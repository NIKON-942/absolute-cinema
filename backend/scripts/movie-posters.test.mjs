import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const { MediaService } = require('../dist/modules/media/media.service.js');

function fixture(posterPath = 'poster-test.png') {
  const movie = { id: 1, posterPath, genres: [], actors: [], createdAt: new Date(), keywords: [] };
  const manager = {
    findOne: async () => movie,
    find: async (_entity, options) => options.where.id._value.map(id => ({ id })),
    save: async value => value,
    transaction: async run => run(manager),
  };
  const progress = { find: async () => [{ movieId: movie.id, movie, updatedAt: new Date() }] };
  const service = new MediaService({ manager }, {}, {}, {}, {}, {}, progress, {});
  service.averageRating = async () => 0;
  service.getMovie = async () => service.toDto(movie);
  return { movie, service };
}

test('saving genres and tags repeatedly preserves the uploaded movie poster URL', async () => {
  const { movie, service } = fixture();
  const original = await service.getMovie(1);
  assert.equal(original.posterUrl, '/api/media/posters/poster-test.png');
  for (let i = 0; i < 3; i++) {
    const updated = await service.updateMovie(1, {
      posterUrl: original.posterUrl, genreIds: '[2,3]', keywords: 'cinema, drama',
    });
    assert.equal(updated.posterUrl, original.posterUrl);
    assert.equal(movie.posterPath, 'poster-test.png');
    assert.deepEqual(updated.genres.map(g => g.id), [2, 3]);
    assert.deepEqual(updated.keywords, ['cinema', 'drama']);
    assert.equal((await service.listProgress(7))[0].posterUrl, original.posterUrl);
  }
});

test('existing URL-form poster records render correctly and normalize on the next save', async () => {
  const url = '/api/media/posters/poster-existing.webp';
  const { movie, service } = fixture(url);
  assert.equal((await service.getMovie(1)).posterUrl, url);
  assert.equal((await service.listProgress(7))[0].posterUrl, url);
  await service.updateMovie(1, { posterUrl: url, genreIds: '[]' });
  assert.equal(movie.posterPath, 'poster-existing.webp');
});

test('poster updates still support external URLs, omission, replacement uploads and removal', async () => {
  const { movie, service } = fixture();
  await service.updateMovie(1, { keywords: 'tag' });
  assert.equal(movie.posterPath, 'poster-test.png');
  const url = 'https://example.com/poster.jpg';
  assert.equal((await service.updateMovie(1, { posterUrl: url })).posterUrl, url);
  assert.equal(movie.posterPath, url);
  assert.equal((await service.updateMovie(1, { posterUrl: '' }, 'poster-new.png')).posterUrl,
    '/api/media/posters/poster-new.png');
  assert.equal((await service.updateMovie(1, { posterUrl: '' })).posterUrl, '');
  assert.equal(movie.posterPath, null);
});
