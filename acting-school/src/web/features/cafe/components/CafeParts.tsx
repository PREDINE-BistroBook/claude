import clsx from 'clsx';
import { CalendarDays, ClipboardList, Coffee, CupSoda, Settings, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { cafeItemName, cafeOptionsLabel, cafePlaceLabel, cafeReasonLabel, type CafeOrderLine, type CafePlace } from '@shared/schemas/cafe';
import { ButtonLink, EmptyState, ErrorState, PageLoader } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { visibleSections } from '../../../layout/sections';
import { useUnread } from '../../team/api';
import { useCafeMenu, useCafeStatus } from '../api';
import { CAFE_PATH, agoParts, boardIsHome, cafeBadge, cafePageForPath, cafePagePath, cafePages, type CafePage } from '../utils';

const PAGE_ICON: Record<CafePage, LucideIcon> = { board: ClipboardList, menu: UtensilsCrossed, order: Coffee, report: CalendarDays };

/**
 * The cafeteria's pages as big tabs, for people who have more than one (an
 * owner: Orders, Menu, My order, Monthly; the director: Orders, Menu, My
 * order). Four tabs put the icon above the word, to fit a phone. Everyone else
 * only orders, so they get no tabs — and the Office helper, whose home is the
 * board, has the same three in his own menu (the bottom bar on a phone), so
 * no second row of them here.
 */
export function CafeTabs() {
  const { t } = useTranslation(['cafe']);
  const f = useFormat();
  const { can } = useAuth();
  const { pathname } = useLocation();
  const cafe = useCafeStatus();
  const pages = cafePages(can, cafe?.enabled);
  if (pages.length < 2 || boardIsHome(can, visibleSections(can).length, cafe?.enabled)) return null;
  const current = cafePageForPath(pathname);
  const waiting = cafeBadge(cafe);
  const stacked = pages.length > 3;
  return (
    <nav aria-label={t('tabs.label')} className="mb-5 grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-surface-2 p-1">
      {pages.map((page) => {
        const Icon = PAGE_ICON[page];
        const active = page === current;
        return (
          <Link
            key={page}
            to={cafePagePath(page)}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'relative flex min-h-12 min-w-0 items-center justify-center rounded-xl py-2 text-center text-sm font-semibold leading-tight transition-colors',
              stacked ? 'flex-col gap-0.5 px-1' : 'gap-2 px-2',
              active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="min-w-0">{t(`tabs.${page}`)}</span>
            {page === 'board' && waiting > 0 && (
              <span
                className={clsx(
                  'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-bold leading-none text-danger-ink tabular-nums',
                  stacked && 'absolute end-1 top-1',
                )}
              >
                {waiting > 99 ? `${f.number(99)}+` : f.number(waiting)}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Wraps each cafeteria page: a loader until the poll has said whether the
 * cafeteria is switched on (an error with "Try again" if it can't be read),
 * and "switched off" instead of the page when it is not (with the way back on
 * for whoever may change Settings).
 */
export function CafeGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['cafe', 'common']);
  const { can } = useAuth();
  const poll = useUnread();
  const cafe = poll.data?.cafe;
  // The poll couldn't be read (no signal): say so, with "Try again", rather than spin for ever.
  if (!cafe) return poll.isError ? <ErrorState error={poll.error} onRetry={() => void poll.refetch()} /> : <PageLoader />;
  if (!cafe.enabled)
    return (
      <EmptyState
        icon={CupSoda}
        title={t('off.title')}
        description={can('settings.manage') ? t('off.hintSettings') : t('off.hint')}
        className="min-h-[50vh]"
        action={
          can('settings.manage') ? (
            <ButtonLink to="/settings" icon={Settings} size="lg">
              {t('off.openSettings')}
            </ButtonLink>
          ) : undefined
        }
      />
    );
  return <>{children}</>;
}

/** Item and place names, ready-made choices and reasons, in the screen's language (the places come with the cached menu). */
export function useCafeNames() {
  const { i18n } = useTranslation();
  const menu = useCafeMenu();
  const places: readonly CafePlace[] = menu.data?.places ?? [];
  return {
    language: i18n.language,
    itemName: (item: { nameEn: string; nameAr: string }) => cafeItemName(item, i18n.language),
    placeLabel: (place: string) => cafePlaceLabel(place, places, i18n.language),
    optionsLabel: (options: string | null) => cafeOptionsLabel(options, i18n.language),
    reasonLabel: (reason: string) => cafeReasonLabel(reason, i18n.language),
  };
}

/** Long words that don't break (a pasted link, "xxxxxxxx…") wrap inside the card instead of widening the page. */
export const WRAP_ANYWHERE = '[overflow-wrap:anywhere]';

/** An order's lines, one under the other: "2 × Tea", and how each is wanted set apart so it can't be missed. */
export function OrderLines({ lines, size = 'md' }: { lines: readonly CafeOrderLine[]; size?: 'md' | 'lg' }) {
  const { itemName, optionsLabel } = useCafeNames();
  const f = useFormat();
  return (
    <ul className={clsx('grid', size === 'lg' ? 'gap-2' : 'gap-1')}>
      {lines.map((line) => (
        <li key={line.id} className={clsx('flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1', WRAP_ANYWHERE, size === 'lg' ? 'text-lg' : 'text-base')}>
          <span className="min-w-0 font-semibold text-ink">
            <span className="tabular-nums">{f.number(line.qty)}</span> × <bdi>{itemName(line)}</bdi>
          </span>
          {line.options && (
            <span className={clsx('min-w-0 rounded-lg bg-warning-soft px-2 py-0.5 font-medium text-warning', size === 'lg' ? 'text-base' : 'text-sm')}>
              <bdi>{optionsLabel(line.options)}</bdi>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Re-renders every `everyMs` so "5 minutes ago" keeps moving while a page stays open. */
export function useNow(everyMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** "Just now" / "5 minutes ago" / "2 hours ago", in the screen's language. */
export function useAgo() {
  const { t } = useTranslation(['cafe']);
  const f = useFormat();
  return (then: number, now: number): string => {
    const ago = agoParts(then, now);
    if (ago.unit === 'now') return t('board.justNow');
    return new Intl.RelativeTimeFormat(f.locale, { numeric: 'always' }).format(-ago.value, ago.unit);
  };
}

/** "Order a drink": the quick action on every section home. Nothing while the cafeteria is off (or not known yet). */
export function OrderDrinkButton({ className }: { className?: string }) {
  const { t } = useTranslation(['cafe']);
  const cafe = useCafeStatus();
  if (!cafe?.enabled) return null;
  return (
    <ButtonLink to={CAFE_PATH} icon={Coffee} size="lg" className={className}>
      {t('orderDrink')}
    </ButtonLink>
  );
}
