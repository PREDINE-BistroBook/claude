import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Permission } from '@shared/permissions';
import type { MeResponse, SessionUser } from '@shared/schemas/auth';
import { currentLanguage, setLanguage } from '../i18n';
import { NoAccess, SplashScreen } from '../components/ui/States';
import { api, setUnauthorizedHandler } from './api';

interface AuthState {
  user: SessionUser | null;
  needsSetup: boolean;
  schoolName: string;
  loading: boolean;
  /** Whether the signed-in person's positions allow this (owners: everything). */
  can: (permission: Permission) => boolean;
  /** Call after sign-in / setup / profile change to refresh. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
export const ME_KEY = ['me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: () => api.get<MeResponse>('/auth/me'), staleTime: 5 * 60_000, retry: 1 });
  const user = me.data?.user ?? null;

  useEffect(() => {
    setUnauthorizedHandler(() => void qc.invalidateQueries({ queryKey: ME_KEY }));
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  // A signed-in person's saved language wins once per sign-in.
  const appliedFor = useRef<number | null>(null);
  useEffect(() => {
    if (user && appliedFor.current !== user.id) {
      appliedFor.current = user.id;
      if (user.locale !== currentLanguage()) setLanguage(user.locale);
    }
    if (!user) appliedFor.current = null;
  }, [user]);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ME_KEY });
  }, [qc]);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    await qc.invalidateQueries({ queryKey: ME_KEY });
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      needsSetup: me.data?.needsSetup ?? false,
      schoolName: me.data?.schoolName ?? '',
      loading: me.isPending,
      can: (p) => !!user?.permissions.includes(p),
      refresh,
      signOut,
    }),
    [user, me.data, me.isPending, refresh, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Signed-in only: sends everyone else to /login (or /setup on first run). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, needsSetup } = useAuth();
  const location = useLocation();
  if (loading) return <SplashScreen />;
  if (!user) {
    if (needsSetup) return <Navigate to="/setup" replace />;
    const next = location.pathname + location.search;
    return <Navigate to={next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
  }
  return <>{children}</>;
}

/** Renders children only for people whose positions allow the permission; a "no access" message otherwise. */
export function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <NoAccess />;
}
