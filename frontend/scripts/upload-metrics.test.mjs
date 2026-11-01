import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadMeasurements, formatBytes } from '../src/utils/upload.ts';

const snapshot = { startedAt: 1000, lastProgressAt: 5000, loaded: 2000, total: 10000, rate: 500 };

test('elapsed time, measured rate and estimated remaining time', () => {
  const result = uploadMeasurements(snapshot, 5000);
  assert.equal(result.elapsedSeconds, 4);
  assert.equal(result.bytesPerSecond, 500);
  assert.equal(result.remainingSeconds, 16);
  assert.equal(result.stalled, false);
});

test('warm-up and missing totals do not produce made-up estimates', () => {
  assert.equal(uploadMeasurements({ ...snapshot, loaded: 0, rate: null }, 1200).remainingSeconds, null);
  assert.equal(uploadMeasurements({ ...snapshot, total: null }, 5000).remainingSeconds, null);
  assert.equal(uploadMeasurements({ ...snapshot, rate: null }, 5000).bytesPerSecond, 500);
});

test('a stalled transfer hides stale ETA while elapsed time continues', () => {
  const result = uploadMeasurements(snapshot, 10000);
  assert.equal(result.elapsedSeconds, 9);
  assert.equal(result.bytesPerSecond, 0);
  assert.equal(result.remainingSeconds, null);
  assert.equal(result.stalled, true);
});

test('100% transfer means waiting for the server, not a zero-second promise', () => {
  const result = uploadMeasurements({ ...snapshot, loaded: 10000 }, 6000);
  assert.equal(result.transferred, true);
  assert.equal(result.remainingSeconds, null);
  assert.equal(result.stalled, false);
});

test('non-finite rates and byte sizes never show NaN or Infinity', () => {
  assert.equal(uploadMeasurements({ ...snapshot, rate: Infinity }, 5000).remainingSeconds, null);
  assert.equal(formatBytes(Infinity), '0 B');
  assert.equal(formatBytes(-1), '0 B');
  assert.equal(formatBytes(1500000), '1.5 MB');
});
