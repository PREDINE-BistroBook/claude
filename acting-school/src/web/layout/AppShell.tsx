import clsx from 'clsx';
import { Drama, Ellipsis, Languages, LogOut, UserRound, WifiOff, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Avatar } from '../components/ui/Avatar';
import { PageLoader } from '../components/ui/States';
import { currentLanguage, setLanguage } from '../i18n';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/hooks';
import { MOBILE_TABS, NAV_ITEMS, type NavItem } from './nav';

function useLanguageToggle() {
  const { user, refresh } = useAuth();
  return async () => {
    const next = currentLanguage() === 'ar' ? 'en' : 'ar';
    setLanguage(next);
    if (user) {
      await api.patch('/auth/profile', { locale: next }).catch(() => undefined);
      await refresh();
    }
  };
}

function isActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

export function AppShell() {
  const { t } = useTranslation();
  const { user, can, schoolName, signOut } = useAuth();
  const { pathname } = useLocation();
  const online = useOnline();
  const toggleLanguage = useLanguageToggle();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => setMoreOpen(false), [pathname]);
  // Each navigation starts at the top, like a new page.
  useEffect(() => window.scrollTo(0, 0), [pathname]);

  const items = NAV_ITEMS.filter((i) => !i.permission || can(i.permission));
  const tabs = (user ? MOBILE_TABS[user.role] : []).map((to) => items.find((i) => i.to === to)).filter(Boolean) as NavItem[];
  const moreItems = items.filter((i) => !tabs.includes(i));
  const groups: { id: NavItem['group']; label?: string }[] = [
    { id: 'main' },
    { id: 'school', label: t('nav.school') },
    { id: 'agency', label: t('nav.agency') },
    { id: 'admin', label: t('nav.admin') },
  ];
  const school = schoolName || t('appName');

  return (
    <div className="min-h-dvh bg-canvas">
      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-line bg-surface lg:flex">
        <Link to="/" className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-ink">
            <Drama className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 truncate text-[15px] font-semibold leading-tight">{school}</span>
        </Link>
        <nav aria-label={t('nav.mainMenu')} className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g) => {
            const groupItems = items.filter((i) => i.group === g.id);
            if (!groupItems.length) return null;
            return (
              <div key={g.id} className="mt-4 first:mt-0">
                {g.label && <div className="px-3 pb-1.5 text-xs font-medium uppercase tracking-wider text-muted">{g.label}</div>}
                <ul className="space-y-0.5">
                  {groupItems.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        className={({ isActive: a }) =>
                          clsx(
                            'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                            a ? 'bg-accent-soft text-accent' : 'text-ink/80 hover:bg-surface-2 hover:text-ink',
                          )
                        }
                      >
                        <item.icon className="size-[18px] shrink-0" aria-hidden />
                        {t(`nav.${item.label}`)}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink/80 hover:bg-surface-2"
          >
            <Languages className="size-[18px]" aria-hidden />
            <span lang={currentLanguage() === 'ar' ? 'en' : 'ar'}>{t('language.switchTo')}</span>
          </button>
          <NavLink
            to="/profile"
            className={({ isActive: a }) => clsx('mt-1 flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-2', a && 'bg-surface-2')}
          >
            <Avatar name={user?.name ?? ''} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user?.name}</span>
              <span className="block truncate text-xs text-muted">{user && t(`enums.role.${user.role}`)}</span>
            </span>
          </NavLink>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            <LogOut className="size-[18px] rtl:-scale-x-100" aria-hidden />
            {t('nav.signOut')}
          </button>
        </div>
      </aside>

      {/* ── Phone top bar ───────────────────────────────────────────── */}
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink">
              <Drama className="size-[18px]" aria-hidden />
            </span>
            <span className="truncate font-semibold">{school}</span>
          </Link>
          <button
            type="button"
            onClick={toggleLanguage}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
            lang={currentLanguage() === 'ar' ? 'en' : 'ar'}
          >
            {t('language.switchTo')}
          </button>
        </div>
      </header>

      {!online && (
        <div className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-sm text-warning lg:ms-64">
          <WifiOff className="size-4" aria-hidden />
          {t('pwa.offline')}
        </div>
      )}

      {/* ── Page ────────────────────────────────────────────────────── */}
      <main className="lg:ms-64">
        <div className="mx-auto max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12 lg:pt-8">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* ── Phone bottom tabs ───────────────────────────────────────── */}
      <nav aria-label={t('nav.mainMenu')} className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        <ul className="mx-auto flex h-16 max-w-lg items-stretch">
          {tabs.map((item) => {
            const active = isActive(pathname, item.to);
            return (
              <li key={item.to} className="flex-1">
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={clsx('flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-accent' : 'text-muted')}
                >
                  <item.icon className="size-[22px]" aria-hidden strokeWidth={active ? 2.2 : 1.8} />
                  {t(`nav.${item.label}`)}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              className={clsx(
                'flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium',
                moreItems.some((i) => isActive(pathname, i.to)) || pathname === '/profile' ? 'text-accent' : 'text-muted',
              )}
            >
              <Ellipsis className="size-[22px]" aria-hidden />
              {t('nav.more')}
            </button>
          </li>
        </ul>
      </nav>

      {/* ── Phone "More" sheet ──────────────────────────────────────── */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.more')}>
          <button type="button" className="absolute inset-0 bg-black/40" aria-label={t('actions.close')} onClick={() => setMoreOpen(false)} />
          <div className="pb-safe absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={user?.name ?? ''} size="md" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{user?.name}</div>
                  <div className="truncate text-sm text-muted">{user && t(`enums.role.${user.role}`)}</div>
                </div>
              </div>
              <button type="button" onClick={() => setMoreOpen(false)} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label={t('actions.close')}>
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <ul className="grid grid-cols-3 gap-2 p-4">
              {[...moreItems, { to: '/profile', label: 'profile', icon: UserRound, group: 'admin' as const }].map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={clsx(
                      'flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center text-sm font-medium',
                      isActive(pathname, item.to) ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink',
                    )}
                  >
                    <item.icon className="size-6" aria-hidden />
                    {t(`nav.${item.label}`)}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={() => void signOut()}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-danger hover:bg-danger-soft"
              >
                <LogOut className="size-4 rtl:-scale-x-100" aria-hidden />
                {t('nav.signOut')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
