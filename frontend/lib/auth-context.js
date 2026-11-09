'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { get, login as apiLogin, post } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, phase: null, meta: null });

  const refresh = useCallback(async () => {
    try {
      const data = await get('/auth/me');
      setState({
        status: 'authenticated',
        user: data.user,
        phase: data.phase,
        resultsPublic: data.resultsPublic,
        rules: data.rules,
      });
      return data;
    } catch {
      setState({ status: 'anonymous', user: null, phase: null });
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (phone) => {
    const data = await apiLogin(phone);
    const me = await get('/auth/me');
    setState({
      status: 'authenticated',
      user: me.user,
      phase: me.phase,
      resultsPublic: me.resultsPublic,
      rules: me.rules,
    });
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setState({ status: 'anonymous', user: null, phase: null });
    }
  }, []);

  const value = useMemo(() => ({ ...state, login, logout, refresh }), [state, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

const RANK = { EMPLOYEE: 1, COMMITTEE: 2, ADMIN: 3 };

/**
 * Client-side gate. This is convenience only — the server enforces every rule.
 * `roles` is a minimum: 'COMMITTEE' also admits ADMIN.
 */
export function useRequireRole(minRole = 'EMPLOYEE') {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (auth.status === 'anonymous') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (auth.status === 'authenticated' && (RANK[auth.user.role] ?? 0) < RANK[minRole]) {
      router.replace('/employee');
    }
  }, [auth.status, auth.user, minRole, pathname, router]);

  return auth;
}
