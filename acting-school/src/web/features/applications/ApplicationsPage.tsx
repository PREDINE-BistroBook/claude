import clsx from 'clsx';
import { Megaphone, UserRoundPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { CastingApplicationStatus } from '@shared/enums';
import type { CastingApplicationCounts, CastingApplicationListItem } from '@shared/schemas/castingApplications';
import { Avatar, Badge, ButtonLink, EmptyState, ErrorState, List, ListRow, PageHeader, PageLoader, SearchInput } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { fullName, useFormat } from '@web/lib/format';
import { useDebounced } from '@web/lib/hooks';
import { useApplicationCounts, useApplications } from './api';
import { APPLICATION_TABS, parseApplicationStatus } from './utils';

/**
 * /casting/applications — casting-call applications from the website, by
 * status (New / Reviewing / Added to roster / Declined, each with its count),
 * newest first, with a search.
 */
export default function ApplicationsPage() {
  const { t } = useTranslation(['applications', 'common']);
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = parseApplicationStatus(params.get('status'));
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebounced(q.trim(), 300);
  const counts = useApplicationCounts();
  const list = useApplications({ status, q: debounced || undefined });

  // Keep the search in the address, so "Back" from an application returns to the same list.
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

  const setStatus = (s: string) =>
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
      <EmptyState title={t('common:states.noResults')} description={t('common:states.noResultsHint')} />
    ) : (
      <EmptyState icon={UserRoundPlus} title={t(`empty.${status}.title`)} description={t(`empty.${status}.hint`)} />
    );
  else
    body = (
      <List>
        {items.map((a) => (
          <ApplicationRow key={a.id} application={a} />
        ))}
      </List>
    );

  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          can('website.manage') ? (
            <ButtonLink to="/website/casting-call" icon={Megaphone} size="lg">
              {t('castingCall')}
            </ButtonLink>
          ) : undefined
        }
      />
      <StatusTabs value={status} onChange={setStatus} counts={counts.data} />
      <SearchInput value={q} onChange={setQ} placeholder={can('talent.contact') ? t('searchContact') : t('search')} className="mb-4" />
      {body}
    </div>
  );
}

/**
 * The four statuses as big buttons, two by two on a phone (all visible at once:
 * no strip that scrolls sideways), each with its count. The chosen one is
 * filled with the Casting colour.
 */
function StatusTabs({ value, onChange, counts }: { value: CastingApplicationStatus; onChange: (s: CastingApplicationStatus) => void; counts?: CastingApplicationCounts }) {
  const { t } = useTranslation(['applications', 'common']);
  const f = useFormat();
  return (
    <div role="tablist" aria-label={t('common:fields.status')} className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {APPLICATION_TABS.map((id) => {
        const active = id === value;
        const n = counts?.[id];
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
            <span className="min-w-0">{t(`common:enums.castingApplicationStatus.${id}`)}</span>
            {n !== undefined && (
              <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums', active ? 'bg-black/15' : 'bg-surface-2 text-muted')}>{f.number(n)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ApplicationRow({ application: a }: { application: CastingApplicationListItem }) {
  const { t } = useTranslation(['applications', 'common']);
  const f = useFormat();
  const name = fullName(a);
  const facts = [a.age !== null ? t('common:units.years', { count: a.age }) : null, a.city, t('applied', { date: f.timestamp(a.createdAt) })].filter(Boolean);
  return (
    <ListRow
      to={`/casting/applications/${a.id}`}
      className="min-h-20"
      leading={<Avatar name={name} fileId={a.photoFileId} size="lg" shape="rounded" />}
      title={<bdi className="font-semibold">{name}</bdi>}
      subtitle={
        <span className="flex flex-col gap-1 whitespace-normal">
          <span>{facts.map((x, i) => (i === 0 ? <bdi key={i}>{x}</bdi> : <span key={i}> · <bdi>{x}</bdi></span>))}</span>
          {a.minor && (
            <span>
              <Badge tone="warning">{t('minor')}</Badge>
            </span>
          )}
        </span>
      }
    />
  );
}
