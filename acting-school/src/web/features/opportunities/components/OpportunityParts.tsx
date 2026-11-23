import clsx from 'clsx';
import {
  Baby,
  Ban,
  Binoculars,
  CalendarClock,
  Clapperboard,
  ExternalLink,
  Film,
  Globe,
  HandCoins,
  Megaphone,
  Music,
  Send,
  Star,
  Tv,
  Drama,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { OpportunityProjectType, OpportunityStatus } from '@shared/enums';
import { OPPORTUNITY_ERROR_CODES, type Opportunity } from '@shared/schemas/opportunities';
import { Button, ButtonLink, ConfirmDialog, buttonClasses, useToast } from '@web/components/ui';
import { ApiError, fileUrl } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { errorMessageKey } from '@web/lib/forms';
import { useFormat } from '@web/lib/format';
import { useMoveOpportunity, useTurnIntoCasting } from '../api';
import { deadlineLook, linkHost, statusMoves } from '../utils';

/** A button whose words wrap onto a second line rather than run out of a 375 px card (Arabic is longer). */
const WRAP = 'h-auto min-h-12 w-full whitespace-normal py-2 text-center leading-tight';

const TYPE_ICONS: Record<OpportunityProjectType, LucideIcon> = {
  film: Film,
  series: Tv,
  ad: Megaphone,
  theatre: Drama,
  music_video: Music,
  online: Globe,
  other: Clapperboard,
};

export const STATUS_ICONS: Record<OpportunityStatus, LucideIcon> = {
  new: Binoculars,
  interested: Star,
  applied: Send,
  dismissed: Ban,
};

/** The project type's icon on a tinted square (no screenshot to show). */
export function ProjectTypeTile({ type, className }: { type: OpportunityProjectType | null; className?: string }) {
  const Icon = type ? TYPE_ICONS[type] : Binoculars;
  return (
    <span aria-hidden className={clsx('flex shrink-0 items-center justify-center rounded-xl bg-section-soft text-section', className)}>
      <Icon className="size-7" />
    </span>
  );
}

/** The red warning: the post asks the actors for money. */
export function MoneyFlag({ withHint = false, className }: { withHint?: boolean; className?: string }) {
  const { t } = useTranslation('opportunities');
  return (
    <div role="note" className={clsx('flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-danger', className)}>
      <HandCoins className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">{t('card.asksForMoney')}</p>
        {withHint && <p className="mt-0.5 text-sm">{t('card.asksForMoneyHint')}</p>}
      </div>
    </div>
  );
}

/** "Deadline Thu 26 Nov · Closes in 2 days" — red within three days, "Closed" once passed. */
export function DeadlineLine({ deadline, today, className }: { deadline: string | null; today: string; className?: string }) {
  const { t } = useTranslation('opportunities');
  const f = useFormat();
  const look = deadlineLook(deadline, today);
  if (look.kind === 'none')
    return (
      <span className={clsx('inline-flex items-center gap-1.5 text-sm text-muted', className)}>
        <CalendarClock className="size-4 shrink-0" aria-hidden />
        {t('card.noDeadline')}
      </span>
    );
  const when = look.kind === 'closed' ? t('card.closed') : look.days === 0 ? t('card.today') : look.days === 1 ? t('card.tomorrow') : t('card.inDays', { count: look.days });
  return (
    <span
      className={clsx(
        'inline-flex flex-wrap items-center gap-x-1.5 text-sm',
        look.kind === 'soon' ? 'font-semibold text-danger' : look.kind === 'closed' ? 'text-muted' : 'text-ink',
        className,
      )}
    >
      <CalendarClock className="size-4 shrink-0" aria-hidden />
      <span className={clsx(look.kind === 'closed' && 'line-through')}>{t('card.deadline', { date: f.date(deadline!, 'weekday') })}</span>
      <span aria-hidden>·</span>
      <span className={clsx(look.kind === 'closed' && 'rounded-full bg-surface-2 px-2 font-semibold text-ink')}>{when}</span>
    </span>
  );
}

/** "Children or teenagers" chip. */
export function MinorsChip() {
  const { t } = useTranslation('opportunities');
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
      <Baby className="size-3.5" aria-hidden />
      {t('card.minors')}
    </span>
  );
}

/**
 * The buttons under an opportunity: Open the post (everyone who sees it), and
 * with castings.write the status moves (Interested / Applied / Not for us —
 * all but the current one), then "Turn into a casting" — or "Open the
 * casting" once it has one.
 */
export function OpportunityActions({ opportunity: o, onMoved }: { opportunity: Opportunity; onMoved?: (status: OpportunityStatus) => void }) {
  const { t } = useTranslation(['opportunities', 'common']);
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const move = useMoveOpportunity();
  const turn = useTurnIntoCasting();
  const [confirm, setConfirm] = useState(false);
  const canWrite = can('castings.write');
  const host = linkHost(o.link);
  const moves = canWrite ? statusMoves(o.status) : [];
  const fail = (err: unknown) =>
    toast.error(t(err instanceof ApiError && err.code === OPPORTUNITY_ERROR_CODES.alreadyCasting ? 'opportunities:errors.alreadyCasting' : errorMessageKey(err)));

  const doMove = (status: OpportunityStatus) =>
    move.mutate(
      { id: o.id, status },
      {
        onSuccess: () => {
          toast.success(t('toast.moved', { status: t(`common:enums.opportunityStatus.${status}`) }));
          onMoved?.(status);
        },
        onError: fail,
      },
    );

  const doTurn = () =>
    turn.mutate(o.id, {
      onSuccess: ({ castingId }) => {
        toast.success(t('toast.turned'));
        navigate(`/castings/${castingId}`);
      },
      onError: (err) => {
        setConfirm(false);
        fail(err);
      },
    });

  const castingButton =
    o.castingId !== null && can('castings.read') ? (
      <ButtonLink key="casting" to={`/castings/${o.castingId}`} size="lg" icon={Clapperboard} className={WRAP}>
        {t('actions.openCasting')}
      </ButtonLink>
    ) : canWrite ? (
      <Button key="casting" size="lg" icon={Clapperboard} onClick={() => setConfirm(true)} className={WRAP}>
        {t('actions.toCasting')}
      </Button>
    ) : null;
  const statusButtons = moves.map((s) => {
      const Icon = STATUS_ICONS[s];
      return (
        <Button
          key={s}
          size="lg"
          variant={s === 'dismissed' ? 'ghost' : 'secondary'}
          icon={Icon}
          loading={move.isPending && move.variables?.status === s && move.variables.id === o.id}
          disabled={move.isPending}
          onClick={() => doMove(s)}
          className={WRAP}
        >
          {t(`actions.${s}`)}
        </Button>
      );
  });

  return (
    <div className="grid gap-2">
      {host && (
        <a href={o.link!} target="_blank" rel="noopener noreferrer" className={buttonClasses('primary', 'lg', WRAP)}>
          <ExternalLink className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
          <span className="flex min-w-0 flex-wrap items-baseline justify-center gap-x-2">
            <span>{t('actions.openPost')}</span>
            <bdi dir="ltr" className="text-sm font-normal opacity-80">
              {host}
            </bdi>
          </span>
          <span className="sr-only"> {t('actions.opensNewTab')}</span>
        </a>
      )}
      {/* Two by two; an odd last one takes the whole row. "Turn into a casting" has a row of its own. */}
      {statusButtons.length > 0 && (
        <div className={clsx('grid grid-cols-2 gap-2', statusButtons.length % 2 === 1 && '[&>*:last-child]:col-span-2')}>{statusButtons}</div>
      )}
      {castingButton}
      <ConfirmDialog
        open={confirm}
        tone="primary"
        title={t('confirmCasting.title')}
        message={t('confirmCasting.message')}
        confirmLabel={t('confirmCasting.yes')}
        loading={turn.isPending}
        onConfirm={doTurn}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

/** One opportunity in the list: the first screenshot, the title, type and source, the warnings, the deadline and roles, then its buttons. */
export function OpportunityCard({ opportunity: o, today }: { opportunity: Opportunity; today: string }) {
  const { t } = useTranslation(['opportunities', 'common']);
  const shot = o.files[0];
  const to = `/casting/opportunities/${o.id}`;
  const meta = [o.projectType ? t(`common:enums.opportunityProjectType.${o.projectType}`) : null, o.source ? t('card.seenOn', { source: o.source }) : null].filter(Boolean);
  return (
    <article className={clsx('rounded-2xl border bg-surface p-4', o.asksForPayment ? 'border-danger/50' : 'border-line')} data-testid="opportunity-card">
      <Link to={to} className="-m-1 flex items-start gap-3 rounded-xl p-1 hover:bg-surface-2">
        {shot ? (
          <img src={fileUrl(shot.fileId)} alt={t('card.screenshot')} loading="lazy" className="size-16 shrink-0 rounded-xl border border-line bg-surface-2 object-cover" />
        ) : (
          <ProjectTypeTile type={o.projectType} className="size-16" />
        )}
        <div className="min-w-0 flex-1">
          <h2 dir="auto" className="text-start text-lg font-semibold leading-snug text-ink break-words">
            {o.title}
          </h2>
          {meta.length > 0 && (
            <p className="mt-0.5 text-sm text-muted">
              {meta.map((m, i) => (
                <span key={i}>
                  {i > 0 && <span aria-hidden> · </span>}
                  <bdi>{m}</bdi>
                </span>
              ))}
            </p>
          )}
        </div>
      </Link>
      {o.asksForPayment && <MoneyFlag className="mt-3" />}
      <div className="mt-3 grid gap-1.5">
        <DeadlineLine deadline={o.deadline} today={today} />
        {o.roles && (
          <p className="text-sm text-ink">
            <span className="font-medium text-muted">{t('card.roles')}: </span>
            <bdi className="break-words">{o.roles}</bdi>
          </p>
        )}
        {o.involvesMinors && (
          <span>
            <MinorsChip />
          </span>
        )}
      </div>
      <div className="mt-4">
        <OpportunityActions opportunity={o} />
      </div>
    </article>
  );
}
