import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import axios from 'axios';
import * as lucideIcons from 'lucide-react';

// Execute the actual modules with a minimal React hook host. Axios and its
// asynchronous interceptors are real; no DOM is needed to test token transport.
function evaluate(file, imports) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name === 'lucide-react') return lucideIcons;
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

test('logout sends its original JWT after local storage is cleared and cannot revoke a newly signed-in session', async () => {
  const values = new Map([['ac_token', 'old-session']]);
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  try {
    const apiModule = evaluate('../src/services/api.ts', { axios, '@/utils/url': { API_BASE: '/api' } });
    const serviceModule = evaluate('../src/services/authService.ts', { './api': apiModule });
    let sent;
    apiModule.api.defaults.adapter = async config => {
      sent = config;
      return { data: { message: 'Logged out' }, status: 200, statusText: 'OK', headers: {}, config };
    };
    const react = { createContext: () => ({ Provider: 'Provider' }), useCallback: f => f,
      useContext: () => null, useEffect: () => {}, useMemo: f => f(), useState: init => [typeof init === 'function' ? init() : init, () => {}] };
    const authModule = evaluate('../src/context/AuthContext.tsx', { react,
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
      '@/services/api': apiModule, '@/services/authService': serviceModule });
    const context = authModule.AuthProvider({ children: null }).props.value;
    context.logout();
    assert.equal(localStorage.getItem('ac_token'), null);
    // A subsequent login can happen before the interceptor's microtask runs.
    localStorage.setItem('ac_token', 'new-session');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.url, '/auth/logout');
    assert.equal(sent.headers.Authorization, 'Bearer old-session');
    apiModule.api.defaults.adapter = async config => {
      throw new axios.AxiosError('Expired old session', 'ERR_BAD_REQUEST', config, undefined,
        { status: 401, data: {}, headers: {}, config, statusText: 'Unauthorized' });
    };
    await assert.rejects(serviceModule.authService.logout('old-session'));
    assert.equal(localStorage.getItem('ac_token'), 'new-session');
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('client accepts the same Unicode passwords and bcrypt byte limit as the server', () => {
  const { isValidPassword } = evaluate('../src/utils/validation.ts', {});
  assert.equal(isValidPassword('abcdefgh'), true);
  assert.equal(isValidPassword('пароль123'), true);
  assert.equal(isValidPassword('short'), false);
  assert.equal(isValidPassword('\u{10400}'.repeat(20)), false);
});

function playbackHost(user, movieOverrides = {}, services = {}, playbackProps = {}) {
  const states = [];
  const refs = [];
  let cursor = 0;
  let refCursor = 0;
  const movie = { id: 7, availableQualities: ['480p', '720p'], transcodeStatus: 'ready', ...movieOverrides };
  const { MoviePlayback } = evaluate('../src/components/MoviePlayback.tsx', {
    react: {
      useState: initial => {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn, useRef: value => refs[refCursor++] ??= { current: value },
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-router-dom': { Link: 'Link' },
    '@/context/LanguageContext': { useLanguage: () => ({ t: key => key }) },
    '@/hooks/useAuth': { useAuth: () => ({ user, isAuthenticated: Boolean(user) }) },
    '@/services/mediaService': { mediaService: services.mediaService ?? {} },
    '@/services/devicesService': { devicesService: services.devicesService ?? {} },
    '@/hooks/useVideoProgress': { useVideoProgress: () => ({ resumeAt: 42 }) },
    '@/components/VideoPlayer': { VideoPlayer: 'VideoPlayer' },
    '@/components/Spinner': { Spinner: 'Spinner' },
    '@/components/EmptyState': { EmptyState: 'EmptyState' },
    '@/components/Modal': { Modal: 'Modal' },
    '@/utils/url': { resolveMediaUrl: url => url, streamUrl: () => { throw new Error('No stream may be requested while rendering'); } },
    '@/utils/plans': { getDeviceId: () => 'device', limitsForTier: () => ({ maxQuality: '720p' }), qualityRank: q => parseInt(q) },
  });
  return () => { cursor = 0; refCursor = 0; return MoviePlayback({ initialMovie: movie, ...playbackProps }); };
}

function elements(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...elements(tree.props?.children, predicate)];
}

test('public movie playback asks guests to sign in and preserves the movie destination', () => {
  const tree = playbackHost(null)();
  assert.equal(elements(tree, node => node.type === 'VideoPlayer').length, 0);
  const login = elements(tree, node => node.type === 'Link' && node.props.to === '/login')[0];
  assert.equal(login.props.state.from, '/movie/7');
});

test('signed-in viewers without a subscription get plans instead of a stream', () => {
  const tree = playbackHost({ id: 1, hasActiveSubscription: false })();
  assert.equal(elements(tree, node => node.type === 'VideoPlayer').length, 0);
  assert.ok(elements(tree, node => node.type === 'Link' && node.props.to === '/plans').length);
});

test('subscribers request playback only after Play and retain resume and plan controls', () => {
  const render = playbackHost({ id: 1, hasActiveSubscription: true });
  const preview = render();
  assert.equal(elements(preview, node => node.type === 'VideoPlayer').length, 0);
  const play = elements(preview, node => node.type === 'button' && node.props['aria-label'] === 'movie.watch')[0];
  assert.ok(play);
  play.props.onClick();
  const player = elements(render(), node => node.type === 'VideoPlayer')[0];
  assert.equal(player.props.movieId, 7);
  assert.equal(player.props.resumeAt, 42);
  assert.equal(player.props.autoPlay, true);
  assert.equal(player.props.maxQuality, '720p');
  assert.equal(typeof player.props.onPlayStateChange, 'function');
  assert.equal(typeof player.props.onLockedQuality, 'function');
});

test('processing movies without ready qualities do not mount a stream', () => {
  const tree = playbackHost({ id: 1, hasActiveSubscription: true }, { availableQualities: [], transcodeStatus: 'processing' })();
  assert.equal(elements(tree, node => node.type === 'VideoPlayer').length, 0);
  assert.equal(elements(tree, node => node.type === 'Spinner').length, 1);
});

test('Watch now starts subscriber playback with saved progress and plan controls', () => {
  const tree = playbackHost({ id: 1, hasActiveSubscription: true }, {}, {}, { autoPlay: true })();
  const player = elements(tree, node => node.type === 'VideoPlayer')[0];
  assert.ok(player);
  assert.equal(player.props.autoPlay, true);
  assert.equal(player.props.resumeAt, 42);
  assert.equal(player.props.maxQuality, '720p');
});

test('Watch now preserves guest login destination and never bypasses subscription or readiness checks', () => {
  const guest = playbackHost(null, {}, {}, { autoPlay: true })();
  assert.equal(elements(guest, node => node.type === 'VideoPlayer').length, 0);
  const login = elements(guest, node => node.type === 'Link' && node.props.to === '/login')[0];
  assert.equal(login.props.state.from, '/movie/7?play=1#movie-player');
  const unsubscribed = playbackHost({ id: 1, hasActiveSubscription: false }, {}, {}, { autoPlay: true })();
  assert.equal(elements(unsubscribed, node => node.type === 'VideoPlayer').length, 0);
  assert.ok(elements(unsubscribed, node => node.type === 'Link' && node.props.to === '/plans').length);
  const processing = playbackHost({ id: 1, hasActiveSubscription: true },
    { availableQualities: [], transcodeStatus: 'processing' }, {}, { autoPlay: true })();
  assert.equal(elements(processing, node => node.type === 'VideoPlayer').length, 0);
});

test('legacy watch links redirect to the public movie page and preserve search and hash', () => {
  const { default: Watch } = evaluate('../src/pages/Watch.tsx', {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-router-dom': { Navigate: 'Navigate', useParams: () => ({ id: '17' }), useLocation: () => ({ search: '?source=history', hash: '#movie-player' }) },
  });
  assert.deepEqual(Watch(), { type: 'Navigate', props: { to: '/movie/17?source=history#movie-player', replace: true } });
});


test('pause, quality changes and replay retain one playback session after the device check', async () => {
  const previous = globalThis.window;
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} };
  const recorded = [];
  let beats = 0;
  try {
    const render = playbackHost({ id: 1, hasActiveSubscription: true }, {}, {
      mediaService: { recordPlayback: async (...args) => recorded.push(args) },
      devicesService: { heartbeat: async () => { beats++; }, end: () => {} },
    });
    const preview = render();
    assert.equal(recorded.length, 0);
    elements(preview, node => node.type === 'button' && node.props['aria-label'] === 'movie.watch')[0].props.onClick();
    let player = elements(render(), node => node.type === 'VideoPlayer')[0];
    player.props.onPlayStateChange(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(recorded.length, 1); assert.equal(beats, 1);
    player.props.onPlayStateChange(false);
    player.props.onQualityChange('480p');
    player = elements(render(), node => node.type === 'VideoPlayer')[0];
    player.props.onPlayStateChange(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(beats, 2); assert.equal(recorded.length, 1);
    assert.equal(recorded[0][0], 7); assert.match(recorded[0][1], /^[a-zA-Z0-9_-]{16,100}$/);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('multipart metadata retains JSON relation lists and explicit clears; multi-genre query uses comma-separated IDs', async () => {
  let form, params;
  const { mediaService } = evaluate('../src/services/mediaService.ts', { './api': { api: {
    patch: async (_path, body) => { form = body; return { data: {} }; },
    get: async (_path, options) => { params = options.params; return { data: {} }; },
  } } });
  await mediaService.updateMovie(7, { countryId: null, directorId: null, genreIds: [1,2], actorIds: [], trailerUrl: '', runtimeMinutes: '', originalTitle: '' });
  assert.equal(form.get('countryId'), ''); assert.equal(form.get('directorId'), '');
  assert.equal(form.get('genreIds'), '[1,2]'); assert.equal(form.get('actorIds'), '[]');
  assert.equal(form.get('trailerUrl'), ''); assert.equal(form.get('runtimeMinutes'), ''); assert.equal(form.get('originalTitle'), '');
  await mediaService.list({ genreIds: [1,2], yearFrom: 2025 });
  assert.equal(params.genreIds, '1,2'); assert.equal(params.yearFrom, 2025);
});


test('OAuth destinations stay internal and the code exchange sends the browser cookie', async () => {
  const { safeReturnTo } = evaluate('../src/utils/authReturn.ts', {});
  assert.equal(safeReturnTo('/movie/7?source=login#movie-player'), '/movie/7?source=login#movie-player');
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/auth/oauth-success', '/login']) assert.equal(safeReturnTo(path), '/');
  const calls = [];
  const { authService } = evaluate('../src/services/authService.ts', { './api': { api: { post: async (...args) => { calls.push(args); return { data: {} }; } } } });
  await authService.exchangeGoogle('short-lived-code');
  await authService.linkGoogle();
  assert.equal(calls[0][0], '/auth/google/exchange'); assert.equal(calls[0][1].code, 'short-lived-code'); assert.equal(calls[0][2].withCredentials, true);
  assert.equal(calls[1][0], '/auth/google/link'); assert.equal(calls[1][2].withCredentials, true);
});
