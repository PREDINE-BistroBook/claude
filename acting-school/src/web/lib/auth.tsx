import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Permission } from '@shared/permissions';
import type { MeResponse, SessionUser } from '@shared/schemas/auth';
import { currentLanguage, setLanguage } from '../i18n';
import { ErrorState, NoAccess, SplashScreen } from '../components/ui/States';
import { api, ApiError, setForbiddenHandler, setUnauthorizedHandler } from './api';
import { authGate } from './authGate';
import { stopPushOnThisBrowser } from './push';

const ChoosePasswordPage = lazy(() => import('../pages/ChoosePasswordPage'));

interface AuthState {
  user: SessionUser | null;
  needsSetup: boolean;
  /** Setup asks for the setup code (on Cloudflare). */
  setupCodeRequired: boolean;
  schoolName: string;
  /** Arabic name, when the school has one. For display use useSchoolName() (picks by language). */
  schoolNameAr: string | null;
  loading: boolean;
  /**
   * The server can't be reached and we don't know who is signed in (opened with no signal, or a
   * weak one): show an offline screen rather than the sign-in page — the session may well be valid.
   */
  offline: boolean;
  /** Whether the signed-in person's positions allow this (owners: everything). */
  can: (permission: Permission) => boolean;
  /** Call after sign-in / setup / profile change to refresh. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
export const ME_KEY = ['me'] as const;

/** Is this cached query about the signed-in person themselves (kept when the cache is wiped)? */
const isMeQuery = (key: readonly unknown[]) => key[0] === ME_KEY[0];

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // Positions can change at any time (permissions are worked out on every request), so re-read fairly often.
  const me = useQuery({ queryKey: ME_KEY, queryFn: () => api.get<MeResponse>('/auth/me'), staleTime: 60_000, retry: 1 });
  const user = me.data?.user ?? null;

  useEffect(() => {
    setUnauthorizedHandler(() => void qc.invalidateQueries({ queryKey: ME_KEY }));
    // A refusal usually means this person's positions changed: re-read them (without restarting a read already under way).
    setForbiddenHandler(() => void qc.invalidateQueries({ queryKey: ME_KEY }, { cancelRefetch: false }));
    return () => {
      setUnauthorizedHandler(null);
      setForbiddenHandler(null);
    };
  }, [qc]);

  // Whenever the signed-in person changes — sign-out, a session that ended (expired, deactivated,
  // password reset elsewhere), or someone else signing in on the same tab — drop everything cached
  // for the previous person. Otherwise the next person would briefly see data their positions hide
  // (contact details, other classes, owner accounts) while their own copy loads.
  const lastUserId = useRef<number | null | undefined>(undefined);
  const userId = me.isPending ? undefined : (user?.id ?? null);
  useEffect(() => {
    if (userId === undefined) return;
    if (lastUserId.current !== undefined && lastUserId.current !== userId) {
      // reset (not remove): queries still on screen start again from nothing instead of keeping old data.
      void qc.resetQueries({ predicate: (q) => !isMeQuery(q.queryKey) });
    }
    lastUserId.current = userId;
  }, [qc, userId]);

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
    // First, while still signed in: this browser stops getting this person's notifications.
    await stopPushOnThisBrowser();
    await api.post('/auth/logout').catch(() => undefined);
    // Mark the person as gone at once (RequireAuth then sends the screen to /login), drop every
    // cached answer about them, then re-read /auth/me for the school name and setup state.
    // (Clearing the whole cache instead would leave nothing to say "signed out" until a reload.)
    qc.setQueryData<MeResponse>(ME_KEY, (d) => (d ? { ...d, user: null } : d));
    qc.removeQueries({ predicate: (q) => !isMeQuery(q.queryKey) });
    void qc.invalidateQueries({ queryKey: ME_KEY });
  }, [qc]);

  const offline =
    !me.data && (me.fetchStatus === 'paused' || (me.error instanceof ApiError && me.error.code === 'network'));

  const value = useMemo<AuthState>(
    () => ({
      user,
      needsSetup: me.data?.needsSetup ?? false,
      setupCodeRequired: me.data?.setupCodeRequired ?? false,
      schoolName: me.data?.schoolName ?? '',
      schoolNameAr: me.data?.schoolNameAr ?? null,
      loading: me.isPending && !offline,
      offline,
      can: (p) => !!user?.permissions.includes(p),
      refresh,
      signOut,
    }),
    [user, me.data, me.isPending, offline, refresh, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/**
 * Signed-in only: sends everyone else to /login (or /setup on first run).
 * Someone who signed in with a temporary password gets the "Choose your own
 * password" screen instead of the app, at every address, until they have
 * chosen (authGate, lib/authGate.ts).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, needsSetup, offline, refresh } = useAuth();
  const location = useLocation();
  switch (authGate({ user, loading, needsSetup, offline })) {
    case 'offline':
      return (
        <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
          <ErrorState error={new ApiError(0, 'network', 'Network error')} onRetry={() => void refresh()} />
        </div>
      );
    case 'loading':
      return <SplashScreen />;
    case 'setup':
      return <Navigate to="/setup" replace />;
    case 'login': {
      const next = location.pathname + location.search;
      return <Navigate to={next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
    }
    case 'choosePassword':
      return (
        <Suspense fallback={<SplashScreen />}>
          <ChoosePasswordPage />
        </Suspense>
      );
    case 'app':
      return <>{children}</>;
  }
}

/** Renders children only for people whose positions allow the permission; a "no access" message otherwise. */
export function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <NoAccess />;
}
