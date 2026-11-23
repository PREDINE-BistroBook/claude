import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Permission } from '@shared/permissions';
import type { DashboardData } from '@shared/schemas/dashboard';
import { ButtonLink, StatCard } from '@web/components/ui';
import { canAdd } from '@web/layout/addActions';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { useCafeStatus } from '../../cafe/api';
import { OrderDrinkButton } from '../../cafe/components/CafeParts';
import { firstName, greetingFor } from '../utils';

export interface HomeStat {
  key: keyof DashboardData['counts'];
  to: string;
  icon: LucideIcon;
}

export interface QuickAction {
  key: string;
  /** "ns:key" of its words (layout/addActions.ts HOME_QUICK_ACTIONS: the list button's own). */
  labelKey: string;
  to: string;
  icon: LucideIcon;
  permission: Permission;
  /** A second permission the page needs as well (Add enquiry: admissions.read). */
  also?: Permission;
}

/** Tailwind needs the full class names written out. */
const STAT_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-3 lg:grid-cols-5',
  6: 'sm:grid-cols-3',
};

/** "Good morning, Karim · Monday 23 November 2026" — under a section home's heading. */
export function useGreetingLine(today: string): string {
  const { t } = useTranslation(['dashboard']);
  const { user } = useAuth();
  const f = useFormat();
  const greeting = t(`greeting.${greetingFor(new Date().getHours())}`, { name: firstName(user?.name) });
  return `${greeting} · ${f.date(today, 'full')}`;
}

/** The counts this section's home shows, for the counts the API answered (the others are closed to the person). */
export function StatGrid({ stats, counts }: { stats: HomeStat[]; counts: DashboardData['counts'] }) {
  const { t } = useTranslation(['dashboard']);
  const f = useFormat();
  const shown = stats.filter((s) => counts[s.key] != null);
  if (!shown.length) return null;
  return (
    <section aria-label={t('stats.label')} className={clsx('grid grid-cols-2 gap-3', STAT_COLS[shown.length])}>
      {shown.map((s) => (
        <StatCard key={s.key} label={t(`stats.${s.key}`)} value={f.number(counts[s.key] ?? 0)} icon={s.icon} to={s.to} />
      ))}
    </section>
  );
}

/**
 * Half the phone's width each: a long label ("Call someone to the office") takes two lines rather than being cut.
 * `whitespace-normal!`: the Button's own `whitespace-nowrap` comes later in the stylesheet and would win.
 */
const QUICK_BUTTON = 'h-auto min-h-12 w-full whitespace-normal! py-2 text-center leading-tight sm:w-auto';

/**
 * Big buttons for the section's everyday "new …" actions, each only with its
 * permission — and, on every section home, "Order a drink" (the cafeteria:
 * everyone, while it is switched on).
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const { can } = useAuth();
  const cafeOn = !!useCafeStatus()?.enabled;
  const allowed = actions.filter((a) => canAdd(a, can));
  if (!allowed.length && !cafeOn) return null;
  return (
    <section aria-labelledby="quick-actions">
      <h2 id="quick-actions" className="sr-only">
        {t('quick.label')}
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {allowed.map((a) => (
          <ButtonLink key={a.key} to={a.to} icon={a.icon} size="lg" className={QUICK_BUTTON}>
            {t(a.labelKey)}
          </ButtonLink>
        ))}
        <OrderDrinkButton className={QUICK_BUTTON} />
      </div>
    </section>
  );
}

/** The section's cards, two by two on desktop. */
export function CardGrid({ children }: { children: ReactNode[] }) {
  const cards = children.filter(Boolean);
  if (!cards.length) return null;
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">{cards}</div>;
}

/** How many quick actions the person has — "Order a drink" included while the cafeteria is on (to tell an empty home from a quiet one). */
export function useAllowedCount(actions: QuickAction[]): number {
  const { can } = useAuth();
  const cafeOn = !!useCafeStatus()?.enabled;
  return actions.filter((a) => canAdd(a, can)).length + (cafeOn ? 1 : 0);
}
