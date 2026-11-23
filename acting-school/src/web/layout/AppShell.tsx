import clsx from 'clsx';
import { Contact, Ellipsis, House, Languages, LogOut, UserRound, WifiOff, X } from 'lucide-react';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Avatar } from '../components/ui/Avatar';
import { BrandMark } from '../components/ui/BrandMark';
import { PageLoader } from '../components/ui/States';
import { MessagesButton, NotificationsButton } from '../features/team/components/HeaderButtons';
import { SummonsAnswerWatcher } from '../features/team/components/SummonsAnswerWatcher';
import { SummonsBanner } from '../features/team/components/SummonsBanner';
import { currentLanguage, setLanguage } from '../i18n';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useOnline, useSchoolName } from '../lib/hooks';
import { useApplicationCounts } from '../features/applications/api';
import { legacyScheduleRedirect } from '../features/schedule/utils';
import { usePositionNames } from '../lib/positions';
import { useFormat } from '../lib/format';
import { TEAM_PATH, adminNavItems, mobileTabs, navItemActive, sectionNavItems, teamMenuActive, teamMenuHint, type NavItem } from './nav';
import { SectionTabs } from './SectionTabs';
import { currentSection, rememberRoute, rememberSection, rememberedSection, sectionByKey, sectionForPath, visibleSections } from './sections';

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

/**
 * Keeps the height of the sticky block at the top (the phone header plus a
 * call-to-the-office banner) in the CSS variable --app-top: a chat's own bar
 * sticks just under it, and html's scroll-padding-top (styles.css) keeps a
 * field scrolled into view from landing underneath it.
 */
function useStickyTopHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--app-top', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return () => root.style.removeProperty('--app-top');
    const observer = new ResizeObserver(set);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--app-top');
    };
  }, []);
  return ref;
}

type MenuItem = Pick<NavItem, 'to' | 'label' | 'icon' | 'end' | 'badge'>;

/** The plain home ("/") for someone who sees no section yet. */
const START_ITEM: MenuItem = { to: '/', label: 'home', icon: House, end: true };
const PROFILE_ITEM: MenuItem = { to: '/profile', label: 'profile', icon: UserRound };
/** The one Team page: every signed-in person, from the account menu in every section (it carries the management controls with staff.manage). */
const TEAM_ITEM: MenuItem = { to: TEAM_PATH, label: 'team', icon: Contact };

/**
 * The signed-in frame. The app has three sections (School, Casting, Website,
 * layout/sections.ts): the tabs at the top switch between them (only for
 * people who see two or more), and the menus — sidebar on desktop, bottom bar
 * + "More" on phones — show the current section's pages plus Administration
 * (Positions, Settings); Team and the profile are in the account menu of every
 * section, Messages and the bell at the top.
 * The current section's colour marks the line at the top, the active tab and
 * the active menu entry (data-section → bg-section / text-section).
 */
export function AppShell() {
  const { t } = useTranslation();
  const { user, can, signOut } = useAuth();
  const school = useSchoolName();
  const { pathname, search } = useLocation();
  const online = useOnline();
  const toggleLanguage = useLanguageToggle();
  const positionNames = usePositionNames();
  const [moreOpen, setMoreOpen] = useState(false);
  const userId = user?.id ?? null;
  const stickyTop = useStickyTopHeight();

  const visible = useMemo(() => visibleSections(can), [can]);
  const section = currentSection(pathname, visible, rememberedSection(userId), can);
  const sectionLabel = section ? t(sectionByKey(section).labelKey) : null;
  const homeHref = section ? sectionByKey(section).home : '/';

  // Remember the section, and the page within it, so "/" and the section's tab bring the person back.
  useEffect(() => {
    const own = sectionForPath(pathname);
    // An old /schedule link on its way to the Casting schedule is not a School page to come back to.
    if (pathname === '/schedule' && legacyScheduleRedirect(new URLSearchParams(search), can)) return;
    if (own && visible.some((s) => s.key === own)) {
      rememberSection(own, userId);
      rememberRoute(own, pathname + search, userId);
    }
  }, [pathname, search, visible, userId, can]);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);
  // Each navigation starts at the top, like a new page. Braces matter: in current
  // Chromium window.scrollTo() returns a Promise, and an effect must not return one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  // Count badges (new casting applications): fetched only while the person is in the section that lists them.
  const applicationBadge = section === 'casting' && can('talent.read');
  const applicationCounts = useApplicationCounts(applicationBadge);
  const badgeOf = (item: MenuItem): number => (item.badge === 'newCastingApplications' && applicationBadge ? (applicationCounts.data?.new ?? 0) : 0);

  const sectionItems = section ? sectionNavItems(section, can) : [];
  const adminItems = adminNavItems(can);
  const tabPaths = user ? mobileTabs(section, can) : [];
  const tabs = tabPaths.map((to) => (to === '/' ? START_ITEM : sectionItems.find((i) => i.to === to))).filter(Boolean) as MenuItem[];
  const moreSection = sectionItems.filter((i) => !tabPaths.includes(i.to));
  const teamActive = teamMenuActive(pathname);
  const moreActive = teamActive || [...moreSection, ...adminItems, PROFILE_ITEM].some((i) => navItemActive(i, pathname));
  const myPositions = user ? positionNames(user.positions) : '';
  const showTabs = visible.length > 1;

  const sidebarGroups: { id: string; label: string | null; items: MenuItem[] }[] = [
    { id: 'section', label: sectionLabel, items: sectionItems.length ? sectionItems : section ? [] : [START_ITEM] },
    { id: 'admin', label: t('nav.admin'), items: adminItems },
  ];

  return (
    <div className="min-h-dvh bg-canvas" data-section={section ?? undefined}>
      {/* Thin line in the section's colour across the top (desktop; phones have it in the header). */}
      <div aria-hidden className="fixed inset-x-0 top-0 z-40 hidden h-1 bg-section lg:block" />

      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-line bg-surface pt-1 lg:flex">
        <Link to={homeHref} className="flex items-center gap-2.5 px-5 py-5">
          <BrandMark className="size-9" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[15px] font-semibold">{school}</span>
            {sectionLabel && <span className="block truncate text-sm font-semibold text-section">{sectionLabel}</span>}
          </span>
        </Link>
        {/* Messages and notifications: in every section. */}
        <div className="grid gap-0.5 px-3 pb-3">
          <MessagesButton variant="sidebar" />
          <NotificationsButton variant="sidebar" />
        </div>
        <nav aria-label={t('nav.mainMenu')} className="flex-1 overflow-y-auto border-t border-line px-3 pb-4 pt-4">
          {sidebarGroups.map((g) =>
            g.items.length ? (
              <div key={g.id} className="mt-5 first:mt-0">
                {g.label && <div className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{g.label}</div>}
                <ul className="space-y-0.5">
                  {g.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive: a }) =>
                          clsx(
                            'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium transition-colors',
                            a ? 'bg-section-soft font-semibold text-section' : 'text-ink/85 hover:bg-surface-2 hover:text-ink',
                          )
                        }
                      >
                        <item.icon className="size-5 shrink-0" aria-hidden />
                        {t(`nav.${item.label}`)}
                        <CountBadge count={badgeOf(item)} className="ms-auto" />
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </nav>
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink/80 hover:bg-surface-2"
          >
            <Languages className="size-5" aria-hidden />
            <span lang={currentLanguage() === 'ar' ? 'en' : 'ar'}>{t('language.switchTo')}</span>
          </button>
          <Link
            to={TEAM_ITEM.to}
            aria-current={teamActive ? 'page' : undefined}
            className={clsx(
              'mt-1 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium',
              teamActive ? 'bg-section-soft font-semibold text-section' : 'text-ink/80 hover:bg-surface-2',
            )}
          >
            <TEAM_ITEM.icon className="size-5" aria-hidden />
            {t('nav.team')}
          </Link>
          <NavLink
            to="/profile"
            className={({ isActive: a }) => clsx('mt-1 flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-2', a && 'bg-surface-2')}
          >
            <Avatar name={user?.name ?? ''} fileId={user?.photoFileId} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user?.name}</span>
              <span className="block truncate text-xs text-muted">{myPositions}</span>
            </span>
          </NavLink>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            <LogOut className="size-5 rtl:-scale-x-100" aria-hidden />
            {t('nav.signOut')}
          </button>
        </div>
      </aside>

      {/* ── Phone top bar (school name + the section you're in, Messages, the bell) and,
           on every screen, the call-to-the-office banner: one sticky block. ── */}
      <div ref={stickyTop} className="sticky top-0 z-30">
        <header className="pt-safe border-b border-line bg-surface/95 backdrop-blur lg:hidden">
          <div aria-hidden className="h-1 bg-section" />
          <div className="flex h-14 items-center justify-between gap-1 ps-4 pe-2">
            <Link
              to={homeHref}
              className="flex min-h-12 min-w-0 items-center gap-2.5"
              aria-label={sectionLabel ? `${school} · ${t('sections.youAreIn', { section: sectionLabel })}` : undefined}
            >
              <BrandMark className="size-9 shrink-0" />
              <span className="min-w-0 leading-tight">
                <span className="block truncate font-semibold">{school}</span>
                {sectionLabel && <span className="block truncate text-sm font-semibold text-section">{sectionLabel}</span>}
              </span>
            </Link>
            <div className="flex shrink-0 items-center">
              <MessagesButton variant="phone" />
              <NotificationsButton variant="phone" />
              {/* Icon over its label, like the two buttons beside it, so the school name keeps its room. */}
              <button
                type="button"
                onClick={toggleLanguage}
                className="inline-flex min-h-12 min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 text-[11px] font-medium leading-none text-ink/80 hover:bg-surface-2 hover:text-ink"
              >
                <Languages className="size-[22px]" aria-hidden />
                <span lang={currentLanguage() === 'ar' ? 'en' : 'ar'}>{t('language.switchTo')}</span>
              </button>
            </div>
          </div>
        </header>
        <div className="lg:ms-64">
          <SummonsBanner />
          {user && can('staff.summon') && <SummonsAnswerWatcher />}
        </div>
      </div>

      {/* ── Section tabs (phones: under the header; desktop: top of the content) ── */}
      {showTabs && (
        <>
          <div className="px-4 pt-3 sm:px-6 lg:hidden">
            <SectionTabs sections={visible} current={section} pathname={pathname} userId={userId} />
          </div>
          <div className="hidden pt-1 lg:ms-64 lg:block">
            <div className="mx-auto max-w-6xl px-8 pt-6">
              <SectionTabs sections={visible} current={section} pathname={pathname} userId={userId} className="max-w-2xl" />
            </div>
          </div>
        </>
      )}

      {!online && (
        <div className="mt-3 flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-sm text-warning lg:ms-64">
          <WifiOff className="size-4" aria-hidden />
          {t('pwa.offline')}
        </div>
      )}

      {/* ── Page ────────────────────────────────────────────────────── */}
      <main className={clsx('lg:ms-64', !showTabs && 'lg:pt-1')}>
        <div className="mx-auto max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12 lg:pt-8">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* ── Phone bottom bar: the section's Home, up to three of its pages, More ── */}
      <nav aria-label={t('nav.mainMenu')} className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        {/* Icons on one line and labels under them: a two-line label ("Workshops on site") doesn't push its icon up. */}
        <ul className="mx-auto flex h-[4.25rem] max-w-lg items-stretch">
          {tabs.map((item) => {
            const active = navItemActive(item, pathname);
            return (
              <li key={item.to} className="min-w-0 flex-1">
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex h-full flex-col items-center justify-start gap-0.5 px-0.5 pt-2 text-center text-xs font-medium leading-tight',
                    active ? 'font-semibold text-section' : 'text-muted',
                  )}
                >
                  <span className={clsx('relative flex h-7 w-12 items-center justify-center rounded-full', active && 'bg-section-soft')}>
                    <item.icon className="size-[22px]" aria-hidden strokeWidth={active ? 2.2 : 1.8} />
                    <CountBadge count={badgeOf(item)} className="absolute -top-1.5 -end-1" />
                  </span>
                  <span className="line-clamp-2 max-w-full">{t(`nav.${item.label}`)}</span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              className={clsx(
                'flex h-full w-full flex-col items-center justify-start gap-0.5 pt-2 text-xs font-medium leading-tight',
                moreActive ? 'font-semibold text-section' : 'text-muted',
              )}
            >
              <span className={clsx('flex h-7 w-12 items-center justify-center rounded-full', moreActive && 'bg-section-soft')}>
                <Ellipsis className="size-[22px]" aria-hidden />
              </span>
              {t('nav.more')}
            </button>
          </li>
        </ul>
      </nav>

      {/* ── Phone "More" sheet: the rest of the section, Administration, Team, profile ── */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.more')}>
          <button type="button" className="absolute inset-0 bg-black/40" aria-label={t('actions.close')} onClick={() => setMoreOpen(false)} />
          <div className="pb-safe absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={user?.name ?? ''} fileId={user?.photoFileId} size="md" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{user?.name}</div>
                  <div className="truncate text-sm text-muted">{myPositions}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2"
                aria-label={t('actions.close')}
              >
                <X className="size-6" aria-hidden />
              </button>
            </div>
            {moreSection.length > 0 && sectionLabel && (
              <MoreGroup label={t('nav.moreSection', { section: sectionLabel })} items={moreSection} pathname={pathname} badgeOf={badgeOf} />
            )}
            {adminItems.length > 0 && <MoreGroup label={t('nav.admin')} items={adminItems} pathname={pathname} />}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line px-4 py-3">
              <Link
                to={TEAM_ITEM.to}
                aria-current={teamActive ? 'page' : undefined}
                className={clsx(
                  'col-span-2 flex min-h-14 items-center justify-center gap-3 rounded-xl px-3 py-2 text-sm font-medium',
                  teamActive ? 'bg-section-soft text-section' : 'bg-surface-2 text-ink',
                )}
              >
                <Contact className="size-5 shrink-0" aria-hidden />
                {/* What Team is for, in plain words: older owners won't guess "Team" means "message or call someone" (or "add someone"). */}
                <span className="min-w-0 text-start leading-tight">
                  <span className="block font-semibold">{t('nav.team')}</span>
                  <span className="block text-xs text-muted">{t(`nav.${teamMenuHint(can)}`)}</span>
                </span>
              </Link>
              <Link
                to={PROFILE_ITEM.to}
                aria-current={pathname === PROFILE_ITEM.to ? 'page' : undefined}
                className={clsx(
                  'flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium',
                  pathname === PROFILE_ITEM.to ? 'bg-section-soft text-section' : 'bg-surface-2 text-ink',
                )}
              >
                <UserRound className="size-5 shrink-0" aria-hidden />
                {t('nav.profile')}
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium text-danger hover:bg-danger-soft"
              >
                <LogOut className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
                {t('nav.signOut')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MoreGroup({ label, items, pathname, badgeOf }: { label: string; items: MenuItem[]; pathname: string; badgeOf?: (item: MenuItem) => number }) {
  const { t } = useTranslation();
  return (
    <section className="px-4 pb-2 pt-3">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">{label}</h2>
      <ul className="grid grid-cols-3 gap-2">
        {items.map((item) => {
          const active = navItemActive(item, pathname);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl px-2 py-3 text-center text-sm font-medium leading-tight',
                  active ? 'bg-section-soft text-section' : 'bg-surface-2 text-ink',
                )}
              >
                <span className="relative">
                  <item.icon className="size-6 shrink-0" aria-hidden />
                  <CountBadge count={badgeOf?.(item) ?? 0} className="absolute -top-2 -end-3" />
                </span>
                {t(`nav.${item.label}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A small count in the section's colour next to a menu entry ("3"), read out as "3 new"; nothing at zero. */
function CountBadge({ count, className }: { count: number; className?: string }) {
  const { t } = useTranslation();
  const f = useFormat();
  if (count <= 0) return null;
  return (
    <span className={clsx('inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-section px-1.5 text-xs font-bold leading-none text-section-ink tabular-nums', className)}>
      <span aria-hidden>{count > 99 ? '99+' : f.number(count)}</span>
      <span className="sr-only">, {t('nav.newCount', { count })}</span>
    </span>
  );
}
