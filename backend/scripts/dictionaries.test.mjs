import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const { MediaService } = require('../dist/modules/media/media.service.js');

function fixture({ duplicate = null, saveError = null } = {}) {
  const calls = { writes: [], where: [] };
  const query = {
    where: (...args) => { calls.where.push(args); return query; },
    andWhere: (...args) => { calls.where.push(args); return query; },
    getOne: async () => duplicate,
  };
  const repo = {
    createQueryBuilder: () => query,
    create: value => value,
    save: async value => {
      if (saveError) throw saveError;
      calls.writes.push(value);
      return { id: 12, ...value };
    },
    update: async (id, value) => { calls.writes.push({ id, ...value }); return { affected: 1 }; },
    findOneByOrFail: async ({ id }) => ({ id, ...calls.writes.at(-1) }),
  };
  return { calls, service: new MediaService({}, repo, repo, repo, repo, {}, {}, {}) };
}

for (const category of ['Genre', 'Actor', 'Country', 'Director']) {
  test(`${category}: inline creation needs only a name and normalizes whitespace`, async () => {
    const { service, calls } = fixture();
    const item = await service[`create${category}`]('  New   entry  ');
    assert.equal(item.id, 12);
    assert.equal(item.name, 'New entry');
    assert.equal(calls.writes.length, 1);
    assert.equal(calls.where[0][1].name, 'New entry');
    assert.match(calls.where[0][0], /LOWER\(/);
  });

  test(`${category}: an existing normalized name returns a conflict without writing`, async () => {
    const { service, calls } = fixture({ duplicate: { id: 3, name: 'NEW entry' } });
    await assert.rejects(service[`create${category}`]('new entry'), error => error.getStatus() === 409);
    assert.equal(calls.writes.length, 0);
  });

  test(`${category}: editing excludes the current entry from duplicate detection`, async () => {
    const { service, calls } = fixture();
    const item = await service[`update${category}`](12, 'New entry');
    assert.equal(item.id, 12);
    assert.deepEqual(calls.where[1], ['entry.id != :id', { id: 12 }]);
  });
}

test('a database uniqueness conflict during concurrent creation is reported as 409', async () => {
  const { service } = fixture({ saveError: { code: '23505' } });
  await assert.rejects(service.createGenre('Drama'), error => error.getStatus() === 409);
});

test('empty dictionary names are rejected before querying or writing', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.createGenre('   '), error => error.getStatus() === 400);
  assert.equal(calls.where.length, 0);
  assert.equal(calls.writes.length, 0);
});
