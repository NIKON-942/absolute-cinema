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
