import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CircleCheck, CircleX, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SummonsViewStatus } from '@shared/enums';
import type { ListResponse } from '@shared/schemas/common';
import type { NotificationsResponse } from '@shared/schemas/notifications';
import type { SummonsView } from '@shared/schemas/summons';
import { Avatar } from '@web/components/ui';
import { api } from '@web/lib/api';
import { useFormat } from '@web/lib/format';
import { teamKeys, useMarkNotificationsRead, useUnread } from '../api';
import { clockOf, isolate, newlyAnswered, vibrateIfAllowed } from '../utils';

/** Answers shown at once (newest first); older ones wait their turn. */
const MAX_SHOWN = 3;

/**
 * For people who can call others to the office: when someone answers, a calm
 * banner under the header ("Layla Haddad answered: On my way · 10:42") that
 * stays until it's closed — an older director looking away from the screen
 * still sees it — plus a short buzz where the browser allows. The answer adds
 * a notification for the caller, so whenever the poll's notification count
 * goes up this re-reads GET /api/summons/sent and shows the calls that went
 * from waiting to answered; the person's row updates too. Closing it marks
 * that answer's notification read.
 */
export function SummonsAnswerWatcher() {
  const { t } = useTranslation(['team', 'common']);
  const f = useFormat();
  const qc = useQueryClient();
  const unread = useUnread();
  const markRead = useMarkNotificationsRead();
  const known = useRef<Map<number, SummonsViewStatus> | null>(null);
  const since = useRef(Date.now());
  const lastCount = useRef<number | null>(null);
  const [answers, setAnswers] = useState<SummonsView[]>([]);

  const check = useCallback(
    async (announce: boolean) => {
      const res = await qc.fetchQuery({
        queryKey: teamKeys.summonsSent,
        queryFn: () => api.get<ListResponse<SummonsView>>('/summons/sent'),
        staleTime: 0,
      });
      const answered = known.current && announce ? newlyAnswered(known.current, res.items, since.current) : [];
      known.current = new Map(res.items.map((s) => [s.id, s.status]));
      if (answered.length) {
        setAnswers((shown) => [...answered, ...shown.filter((s) => !answered.some((a) => a.id === s.id))]);
        vibrateIfAllowed(200);
        await qc.invalidateQueries({ queryKey: teamKeys.team });
      }
    },
    [qc],
  );

  // What I've sent so far: the starting point, so older answers don't show.
  useEffect(() => {
    void check(false).catch(() => undefined);
  }, [check]);

  const count = unread.data?.notifications;
  useEffect(() => {
    if (count === undefined) return;
    const prev = lastCount.current;
    lastCount.current = count;
    if (prev !== null && count > prev) void check(true).catch(() => undefined);
  }, [count, check]);

  /** Close one answer: gone from the banner, and its notification in the bell is read. */
  const dismiss = async (s: SummonsView) => {
    setAnswers((shown) => shown.filter((x) => x.id !== s.id));
    try {
      const list = await qc.fetchQuery({ queryKey: teamKeys.notifications, queryFn: () => api.get<NotificationsResponse>('/notifications'), staleTime: 0 });
      const ids = list.items.filter((n) => n.kind === 'summon_answer' && n.link === `/team?summons=${s.id}` && !n.readAt).map((n) => n.id);
      if (ids.length) markRead.mutate({ ids });
    } catch {
      // The bell still lists it; nothing else to do.
    }
  };

  if (!answers.length) return null;
  const shown = answers.slice(0, MAX_SHOWN);
  return (
    <section role="status" aria-label={t('answerBanner.label')} className="border-b border-line bg-success-soft text-ink shadow-sm">
      <ul className="mx-auto grid max-w-6xl gap-1 px-2 py-1.5 sm:px-4 lg:px-6">
        {shown.map((s) => {
          const Icon = s.status === 'on_my_way' ? CircleCheck : CircleX;
          const answer = t(`common:enums.summonsStatus.${s.status}`);
          return (
            <li key={s.id} className="flex min-h-14 items-center gap-2">
              <Link
                to={`/team?summons=${s.id}`}
                onClick={() => void dismiss(s)}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-success/10"
              >
                <Avatar name={s.to.name} fileId={s.to.photoFileId} size="md" />
                <span className="min-w-0 flex-1 text-base font-semibold leading-snug">
                  <Icon className={clsx('me-1.5 inline size-5 align-[-4px]', s.status === 'on_my_way' ? 'text-success' : 'text-danger')} aria-hidden />
                  {t('answerBanner.answered', { name: isolate(s.to.name), answer, time: f.time(clockOf(s.answeredAt ?? s.createdAt)) })}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void dismiss(s)}
                aria-label={t('answerBanner.close', { name: isolate(s.to.name) })}
                className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-success/10 hover:text-ink"
              >
                <X className="size-6" aria-hidden />
              </button>
            </li>
          );
        })}
        {answers.length > MAX_SHOWN && <li className="px-2 pb-1 text-sm text-muted">{t('answerBanner.more', { count: answers.length - MAX_SHOWN })}</li>}
      </ul>
    </section>
  );
}
