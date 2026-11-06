import assert from 'node:assert/strict';
const origin = process.argv[2];
assert.ok(origin, 'Usage: node scripts/check-public-pages.mjs http://localhost');
for (const slug of ['privacy', 'terms']) {
  for (const suffix of ['', '/']) {
    const response = await fetch(new URL('/' + slug + suffix, origin), { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, slug + suffix + ' must be public without a redirect or sign-in');
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(response.headers.get('cache-control') ?? '', /no-cache/);
    const html = await response.text();
    assert.match(html, /<article lang="uk"/);
    assert.match(html, /<article lang="en"/);
    assert.match(html, /href="mailto:/);
    assert.ok(html.includes('href="https://absolutecine.duckdns.org/' + slug + '"'));
    assert.doesNotMatch(html, /<script[\s>]/i, 'Legal text must be readable without running JavaScript');
    assert.doesNotMatch(html, /id="root"/);
  }
  console.log('PASS public bilingual ' + slug + ' page, no scripts or login, correct cache headers');
}
const home = await fetch(new URL('/', origin), { signal: AbortSignal.timeout(10000) });
assert.equal(home.status, 200);
const html = await home.text();
assert.match(html, /href="\/privacy"/);
assert.match(html, /href="\/terms"/);
console.log('PASS homepage exposes both legal links in its HTML');
