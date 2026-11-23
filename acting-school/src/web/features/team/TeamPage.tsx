import clsx from 'clsx';
import { CircleCheck, CircleSlash, Clock, Contact, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import type { SummonsView } from '@shared/schemas/summons';
import type { TeamMember } from '@shared/schemas/team';
import { Avatar, Badge, EmptyState, ErrorState, PageHeader, PageLoader, SearchInput } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { PositionChips } from '../staff/components/bits';
import { useSummonsById, useTeam } from './api';
import { PersonActions } from './components/PersonActions';
import { clockOf, filterTeam, isolate, summonsFromId, summonsIdFrom } from './utils';

/**
 * /team — the Team directory, for every signed-in worker: active staff with
 * photo, name and positions (owners appear to non-owners as name and photo
 * only), each with "Message" and, for people who may, "Call to the office".
 * A notification link "/team?summons=12" highlights the person that call went
 * to (the caller's answer notification); the person called's link
 * "/team?summons=12&from=3" shows what became of the call and points at the
 * caller's row.
 */
export default function TeamPage() {
  const { t } = useTranslation(['team', 'common']);
  const { can, user } = useAuth();
  const team = useTeam();
  const { search } = useLocation();
  const [q, setQ] = useState('');
  const items = useMemo(() => team.data?.items ?? [], [team.data]);
  const shown = useMemo(() => filterTeam(items, q), [items, q]);
  const summonsId = summonsIdFrom(search);
  const fromId = summonsFromId(search);
  // The caller's own last call shows on that person's row; any other call (the person called
  // opening their notification, or an older one) gets a card above the list saying what became of it.
  const rowWithCall = summonsId ? items.find((m) => m.lastSummons?.id === summonsId) : undefined;
  const call = useSummonsById(summonsId, team.isSuccess && !rowWithCall);
  const highlighted = rowWithCall?.id ?? fromId ?? (call.data ? (call.data.from.id === user?.id ? call.data.to.id : call.data.from.id) : undefined);

  let body;
  if (team.isPending) body = <PageLoader />;
  else if (team.isError) body = <ErrorState error={team.error} onRetry={() => void team.refetch()} />;
  else if (!items.length) body = <EmptyState icon={Contact} title={t('empty')} />;
  else
    body = (
      <>
        {items.length > 6 && <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="mb-4" />}
        {shown.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {shown.map((m) => (
              <TeamRow key={m.id} member={m} highlighted={m.id === highlighted} scrollTo={m.id === rowWithCall?.id} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t('noResults')} className="rounded-2xl border border-dashed border-line-strong" />
        )}
      </>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('title')}
        subtitle={
          <>
            {can('staff.summon') ? t('subtitleSummon') : t('subtitle')}
            {team.isSuccess && items.length > 0 && <span className="block">{t('count', { count: items.length })}</span>}
          </>
        }
      />
      {!rowWithCall && call.data && <SummonsOutcome summons={call.data} me={user?.id ?? null} />}
      {body}
    </div>
  );
}

/**
 * What became of one call to the office, for the person called (opening the
 * notification after answering, or after it ended) or for the caller looking
 * at an older call: who, when, the note, and the outcome in plain words.
 */
function SummonsOutcome({ summons: s, me }: { summons: SummonsView; me: number | null }) {
  const { t } = useTranslation(['team', 'common']);
  const f = useFormat();
  const toMe = s.to.id === me;
  const other = toMe ? s.from : s.to;
  const at = (ms: number) => f.time(clockOf(ms));
  const answer = s.status === 'on_my_way' || s.status === 'cant_now' ? t(`common:enums.summonsStatus.${s.status}`) : '';
  let outcome: string;
  if (s.status === 'pending') outcome = toMe ? t('outcome.waitingForYou') : t('summon.status.pending', { time: at(s.createdAt) });
  else if (s.status === 'cancelled') outcome = t('outcome.cancelled');
  else if (s.status === 'expired') outcome = t('outcome.expired');
  else outcome = toMe ? t('outcome.youAnswered', { answer, time: at(s.answeredAt ?? s.createdAt) }) : t(`summon.status.${s.status}`, { time: at(s.answeredAt ?? s.createdAt) });
  const Icon = s.status === 'on_my_way' ? CircleCheck : s.status === 'pending' ? Clock : s.status === 'cant_now' ? X : CircleSlash;
  return (
    <section aria-label={t('outcome.label')} className="mb-5 rounded-2xl border border-line bg-surface p-4 sm:p-5" data-testid="summons-outcome">
      <div className="flex items-start gap-3.5">
        <Avatar name={other.name} fileId={other.photoFileId} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold leading-snug text-ink">
            {toMe ? t('outcome.calledYou', { name: isolate(other.name) }) : t('outcome.youCalled', { name: isolate(other.name) })}
          </p>
          <p className="mt-0.5 text-sm text-muted">{t('outcome.calledAt', { time: at(s.createdAt), date: f.date(isoDay(s.createdAt)) })}</p>
          {s.note && (
            <p className="mt-1.5 text-base text-ink">
              <span className="font-semibold">{t('banner.noteLabel')}: </span>
              <bdi>{s.note}</bdi>
            </p>
          )}
          <p className={clsx('mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-base font-medium', OUTCOME_TONE[s.status])} role="status">
            <Icon className="size-5 shrink-0" aria-hidden />
            {outcome}
          </p>
          {toMe && <PersonActions userId={other.id} showStatus={false} className="mt-3" />}
        </div>
      </div>
    </section>
  );
}

const OUTCOME_TONE = {
  pending: 'bg-warning-soft text-warning',
  on_my_way: 'bg-success-soft text-success',
  cant_now: 'bg-danger-soft text-danger',
  cancelled: 'bg-surface-2 text-muted',
  expired: 'bg-surface-2 text-muted',
} as const;

/** "YYYY-MM-DD" of an epoch on this device's calendar (for useFormat().date). */
const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A colleague's row. `scrollTo`: brought into view (the caller's call, whose answer shows on the row); otherwise the card above the list is what to read first. */
function TeamRow({ member: m, highlighted, scrollTo }: { member: TeamMember; highlighted: boolean; scrollTo: boolean }) {
  const { t } = useTranslation(['team', 'common']);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (scrollTo) ref.current?.scrollIntoView({ block: 'center' });
  }, [scrollTo]);
  return (
    <li ref={ref} className={clsx('px-4 py-4 sm:px-5', highlighted && 'bg-accent-soft/60')} data-testid={`team-row-${m.id}`}>
      <div className="flex items-start gap-3.5">
        <Avatar name={m.name} fileId={m.photoFileId} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <bdi className="truncate text-[17px] font-semibold text-ink">{m.name}</bdi>
            {m.isMe && <Badge tone="neutral">{t('you')}</Badge>}
          </div>
          {m.positions.length > 0 && <PositionChips positions={m.positions} className="mt-1.5" />}
          <PersonActions member={m} className="mt-3" />
        </div>
      </div>
    </li>
  );
}
