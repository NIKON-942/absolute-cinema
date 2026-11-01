/** Offline Stripe SDK transport + real Nest HTTP webhook on an isolated CI DB. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import pg from 'pg';
import Stripe from 'stripe';

assert.equal(process.env.ALLOW_SMOKE_FIXTURES, 'true', 'An isolated CI database is required');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { PaymentsService } = require('../dist/modules/payments/payments.service.js');
const secret = 'whsec_ci_offline_only';
const config = { get: key => ({
  stripe: { enabled: true, secretKey: 'sk_test_ci_offline_only', webhookSecret: secret },
  clientUrl: 'http://localhost',
})[key] };
const saved = [];
const repository = { update: async () => ({ affected: 1 }), create: value => value,
  save: async value => { saved.push(value); return { id: 1, ...value }; } };
const payments = new PaymentsService(config, {}, {
  findOne: async () => ({ monthlyPrice: '9.99', yearlyPrice: '99.99', currency: 'usd' }),
}, repository, repository);
const requests = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  requests.push({ url: req.url, headers: req.headers, form: new URLSearchParams(body) });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'cs_test_offline', object: 'checkout.session', url: 'http://localhost/checkout' }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const apiVersion = payments.stripe.getApiField('version');
  assert.equal(apiVersion, '2026-10-28.endive');
  payments.stripe = new Stripe('sk_test_ci_offline_only', {
    host: '127.0.0.1', port: server.address().port, protocol: 'http', apiVersion,
  });
  for (const [period, interval, amount] of [['monthly', 'month', '999'], ['yearly', 'year', '9999']]) {
    const result = await payments.createCheckout(1, 'basic', period);
    assert.equal(result.checkoutUrl, 'http://localhost/checkout');
    const request = requests.at(-1);
    assert.equal(request.url, '/v1/checkout/sessions');
    assert.equal(request.headers['stripe-version'], apiVersion);
    assert.equal(request.form.get('mode'), 'subscription');
    assert.equal(request.form.get('line_items[0][price_data][recurring][interval]'), interval);
    assert.equal(request.form.get('line_items[0][price_data][unit_amount]'), amount);
    assert.equal(request.form.get('metadata[sessionId]'), request.form.get('client_reference_id'));
    assert.ok(saved.some(row => row.sessionId === request.form.get('client_reference_id')));
  }
  console.log('PASS Stripe 23 monthly/yearly Checkout transport and pinned API version (offline)');
} finally {
  await new Promise(resolve => server.close(resolve));
}

const client = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
await client.connect();
let sessionId;
try {
  const result = await client.query("SELECT session_id FROM payment_transactions WHERE status = 'paid' ORDER BY id DESC LIMIT 1");
  assert.equal(result.rowCount, 1, 'Run smoke-plans.mjs first');
  sessionId = result.rows[0].session_id;
} finally {
  await client.end();
}
const app = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env,
  NODE_ENV: 'development', PORT: '4100', STRIPE_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_ci_offline_only', STRIPE_WEBHOOK_SECRET: secret,
}, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
for (const stream of [app.stdout, app.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
const exited = once(app, 'exit');
const base = 'http://127.0.0.1:4100/api';
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (app.exitCode !== null) throw new Error(logs);
    try { ready = (await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, logs);
  const spec = await (await fetch(`${base}/docs-json`)).json();
  assert.ok(spec.paths['/api/payments/webhook']);
  const payload = JSON.stringify({ id: 'evt_ci', object: 'event', type: 'checkout.session.completed',
    data: { object: { id: 'cs_ci', object: 'checkout.session', metadata: { sessionId, note: 'Перевірка' } } },
  }, null, 2);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const send = sig => fetch(`${base}/payments/webhook`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': sig }, body: payload });
  assert.equal((await send('invalid')).status, 400);
  assert.equal((await send(signature)).status, 200);
  assert.equal((await send(signature)).status, 200);
  const invalid = await fetch(`${base}/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'invalid', password: '' }) });
  assert.equal(invalid.status, 400);
  console.log('PASS Nest 12 Swagger/DTO validation and Stripe signed raw-body webhook/replay');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  app.kill('SIGTERM');
  await exited;
}
