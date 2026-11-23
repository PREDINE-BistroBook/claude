import clsx from 'clsx';
import { CalendarCheck, CalendarDays, Inbox, Plus, SearchX, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { todayISO } from '@shared/dates';
import { LEAD_SOURCES } from '@shared/enums';
import type { LeadListItem } from '@shared/schemas/admissions';
import {
  BidiText,
  Button,
  ButtonLink,
  Checkbox,
  EmptyState,
  ErrorState,
  List,
  ListRow,
  PageHeader,
  PageLoader,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
} from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { fullName, useFormat } from '@web/lib/format';
import { useDebounced } from '@web/lib/hooks';
import { useLeadCounts, useLeads } from './api';
import { FollowUpLabel, SourceTile } from './components/bits';
import { LEAD_TABS, TAB_COUNT, parseSource, parseTab, tabFilter, type LeadTab } from './utils';

const EMPTY_ICONS = { follow_up: CalendarCheck, new: Sparkles, interviews: CalendarDays, open: Inbox, closed: Inbox } as const;

export default function LeadsPage() {
  const { t } = useTranslation(['admissions', 'common']);
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const source = parseSource(params.get('source'));
  const mine = params.get('mine') === '1';
  const q = params.get('q') ?? '';

  // The box updates instantly; the URL (and so the query) follows after a pause in typing.
  const [text, setText] = useState(q);
  const debounced = useDebounced(text.trim(), 300);
  const pushed = useRef(q);

  const update = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if (debounced === pushed.current) return;
    pushed.current = debounced;
    update({ q: debounced || null });
    // `update` only wraps setParams, which is stable.
  }, [debounced]);

  // Back/forward (or a link) changed ?q= — reflect it in the box.
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q;
      setText(q);
    }
  }, [q]);

  const clearFilters = () => {
    pushed.current = '';
    setText('');
    update({ q: null, source: null, mine: null });
  };

  const counts = useLeadCounts();
  const leads = useLeads({ q: q || undefined, source, assignedToId: mine && user ? user.id : undefined, ...tabFilter(tab) });
  const items = leads.data?.items ?? [];
  const filtered = !!q || !!source || mine;
  const canWrite = can('admissions.write');

  const newButton = canWrite ? (
    <ButtonLink to="/admissions/new" variant="primary" icon={Plus}>
      {t('newLead')}
    </ButtonLink>
  ) : null;

  let body;
  if (leads.isPending) body = <PageLoader />;
  else if (leads.isError) body = <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />;
  else if (!items.length && !filtered)
    body = (
      <EmptyState
        icon={EMPTY_ICONS[tab]}
        title={t(`list.empty.${tab}.title`)}
        description={t(`list.empty.${tab}.hint`)}
        action={
          tab === 'open' || tab === 'new'
            ? newButton
            : tab !== 'closed' && (
                <ButtonLink to="/admissions?tab=open" replace>
                  {t('list.seeOpen')}
                </ButtonLink>
              )
        }
        className="rounded-2xl border border-dashed border-line-strong"
      />
    );
  else if (!items.length)
    body = (
      <EmptyState
        icon={SearchX}
        title={t('common:states.noResults')}
        description={t('common:states.noResultsHint')}
        action={<Button onClick={clearFilters}>{t('list.clearFilters')}</Button>}
      />
    );
  else
    body = (
      <>
        <p className="mb-2 px-1 text-sm text-muted" aria-live="polite">
          {t('list.count', { count: items.length })}
        </p>
        <List className={clsx('transition-opacity', leads.isPlaceholderData && 'opacity-60')}>
          {items.map((l) => (
            <LeadRow key={l.id} lead={l} tab={tab} />
          ))}
        </List>
      </>
    );

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={newButton} />
      <Tabs<LeadTab>
        tabs={LEAD_TABS.map((id) => ({ id, label: t(`tabs.${id}`), count: counts.data?.[TAB_COUNT[id]] }))}
        value={tab}
        onChange={(id) => update({ tab: id === 'follow_up' ? null : id })}
        className="mb-4"
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={text} onChange={setText} placeholder={t('list.searchPlaceholder')} className="w-full sm:max-w-sm" />
        <div className="flex items-center gap-3">
          <Select
            aria-label={t('list.sourceFilter')}
            value={source ?? ''}
            onChange={(e) => update({ source: e.target.value || null })}
            className="min-w-0 flex-1 sm:w-48 sm:flex-none"
          >
            <option value="">{t('list.allSources')}</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`common:enums.leadSource.${s}`)}
              </option>
            ))}
          </Select>
          <Checkbox label={t('list.mine')} checked={mine} onChange={(e) => update({ mine: e.target.checked ? '1' : null })} className="min-h-10 shrink-0" />
        </div>
      </div>
      {body}
    </div>
  );
}

function LeadRow({ lead: l, tab }: { lead: LeadListItem; tab: LeadTab }) {
  const { t } = useTranslation(['admissions', 'common']);
  const f = useFormat();
  const today = todayISO();
  const name = fullName(l);

  // The second line on the trailing side: what matters next for this lead.
  let next = null;
  if (l.status === 'lost' && l.lostReason) next = <span className="text-xs text-muted">{t(`common:enums.leadLostReason.${l.lostReason}`)}</span>;
  else if (l.nextInterview && (tab === 'interviews' || !l.nextFollowUpOn))
    next = (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-info">
        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{t('list.interviewOn')}</span>
        {f.dateTime(l.nextInterview.scheduledAt, 'short')}
      </span>
    );
  else if (l.nextFollowUpOn) next = <FollowUpLabel date={l.nextFollowUpOn} today={today} />;

  return (
    <ListRow
      to={`/admissions/${l.id}`}
      leading={<SourceTile source={l.source} />}
      title={<BidiText>{name}</BidiText>}
      subtitle={
        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0">{t(`common:enums.leadSource.${l.source}`)}</span>
          {l.assignedToName && (
            <>
              <span aria-hidden className="shrink-0">
                ·
              </span>
              <span className="sr-only">{t('list.assignedTo')}</span>
              <BidiText>{l.assignedToName}</BidiText>
            </>
          )}
        </span>
      }
      trailing={
        <span className="flex max-w-36 flex-col items-end gap-1 sm:max-w-none">
          <StatusBadge group="leadStatus" value={l.status} />
          {next}
        </span>
      }
    />
  );
}
