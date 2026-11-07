import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !blocked.check(address, 'ipv4');
  return version === 6 && publicV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function remoteUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80', '443'].includes(url.port))) throw new Error('Only public HTTP(S) video URLs on ports 80/443 are supported');
  return url;
}

/** Download before probing. DNS is validated and pinned to prevent rebinding;
 * every redirect receives the same validation. FFmpeg never handles network URLs. */
export async function downloadRemoteSource(source: string, destination: string): Promise<void> {
  let url = remoteUrl(source);
  const signal = AbortSignal.timeout(15 * 60 * 1000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Video source must resolve exclusively to public internet addresses');
    const pinned = addresses[0];
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        // Wikimedia requires an identifiable client, rather than an empty UA.
        headers: { 'User-Agent': 'AbsoluteCinema/1.0 (+https://absolutecine.duckdns.org)', Accept: 'video/*, application/octet-stream;q=0.9, */*;q=0.1' },
        signal, ...{ autoSelectFamily: false }, lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
      }, resolve);
      request.setTimeout(30_000, () => request.destroy(new Error('Video source stalled')));
      request.once('error', reject);
      request.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      response.destroy();
      if (!response.headers.location) throw new Error('Video redirect has no destination');
      url = remoteUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (response.statusCode !== 200) { response.destroy(); throw new Error(`Video source returned HTTP ${response.statusCode}`); }
    if (/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers['content-type'] ?? '')) {
      response.destroy();
      throw new Error('Video URL points to a web page. Use a direct video file URL (Wikimedia: Original file).');
    }
    let size = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(size > 8 * 1024 ** 3 ? new Error('Video source exceeds 8 GiB') : null, chunk);
    } });
    await pipeline(response, limit, createWriteStream(destination, { flags: 'wx' }), { signal });
    return;
  }
  throw new Error('Too many video source redirects');
}
