import clsx from 'clsx';
import { Bell, BellRing, CheckCheck, CircleCheck, Clapperboard, Coffee, MessageCircle, PencilLine, ScanEye, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import type { NotificationItem } from '@shared/schemas/notifications';
import { Button, EmptyState, ErrorState, Modal, Spinner } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { dayKind } from '../../chat/utils';
import { useMarkNotificationsRead, useNotifications, useUnread } from '../api';
import { clockOf, safeAppLink } from '../utils';

type Variant = 'phone' | 'sidebar';

/** A count on an icon: "1" … "99+", hidden at zero. */
function CountBadge({ count, className }: { count: number; className?: string }) {
  const f = useFormat();
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-bold leading-5 text-danger-ink tabular-nums',
        className,
      )}
    >
      {count > 99 ? `${f.number(99)}+` : f.number(count)}
    </span>
  );
}

const phoneCls =
  'relative inline-flex min-h-12 min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 text-[11px] font-medium leading-none text-ink/80 hover:bg-surface-2 hover:text-ink';
const sidebarCls = 'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium transition-colors';

function ButtonBody({ icon: Icon, label, count, variant }: { icon: LucideIcon; label: string; count: number; variant: Variant }) {
  if (variant === 'phone')
    return (
      <>
        <span className="relative">
          <Icon className="size-[22px]" aria-hidden />
          <CountBadge count={count} className="absolute -top-2 -end-3 ring-2 ring-surface" />
        </span>
        <span>{label}</span>
      </>
    );
  return (
    <>
      <Icon className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-start">{label}</span>
      <CountBadge count={count} />
    </>
  );
}

/** The Messages icon with its unread badge (header on phones, sidebar on desktop). */
export function MessagesButton({ variant }: { variant: Variant }) {
  const { t } = useTranslation(['team', 'common']);
  const { pathname } = useLocation();
  const unread = useUnread();
  const count = unread.data?.total ?? 0;
  const active = pathname === '/messages' || pathname.startsWith('/messages/');
  return (
    <Link
      to="/messages"
      aria-label={count ? t('messagesLink.open', { count }) : t('messagesLink.label')}
      aria-current={active ? 'page' : undefined}
      className={
        variant === 'phone'
          ? clsx(phoneCls, active && 'bg-section-soft text-section')
          : clsx(sidebarCls, active ? 'bg-section-soft font-semibold text-section' : 'text-ink/85 hover:bg-surface-2 hover:text-ink')
      }
    >
      <ButtonBody icon={MessageCircle} label={t('messagesLink.label')} count={count} variant={variant} />
    </Link>
  );
}

/** The bell with the unread count; opens the notifications sheet. */
export function NotificationsButton({ variant }: { variant: Variant }) {
  const { t } = useTranslation(['team', 'common']);
  const unread = useUnread();
  const [open, setOpen] = useState(false);
  const count = unread.data?.notifications ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count ? t('bell.open', { count }) : t('bell.openNone')}
        className={variant === 'phone' ? phoneCls : clsx(sidebarCls, 'text-ink/85 hover:bg-surface-2 hover:text-ink')}
      >
        <ButtonBody icon={count ? BellRing : Bell} label={t('bell.label')} count={count} variant={variant} />
      </button>
      <NotificationsSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const KIND_ICON: Record<NotificationItem['kind'], LucideIcon> = {
  message: MessageCircle,
  summon: BellRing,
  summon_answer: CircleCheck,
  cafe_order: Coffee,
  cafe_status: Coffee,
  video_new: Clapperboard,
  video_review: ScanEye,
  video_changes: PencilLine,
  video_approved: CircleCheck,
};
/**
 * The tile behind each kind's icon: calls stand out, answers and cafeteria news are good news, messages plain;
 * videos: work waiting (a new video, an edit to check, changes needed) stands out, an approval is good news.
 */
const KIND_TONE: Record<NotificationItem['kind'], string> = {
  message: 'bg-accent-soft text-accent',
  summon: 'bg-warning-soft text-warning',
  summon_answer: 'bg-success-soft text-success',
  cafe_order: 'bg-warning-soft text-warning',
  cafe_status: 'bg-success-soft text-success',
  video_new: 'bg-accent-soft text-accent',
  video_review: 'bg-warning-soft text-warning',
  video_changes: 'bg-warning-soft text-warning',
  video_approved: 'bg-success-soft text-success',
};

/**
 * An alert's icon and tile. A kind this page doesn't know (an alert written by
 * a newer server while an older page is still open) gets the plain bell —
 * never an undefined component that breaks the sheet.
 */
export function notificationLook(kind: string): { icon: LucideIcon; tone: string } {
  return {
    icon: (KIND_ICON as Partial<Record<string, LucideIcon>>)[kind] ?? Bell,
    tone: (KIND_TONE as Partial<Record<string, string>>)[kind] ?? 'bg-surface-2 text-muted',
  };
}

/** The bell's sheet: newest first; tapping one marks it read and opens its page. */
export function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['team', 'common', 'chat']);
  const f = useFormat();
  const navigate = useNavigate();
  const list = useNotifications(open);
  const markRead = useMarkNotificationsRead();
  const items = list.data?.items ?? [];
  const unread = list.data?.unread ?? 0;

  const openItem = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    onClose();
    navigate(safeAppLink(n.link));
  };
  const when = (ms: number) => {
    const kind = dayKind(ms);
    const time = f.time(clockOf(ms));
    if (kind === 'today') return time;
    if (kind === 'yesterday') return `${t('chat:yesterday')} · ${time}`;
    return `${f.timestamp(ms, 'short')} · ${time}`;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('bell.title')}
      footer={
        unread > 0 ? (
          <Button size="lg" icon={CheckCheck} loading={markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
            {t('bell.markAllRead')}
          </Button>
        ) : undefined
      }
    >
      {list.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title={t('bell.empty')} description={t('bell.emptyHint')} />
      ) : (
        <ul className="-mx-5 -my-4 divide-y divide-line">
          {items.map((n) => {
            const { icon: Icon, tone } = notificationLook(n.kind);
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={clsx('flex min-h-16 w-full items-start gap-3 px-5 py-3 text-start transition-colors hover:bg-surface-2', !n.readAt && 'bg-accent-soft/50')}
                >
                  <span
                    className={clsx('mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full', tone)}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={clsx('block text-[15px] text-ink', !n.readAt ? 'font-semibold' : 'font-medium')}>
                      <bdi dir="auto">{n.title}</bdi>
                    </span>
                    {/* Lined up with the title on the page's start side; the bdi keeps the text's own letter order. */}
                    {n.body && (
                      <span className="mt-0.5 line-clamp-2 block text-start text-sm text-muted">
                        <bdi>{n.body}</bdi>
                      </span>
                    )}
                    <span className="mt-1 block text-xs text-muted">{when(n.createdAt)}</span>
                  </span>
                  {!n.readAt && (
                    <span className="mt-2 size-2.5 shrink-0 rounded-full bg-danger" aria-label={t('bell.unread')} role="img" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
