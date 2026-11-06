import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isDocumentation = path => path.startsWith('docs/') || /\.(md|mdx|rst|docx)$/i.test(path)
  || /^(LICENSE|NOTICE)(\.[^/]*)?$/i.test(path);

/** Conservative scopes: shared configuration changes run the complete suite. */
export function classifyChanges(paths, { eventName = 'push', baseRef = '', ref = '', unknownDiff = false } = {}) {
  const code = paths.filter(path => !isDocumentation(path));
  const run = eventName === 'workflow_dispatch' || unknownDiff || code.length > 0;
  const full = run && (eventName === 'workflow_dispatch' || unknownDiff
    || (eventName === 'pull_request' && baseRef === 'main') || ref === 'refs/heads/main'
    || code.some(path => /^\.github\//.test(path) || /(^|\/)(package(-lock)?\.json|Dockerfile|\.dockerignore|\.npmrc|\.nvmrc|tsconfig[^/]*\.json|nest-cli\.json|vite\.config\.[^/]+)$/.test(path)));
  const auth = full || code.some(path => /^backend\/src\/(modules\/(auth|users)\/|common\/)/.test(path)
    || /^frontend\/src\/(context\/AuthContext\.tsx|hooks\/useAuth\.ts|services\/(api|authService|usersService)\.ts|components\/(AuthShell|ProtectedRoute|AdminRoute|Navbar)\.tsx|pages\/(Login|Register|ForgotPassword|ResetPassword|OAuthSuccess|Profile)\.tsx|utils\/validation\.ts)$/.test(path)
    || path === 'frontend/scripts/auth-regressions.test.mjs');
  const payments = full || code.some(path => /^backend\/src\/(modules\/(payments|users)\/|common\/)/.test(path)
    || /^backend\/scripts\/(review-regressions\.test|smoke-stripe)\.mjs$/.test(path)
    || /^frontend\/src\/(services\/paymentsService\.ts|pages\/(SubscriptionPlans|MockCheckout|Profile)\.tsx|utils\/plans\.ts)$/.test(path));
  const uploads = full || code.some(path => /^backend\/src\/(modules\/(media|users)\/|common\/)/.test(path)
    || /^backend\/scripts\/(uploads\.test|movie-posters\.test|smoke-dependencies)\.mjs$/.test(path)
    || /^frontend\/src\/(services\/(uploadManager|videoUploads|mediaService|usersService)\.ts|components\/(ImageField|UploadPanel|TranscodeProgress)\.tsx|context\/UploadContext\.tsx|workers\/|utils\/upload\.ts|pages\/(AdminPanel|Profile)\.tsx)/.test(path)
    || path === 'frontend/scripts/upload-metrics.test.mjs');
  const video = full || code.some(path => /^backend\/src\/modules\/media\/(transcode\.service\.ts|media-processing\.ts|remote-source\.ts|media\.service\.ts|media\.constants\.ts|media\.module\.ts|entities\/movie\.entity\.ts)$/.test(path)
    || ['backend/scripts/transcode.test.mjs', 'backend/scripts/smoke-dependencies.mjs'].includes(path));
  const deployment = full || code.some(path => /^deploy\//.test(path) || path === 'docker-compose.yml'
    || path === 'backend/scripts/requirements-migration.mjs'
    || /^backend\/src\/(database\/|config\/|main\.ts$|app\.module\.ts$)/.test(path));
  // The integration suite spans modules; new backend modules must not silently
  // fall back to smoke checks just because they are absent from a scope list.
  const regressions = auth || payments || uploads || deployment
    || code.some(path => path.startsWith('backend/src/'));
  const dependencies = full || code.some(path => /^backend\/src\/modules\/mail\//.test(path)
    || ['backend/src/main.ts', 'backend/scripts/smoke-dependencies.mjs'].includes(path));
  return { run, full, auth, payments, uploads, video, deployment, regressions, dependencies };
}

export function changedPaths(base, head) {
  if (!/^[a-f0-9]{40}$/i.test(base ?? '') || /^0+$/.test(base) || !/^[a-f0-9]{40}$/i.test(head ?? '')) {
    throw new Error('No usable base/head commit; run the full suite');
  }
  const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  try { git(['cat-file', '-e', `${base}^{commit}`]); }
  catch { git(['fetch', '--no-tags', '--depth=1', 'origin', base]); }
  // Include both sides of renames so moving runtime code into docs cannot skip tests.
  return git(['diff', '--no-renames', '--name-only', '-z', base, head]).split('\0').filter(Boolean);
}

function main() {
  const options = { eventName: process.env.GITHUB_EVENT_NAME, baseRef: process.env.CI_BASE_REF, ref: process.env.GITHUB_REF };
  let paths = [];
  if (options.eventName !== 'workflow_dispatch') {
    try { paths = changedPaths(process.env.CI_BASE_SHA, process.env.GITHUB_SHA); }
    catch (error) { console.warn(error.message); options.unknownDiff = true; }
  }
  const scope = classifyChanges(paths, options);
  const output = Object.entries(scope).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.log(output);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Selected checks\n\n${scope.run ? scope.full ? 'Full suite.' : 'Build and smoke checks plus the scopes below.' : 'Documentation only: build and deployment skipped.'}\n\n`
    + '| Scope | Enabled |\n| --- | --- |\n' + Object.entries(scope).map(([key, value]) => `| ${key} | ${value} |`).join('\n') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
