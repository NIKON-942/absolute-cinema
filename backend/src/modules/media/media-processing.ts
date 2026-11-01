import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export type ProcessingProgress = (seconds: number, finalizing?: boolean) => void;
export interface MediaProbe {
  width: number; height: number; duration: number | null;
  videoIndex?: number;
  startTime?: number;
  codec?: string; pixelFormat?: string; profile?: string; level?: number;
  frameRate?: number; aspect?: string; fieldOrder?: string; rotation?: number;
  audio?: { index: number; codec: string; profile?: string; channels: number; sampleRate: number; language?: string; startTime?: number };
}

export async function probeMedia(input: string): Promise<MediaProbe> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60_000, windowsHide: true });
  const data = JSON.parse(stdout);
  const video = data.streams?.find((s: { codec_type: string; disposition?: { attached_pic?: number } }) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video?.height || !video?.width) throw new Error('Master source must contain a video stream with valid dimensions');
  const tracks = data.streams.filter((s: { codec_type: string }) => s.codec_type === 'audio');
  const audio = tracks.find((s: { disposition?: { default?: number } }) => s.disposition?.default) ?? tracks[0];
  const [numerator, denominator] = String(video.avg_frame_rate ?? '').split('/').map(Number);
  const duration = Number(data.format?.duration ?? video.duration);
  return {
    width: video.width, height: video.height, videoIndex: video.index, duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    codec: video.codec_name, pixelFormat: video.pix_fmt, profile: video.profile, level: video.level,
    startTime: Number(data.format?.start_time) || 0,
    frameRate: denominator > 0 ? numerator / denominator : undefined, aspect: video.sample_aspect_ratio,
    fieldOrder: video.field_order, rotation: Number(video.side_data_list?.find((s: { rotation?: number }) => s.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0),
    audio: audio ? { index: audio.index, codec: audio.codec_name, profile: audio.profile, channels: audio.channels,
      sampleRate: Number(audio.sample_rate), language: audio.tags?.language, startTime: Number(audio.start_time) || 0 } : undefined,
  };
}

/** Copy only an exact, conservative web-compatible H.264 rendition. Other
 * formats, HDR/10-bit, interlacing, rotation, or scaling require encoding. */
export function canCopyVideo(meta: MediaProbe, height: number) {
  return meta.height === height && meta.width > 0 && meta.width <= 1920 && meta.height <= 1080
    && meta.width % 2 === 0 && meta.height % 2 === 0 && meta.codec === 'h264' && meta.pixelFormat === 'yuv420p'
    && ['Constrained Baseline', 'Baseline', 'Main', 'High'].includes(meta.profile ?? '')
    && (meta.level ?? Infinity) <= 42 && (meta.frameRate ?? Infinity) <= 60 && (meta.frameRate ?? 0) > 0
    && (!meta.aspect || meta.aspect === '1:1') && (!meta.fieldOrder || ['unknown', 'progressive'].includes(meta.fieldOrder))
    && !meta.rotation;
}

export function canCopyAudio(meta: MediaProbe) {
  const a = meta.audio;
  return Boolean(a && a.codec === 'aac' && a.profile === 'LC' && a.channels >= 1 && a.channels <= 2
    && a.sampleRate >= 8000 && a.sampleRate <= 48000);
}

/** AAC mono/stereo is preserved bit-for-bit; surround and other codecs become
 * AAC-LC stereo at 256 kbit/s. FFmpeg's standard downmix includes the centre
 * dialogue channel. No gain, normalization, or loudness filter is applied. */
export async function prepareWebAudio(input: string, output: string, meta: MediaProbe, progress?: ProcessingProgress) {
  if (!meta.audio) throw new Error('The source has no audio stream');
  const encoding = canCopyAudio(meta) ? ['-c:a', 'copy']
    : ['-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '256k', '-ac', '2', '-ar', '48000'];
  await runFfmpeg(['-i', input, '-map', `0:${meta.audio.index}`, '-vn', '-sn', '-dn', ...encoding,
    '-movflags', '+faststart', output], progress);
}

export async function renderWebVideo(input: string, output: string, height: number, meta: MediaProbe,
  audio: string | undefined, progress?: ProcessingProgress, forceCopy = false) {
  const copy = forceCopy || canCopyVideo(meta, height);
  const offset = (meta.audio?.startTime ?? 0) - (meta.startTime ?? 0);
  const args = ['-i', input, ...(audio ? ['-itsoffset', String(offset), '-i', audio] : []), '-map', meta.videoIndex !== undefined ? `0:${meta.videoIndex}` : '0:v:0',
    ...(audio ? ['-map', '1:a:0', '-c:a', 'copy'] : ['-an']), '-sn', '-dn'];
  args.push(...(copy ? ['-c:v', 'copy'] : [
    '-vf', `scale=-2:'min(${height},ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`,
    '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
  ]));
  args.push('-movflags', '+faststart', output);
  await runFfmpeg(args, progress);
}

/** Every subprocess bypasses the shell, including user-controlled filenames. */
export function runFfmpeg(args: string[], progress?: ProcessingProgress): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-y', ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = ''; let stderr = ''; let seconds = 0;
    const parse = (line: string) => {
      if (line.startsWith('out_time_us=')) {
        const value = Number(line.slice(12).trim());
        if (Number.isFinite(value) && value >= 0) { seconds = value / 1_000_000; progress?.(seconds); }
      } else if (line.trim() === 'progress=end') progress?.(seconds, true);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; lines.forEach(parse);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (buffer) parse(buffer);
      if (code === 0) resolve(); else reject(new Error(`FFmpeg failed (${signal ?? code}): ${stderr.trim()}`));
    });
  });
}

/** Hash encoded packet payloads, rather than container bytes changed by remux. */
export async function streamHash(file: string, stream: 'v' | 'a') {
  const { stdout } = await exec('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-map', `0:${stream}:0`, '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-'],
    { encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 1024 * 1024, windowsHide: true });
  return stdout.trim();
}
