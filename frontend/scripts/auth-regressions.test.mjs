import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import axios from 'axios';

// Execute the actual modules with a minimal React hook host. Axios and its
// asynchronous interceptors are real; no DOM is needed to test token transport.
function evaluate(file, imports) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
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
  assert.equal(isValidPassword('😀'.repeat(20)), false);
});

function playbackHost(user, movieOverrides = {}) {
  const states = [];
  let cursor = 0;
  const movie = { id: 7, availableQualities: ['480p', '720p'], transcodeStatus: 'ready', ...movieOverrides };
  const { MoviePlayback } = evaluate('../src/components/MoviePlayback.tsx', {
    react: {
      useState: initial => {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn, useRef: value => ({ current: value }),
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-router-dom': { Link: 'Link' },
    '@/context/LanguageContext': { useLanguage: () => ({ t: key => key }) },
    '@/hooks/useAuth': { useAuth: () => ({ user, isAuthenticated: Boolean(user) }) },
    '@/services/mediaService': { mediaService: {} },
    '@/services/devicesService': { devicesService: {} },
    '@/hooks/useVideoProgress': { useVideoProgress: () => ({ resumeAt: 42 }) },
    '@/components/VideoPlayer': { VideoPlayer: 'VideoPlayer' },
    '@/components/Spinner': { Spinner: 'Spinner' },
    '@/components/EmptyState': { EmptyState: 'EmptyState' },
    '@/components/Modal': { Modal: 'Modal' },
    '@/utils/url': { resolveMediaUrl: url => url, streamUrl: () => { throw new Error('No stream may be requested while rendering'); } },
    '@/utils/plans': { getDeviceId: () => 'device', limitsForTier: () => ({ maxQuality: '720p' }), qualityRank: q => parseInt(q) },
  });
  return () => { cursor = 0; return MoviePlayback({ initialMovie: movie }); };
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

test('legacy watch links redirect to the public movie page and preserve search and hash', () => {
  const { default: Watch } = evaluate('../src/pages/Watch.tsx', {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-router-dom': { Navigate: 'Navigate', useParams: () => ({ id: '17' }), useLocation: () => ({ search: '?source=history', hash: '#movie-player' }) },
  });
  assert.deepEqual(Watch(), { type: 'Navigate', props: { to: '/movie/17?source=history#movie-player', replace: true } });
});
