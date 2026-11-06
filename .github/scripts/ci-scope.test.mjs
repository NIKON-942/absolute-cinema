import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyChanges } from './ci-scope.mjs';

test('documentation alone skips builds, including documentation PRs to main', () => {
  for (const options of [{}, { eventName: 'pull_request', baseRef: 'main' }]) {
    const scope = classifyChanges(['README.md', 'docs/ТЗ.docx', 'docs/diagrams/C4_level1.png'], options);
    assert.ok(Object.values(scope).every(value => value === false));
  }
});
test('frontend-only changes build and test the web image without backend fixtures or FFmpeg', () => {
  for (const path of ['frontend/src/components/MoviePlayback.tsx', 'frontend/src/components/VideoPlayer.tsx', 'frontend/src/components/BrandIcon.tsx', 'frontend/src/pages/Watch.tsx', 'frontend/src/utils/authReturn.ts', 'frontend/src/index.css']) {
    const scope = classifyChanges([path]);
    assert.equal(scope.run, true, path); assert.equal(scope.full, false, path);
    assert.equal(scope.video, false, path); assert.equal(scope.regressions, false, path);
  }
});

test('every backend module enables integration regressions, including analytics and recommendations', () => {
  for (const path of ['backend/src/modules/admin/admin.service.ts', 'backend/src/modules/admin/admin.controller.ts', 'backend/src/modules/recommendations/recommendations.service.ts', 'backend/src/modules/recommendations/recommendations.controller.ts', 'backend/src/modules/new-feature/new-feature.service.ts']) {
    const scope = classifyChanges([path]);
    assert.equal(scope.run, true, path); assert.equal(scope.regressions, true, path);
    assert.equal(scope.full, false, path); assert.equal(scope.video, false, path);
    assert.equal(scope.payments, false, path);
  }
});

test('standalone poster and migration fixtures select the steps that execute them', () => {
  const posters = classifyChanges(['backend/scripts/movie-posters.test.mjs']);
  assert.equal(posters.uploads, true); assert.equal(posters.regressions, true);
  assert.equal(posters.video, false); assert.equal(posters.deployment, false);
  const migration = classifyChanges(['backend/scripts/requirements-migration.mjs']);
  assert.equal(migration.deployment, true); assert.equal(migration.regressions, true);
  assert.equal(migration.video, false); assert.equal(migration.uploads, false);
});
test('auth and payments enable regressions and the Stripe checks separately', () => {
  const auth = classifyChanges(['backend/src/modules/auth/auth.service.ts']);
  assert.equal(auth.auth, true); assert.equal(auth.regressions, true); assert.equal(auth.payments, false);
  const payments = classifyChanges(['backend/src/modules/payments/payments.service.ts']);
  assert.equal(payments.payments, true); assert.equal(payments.regressions, true); assert.equal(payments.video, false);
});
test('image/upload changes do not unnecessarily run video encoding', () => {
  for (const path of ['frontend/src/components/ImageField.tsx', 'backend/src/modules/media/image-upload.ts', 'backend/src/modules/media/uploads.service.ts']) {
    const scope = classifyChanges([path]);
    assert.equal(scope.uploads, true, path); assert.equal(scope.video, false, path);
  }
});
test('video processing and shared media services enable FFmpeg', () => {
  for (const path of ['backend/src/modules/media/media-processing.ts', 'backend/src/modules/media/transcode.service.ts', 'backend/src/modules/media/media.service.ts']) {
    assert.equal(classifyChanges([path]).video, true, path);
  }
});
test('deployment and database changes check repeated migrations and regressions', () => {
  for (const path of ['deploy/Caddyfile', 'backend/src/database/migrations/New.ts', 'backend/src/config/configuration.ts']) {
    const scope = classifyChanges([path]);
    assert.equal(scope.deployment, true, path); assert.equal(scope.regressions, true, path);
  }
});
test('manual runs, runtime PRs to main and direct main pushes run everything', () => {
  for (const options of [{ eventName: 'workflow_dispatch' }, { eventName: 'pull_request', baseRef: 'main' }, { ref: 'refs/heads/main' }]) {
    assert.ok(Object.values(classifyChanges(['frontend/src/index.css'], options)).every(Boolean));
  }
});
test('dependencies, Docker/build configuration and CI changes run everything', () => {
  for (const path of ['package.json', 'backend/package-lock.json', 'frontend/Dockerfile', 'frontend/tsconfig.json', '.github/workflows/ci-cd.yml', '.github/scripts/ci-scope.mjs']) {
    assert.ok(Object.values(classifyChanges([path])).every(Boolean), path);
  }
});
test('unavailable git history falls back to the complete suite', () => {
  assert.ok(Object.values(classifyChanges([], { unknownDiff: true })).every(Boolean));
});
test('changes to the combined smoke script check all of its independent groups', () => {
  const scope = classifyChanges(['backend/scripts/smoke-dependencies.mjs']);
  assert.equal(scope.dependencies, true); assert.equal(scope.uploads, true); assert.equal(scope.video, true);
});
test('a code file mixed with docs still enables checks; deleted/renamed code is included', () => {
  const scope = classifyChanges(['docs/old-auth.ts', 'backend/src/modules/auth/auth.service.ts', 'README.md']);
  assert.equal(scope.run, true); assert.equal(scope.auth, true);
  assert.equal(classifyChanges(['frontend/public/brand/frog-head.png']).run, true);
});
