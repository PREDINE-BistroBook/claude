import { Megaphone, UserRoundPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { CastingApplicationListItem } from '@shared/schemas/castingApplications';
import { Avatar, Badge, ButtonLink, EmptyState, ErrorState, List, ListRow, PageHeader, PageLoader, SearchInput, Tabs } from '@web/components/ui';
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
      <Tabs
        tabs={APPLICATION_TABS.map((id) => ({ id, label: t(`common:enums.castingApplicationStatus.${id}`), count: counts.data?.[id] }))}
        value={status}
        onChange={setStatus}
        className="mb-4 [&_button]:min-h-12 [&_button]:text-base"
      />
      <SearchInput value={q} onChange={setQ} placeholder={can('talent.contact') ? t('searchContact') : t('search')} className="mb-4" />
      {body}
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
