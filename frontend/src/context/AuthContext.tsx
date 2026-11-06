import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { TOKEN_KEY } from '@/services/api';
import { authService } from '@/services/authService';
import type { RegisterPayload } from '@/services/authService';
import type { UserDto } from '@/types';

interface AuthContextValue {
  user: UserDto | null;
  token: string | null;
  /** True while the initial `me` refresh is in flight (guards route redirects). */
  loading: boolean;
  isAdmin: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<UserDto>;
  register: (payload: RegisterPayload) => Promise<UserDto>;
  loginWithToken: (token: string) => Promise<UserDto>;
  logout: () => void;
  /** Re-fetch /auth/me and update the session user. */
  refreshMe: () => Promise<UserDto | null>;
  setUser: (user: UserDto | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState<boolean>(() => Boolean(localStorage.getItem(TOKEN_KEY)));

  const applySession = useCallback((accessToken: string, nextUser: UserDto) => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    setToken(accessToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await authService.login(email, password);
      applySession(res.accessToken, res.user);
      return res.user;
    },
    [applySession],
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const res = await authService.register(payload);
      applySession(res.accessToken, res.user);
      return res.user;
    },
    [applySession],
  );

  const loginWithToken = useCallback(
    async (accessToken: string) => {
      localStorage.setItem(TOKEN_KEY, accessToken);
      setToken(accessToken);
      try {
        const me = await authService.me();
        setUser(me);
        return me;
      } catch (err) {
        // Never keep an unvalidated token — it would poison later requests.
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        throw err;
      }
    },
    [],
  );

  const logout = useCallback(() => {
    // Ask the server to revoke the token (FR-36), then clear local state.
    const accessToken = localStorage.getItem(TOKEN_KEY);
    authService.logout(accessToken).catch(() => undefined);
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const refreshMe = useCallback(async (): Promise<UserDto | null> => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setUser(null);
      setToken(null);
      return null;
    }
    try {
      const me = await authService.me();
      setUser(me);
      setToken(stored);
      return me;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
      return null;
    }
  }, []);

  // Refresh the session on mount when a token exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (!stored) {
        setLoading(false);
        return;
      }
      try {
        const me = await authService.me();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) {
          // 401 interceptor already cleaned storage; just drop local state.
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      isAdmin: user?.role === 'admin' || user?.role === 'head_admin',
      isAuthenticated: Boolean(user),
      login,
      register,
      loginWithToken,
      logout,
      refreshMe,
      setUser,
    }),
    [user, token, loading, login, register, loginWithToken, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
