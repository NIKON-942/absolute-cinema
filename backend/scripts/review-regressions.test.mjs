import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

assert.equal(process.env.ALLOW_SMOKE_FIXTURES, 'true', 'Use an isolated test database');
assert.equal(process.env.DB_NAME, 'cinema_review', 'Never run these fixtures on an application database');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { AppDataSource: db } = require('../dist/database/data-source.js');
const { AuthService } = require('../dist/modules/auth/auth.service.js');
const { UsersService } = require('../dist/modules/users/users.service.js');
const { PaymentsService, billingEnd } = require('../dist/modules/payments/payments.service.js');
const { MediaService } = require('../dist/modules/media/media.service.js');
const { UserEntity } = require('../dist/modules/users/user.entity.js');
const { SubscriptionEntity } = require('../dist/modules/payments/entities/subscription.entity.js');
const { PaymentTransactionEntity } = require('../dist/modules/payments/entities/payment-transaction.entity.js');
const { SubscriptionPlanEntity } = require('../dist/modules/payments/entities/subscription-plan.entity.js');
const { MovieEntity } = require('../dist/modules/media/entities/movie.entity.js');
const { GenreEntity } = require('../dist/modules/media/entities/genre.entity.js');
const { ActorEntity } = require('../dist/modules/media/entities/actor.entity.js');
const { CountryEntity } = require('../dist/modules/media/entities/country.entity.js');
const { DirectorEntity } = require('../dist/modules/media/entities/director.entity.js');
const { RatingEntity } = require('../dist/modules/media/entities/rating.entity.js');
const { WatchProgressEntity } = require('../dist/modules/media/entities/watch-progress.entity.js');
const { IsPassword } = require('../dist/common/validators/password.js');
const { validate } = require('class-validator');
const { isPublicAddress, downloadRemoteSource } = require('../dist/modules/media/remote-source.js');
const { validatePoster, validateUploadedVideo } = require('../dist/modules/media/upload-validation.js');
const repo = entity => db.getRepository(entity);
const config = { get: key => key === 'stripe' ? { enabled: false } : 'http://localhost' };
const mail = { sendWelcome() {}, sendPasswordReset() {}, sendReceipt() {} };
let auth, users, payments, media;

before(async () => {
  await db.initialize();
  users = new UsersService(repo(UserEntity), repo(SubscriptionEntity), db);
  auth = new AuthService({ sign: value => JSON.stringify(value) }, config, users, mail, repo(UserEntity));
  payments = new PaymentsService(config, mail, repo(SubscriptionPlanEntity), repo(SubscriptionEntity), repo(PaymentTransactionEntity));
  media = new MediaService(repo(MovieEntity), repo(GenreEntity), repo(ActorEntity), repo(CountryEntity), repo(DirectorEntity), repo(RatingEntity), repo(WatchProgressEntity), {});
  await repo(SubscriptionPlanEntity).upsert({ tier: 'basic', monthlyPrice: '4.99', yearlyPrice: '49.99', currency: 'usd' }, ['tier']);
});
after(async () => { if (db.isInitialized) await db.destroy(); });
const newUser = async () => (await auth.register({ email: `${randomUUID()}@example.com`, name: 'Test viewer', password: 'abcdefgh' })).user;

test('fifth failed login locks the account for an hour, including concurrent attempts', async () => {
  const user = await newUser();
  const attempts = await Promise.allSettled(Array.from({ length: 7 }, () => auth.login({ email: user.email, password: 'wrong' })));
  assert.ok(attempts.every(result => result.status === 'rejected'));
  let saved = await repo(UserEntity).findOneByOrFail({ id: user.id });
  assert.equal(saved.failedLoginAttempts, 5);
  assert.ok(saved.loginLockedUntil.getTime() > Date.now() + 59 * 60 * 1000);
  await assert.rejects(auth.login({ email: user.email, password: 'abcdefgh' }), /locked/);
  await repo(UserEntity).update(user.id, { loginLockedUntil: new Date(Date.now() - 1) });
  await auth.login({ email: user.email, password: 'abcdefgh' });
  saved = await repo(UserEntity).findOneByOrFail({ id: user.id });
  assert.equal(saved.failedLoginAttempts, 0);
  assert.equal(saved.loginLockedUntil, null);
});

test('only one concurrent reset can consume a token and revoke sessions', async () => {
  const user = await newUser(); const token = randomUUID();
  await repo(UserEntity).update(user.id, { resetTokenHash: createHash('sha256').update(token).digest('hex'), resetTokenExpiresAt: new Date(Date.now() + 60_000) });
  const results = await Promise.allSettled([
    auth.resetPassword({ token, newPassword: 'first-password' }),
    auth.resetPassword({ token, newPassword: 'second-password' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const saved = await repo(UserEntity).findOneByOrFail({ id: user.id });
  assert.equal(saved.resetTokenHash, null); assert.equal(saved.tokenVersion, 1);
});

test('rating pagination executes in PostgreSQL and catalog preserves personalized fields', async () => {
  const user = await newUser();
  const movie = await repo(MovieEntity).save({ title: randomUUID(), year: 2026 });
  await repo(RatingEntity).save({ userId: user.id, movieId: movie.id, value: 9 });
  await media.toggleFavorite(movie.id, user.id);
  const result = await media.listMovies({ sort: 'rating', page: 1, limit: 20 }, user.id);
  const found = result.items.find(m => m.id === movie.id);
  assert.equal(found.userRating, 9); assert.equal(found.isFavorite, true);
  assert.equal((await users.list(String(user.id), 1, 20)).items.some(u => u.id === user.id), true);
  await media.removeMovie(movie.id);
  assert.equal(await repo(RatingEntity).countBy({ movieId: movie.id }), 0);
});

test('payment failure rolls back all writes; webhook retries and concurrent completions activate exactly once', async () => {
  const user = await newUser();
  const { checkoutUrl } = await payments.createCheckout(user.id, 'basic', 'monthly');
  const sessionId = checkoutUrl.split('/').at(-1);
  const manager = repo(PaymentTransactionEntity).manager;
  const original = manager.transaction;
  manager.transaction = callback => original.call(manager, async em => {
    const update = em.update.bind(em);
    em.update = async (entity, criteria, patch) => {
      const result = await update(entity, criteria, patch);
      if (entity === PaymentTransactionEntity && patch.status === 'paid') throw new Error('simulated DB failure after writes');
      return result;
    };
    return callback(em);
  });
  try { await assert.rejects(payments.complete(sessionId, user.id), /simulated DB/); }
  finally { manager.transaction = original; }
  assert.equal((await repo(PaymentTransactionEntity).findOneByOrFail({ sessionId })).status, 'pending');
  assert.equal(await repo(SubscriptionEntity).countBy({ userId: user.id, status: 'active' }), 0);
  await Promise.all([payments.complete(sessionId, user.id), payments.complete(sessionId, user.id)]);
  assert.equal(await repo(SubscriptionEntity).countBy({ userId: user.id, status: 'active' }), 1);
  await payments.cancelSubscription(user.id);
  assert.equal((await users.findWithSubscription(user.id)).hasActiveSubscription, true);
  assert.equal((await users.findWithSubscription(user.id)).activeSubscription.cancelAtPeriodEnd, true);
});

test('failed orders allow three explicit retries without rewriting creation timestamps', async () => {
  const user = await newUser();
  let url = (await payments.createCheckout(user.id, 'basic', 'monthly')).checkoutUrl;
  for (let retry = 0; retry < 4; retry++) {
    const id = url.split('/').at(-1);
    const initial = await repo(PaymentTransactionEntity).findOneByOrFail({ sessionId: id });
    await repo(PaymentTransactionEntity).update(initial.id, { expiresAt: new Date(Date.now() - 1) });
    await payments.expireStalePendingOrders();
    const expired = await repo(PaymentTransactionEntity).findOneByOrFail({ id: initial.id });
    assert.equal(expired.status, 'failed'); assert.equal(+expired.createdAt, +initial.createdAt);
    if (retry === 3) await assert.rejects(payments.retry(user.id, id), /cannot be retried/);
    else url = (await payments.retry(user.id, id)).checkoutUrl;
  }
});

test('Stripe renewal invoices are idempotent; cancellation reaches the provider and preserves paid access', async () => {
  const user = await newUser();
  const id = (await payments.createCheckout(user.id, 'basic', 'monthly')).checkoutUrl.split('/').at(-1);
  const start = Math.floor(Date.now() / 1000);
  const external = { id: `sub_${randomUUID()}`, status: 'active', metadata: { sessionId: id }, cancel_at_period_end: false,
    items: { data: [{ current_period_start: start, current_period_end: start + 3600 }] } };
  const remoteCalls = [];
  payments.stripe = { subscriptions: { retrieve: async () => external,
    update: async (id, body) => { remoteCalls.push({ id, body }); return external; } }, webhooks: { constructEvent: payload => JSON.parse(payload) } };
  try {
    await payments.complete(id, undefined, external);
    const invoice = { id: `in_${randomUUID()}`, parent: { subscription_details: { subscription: external.id } },
      billing_reason: 'subscription_cycle', amount_paid: 499, currency: 'usd',
      lines: { data: [{ parent: { type: 'subscription_item_details' }, period: { end: start + 7200 } }] } };
    const payload = Buffer.from(JSON.stringify({ type: 'invoice.paid', data: { object: invoice } }));
    await Promise.all([payments.handleWebhook(payload, ''), payments.handleWebhook(payload, '')]);
    assert.equal(await repo(PaymentTransactionEntity).countBy({ sessionId: `invoice:${invoice.id}` }), 1);
    const sub = await repo(SubscriptionEntity).findOneByOrFail({ stripeSubscriptionId: external.id });
    assert.equal(+sub.endsAt, (start + 7200) * 1000);
    await payments.cancelSubscription(user.id);
    assert.deepEqual(remoteCalls, [{ id: external.id, body: { cancel_at_period_end: true } }]);
    assert.equal((await users.findWithSubscription(user.id)).hasActiveSubscription, true);
  } finally { payments.stripe = null; }
});

test('enabled Stripe never falls back to mock mode on missing secrets', () => {
  assert.throws(() => new PaymentsService({ get: () => ({ enabled: true, secretKey: '' }) }, mail, {}, {}, {}), /required/);
});

test('calendar billing clamps end-of-month and leap-day subscriptions', () => {
  assert.equal(billingEnd(new Date('2026-01-31T12:00:00Z'), 'monthly').toISOString(), '2026-02-28T12:00:00.000Z');
  assert.equal(billingEnd(new Date('2024-02-29T12:00:00Z'), 'yearly').toISOString(), '2025-02-28T12:00:00.000Z');
});

test('server password validation follows FR-2 and rejects bcrypt truncation', async () => {
  class Dto {} IsPassword()(Dto.prototype, 'password');
  for (const [password, valid] of [['abcdefgh', true], ['пароль123', true], ['short', false], ['😀'.repeat(20), false]]) {
    assert.equal((await validate(Object.assign(new Dto(), { password }))).length === 0, valid);
  }
});

test('remote video rejects internal, reserved, mapped and metadata addresses before downloading', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.2', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '192.0.2.1']) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  await mkdir('.tmp', { recursive: true });
  await assert.rejects(downloadRemoteSource('http://127.0.0.1/source.mp4', join('.tmp', `${randomUUID()}.mp4`)), /public/);
});

test('upload validation checks poster bytes and video codecs, not only MIME names', async () => {
  await mkdir('.tmp', { recursive: true });
  const path = join('.tmp', `${randomUUID()}.png`);
  await writeFile(path, '<html>fake image</html>');
  await assert.rejects(validatePoster({ path, originalname: 'poster.png', size: 23 }), /Poster must/);
  await assert.rejects(stat(path), { code: 'ENOENT' });
  await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  try { await validatePoster({ path, originalname: 'poster.png', size: 8 }); }
  finally { await rm(path, { force: true }); }
  validateUploadedVideo({ format: 'mov,mp4,m4a,3gp,3g2,mj2', codec: 'h264', audio: { codec: 'aac' } }, 'video.mp4');
  assert.throws(() => validateUploadedVideo({ format: 'mov,mp4', codec: 'mpeg4' }, 'video.mp4'), /Upload MP4/);
  assert.throws(() => validateUploadedVideo({ format: 'avi', codec: 'h264' }, 'video.avi'), /Upload MP4/);
});

test('the last active administrator cannot be blocked, deleted or demoted', async () => {
  const previous = await repo(UserEntity).findBy({ role: 'admin' });
  for (const admin of previous) await repo(UserEntity).update(admin.id, { isBlocked: true });
  const user = await newUser();
  await repo(UserEntity).update(user.id, { role: 'admin' });
  try {
    await assert.rejects(users.setRole(user.id, 'viewer'), /last active administrator/);
    await assert.rejects(users.setBlocked(user.id, true), /last active administrator/);
    await assert.rejects(users.remove(user.id), /last active administrator/);
  } finally {
    for (const admin of previous) await repo(UserEntity).update(admin.id, { isBlocked: admin.isBlocked });
    await repo(UserEntity).update(user.id, { role: 'viewer' });
  }
  await users.remove(user.id);
});
