import clsx from 'clsx';
import { BellRing, Clock, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { MAX_SUMMONS_NOTE } from '@shared/schemas/summons';
import type { TeamMember } from '@shared/schemas/team';
import { Button, Modal, TextAreaField, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { teamErrorKey, useOpenConversation, useSummon, useTeam } from '../api';
import { hasPersonActions, isolate, personActionButtons } from '../utils';
import { SummonsStatusLine } from './SummonsStatusLine';

/**
 * "Message" and "Call to the office" beside a colleague — the same component on
 * the Team page, a team member's page (/staff/:id), a workshop's coach and an
 * enquiry's assignee. Pass `member` from GET /api/team, or just `userId` and
 * the person is looked up there (someone not in it — deactivated, unknown —
 * gets no buttons). "Call to the office" needs staff.summon; nobody gets
 * buttons for themselves. With staff.summon, the last call's answer shows under
 * the buttons ("On my way ✓ 10:42").
 */
export function PersonActions({
  userId,
  member: given,
  compact: _compact = false,
  showStatus = true,
  onlySummon = false,
  inBar = false,
  className,
}: {
  userId?: number | null;
  member?: TeamMember;
  /** In a list row. The buttons stay 48 px tall everywhere (big targets for older hands). */
  compact?: boolean;
  showStatus?: boolean;
  /** Only "Call to the office" (inside the chat with this person). */
  onlySummon?: boolean;
  /** In the conversation's top bar: just "Call to the office", as an icon over a short label. */
  inBar?: boolean;
  className?: string;
}) {
  const { t } = useTranslation(['team', 'common']);
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const team = useTeam(!given && userId !== null && userId !== undefined);
  const member = given ?? (userId === null || userId === undefined ? undefined : team.data?.items.find((m) => m.id === userId));
  const allowed = personActionButtons(user, member);
  const buttons = onlySummon || inBar ? { message: false, summon: allowed.summon } : allowed;
  const open = useOpenConversation();
  const [summoning, setSummoning] = useState(false);

  if (!member || !hasPersonActions(buttons)) return null;

  // Already called and still waiting for the answer: nothing to press until then (the status line says so, with "Cancel").
  const waiting = summonsWaiting(member.lastSummons, Date.now());
  const modal = buttons.summon && <SummonModal member={member} open={summoning} onClose={() => setSummoning(false)} />;

  if (inBar)
    return (
      <>
        <button
          type="button"
          onClick={() => setSummoning(true)}
          disabled={waiting}
          className={clsx(
            'inline-flex min-h-12 min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 text-[11px] font-medium leading-none text-ink/80 hover:bg-surface-2 hover:text-ink disabled:opacity-60',
            className,
          )}
        >
          {waiting ? <Clock className="size-[22px]" aria-hidden /> : <BellRing className="size-[22px]" aria-hidden />}
          <span>{waiting ? t('actions.summonWaitingShort') : t('actions.summonShort')}</span>
        </button>
        {modal}
      </>
    );

  // Big targets for older hands: 48 px everywhere.
  const size = 'lg';
  // Phones: one under the other, full width (plain, easy to hit); wider screens: side by side.
  const extra = 'w-full sm:w-auto';
  const message = () =>
    open.mutate(member.id, {
      onSuccess: (conv) => navigate(`/messages/${conv.id}`),
      onError: (err) => toast.error(t(teamErrorKey(err))),
    });

  return (
    <div className={clsx('grid min-w-0 gap-1.5', className)}>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {buttons.message && (
          <Button icon={MessageCircle} size={size} className={extra} loading={open.isPending} onClick={message} aria-label={t('actions.messageTo', { name: isolate(member.name) })}>
            {t('actions.message')}
          </Button>
        )}
        {buttons.summon &&
          (waiting ? (
            <Button icon={Clock} size={size} className={extra} disabled>
              {t('actions.summonWaiting')}
            </Button>
          ) : (
            <Button icon={BellRing} size={size} className={extra} onClick={() => setSummoning(true)} aria-label={t('actions.summonTo', { name: isolate(member.name) })}>
              {t('actions.summon')}
            </Button>
          ))}
      </div>
      {showStatus && buttons.summon && member.lastSummons && <SummonsStatusLine summons={member.lastSummons} />}
      {modal}
    </div>
  );
}

/** My last call to this person is still waiting for an answer (and hasn't passed its two hours). */
function summonsWaiting(s: TeamMember['lastSummons'], now: number): boolean {
  return !!s && s.status === 'pending' && s.expiresAt > now;
}

/** "Call <name> to the office?" with an optional short note. */
function SummonModal({ member, open, onClose }: { member: TeamMember; open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['team', 'common']);
  const toast = useToast();
  const summon = useSummon();
  const [note, setNote] = useState('');
  const close = () => {
    setNote('');
    summon.reset();
    onClose();
  };
  const send = () =>
    summon.mutate(
      { userId: member.id, note: note.trim() || null },
      {
        onSuccess: () => {
          toast.success(t('summon.sent', { name: isolate(member.name) }));
          close();
        },
        onError: (err) => {
          toast.error(t(teamErrorKey(err), { name: isolate(member.name) }));
          // Already called / too many: nothing to change in the form, so close it.
          if (err instanceof ApiError && (err.status === 409 || err.status === 429 || err.status === 404)) close();
        },
      },
    );
  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={t('summon.title', { name: isolate(member.name) })}
      footer={
        <>
          <Button size="lg" onClick={close} disabled={summon.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button size="lg" variant="primary" icon={BellRing} loading={summon.isPending} onClick={send}>
            {t('summon.send')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-base text-ink">{t('summon.description', { name: isolate(member.name) })}</p>
        <TextAreaField
          label={t('summon.note')}
          optional
          rows={2}
          maxLength={MAX_SUMMONS_NOTE}
          dir="auto"
          placeholder={t('summon.notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
