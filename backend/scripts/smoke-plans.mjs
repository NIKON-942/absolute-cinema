/**
 * One-off smoke test for tier enforcement (run against a dev backend).
 *   node scripts/smoke-plans.mjs
 * Exercises: mock checkout per tier, quality cap (402), device limit (409),
 * device listing/revocation, and the TTL-freeing path via /devices/end.
 */
const BASE = 'http://localhost:4000/api';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures++;
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { /* stream or empty */ }
  return { status: res.status, data, text };
}

async function subscribe(token, tier) {
  const co = await api('POST', '/payments/checkout', { token, body: { tier, period: 'monthly' } });
  if (co.status !== 201 && co.status !== 200) throw new Error(`checkout failed: ${co.status}`);
  const sessionId = co.data.checkoutUrl.split('/').pop();
  const done = await api('POST', `/payments/mock-complete/${sessionId}`, { token });
  if (done.status !== 200) throw new Error(`mock-complete failed: ${done.status}`);
}

const main = async () => {
  // login
  const login = await api('POST', '/auth/login', { body: { email: 'viewer@cinema.local', password: 'Viewer12345' } });
  check('login viewer', login.status === 200 || login.status === 201);
  const token = login.data.accessToken;

  // plans expose the new tiers + limits
  const plans = await api('GET', '/payments/plans');
  const tiers = plans.data.map((p) => `${p.tier}:${p.maxDevices}x${p.maxQuality}${p.prioritySupport ? '*' : ''}`);
  check('plans = basic(1x720p), plus(2x1080p), premium(4x1080p*)',
    JSON.stringify(tiers) === JSON.stringify(['basic:1x720p', 'plus:2x1080p', 'premium:4x1080p*']),
    tiers.join(', '));

  // pick a movie that has renditions
  const movies = await api('GET', '/media?limit=20');
  const movie = movies.data.items.find((m) => m.availableQualities.includes('1080p'));
  check('found movie with 1080p rendition', Boolean(movie), movie?.title);

  // ----- BASIC tier -----
  await subscribe(token, 'basic');
  const meBasic = await api('GET', '/auth/me', { token });
  check('subscribed to basic', meBasic.data.activeSubscription?.tier === 'basic');

  const s1080 = await api('GET', `/media/${movie.id}/stream?quality=1080p&deviceId=smoke-a&token=${token}`, {});
  check('basic + 1080p → 402 UPGRADE_REQUIRED', s1080.status === 402 && s1080.data?.code === 'UPGRADE_REQUIRED',
    `status=${s1080.status}`);

  const s720 = await fetch(`${BASE}/media/${movie.id}/stream?quality=720p&deviceId=smoke-a&token=${token}`, { headers: { Range: 'bytes=0-1023' } });
  check('basic + 720p → 206 partial', s720.status === 206, `status=${s720.status}`);
  await s720.body.cancel();

  // device limit: basic allows 1
  const hbA = await api('POST', '/devices/heartbeat', { token, body: { deviceId: 'smoke-a' } });
  check('heartbeat device A ok', hbA.status === 200 && hbA.data.activeDevices === 1);
  const hbB = await api('POST', '/devices/heartbeat', { token, body: { deviceId: 'smoke-b' } });
  check('basic + 2nd device → 409 DEVICE_LIMIT', hbB.status === 409 && hbB.data?.code === 'DEVICE_LIMIT',
    `status=${hbB.status}`);

  const streamB = await fetch(`${BASE}/media/${movie.id}/stream?quality=480p&deviceId=smoke-b&token=${token}`);
  check('basic + stream from 2nd device → 409', streamB.status === 409);
  await streamB.body.cancel();

  const devList = await api('GET', '/devices', { token });
  check('GET /devices shows 1 session, max 1', devList.data.devices?.length === 1 && devList.data.maxDevices === 1);

  // ----- PLUS tier (upgrade) -----
  await subscribe(token, 'plus');
  const hbB2 = await api('POST', '/devices/heartbeat', { token, body: { deviceId: 'smoke-b' } });
  check('plus: 2nd device now allowed', hbB2.status === 200 && hbB2.data.activeDevices === 2);
  const hbC = await api('POST', '/devices/heartbeat', { token, body: { deviceId: 'smoke-c' } });
  check('plus + 3rd device → 409', hbC.status === 409 && hbC.data?.code === 'DEVICE_LIMIT');

  const s1080plus = await fetch(`${BASE}/media/${movie.id}/stream?quality=1080p&deviceId=smoke-a&token=${token}`, { headers: { Range: 'bytes=0-1023' } });
  check('plus + 1080p → 206 partial', s1080plus.status === 206, `status=${s1080plus.status}`);
  await s1080plus.body.cancel();

  // revoke frees a slot: a is gone, so c joins b within the 2-device cap
  const rev = await api('DELETE', '/devices/smoke-a', { token });
  check('DELETE /devices/:id ok', rev.status === 200);
  const hbC2 = await api('POST', '/devices/heartbeat', { token, body: { deviceId: 'smoke-c' } });
  check('after revoke, freed slot admits a new device', hbC2.status === 200 && hbC2.data.activeDevices === 2,
    `status=${hbC2.status}, active=${hbC2.data?.activeDevices}`);

  // end releases the slot immediately: only c remains
  const endB = await api('POST', '/devices/end?deviceId=smoke-b', { token });
  check('POST /devices/end ok', endB.status === 200);
  const hbC3 = await api('POST', '/devices/heartbeat', { token, body: { deviceId: 'smoke-c' } });
  check('after end, only 1 session remains', hbC3.status === 200 && hbC3.data.activeDevices === 1,
    `status=${hbC3.status}, active=${hbC3.data?.activeDevices}`);

  // ----- PREMIUM tier -----
  await subscribe(token, 'premium');
  const hbD = await api('POST', '/devices/heartbeat', { token, body: { deviceId: 'smoke-d' } });
  const hbE = await api('POST', '/devices/heartbeat', { token, body: { deviceId: 'smoke-e' } });
  const hbF = await api('POST', '/devices/heartbeat', { token, body: { deviceId: 'smoke-f' } });
  check('premium: 4 concurrent devices ok', [hbD.status, hbE.status, hbF.status].every((s) => s === 200) && hbF.data.activeDevices === 4);

  // cleanup: cancel subscription + end all sessions so the demo account is reusable
  await api('POST', '/payments/subscription/cancel', { token });
  for (const d of ['smoke-a', 'smoke-b', 'smoke-c', 'smoke-d', 'smoke-e', 'smoke-f']) {
    await api('POST', `/devices/end?deviceId=${d}`, { token });
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => { console.error('Smoke test crashed:', err); process.exit(1); });
