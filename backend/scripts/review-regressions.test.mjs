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
let auth, users, payments, media, testHead;
const removeUser = id => users.remove(id, testHead.id);

test('head administrator bootstrap, explicit promotion and migration rollback preserve existing accounts', async () => {
  const { spawnSync } = require('node:child_process');
  const { DataSource } = require('typeorm');
  const database = 'cinema_head_' + randomUUID().replaceAll('-', '');
  const email = 'head-bootstrap@example.com';
  const env = { ...process.env, DB_NAME: database, INITIAL_ADMIN_EMAIL: email, INITIAL_ADMIN_PASSWORD: 'isolated-head-password-12345' };
  const run = (file, args = [], success = true) => {
    const result = spawnSync(process.execPath, [join(process.cwd(), 'dist/database', file), ...args], { env, encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status === 0, success, result.stderr + result.stdout);
    return result;
  };
  let isolated;
  await db.query(`CREATE DATABASE "${database}"`);
  try {
    run('run-migrations.js');
    run('bootstrap.js');
    run('bootstrap.js');
    isolated = new DataSource({ ...db.options, database });
    await isolated.initialize();
    const [initial] = await isolated.query('SELECT id, role, password_hash FROM users WHERE email = $1', [email]);
    assert.equal(initial.role, 'head_admin');
    assert.equal((await isolated.query('SELECT count(*)::int AS n FROM users'))[0].n, 1);
    await isolated.undoLastMigration();
    assert.equal((await isolated.query('SELECT role FROM users WHERE id = $1', [initial.id]))[0].role, 'admin');
    run('run-migrations.js');
    await isolated.query("INSERT INTO users (email, name) VALUES ('viewer-bootstrap@example.com', 'Viewer')");
    await isolated.query("INSERT INTO users (email, name, role) VALUES ('other-admin@example.com', 'Other admin', 'admin')");
    env.INITIAL_ADMIN_EMAIL = 'missing@example.com';
    run('bootstrap.js', [], false);
    env.INITIAL_ADMIN_EMAIL = 'viewer-bootstrap@example.com';
    run('bootstrap.js', [], false);
    env.INITIAL_ADMIN_EMAIL = '  ' + email.toUpperCase() + '  ';
    env.INITIAL_ADMIN_PASSWORD = '';
    run('bootstrap.js');
    const [automatic] = await isolated.query('SELECT role, password_hash FROM users WHERE id = $1', [initial.id]);
    assert.equal(automatic.role, 'head_admin');
    assert.equal(automatic.password_hash, initial.password_hash);
    env.INITIAL_ADMIN_EMAIL = 'other-admin@example.com';
    run('bootstrap.js');
    assert.equal((await isolated.query("SELECT role FROM users WHERE email = 'other-admin@example.com'"))[0].role, 'admin', 'Repeated bootstrap does not create additional heads');
    env.INITIAL_ADMIN_EMAIL = email;
    await isolated.query("UPDATE users SET role = 'admin' WHERE id = $1", [initial.id]);
    run('promote-head-admin.js', ['--email', 'viewer-bootstrap@example.com'], false);
    run('promote-head-admin.js', ['--email', email]);
    run('promote-head-admin.js', ['--email', email]);
    run('bootstrap.js');
    const [promoted] = await isolated.query('SELECT role, password_hash FROM users WHERE id = $1', [initial.id]);
    assert.equal(promoted.role, 'head_admin');
    assert.equal(promoted.password_hash, initial.password_hash);
    await isolated.query('UPDATE users SET is_blocked = true WHERE id = $1', [initial.id]);
    run('bootstrap.js', [], false);
    run('promote-head-admin.js', ['--email', email], false);
  } finally {
    if (isolated?.isInitialized) await isolated.destroy();
    await db.query(`DROP DATABASE "${database}"`);
  }
});

before(async () => {
  await db.initialize();
  testHead = await repo(UserEntity).save({ email: randomUUID() + '@example.com', name: 'Fixture head administrator', role: 'head_admin' });
  users = new UsersService(repo(UserEntity), repo(SubscriptionEntity), db);
  auth = new AuthService({ sign: value => JSON.stringify(value) }, config, users, mail, repo(UserEntity));
  payments = new PaymentsService(config, mail, repo(SubscriptionPlanEntity), repo(SubscriptionEntity), repo(PaymentTransactionEntity));
  media = new MediaService(repo(MovieEntity), repo(GenreEntity), repo(ActorEntity), repo(CountryEntity), repo(DirectorEntity), repo(RatingEntity), repo(WatchProgressEntity), {});
  await repo(SubscriptionPlanEntity).upsert({ tier: 'basic', monthlyPrice: '4.99', yearlyPrice: '49.99', currency: 'usd' }, ['tier']);
});
after(async () => { if (db.isInitialized) await db.destroy(); });
const newUser = async () => (await auth.register({ email: `${randomUUID()}@example.com`, name: 'Test viewer', password: 'abcdefgh' })).user;

test('administrative permissions validate actor and target and forbid self-management', async () => {
  const make = role => repo(UserEntity).save({ email: randomUUID() + '@example.com', name: 'Permission fixture', role });
  const admin = await make('admin'), peer = await make('admin'), viewer = await make('viewer');
  const forbidden = error => error.getStatus() === 403;
  try {
    await assert.rejects(users.setRole(viewer.id, 'admin', undefined), forbidden);
    await assert.rejects(users.setRole(viewer.id, 'admin', admin.id), forbidden);
    await assert.rejects(users.setRole(admin.id, 'head_admin', admin.id), forbidden);
    for (const target of [peer, testHead]) {
      await assert.rejects(users.setBlocked(target.id, true, admin.id), forbidden);
      await assert.rejects(users.remove(target.id, admin.id), forbidden);
    }
    await assert.rejects(users.setBlocked(admin.id, true, viewer.id), forbidden);
    for (const operation of [() => users.setRole(testHead.id, 'viewer', testHead.id), () => users.setBlocked(testHead.id, true, testHead.id), () => users.remove(testHead.id, testHead.id)]) {
      await assert.rejects(operation(), forbidden);
    }
    await users.setBlocked(viewer.id, true, admin.id);
    await users.setBlocked(viewer.id, false, admin.id);
    await users.setRole(viewer.id, 'head_admin', testHead.id);
    await users.setRole(viewer.id, 'viewer', testHead.id);
    await users.setRole(admin.id, 'viewer', testHead.id);
    await assert.rejects(users.setBlocked(peer.id, true, admin.id), forbidden, 'Demoted actors lose privileges immediately');
    await users.setBlocked(peer.id, true, testHead.id);
    await assert.rejects(users.setBlocked(viewer.id, true, peer.id), forbidden);
    await users.setBlocked(peer.id, false, testHead.id);
    await users.remove(viewer.id, peer.id);
  } finally {
    for (const user of [admin, peer, viewer]) if (await repo(UserEntity).existsBy({ id: user.id })) await removeUser(user.id);
  }
});

test('concurrent demotion, blocking and deletion preserve an active head administrator', async () => {
  for (const action of ['demote', 'block', 'delete']) {
    const heads = await Promise.all([1, 2].map(() => repo(UserEntity).save({ email: randomUUID() + '@example.com', name: 'Concurrent head', role: 'head_admin' })));
    try {
      await repo(UserEntity).update(testHead.id, { isBlocked: true });
      const act = (target, actor) => action === 'demote' ? users.setRole(target.id, 'admin', actor.id)
        : action === 'block' ? users.setBlocked(target.id, true, actor.id) : users.remove(target.id, actor.id);
      const results = await Promise.allSettled([act(heads[0], heads[1]), act(heads[1], heads[0])]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, action);
      assert.equal(await repo(UserEntity).countBy({ role: 'head_admin', isBlocked: false }), 1, action);
      const survivor = await repo(UserEntity).findOneByOrFail({ role: 'head_admin', isBlocked: false });
      await assert.rejects(act(survivor, survivor), error => error.getStatus() === 403);
    } finally {
      await repo(UserEntity).update(testHead.id, { isBlocked: false });
      for (const user of heads) if (await repo(UserEntity).existsBy({ id: user.id })) await removeUser(user.id);
    }
  }
});

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
  for (const [password, valid] of [['abcdefgh', true], ['пароль123', true], ['short', false], ['\u{10400}'.repeat(20), false]]) {
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
  await assert.rejects(validatePoster({ path, originalname: 'poster.png', size: 23 }), /Image must/);
  await assert.rejects(stat(path), { code: 'ENOENT' });
  await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  try { await validatePoster({ path, originalname: 'poster.png', size: 8 }); }
  finally { await rm(path, { force: true }); }
  validateUploadedVideo({ format: 'mov,mp4,m4a,3gp,3g2,mj2', codec: 'h264', audio: { codec: 'aac' } }, 'video.mp4');
  assert.throws(() => validateUploadedVideo({ format: 'mov,mp4', codec: 'mpeg4' }, 'video.mp4'), /Upload MP4/);
  assert.throws(() => validateUploadedVideo({ format: 'avi', codec: 'h264' }, 'video.avi'), /Upload MP4/);
});


// FR-25, FR-37/39, FR-44 and strict metadata validation on real PostgreSQL.
test('movie references survive dictionary renames and reject deletion while used', async () => {
  const country = await media.createCountry('Country-' + randomUUID());
  const director = await media.createDirector('Director-' + randomUUID());
  const genre = await media.createGenre('Genre-' + randomUUID());
  const actor = await media.createActor('Actor-' + randomUUID());
  const movie = await media.createMovie({ title: randomUUID(), year: '2026', countryId: String(country.id), directorId: director.id, genreIds: JSON.stringify([genre.id]), actorIds: [actor.id] });
  try {
    assert.equal(movie.countryId, country.id); assert.equal(movie.directorId, director.id);
    assert.deepEqual(movie.genres.map(g => g.id), [genre.id]); assert.deepEqual(movie.actors.map(a => a.id), [actor.id]);
    await media.updateCountry(country.id, 'Renamed-' + country.name);
    await media.updateDirector(director.id, 'Renamed-' + director.name);
    const renamed = await media.getMovie(movie.id);
    assert.equal(renamed.country, 'Renamed-' + country.name); assert.equal(renamed.director, 'Renamed-' + director.name);
    const filtered = await media.listMovies({ country: renamed.country, page: 1, limit: 20 });
    assert.equal(filtered.items.find(m => m.id === movie.id).director, renamed.director);
    for (const [remove, id] of [[media.deleteCountry, country.id], [media.deleteDirector, director.id], [media.deleteGenre, genre.id], [media.deleteActor, actor.id]]) {
      await assert.rejects(remove.call(media, id), error => error.getStatus() === 409);
    }
    await media.updateMovie(movie.id, { countryId: '', directorId: '', genreIds: '[]', actorIds: '' });
    const cleared = await media.getMovie(movie.id);
    assert.equal(cleared.countryId, null); assert.equal(cleared.directorId, null); assert.deepEqual(cleared.genres, []);
  } finally {
    await media.removeMovie(movie.id);
    await media.deleteCountry(country.id); await media.deleteDirector(director.id); await media.deleteGenre(genre.id); await media.deleteActor(actor.id);
  }
});

test('multi-genre ANY filters combine with year/country and preserve all genre metadata and pagination', async () => {
  const a = await media.createGenre('GenreA-' + randomUUID()); const b = await media.createGenre('GenreB-' + randomUUID());
  const country = await media.createCountry('FilterCountry-' + randomUUID());
  const make = (year, genreIds) => media.createMovie({ title: randomUUID(), year, genreIds, countryId: country.id });
  const movies = [await make(2026, [a.id, b.id]), await make(2026, [b.id]), await make(2020, [a.id])];
  try {
    const filters = { genreIds: [a.id, b.id], yearFrom: '2025', country: country.name, page: 1, limit: 1 };
    const first = await media.listMovies(filters); const second = await media.listMovies({ ...filters, page: 2 });
    assert.equal(first.total, 2); assert.notEqual(first.items[0].id, second.items[0].id);
    const all = [...first.items, ...second.items];
    assert.deepEqual(all.find(m => m.id === movies[0].id).genres.map(g => g.id).sort(), [a.id, b.id].sort());
    const legacy = await media.listMovies({ genre: a.name, page: 1, limit: 20 });
    assert.equal(legacy.total, 2); assert.equal(legacy.items.find(m => m.id === movies[0].id).genres.length, 2);
  } finally {
    for (const m of movies) await media.removeMovie(m.id);
    await media.deleteGenre(a.id); await media.deleteGenre(b.id); await media.deleteCountry(country.id);
  }
});

test('invalid metadata and unknown IDs fail before any create or partial update', async () => {
  const movie = await media.createMovie({ title: randomUUID(), year: 2026 });
  try {
    for (const patch of [{ year: '2026oops' }, { year: 1800 }, { runtimeMinutes: 0 }, { ageRating: 'R' }, { genreIds: '[1,bad]' }, { actorIds: [2147483647] }, { countryId: 2147483647 }, { directorId: 2147483647 }, { trailerUrl: 'javascript:alert(1)' }, { posterUrl: 'file:///x' }, { surprise: 'unknown' }]) {
      await assert.rejects(media.updateMovie(movie.id, { ...patch, title: 'Must not persist' }), error => error.getStatus() === 400);
      assert.equal((await media.getMovie(movie.id)).title, movie.title);
    }
    const count = await repo(MovieEntity).count();
    await assert.rejects(media.createMovie({ title: 'Invalid new movie', year: 2026, genreIds: '[2147483647]' }), error => error.getStatus() === 400);
    assert.equal(await repo(MovieEntity).count(), count);
    await media.updateMovie(movie.id, { runtimeMinutes: 90, trailerUrl: 'https://example.com/trailer.mp4', originalTitle: 'Original', description: 'Description', keywords: 'one,two' });
    await media.updateMovie(movie.id, { runtimeMinutes: '', trailerUrl: '', originalTitle: '', description: '', keywords: '' });
    const cleared = await media.getMovie(movie.id);
    assert.equal(cleared.runtimeMinutes, null); assert.equal(cleared.trailerUrl, null); assert.equal(cleared.originalTitle, ''); assert.deepEqual(cleared.keywords, []);
    await assert.rejects(media.createGenre('  '), error => error.getStatus() === 400);
    const g = await media.createGenre('Unique-' + randomUUID());
    try { await assert.rejects(media.createGenre(g.name), error => error.getStatus() === 409); }
    finally { await media.deleteGenre(g.id); }
  } finally { await media.removeMovie(movie.id); }
});

test('period analytics deduplicate playback retries, isolate old events and weight the latest ratings correctly', async () => {
  const { AdminService } = require('../dist/modules/admin/admin.service.js');
  const admin = new AdminService(users, repo(MovieEntity), repo(SubscriptionEntity), repo(PaymentTransactionEntity));
  const viewers = [await newUser(), await newUser(), await newUser()];
  const g = await media.createGenre('Analytics-' + randomUUID());
  const movie = await media.createMovie({ title: randomUUID(), year: 2026, genreIds: [g.id] });
  try {
    await repo(MovieEntity).update(movie.id, { viewCount: 1000 });
    await Promise.all(Array.from({ length: 8 }, () => media.recordPlayback(movie.id, viewers[0].id, 'same-session-12345678')));
    await media.recordPlayback(movie.id, viewers[0].id, 'older-session-12345678');
    await db.query("UPDATE playback_events SET created_at = now() - interval '45 days' WHERE movie_id = $1 AND playback_id LIKE 'older%'", [movie.id]);
    assert.equal((await media.getMovie(movie.id)).viewCount, 1002);
    await media.setRating(movie.id, viewers[0].id, 4); await media.setRating(movie.id, viewers[0].id, 9);
    await media.setRating(movie.id, viewers[1].id, 3);
    await db.query("UPDATE rating_events SET created_at = now() - interval '45 days' WHERE movie_id = $1 AND user_id = $2", [movie.id, viewers[1].id]);
    await media.setRating(movie.id, viewers[2].id, 7);
    let report = await admin.analytics(30);
    let top = report.topMovies.find(m => m.id === movie.id);
    assert.equal(top.viewCount, 1); assert.equal(top.averageRating, 8);
    assert.equal(report.genrePopularity.find(row => row.genre === g.name).views, 1);
    assert.equal(report.genrePopularity.find(row => row.genre === g.name).averageRating, 8);
    report = await admin.analytics(90);
    assert.equal(report.topMovies.find(m => m.id === movie.id).viewCount, 2);
    assert.equal(report.topMovies.find(m => m.id === movie.id).averageRating, 6.3);
    await media.deleteRating(movie.id, viewers[0].id);
    report = await admin.analytics(30);
    assert.equal(report.topMovies.find(m => m.id === movie.id).averageRating, 7);
    assert.equal(report.genrePopularity.find(row => row.genre === g.name).averageRating, 7);
    await assert.rejects(media.recordPlayback(movie.id, viewers[0].id, 'bad id'), error => error.getStatus() === 400);
  } finally {
    await media.removeMovie(movie.id); await media.deleteGenre(g.id);
    for (const user of viewers) await removeUser(user.id);
  }
});

test('HTTP metadata validation, multipart relations and playback guards work through Nest', async () => {
  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { JwtService } = require('@nestjs/jwt');
  const { AppModule } = require('../dist/app.module.js');
  const { AllExceptionsFilter } = require('../dist/common/filters/all-exceptions.filter.js');
  const { VIDEOS_DIR } = require('../dist/modules/media/media.constants.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  const administrator = await repo(UserEntity).save({ email: randomUUID() + '@example.com', name: 'HTTP admin', role: 'admin' });
  const viewer = await newUser();
  const tokenFor = user => app.get(JwtService).sign({ sub: user.id, email: user.email, tv: 0 });
  const headers = { Authorization: 'Bearer ' + tokenFor(administrator) };
  const viewerHeaders = { Authorization: 'Bearer ' + tokenFor(viewer) };
  let movie, genre;
  const videoFilename = 'requirements-' + randomUUID() + '.mp4';
  try {
    await app.listen(0, '127.0.0.1');
    const base = 'http://127.0.0.1:' + app.getHttpServer().address().port + '/api';
    const request = (path, options = {}) => fetch(base + path, { ...options, headers: { ...headers, ...options.headers } });
    const headHeaders = { Authorization: 'Bearer ' + tokenFor(testHead), 'Content-Type': 'application/json' };
    assert.equal((await request('/users/' + viewer.id + '/role', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"role":"admin"}' })).status, 403);
    assert.equal((await request('/users/' + administrator.id + '/block', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"isBlocked":true}' })).status, 403);
    assert.equal((await request('/users/' + administrator.id, { method: 'DELETE' })).status, 403);
    for (const path of ['/users', '/admin/analytics', '/admin/media']) assert.equal((await request(path, { headers: headHeaders })).status, 200, path);
    assert.equal((await request('/users/' + viewer.id + '/role', { method: 'PATCH', headers: headHeaders, body: '{"role":"invalid"}' })).status, 400);
    assert.equal((await request('/users/' + viewer.id + '/role', { method: 'PATCH', headers: headHeaders, body: '{"role":"admin"}' })).status, 200);
    assert.equal((await request('/users', { headers: viewerHeaders })).status, 200, 'Existing JWT reflects promotion from the database');
    await users.setRole(viewer.id, 'viewer', testHead.id);
    assert.equal((await request('/users', { headers: viewerHeaders })).status, 403, 'Existing JWT reflects demotion from the database');
    assert.equal((await request('/media/genres', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '   ' }) })).status, 400);
    genre = await media.createGenre('HTTP-' + randomUUID());
    const form = new FormData(); form.set('title', 'HTTP-' + randomUUID()); form.set('year', '2026'); form.set('genreIds', JSON.stringify([genre.id]));
    form.set('file', new Blob([Buffer.from([137,80,78,71,13,10,26,10])], { type: 'image/png' }), 'poster.png');
    const created = await request('/media', { method: 'POST', body: form });
    assert.equal(created.status, 201, await created.clone().text()); movie = await created.json();
    assert.deepEqual(movie.genres.map(g => g.id), [genre.id]);
    const poster = await request(movie.posterUrl.replace('/api', ''));
    assert.equal(poster.status, 200); assert.equal((await poster.arrayBuffer()).byteLength, 8);
    for (let i = 0; i < 2; i++) {
      const metadata = new FormData();
      metadata.set('posterUrl', movie.posterUrl);
      metadata.set('genreIds', JSON.stringify([genre.id]));
      metadata.set('keywords', 'cinema, drama');
      const saved = await request('/media/' + movie.id, { method: 'PATCH', body: metadata });
      assert.equal(saved.status, 200, await saved.clone().text());
      assert.equal((await saved.json()).posterUrl, movie.posterUrl);
      assert.equal((await request(movie.posterUrl.replace('/api', ''))).status, 200);
    }
    const invalid = new FormData(); invalid.set('title', 'Must not change'); invalid.set('actorIds', '[2147483647]');
    invalid.set('file', new Blob([Buffer.from([137,80,78,71,13,10,26,10])], { type: 'image/png' }), 'poster.png');
    assert.equal((await request('/media/' + movie.id, { method: 'PATCH', body: invalid })).status, 400);
    assert.equal((await media.getMovie(movie.id)).title, movie.title);
    assert.equal((await request('/media?genreIds=' + genre.id)).status, 200);
    assert.equal((await request('/media?genreIds=12bad')).status, 400);
    assert.equal((await request('/media/genres/' + genre.id, { method: 'DELETE' })).status, 409);
    const path = '/media/' + movie.id + '/playback';
    const body = JSON.stringify({ playbackId: 'http-session-123456789' });
    const jsonHeaders = { ...viewerHeaders, 'Content-Type': 'application/json' };
    assert.equal((await fetch(base + path, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })).status, 401);
    assert.equal((await request(path, { method: 'POST', body, headers: jsonHeaders })).status, 403);
    await repo(SubscriptionEntity).save({ userId: viewer.id, tier: 'basic', period: 'monthly', status: 'active', startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() + 86400000) });
    await mkdir(VIDEOS_DIR, { recursive: true }); await writeFile(join(VIDEOS_DIR, videoFilename), Buffer.alloc(100, 1));
    await repo(MovieEntity).update(movie.id, { video480: videoFilename });
    const stream = '/media/' + movie.id + '/stream?quality=480p&deviceId=requirements-device';
    for (let i = 0; i < 2; i++) {
      const range = await request(stream, { headers: { ...viewerHeaders, Range: 'bytes=0-9' } });
      assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 10);
    }
    assert.equal((await request(stream, { method: 'HEAD', headers: viewerHeaders })).status, 200);
    assert.equal((await media.getMovie(movie.id)).viewCount, 0, 'Preloading and repeated Range requests must not count views');
    for (let i = 0; i < 2; i++) assert.equal((await request(path, { method: 'POST', body, headers: jsonHeaders })).status, 201);
    assert.equal((await media.getMovie(movie.id)).viewCount, 1);
  } finally {
    await app.close();
    if (movie) await media.removeMovie(movie.id);
    if (genre) await media.deleteGenre(genre.id);
    await removeUser(viewer.id);
    await repo(UserEntity).update(administrator.id, { role: 'viewer' });
    await removeUser(administrator.id);
    await rm(join(VIDEOS_DIR, videoFilename), { force: true });
  }
});


test('Google IDs are authoritative; existing accounts require explicit linking and a current session', async () => {
  const existing = await newUser();
  const profile = { googleId: 'google-' + randomUUID(), email: existing.email, name: 'Google viewer', emailVerified: true };
  await assert.rejects(auth.loginWithGoogle(profile), err => err.getResponse().code === 'GOOGLE_LINK_REQUIRED');
  await assert.rejects(auth.loginWithGoogle({ ...profile, emailVerified: false }), err => err.getStatus() === 403);
  const linked = JSON.parse(await auth.loginWithGoogle(profile, existing.id, 0));
  assert.equal(linked.sub, existing.id);
  assert.equal((await auth.me(existing.id)).googleLinked, true);
  // Email changes at Google cannot move the identity to another local account.
  assert.equal(JSON.parse(await auth.loginWithGoogle({ ...profile, email: randomUUID() + '@example.com' })).sub, existing.id);
  const other = await newUser();
  await assert.rejects(auth.loginWithGoogle(profile, other.id, 0), err => err.getResponse().code === 'GOOGLE_ACCOUNT_CONFLICT');
  await auth.logout(existing.id);
  await assert.rejects(auth.loginWithGoogle(profile, existing.id, 0), err => err.getStatus() === 403);
  await repo(UserEntity).update(existing.id, { isBlocked: true });
  await assert.rejects(auth.loginWithGoogle(profile), err => err.getStatus() === 403);
  await removeUser(existing.id); await removeUser(other.id);
});

test('Google registration is unique under concurrent callbacks and creates one local account', async () => {
  const profile = { googleId: 'google-' + randomUUID(), email: randomUUID() + '@example.com', name: 'New Google viewer', emailVerified: true };
  const tokens = await Promise.all([auth.loginWithGoogle(profile), auth.loginWithGoogle(profile)]);
  assert.equal(JSON.parse(tokens[0]).sub, JSON.parse(tokens[1]).sub);
  const [user] = await repo(UserEntity).findBy({ googleId: profile.googleId });
  assert.equal(await repo(UserEntity).countBy({ googleId: profile.googleId }), 1);
  assert.equal(user.passwordHash, null);
  await removeUser(user.id);
});

test('Google OAuth state and exchange codes are short-lived, browser-bound and single-use', async () => {
  const { GoogleFlowService, safeReturnTo } = require('../dist/modules/auth/google-flow.service.js');
  const { GoogleCallbackGuard } = require('../dist/modules/auth/google-callback.guard.js');
  const service = new GoogleFlowService(db, { get: key => key === 'google' ? { clientId: 'test-client', clientSecret: 'test-secret', callbackUrl: 'https://absolutecine.duckdns.org/api/auth/google/callback' } : 'https://absolutecine.duckdns.org' });
  let cookie, options;
  const response = { cookie: (name, value, opts) => { cookie = name + '=' + value; options = opts; }, setHeader() {}, clearCookie() {} };
  const url = new URL(await service.begin(response, '/movie/17?quality=720p'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://absolutecine.duckdns.org/api/auth/google/callback');
  assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.sameSite, 'lax');
  const req = { query: { state: url.searchParams.get('state') }, headers: { cookie } };
  await assert.rejects(service.consume({ ...req, headers: { cookie: 'ac_google_flow=' + 'a'.repeat(64) } }));
  const attempts = await Promise.allSettled([service.consume(req), service.consume(req)]);
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
  const flow = attempts.find(a => a.status === 'fulfilled').value;
  const landing = new URL(await service.finish(flow, 'application-jwt'));
  assert.equal(landing.searchParams.has('token'), false); assert.equal(landing.hash.includes('application-jwt'), false);
  const code = new URLSearchParams(landing.hash.slice(1)).get('code');
  await assert.rejects(service.finish(flow, 'another-jwt'));
  await assert.rejects(service.exchange({ headers: {} }, response, code));
  const exchange = await Promise.allSettled([service.exchange(req, response, code), service.exchange(req, response, code)]);
  assert.equal(exchange.filter(a => a.status === 'fulfilled').length, 1);
  assert.deepEqual(exchange.find(a => a.status === 'fulfilled').value, { accessToken: 'application-jwt', returnTo: '/movie/17?quality=720p' });
  const expiredUrl = new URL(await service.begin(response, '/'));
  await db.query("UPDATE google_oauth_flows SET expires_at = now() - interval '1 second' WHERE code_hash IS NULL");
  await assert.rejects(service.consume({ query: { state: expiredUrl.searchParams.get('state') }, headers: { cookie } }));
  for (const target of ['https://evil.example', '//evil.example', '/\\evil.example', '/auth/oauth-success', '/login']) assert.equal(safeReturnTo(target), '/');
  const cancelUrl = new URL(await service.begin(response, '/'));
  let redirected;
  const cancelRequest = { query: { state: cancelUrl.searchParams.get('state'), error: 'access_denied' }, headers: { cookie } };
  const context = { switchToHttp: () => ({ getRequest: () => cancelRequest, getResponse: () => ({ setHeader() {}, redirect: url => { redirected = url; } }) }) };
  assert.equal(await new GoogleCallbackGuard(service).canActivate(context), false);
  assert.equal(new URL(redirected).searchParams.get('error'), 'cancelled');
});

test('movie visibility protects every public route and preserves data when republished', async () => {
  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { JwtService } = require('@nestjs/jwt');
  const { AppModule } = require('../dist/app.module.js');
  const { AllExceptionsFilter } = require('../dist/common/filters/all-exceptions.filter.js');
  const { VIDEOS_DIR } = require('../dist/modules/media/media.constants.js');
  const { UploadsService } = require('../dist/modules/media/uploads.service.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  const viewer = await newUser();
  const recommendationViewer = await newUser();
  const administrator = await newUser();
  await repo(UserEntity).update(administrator.id, { role: 'admin' });
  const tokenFor = user => app.get(JwtService).sign({ sub: user.id, email: user.email, tv: 0 });
  const viewerToken = tokenFor(viewer);
  const viewerHeaders = { Authorization: 'Bearer ' + viewerToken };
  const adminHeaders = { Authorization: 'Bearer ' + tokenFor(administrator) };
  const recommendationHeaders = { Authorization: 'Bearer ' + tokenFor(recommendationViewer) };
  const prefix = 'Visibility-' + randomUUID();
  const videoFilename = prefix + '.mp4';
  let movie, seed, genre, uploadId;
  try {
    genre = await media.createGenre(prefix);
    movie = await media.createMovie({ title: prefix + '-target', year: 2026, genreIds: [genre.id] });
    seed = await media.createMovie({ title: prefix + '-seed', year: 2026, genreIds: [genre.id] });
    assert.equal(movie.isHidden, false, 'New movies remain published by default');
    await mkdir(VIDEOS_DIR, { recursive: true });
    await writeFile(join(VIDEOS_DIR, videoFilename), Buffer.alloc(100, 1));
    await repo(MovieEntity).update(movie.id, { video480: videoFilename, viewCount: 1000000 });
    await media.toggleFavorite(movie.id, viewer.id);
    await media.setRating(movie.id, viewer.id, 8);
    await media.saveProgress(movie.id, viewer.id, 45, 120);
    await media.setRating(seed.id, recommendationViewer.id, 9);
    await repo(SubscriptionEntity).save({ userId: viewer.id, tier: 'basic', period: 'monthly', status: 'active', startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() + 86400000) });
    await app.listen(0, '127.0.0.1');
    const base = 'http://127.0.0.1:' + app.getHttpServer().address().port + '/api';
    const request = (path, options = {}) => fetch(base + path, options);
    const json = async (path, options = {}, status = 200) => {
      const response = await request(path, options);
      assert.equal(response.status, status, path + ': ' + await response.clone().text());
      return response.json();
    };
    const setVisibility = isHidden => json('/admin/media/' + movie.id + '/visibility', {
      method: 'PATCH', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ isHidden }),
    });
    const hasMovie = rows => rows.some(row => row.id === movie.id);
    assert.equal(hasMovie(await json('/recommendations')), true, 'Popular fallback initially includes the movie');
    const personalized = await json('/recommendations', { headers: recommendationHeaders });
    assert.equal(hasMovie(personalized), true);
    assert.equal(personalized.some(row => row.id === seed.id), false, 'Personalized SQL excludes its profile signal');
    assert.equal(hasMovie(await json('/media/' + seed.id + '/similar')), true);

    for (const headers of [{}, viewerHeaders]) {
      const status = headers.Authorization ? 403 : 401;
      assert.equal((await request('/admin/media', { headers })).status, status);
      assert.equal((await request('/admin/media/' + movie.id, { headers })).status, status);
      assert.equal((await request('/admin/media/' + movie.id + '/visibility', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"isHidden":true}' })).status, status);
    }
    for (const body of [{}, { isHidden: 'false' }, { isHidden: null }, { isHidden: 1 }]) {
      assert.equal((await request('/admin/media/' + movie.id + '/visibility', { method: 'PATCH', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 400);
    }
    assert.equal((await media.getMovie(movie.id)).isHidden, false);
    assert.equal((await setVisibility(true)).isHidden, true);
    assert.equal((await setVisibility(true)).isHidden, true, 'Repeating a hide request is idempotent');

    const all = await json('/admin/media?search=' + prefix, { headers: adminHeaders });
    assert.equal(all.total, 2);
    assert.equal((await json('/admin/media?search=' + prefix + '&visibility=hidden', { headers: adminHeaders })).total, 1);
    assert.equal((await json('/admin/media?search=' + prefix + '&visibility=published', { headers: adminHeaders })).total, 1);
    assert.equal((await request('/admin/media?visibility=invalid', { headers: adminHeaders })).status, 400);
    assert.equal((await json('/admin/media/' + movie.id, { headers: adminHeaders })).isHidden, true);
    for (const headers of [{}, viewerHeaders, adminHeaders]) {
      for (const suffix of ['', '/similar']) {
        assert.equal((await request('/media/' + movie.id + suffix, { headers })).status, 404);
      }
      const catalog = await json('/media?search=' + prefix + '&limit=1&visibility=all&includeHidden=true', { headers });
      assert.equal(catalog.total, 1, 'Visibility filtering happens before pagination and ignores public bypass parameters');
      assert.equal(hasMovie(catalog.items), false);
    }
    assert.equal(hasMovie(await json('/media/' + seed.id + '/similar')), false);
    for (const headers of [{}, recommendationHeaders]) {
      assert.equal(hasMovie(await json('/recommendations', { headers })), false);
    }
    assert.equal(hasMovie(await json('/media/favorites', { headers: viewerHeaders })), false);
    assert.equal((await json('/media/progress', { headers: viewerHeaders })).some(row => row.movieId === movie.id), false);
    for (const method of ['GET', 'HEAD']) {
      assert.equal((await request('/media/' + movie.id + '/stream?quality=480p&deviceId=visibility-device', { method, headers: { ...viewerHeaders, Range: 'bytes=0-9' } })).status, 404);
      assert.equal((await request('/media/' + movie.id + '/stream?quality=480p&deviceId=visibility-device&token=' + viewerToken, { method })).status, 404);
    }
    for (const [suffix, method, body] of [
      ['/favorites', 'POST', {}], ['/rating', 'PUT', { value: 10 }], ['/rating', 'DELETE', {}],
      ['/progress', 'PUT', { positionSeconds: 90, durationSeconds: 120 }], ['/playback', 'POST', { playbackId: 'hidden-movie-playback-123' }],
    ]) {
      assert.equal((await request('/media/' + movie.id + suffix, { method, headers: { ...viewerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 404, suffix);
    }
    const edited = await json('/media/' + movie.id, { method: 'PATCH', headers: { ...adminHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: prefix + '-edited' }) });
    assert.equal(edited.isHidden, true, 'Editing a hidden movie does not publish it');
    await json('/media/' + movie.id + '/transcode', { headers: adminHeaders });
    const hash = createHash('sha256').update('x').digest('hex');
    const upload = await json('/media/uploads/' + movie.id, { method: 'POST', headers: { ...adminHeaders, 'Content-Type': 'application/json', 'Tus-Resumable': '1.0.0' }, body: JSON.stringify({ filename: 'hidden.mp4', size: 1, sha256: hash, chunks: [hash] }) }, 201);
    uploadId = upload.id;
    assert.equal(upload.movieId, movie.id, 'Administrators can still upload video to a hidden movie');
    assert.equal((await request('/media/uploads/' + uploadId, { method: 'DELETE', headers: adminHeaders })).status, 204);
    uploadId = undefined;

    assert.equal((await setVisibility(false)).isHidden, false);
    assert.equal((await setVisibility(false)).isHidden, false);
    const restored = await json('/media/' + movie.id, { headers: viewerHeaders });
    assert.equal(restored.title, prefix + '-edited');
    assert.equal(restored.isFavorite, true);
    assert.equal(restored.userRating, 8);
    assert.equal(restored.viewCount, 1000000);
    assert.equal(hasMovie(await json('/media/favorites', { headers: viewerHeaders })), true);
    assert.equal((await json('/media/progress', { headers: viewerHeaders })).find(row => row.movieId === movie.id).positionSeconds, 45);
    assert.equal(hasMovie(await json('/recommendations')), true);
    assert.equal(hasMovie(await json('/recommendations', { headers: recommendationHeaders })), true);
    for (const method of ['GET', 'HEAD']) {
      const response = await request('/media/' + movie.id + '/stream?quality=480p&deviceId=visibility-device', { method, headers: { ...viewerHeaders, ...(method === 'GET' ? { Range: 'bytes=0-9' } : {}) } });
      assert.equal(response.status, method === 'GET' ? 206 : 200);
      await response.arrayBuffer();
    }
  } finally {
    if (uploadId) await app.get(UploadsService).remove(uploadId, administrator.id).catch(() => {});
    await app.close();
    if (movie) await media.removeMovie(movie.id);
    if (seed) await media.removeMovie(seed.id);
    if (genre) await media.deleteGenre(genre.id);
    await repo(UserEntity).update(administrator.id, { role: 'viewer' });
    for (const user of [viewer, recommendationViewer, administrator]) await removeUser(user.id);
    await rm(join(VIDEOS_DIR, videoFilename), { force: true });
  }
});
