import clsx from 'clsx';
import { ChevronRight, CircleCheck, CircleSlash, Clock, Contact, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import type { StaffMember } from '@shared/schemas/staff';
import type { SummonsView } from '@shared/schemas/summons';
import type { TeamMember } from '@shared/schemas/team';
import { Avatar, Badge, ButtonLink, EmptyState, ErrorState, PageHeader, PageLoader, SearchInput, Tabs } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { useStaffList } from '../staff/api';
import { PositionChips, PositionsGuideLink } from '../staff/components/bits';
import { useSummonsById, useTeam } from './api';
import { PersonActions } from './components/PersonActions';
import { accountLink, clockOf, filterTeam, inactiveAccounts, isolate, summonsFromId, summonsIdFrom, teamFilter, type TeamFilter } from './utils';

/**
 * /team — the one Team page, for every signed-in person: the active team with
 * photo, name and positions (owners appear to non-owners as name and photo
 * only), each with "Message" and, for people who may, "Call to the office".
 *
 * With staff.manage the same page carries the management controls: "Add team
 * member" (→ /staff/new), a link on each row to that member's page
 * (/staff/:id) and the Active / Inactive filter (inactive accounts come from
 * GET /api/staff; the Team list only has active people).
 *
 * A notification link "/team?summons=12" highlights the person that call went
 * to (the caller's answer notification); the person called's link
 * "/team?summons=12&from=3" shows what became of the call and points at the
 * caller's row.
 */
export default function TeamPage() {
  const { t } = useTranslation(['team', 'staff', 'common']);
  const { can, user } = useAuth();
  const manage = can('staff.manage');
  const team = useTeam();
  // staff.manage: the accounts behind the rows (which can be opened, and the inactive ones).
  const staff = useStaffList(manage);
  const { search } = useLocation();
  const [q, setQ] = useState('');
  const [wanted, setWanted] = useState<TeamFilter>('active');
  const filter = teamFilter(wanted, manage);
  const items = useMemo(() => team.data?.items ?? [], [team.data]);
  const accounts = useMemo(() => new Map((manage ? (staff.data?.items ?? []) : []).map((s) => [s.id, s])), [manage, staff.data]);
  const inactive = useMemo(() => inactiveAccounts(manage ? (staff.data?.items ?? []) : []), [manage, staff.data]);
  const shown = useMemo(() => filterTeam(items, q), [items, q]);
  const shownInactive = useMemo(() => filterTeam(inactive, q), [inactive, q]);
  const summonsId = summonsIdFrom(search);
  const fromId = summonsFromId(search);
  // The caller's own last call shows on that person's row; any other call (the person called
  // opening their notification, or an older one) gets a card above the list saying what became of it.
  const rowWithCall = summonsId ? items.find((m) => m.lastSummons?.id === summonsId) : undefined;
  const call = useSummonsById(summonsId, team.isSuccess && !rowWithCall);
  const highlighted = rowWithCall?.id ?? fromId ?? (call.data ? (call.data.from.id === user?.id ? call.data.to.id : call.data.from.id) : undefined);

  const listClass = 'divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface';
  const noResults = <EmptyState title={t('noResults')} className="rounded-2xl border border-dashed border-line-strong" />;

  let body;
  if (filter === 'inactive') {
    if (staff.isPending) body = <PageLoader />;
    else if (staff.isError) body = <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />;
    else if (!inactive.length)
      body = <EmptyState icon={Contact} title={t('staff:inactiveEmpty')} description={t('staff:inactiveEmptyHint')} className="rounded-2xl border border-dashed border-line-strong" />;
    else
      body = (
        <>
          <p className="mb-3 px-1 text-sm text-muted">{t('staff:inactiveHint')}</p>
          {inactive.length > 6 && <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="mb-4" />}
          {shownInactive.length ? (
            <ul className={listClass}>
              {shownInactive.map((s) => (
                <InactiveRow key={s.id} account={s} />
              ))}
            </ul>
          ) : (
            noResults
          )}
        </>
      );
  } else if (team.isPending) body = <PageLoader />;
  else if (team.isError) body = <ErrorState error={team.error} onRetry={() => void team.refetch()} />;
  else if (!items.length) body = <EmptyState icon={Contact} title={t('empty')} />;
  else
    body = (
      <>
        {items.length > 6 && <SearchInput value={q} onChange={setQ} placeholder={t('search')} className="mb-4" />}
        {shown.length ? (
          <ul className={listClass}>
            {shown.map((m) => (
              <TeamRow key={m.id} member={m} account={accounts.get(m.id)} canManage={manage} highlighted={m.id === highlighted} scrollTo={m.id === rowWithCall?.id} />
            ))}
          </ul>
        ) : (
          noResults
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
        actions={
          manage ? (
            <ButtonLink to="/staff/new" variant="primary" size="lg" icon={UserPlus}>
              {t('staff:addStaff')}
            </ButtonLink>
          ) : undefined
        }
      />
      {!rowWithCall && call.data && <SummonsOutcome summons={call.data} me={user?.id ?? null} />}
      {manage && (
        <Tabs<TeamFilter>
          className="mb-4"
          value={filter}
          onChange={(next) => {
            setWanted(next);
            setQ('');
          }}
          tabs={[
            { id: 'active', label: t('staff:filter.active'), count: team.isSuccess ? items.length : undefined },
            { id: 'inactive', label: t('staff:filter.inactive'), count: staff.isSuccess ? inactive.length : undefined },
          ]}
        />
      )}
      {body}
      {manage && can('positions.manage') && <PositionsGuideLink className="mt-5" />}
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

/**
 * The top of a row: photo, name, a line under it, positions. With staff.manage
 * (and an account the caller may see) the whole block is the link to that
 * member's page, ending in a visible word — "Edit" or "View" — and an arrow.
 */
function RowHead({
  name,
  photoFileId,
  badge,
  email,
  positions,
  link,
  dimmed = false,
}: {
  name: string;
  photoFileId: string | null;
  badge?: ReactNode;
  email?: string;
  positions: TeamMember['positions'] | null;
  link: ReturnType<typeof accountLink>;
  dimmed?: boolean;
}) {
  const { t } = useTranslation(['staff', 'common']);
  const inner = (
    <>
      <Avatar name={name} fileId={photoFileId} size="lg" className={clsx(dimmed && 'opacity-50 grayscale')} />
      <span className="block min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <bdi className={clsx('truncate text-[17px] font-semibold', dimmed ? 'text-muted' : 'text-ink')}>{name}</bdi>
          {badge}
        </span>
        {email && (
          // LTR so a long address keeps its start visible; still aligned to the row's start in Arabic.
          <span dir="ltr" className="mt-0.5 block truncate text-sm text-muted rtl:text-end">
            {email}
          </span>
        )}
        {positions && positions.length > 0 && <PositionChips positions={positions} className="mt-1.5" />}
      </span>
    </>
  );
  if (!link) return <div className="flex items-start gap-3.5">{inner}</div>;
  return (
    <Link
      to={link.to}
      aria-label={t(link.mode === 'edit' ? 'manage.editOf' : 'manage.viewOf', { name: isolate(name) })}
      className="-m-2 flex min-h-14 items-start gap-3.5 rounded-xl p-2 transition-colors hover:bg-surface-2"
    >
      {inner}
      <span className="flex min-h-12 shrink-0 items-center gap-1 self-center text-sm font-semibold text-accent">
        {t(link.mode === 'edit' ? 'manage.edit' : 'manage.view')}
        <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
      </span>
    </Link>
  );
}

/**
 * A team member's row: "Message" and (with staff.summon) "Call to the office"
 * under their name; with staff.manage the name block opens their page.
 * `scrollTo`: brought into view (the caller's call, whose answer shows on the
 * row); otherwise the card above the list is what to read first.
 */
function TeamRow({
  member: m,
  account,
  canManage,
  highlighted,
  scrollTo,
}: {
  member: TeamMember;
  account: StaffMember | undefined;
  canManage: boolean;
  highlighted: boolean;
  scrollTo: boolean;
}) {
  const { t } = useTranslation(['team', 'common']);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (scrollTo) ref.current?.scrollIntoView({ block: 'center' });
  }, [scrollTo]);
  return (
    <li ref={ref} className={clsx('px-4 py-4 sm:px-5', highlighted && 'bg-accent-soft/60')} data-testid={`team-row-${m.id}`}>
      <RowHead
        name={m.name}
        photoFileId={m.photoFileId}
        badge={m.isMe ? <Badge tone="neutral">{t('you')}</Badge> : undefined}
        email={account?.email}
        positions={m.positions}
        link={accountLink(canManage, account)}
      />
      {/* Lined up under the name (photo 3.5rem + gap). Nothing for yourself. */}
      <PersonActions member={m} className="mt-3 ps-[4.375rem]" />
    </li>
  );
}

/** An inactive account (staff.manage only): it can't be messaged or called, only opened — to reactivate it, say. */
function InactiveRow({ account: a }: { account: StaffMember }) {
  const { t } = useTranslation(['staff', 'common']);
  return (
    <li className="px-4 py-4 sm:px-5" data-testid={`team-inactive-${a.id}`}>
      <RowHead
        name={a.name}
        photoFileId={a.photoFileId}
        badge={<Badge tone="danger">{t('inactive')}</Badge>}
        email={a.email}
        positions={a.positions}
        link={accountLink(true, a)}
        dimmed
      />
    </li>
  );
}
