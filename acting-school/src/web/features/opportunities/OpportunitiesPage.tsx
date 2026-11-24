import clsx from 'clsx';
import { Binoculars, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { todayISO } from '@shared/dates';
import type { OpportunityStatus } from '@shared/enums';
import type { OpportunityCounts } from '@shared/schemas/opportunities';
import { EmptyState, ErrorState, PageHeader, PageLoader, SearchInput } from '@web/components/ui';
import { wholeListEmpty } from '@web/layout/addActions';
import { ScreenAddAction, ScreenEmptyAdd } from '@web/layout/ScreenAdd';
import { useFormat } from '@web/lib/format';
import { useDebounced } from '@web/lib/hooks';
import { useOpportunities, useOpportunityCounts } from './api';
import { OpportunityCard, STATUS_ICONS } from './components/OpportunityParts';
import { OPPORTUNITY_TABS, parseOpportunityStatus } from './utils';

/**
 * /casting/opportunities — castings the team saw elsewhere (Part K1): New /
 * Interested / Applied / Not for us, each with its count; a card per
 * opportunity with its first screenshot, the red "Asks for money" warning,
 * the deadline (red within three days, "Closed" once passed) and the buttons
 * Open the post · Interested · Applied · Not for us · Turn into a casting.
 * "+ Add opportunity" with castings.write.
 */
export default function OpportunitiesPage() {
  const { t } = useTranslation(['opportunities', 'common']);
  const [params, setParams] = useSearchParams();
  const status = parseOpportunityStatus(params.get('status'));
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebounced(q.trim(), 300);
  const counts = useOpportunityCounts();
  const list = useOpportunities({ status, q: debounced || undefined });
  const today = todayISO();

  // Keep the search in the address, so "Back" from an opportunity returns to the same list.
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debounced) next.set('q', debounced);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [debounced, setParams]);

  const setStatus = (s: OpportunityStatus) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (s === 'new') next.delete('status');
        else next.set('status', s);
        return next;
      },
      { replace: true },
    );

  const items = list.data?.items ?? [];
  let body;
  if (list.isPending) body = <PageLoader />;
  else if (list.isError) body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  else if (!items.length)
    body = debounced ? (
      <EmptyState icon={SearchX} title={t('common:states.noResults')} description={t('common:states.noResultsHint')} />
    ) : (
      <EmptyState
        icon={Binoculars}
        title={t(`empty.${status}.title`)}
        description={t(`empty.${status}.hint`)}
        // "Add the first opportunity" only when there are none at all: an empty tab next to full ones has the screen's own Add.
        action={wholeListEmpty(counts.data && Object.values(counts.data)) ? <ScreenEmptyAdd screen="casting/opportunities" /> : undefined}
        className="rounded-2xl border border-dashed border-line-strong"
      />
    );
  else
    body = (
      <>
        <p className="mb-2 px-1 text-sm text-muted" aria-live="polite">
          {t('count', { count: items.length })}
        </p>
        <ul className={clsx('grid gap-3 lg:grid-cols-2 lg:items-start', list.isPlaceholderData && 'opacity-60')}>
          {items.map((o) => (
            <li key={o.id}>
              <OpportunityCard opportunity={o} today={today} />
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <div>
      {/* The explanation under the title is for larger screens: on a phone the list starts higher. */}
      <PageHeader title={t('title')} subtitle={<span className="max-sm:hidden">{t('subtitle')}</span>} actions={<ScreenAddAction screen="casting/opportunities" />} />
      <StatusTabs value={status} onChange={setStatus} counts={counts.data} />
      <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="mb-4" />
      {body}
    </div>
  );
}

/** The four statuses as big buttons, two by two on a phone (all in sight, nothing scrolls sideways), each with its count. */
function StatusTabs({ value, onChange, counts }: { value: OpportunityStatus; onChange: (s: OpportunityStatus) => void; counts?: OpportunityCounts }) {
  const { t } = useTranslation(['opportunities', 'common']);
  const f = useFormat();
  return (
    <div role="tablist" aria-label={t('tabsLabel')} className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {OPPORTUNITY_TABS.map((id) => {
        const active = id === value;
        const n = counts?.[id];
        const Icon = STATUS_ICONS[id];
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={clsx(
              'flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-start text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-section',
              active ? 'border-section bg-section text-section-ink' : 'border-line-strong bg-surface text-ink hover:bg-surface-2',
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {/* No icon on the narrowest phones: "Interested" and its count need the room. */}
              <Icon className="size-4 shrink-0 max-[22.5rem]:hidden" aria-hidden />
              <span className="min-w-0">{t(`common:enums.opportunityStatus.${id}`)}</span>
            </span>
            {n !== undefined && (
              <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums', active ? 'bg-black/15' : 'bg-surface-2 text-muted')}>{f.number(n)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
