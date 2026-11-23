import clsx from 'clsx';
import { CalendarClock, ChevronRight, Clapperboard, SearchX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { CASTING_STATUSES, type CastingStatus } from '@shared/enums';
import type { CastingListItem } from '@shared/schemas/castings';
import {
  Button,
  EmptyState,
  ErrorState,
  List,
  PageHeader,
  PageLoader,
  SearchInput,
  Segmented,
  StatusBadge,
  useEnumLabel,
} from '@web/components/ui';
import { wholeListEmpty } from '@web/layout/addActions';
import { ScreenAddAction, ScreenEmptyAdd } from '@web/layout/ScreenAdd';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { useDebounced } from '@web/lib/hooks';
import { useCastings } from './api';
import { CastingTypeIcon, DeadlineBadge } from './components/bits';

type StatusFilter = CastingStatus | 'all';

/** ?status= → filter. No param means "open" (what the agency works on day to day). */
function parseStatus(v: string | null): StatusFilter {
  if (v === 'all') return 'all';
  return v && (CASTING_STATUSES as readonly string[]).includes(v) ? (v as CastingStatus) : 'open';
}

export default function CastingsPage() {
  const { t } = useTranslation(['castings', 'common']);
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = parseStatus(params.get('status'));

  // The box updates instantly; the URL (and so the query) follows after a pause in typing.
  const [text, setText] = useState(q);
  const debounced = useDebounced(text.trim(), 300);
  const pushed = useRef(q);

  useEffect(() => {
    if (debounced === pushed.current) return;
    pushed.current = debounced;
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

  // Back/forward (or a link) changed ?q= — reflect it in the box.
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q;
      setText(q);
    }
  }, [q]);

  const setStatus = (value: StatusFilter) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'open') next.delete('status');
        else next.set('status', value);
        return next;
      },
      { replace: true },
    );

  const clearSearch = () => {
    pushed.current = '';
    setText('');
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('q');
        return next;
      },
      { replace: true },
    );
  };

  const castings = useCastings({ q: q || undefined, status: status === 'all' ? undefined : status });
  // An empty Open tab: are there any castings at all? Only then does its empty state say "Add the first one".
  const emptyTab = castings.isSuccess && !castings.isPlaceholderData && !castings.data.items.length && !q;
  const everything = useCastings({}, emptyTab && status !== 'all');
  const noCastingsAtAll = emptyTab && (status === 'all' || wholeListEmpty(everything.data && [everything.data.items.length]));
  const items = castings.data?.items ?? [];
  const canWrite = can('castings.write');


  const emptyTitle = {
    open: t('list.emptyOpenTitle'),
    closed: t('list.emptyClosedTitle'),
    cancelled: t('list.emptyCancelledTitle'),
    all: t('list.emptyAllTitle'),
  }[status];

  let body;
  if (castings.isPending) body = <PageLoader />;
  else if (castings.isError) body = <ErrorState error={castings.error} onRetry={() => void castings.refetch()} />;
  else if (!items.length && q)
    body = (
      <EmptyState
        icon={SearchX}
        title={t('common:states.noResults')}
        description={t('common:states.noResultsHint')}
        action={<Button onClick={clearSearch}>{t('list.clearSearch')}</Button>}
      />
    );
  else if (!items.length)
    body = (
      <EmptyState
        icon={Clapperboard}
        title={emptyTitle}
        description={status === 'open' || status === 'all' ? (canWrite ? t('list.emptyOpenHint') : t('list.emptyHintReadOnly')) : undefined}
        action={noCastingsAtAll ? <ScreenEmptyAdd screen="castings" /> : undefined}
        className="rounded-2xl border border-dashed border-line-strong"
      />
    );
  else
    body = (
      <>
        <p className="mb-2 px-1 text-sm text-muted" aria-live="polite">
          {t('list.count', { count: items.length })}
        </p>
        <List className={clsx('transition-opacity', castings.isPlaceholderData && 'opacity-60')}>
          {items.map((c) => (
            <CastingRow key={c.id} casting={c} />
          ))}
        </List>
      </>
    );

  return (
    <div>
      <PageHeader title={t('title')} actions={<ScreenAddAction screen="castings" />} />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SearchInput value={text} onChange={setText} placeholder={t('list.searchPlaceholder')} className="w-full md:max-w-sm" />
        <Segmented<StatusFilter>
          label={t('list.statusFilter')}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: t('list.open') },
            { value: 'closed', label: t('list.closed') },
            { value: 'cancelled', label: t('list.cancelled') },
            { value: 'all', label: t('list.all') },
          ]}
          className="self-start"
        />
      </div>
      {body}
    </div>
  );
}

function CastingRow({ casting: c }: { casting: CastingListItem }) {
  const { t } = useTranslation(['castings', 'common']);
  const f = useFormat();
  const enumLabel = useEnumLabel();
  const meta = [c.production, enumLabel('castingType', c.type)].filter(Boolean);

  return (
    <li>
      <Link to={`/castings/${c.id}`} className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 sm:px-5">
        <CastingTypeIcon type={c.type} status={c.status} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p dir="auto" className="truncate text-start font-medium text-ink">
                {c.title}
              </p>
              {meta.length > 0 && (
                <p className="mt-0.5 truncate text-sm text-muted">
                  {meta.map((m, i) => (
                    <span key={i}>
                      {i > 0 && <span aria-hidden> · </span>}
                      <bdi>{m}</bdi>
                    </span>
                  ))}
                </p>
              )}
            </div>
            <StatusBadge group="castingStatus" value={c.status} className="mt-0.5" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" aria-hidden />
              {c.submissionDeadline ? t('list.deadline', { date: f.date(c.submissionDeadline) }) : t('list.noDeadline')}
            </span>
            <DeadlineBadge casting={c} />
            <span className="inline-flex items-center gap-x-3 tabular-nums">
              <span>{t('counts.roles', { count: c.rolesCount })}</span>
              <span>{t('counts.submissions', { count: c.submissionsCount })}</span>
              {c.bookedCount > 0 && <span className="font-medium text-success">{t('counts.booked', { count: c.bookedCount })}</span>}
            </span>
          </div>
        </div>
        <ChevronRight className="mt-3 size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
      </Link>
    </li>
  );
}
