import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// Memory stays bounded to one 16 MiB part, including for multi-gigabyte files.
self.onmessage = async ({ data }: MessageEvent<{ file: File; chunkSize: number }>) => {
  try {
    const full = sha256.create();
    const chunks: string[] = [];
    for (let offset = 0; offset < data.file.size; offset += data.chunkSize) {
      const bytes = new Uint8Array(await data.file.slice(offset, offset + data.chunkSize).arrayBuffer());
      full.update(bytes); chunks.push(bytesToHex(sha256(bytes)));
      self.postMessage({ progress: Math.floor(Math.min(offset + data.chunkSize, data.file.size) / data.file.size * 100) });
    }
    self.postMessage({ manifest: { filename: data.file.name, size: data.file.size, sha256: bytesToHex(full.digest()), chunks } });
  } catch { self.postMessage({ error: 'Cannot read the selected file' }); }
};
