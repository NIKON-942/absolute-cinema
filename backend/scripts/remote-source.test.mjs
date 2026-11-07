import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

const require = createRequire(import.meta.url);
const dns = require('node:dns/promises');
const http = require('node:http');
const https = require('node:https');
const { downloadRemoteSource } = require('../dist/modules/media/remote-source.js');

async function fixture(t, responses, run) {
  const root = resolve('.tmp/remote-source-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  const requests = [];
  t.mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  const request = (url, options, callback) => {
    requests.push({ url, options });
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.end = () => {
      const next = responses.shift();
      assert.ok(next, 'Unexpected extra request');
      const response = Object.assign(Readable.from([Buffer.from(next.body ?? '')]), {
        statusCode: next.status ?? 200, headers: next.headers ?? {},
      });
      queueMicrotask(() => callback(response));
    };
    return req;
  };
  t.mock.method(http, 'request', request);
  t.mock.method(https, 'request', request);
  try { await run(join(directory, 'source'), requests); }
  finally {
    assert.equal(resolve(directory).startsWith(root + (process.platform === 'win32' ? '\\' : '/')), true);
    await rm(directory, { recursive: true, force: true });
  }
}

test('remote downloads identify the application on the initial request and redirects', async t => {
  await fixture(t, [
    { status: 302, headers: { location: 'https://upload.wikimedia.org/example.webm' } },
    { headers: { 'content-type': 'video/webm' }, body: 'video bytes' },
  ], async (destination, requests) => {
    await downloadRemoteSource('https://commons.wikimedia.org/example', destination);
    assert.equal(await readFile(destination, 'utf8'), 'video bytes');
    assert.equal(requests.length, 2);
    for (const { options } of requests) {
      assert.match(options.headers['User-Agent'], /^AbsoluteCinema\/1\.0 \(\+https:\/\//);
      assert.equal(options.autoSelectFamily, false);
      await new Promise((resolve, reject) => options.lookup('example', {}, (error, address, family) => {
        if (error) return reject(error);
        assert.equal(address, '93.184.216.34'); assert.equal(family, 4); resolve();
      }));
    }
  });
});

test('HTML and XHTML pages fail clearly before any destination file is created', async t => {
  for (const contentType of ['text/html; charset=utf-8', 'application/xhtml+xml']) {
    await fixture(t, [{ headers: { 'content-type': contentType }, body: '<html>File page</html>' }], async destination => {
      await assert.rejects(downloadRemoteSource('https://commons.wikimedia.org/wiki/File:Example.webm', destination), /direct video file URL/);
      await assert.rejects(stat(destination), { code: 'ENOENT' });
    });
    t.mock.restoreAll();
  }
});

test('forbidden sources still fail without creating a media file', async t => {
  await fixture(t, [{ status: 403 }], async destination => {
    await assert.rejects(downloadRemoteSource('https://upload.wikimedia.org/example.webm', destination), /HTTP 403/);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
  });
});
