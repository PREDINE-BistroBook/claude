import clsx from 'clsx';
import { ArrowLeft, CheckCheck, Check, Trash2 } from 'lucide-react';
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { ChatMessage, ConversationDetail } from '@shared/schemas/chat';
import { Avatar, Button, ConfirmDialog, DocumentChip, ErrorState, PageLoader, PhotoViewer, Spinner, useToast, type ViewerPhoto } from '@web/components/ui';
import { ApiError, fileUrl } from '@web/lib/api';
import { usePageTitle } from '@web/lib/hooks';
import { useFormat } from '@web/lib/format';
import { teamErrorKey } from '../team/api';
import { PersonActions } from '../team/components/PersonActions';
import { clockOf, isolate } from '../team/utils';
import { useConversation, useDeleteMessage } from './api';
import { Composer } from './components/Composer';
import { useConversationMessages } from './useConversationMessages';
import { dayKind, groupByDay, receipt } from './utils';

/** /messages/:id — one conversation: bubbles by day, photos and files, "Seen", and the message box. */
export default function ConversationPage() {
  const { t } = useTranslation(['chat', 'common']);
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const conv = useConversation(id, valid);
  if (!valid || conv.isError)
    return (
      <div>
        <BackLink />
        <ErrorState error={valid ? conv.error : new ApiError(404, 'not_found', 'Not found')} onRetry={valid ? () => void conv.refetch() : undefined} />
      </div>
    );
  if (conv.isPending) return <PageLoader label={t('common:states.loading')} />;
  return <ConversationView key={conv.data.id} conv={conv.data} />;
}

function BackLink() {
  const { t } = useTranslation(['chat', 'common']);
  return (
    <Link to="/messages" className="mb-2 inline-flex min-h-12 items-center gap-1.5 text-base text-muted hover:text-ink">
      <ArrowLeft className="size-5 rtl:-scale-x-100" aria-hidden />
      {t('conversation.back')}
    </Link>
  );
}

/** Near the bottom of the page (so a new message should scroll into view). */
const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240;
const toBottom = (smooth = false) => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

function ConversationView({ conv }: { conv: ConversationDetail }) {
  const { t } = useTranslation(['chat', 'team', 'common']);
  const f = useFormat();
  const toast = useToast();
  const other = conv.other;
  usePageTitle(other.name);
  const m = useConversationMessages(conv.id, conv.myLastReadMessageId);
  const del = useDeleteMessage();
  const [selected, setSelected] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<ChatMessage | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);

  // Every photo in the loaded messages, oldest first: the full-screen viewer pages through them.
  const photos = useMemo(() => {
    const list: (ViewerPhoto & { messageId: number })[] = [];
    for (const msg of m.items)
      for (const a of msg.attachments)
        if (a.kind === 'photo')
          list.push({ fileId: a.fileId, messageId: msg.id, meta: `${msg.mine ? t('team:you') : other.name} · ${f.timestampTime(msg.createdAt, 'short')}` });
    return list;
  }, [m.items, other.name, f, t]);

  // Scrolling: the newest message in view on opening; follow new messages when already near the bottom
  // (or when they're mine); keep the place when earlier messages are added above.
  const lastId = m.items.length ? m.items[m.items.length - 1]!.id : null;
  const firstId = m.items.length ? m.items[0]!.id : null;
  const prev = useRef<{ lastId: number | null; firstId: number | null; height: number; wasNearBottom: boolean }>({ lastId: null, firstId: null, height: 0, wasNearBottom: true });
  useLayoutEffect(() => {
    if (!m.loaded) return;
    const p = prev.current;
    const height = document.documentElement.scrollHeight;
    if (p.lastId === null) toBottom();
    else if (firstId !== p.firstId && lastId === p.lastId) window.scrollBy(0, height - p.height);
    else if (lastId !== p.lastId && (p.wasNearBottom || m.items[m.items.length - 1]?.mine)) toBottom(true);
    prev.current = { lastId, firstId, height: document.documentElement.scrollHeight, wasNearBottom: nearBottom() };
  }, [m.loaded, lastId, firstId, m.items]);
  useLayoutEffect(() => {
    const onScroll = () => {
      prev.current.wasNearBottom = nearBottom();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const confirmDelete = () => {
    if (!toDelete) return;
    const msg = toDelete;
    del.mutate(msg.id, {
      onSuccess: () => {
        m.upsert({ ...msg, body: null, attachments: [], deleted: true, canDelete: false });
        setToDelete(null);
        setSelected(null);
        toast.success(t('conversation.deletedToast'));
      },
      onError: (err) => {
        setToDelete(null);
        toast.error(t(teamErrorKey(err)));
      },
    });
  };

  const r = receipt(m.items, m.otherLastReadMessageId);
  const groups = groupByDay(m.items);
  const dayTitle = (ms: number) => {
    const kind = dayKind(ms);
    return kind === 'today' ? t('today') : kind === 'yesterday' ? t('yesterday') : f.timestamp(ms, 'full');
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-12rem)] max-w-3xl flex-col lg:min-h-[calc(100dvh-6rem)]">
      {/* Who this chat is with stays in view: a compact bar that sticks under the app's header (and
          under a call-to-the-office banner, whose height AppShell keeps in --app-top). */}
      <header
        className="sticky z-20 -mx-4 -mt-5 mb-3 border-b border-line bg-canvas/95 px-2 py-1 backdrop-blur sm:-mx-6 sm:-mt-6 sm:px-4 lg:mx-0 lg:-mt-8 lg:px-0"
        style={{ top: 'var(--app-top, 0px)' }}
        data-testid="conversation-bar"
      >
        <div className="flex min-h-14 items-center gap-2">
          <Link
            to="/messages"
            className="inline-flex min-h-12 min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 text-[11px] font-medium leading-none text-ink/80 hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeft className="size-[22px] rtl:-scale-x-100" aria-hidden />
            <span>{t('conversation.backShort')}</span>
          </Link>
          <Avatar name={other.name} fileId={other.photoFileId} size="md" className={clsx('shrink-0', !other.active && 'opacity-60 grayscale')} />
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink sm:text-xl">
            <bdi>{other.name}</bdi>
          </h1>
          {/* "Call to the office" for people who may; "Message" isn't offered here (this is the chat). */}
          <PersonActions userId={other.id} inBar showStatus={false} />
        </div>
      </header>

      <div className="flex-1" aria-live="polite" aria-relevant="additions">
        {m.error ? (
          <ErrorState error={m.error} />
        ) : !m.loaded ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <>
            {m.hasEarlier ? (
              <div className="mb-3 flex justify-center">
                <Button variant="ghost" size="lg" loading={m.loadingEarlier} onClick={() => void m.loadEarlier()}>
                  {t('conversation.loadEarlier')}
                </Button>
              </div>
            ) : (
              <p className="mb-4 rounded-xl bg-surface-2 px-4 py-3 text-center text-sm text-muted">{t('conversation.start', { name: isolate(other.name) })}</p>
            )}
            <ol className="grid grid-cols-1 gap-1.5">
              {groups.map((g) => (
                <Fragment key={g.day}>
                  <li className="my-3 flex justify-center" aria-hidden={false}>
                    <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">{dayTitle(g.items[0]!.createdAt)}</span>
                  </li>
                  {g.items.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      otherName={other.name}
                      selected={selected === msg.id}
                      onSelect={() => setSelected((s) => (s === msg.id ? null : msg.id))}
                      onDelete={() => setToDelete(msg)}
                      onOpenPhoto={(fileId) => setViewer(photos.findIndex((p) => p.messageId === msg.id && p.fileId === fileId))}
                      receipt={r?.messageId === msg.id ? r.status : null}
                    />
                  ))}
                </Fragment>
              ))}
            </ol>
          </>
        )}
      </div>

      {other.active ? (
        <Composer conversationId={conv.id} onSent={(msg) => m.upsert(msg)} />
      ) : (
        <p className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] mt-4 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning lg:bottom-4">
          {t('conversation.inactive', { name: isolate(other.name) })}
        </p>
      )}

      <PhotoViewer photos={photos} index={viewer !== null && viewer >= 0 ? viewer : null} onIndex={setViewer} onClose={() => setViewer(null)} />
      <ConfirmDialog
        open={!!toDelete}
        title={t('conversation.deleteTitle')}
        message={t('conversation.deleteHint')}
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function MessageBubble({
  message: msg,
  otherName,
  selected,
  onSelect,
  onDelete,
  onOpenPhoto,
  receipt: rc,
}: {
  message: ChatMessage;
  otherName: string;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onOpenPhoto: (fileId: string) => void;
  receipt: 'seen' | 'sent' | null;
}) {
  const { t } = useTranslation(['chat', 'common']);
  const f = useFormat();
  const mine = msg.mine;
  const photos = msg.attachments.filter((a) => a.kind === 'photo');
  const docs = msg.attachments.filter((a) => a.kind === 'document');
  const time = f.time(clockOf(msg.createdAt));
  // My own message I may still delete: tapping it shows "Delete message" under it.
  const tappable = mine && msg.canDelete;

  const bubble = (
    <div
      className={clsx(
        'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-start shadow-[0_1px_1px_rgb(0_0_0/0.05)] sm:max-w-[70%]',
        mine ? 'rounded-ee-md bg-accent text-accent-ink' : 'rounded-es-md border border-line bg-surface text-ink',
        msg.deleted && 'opacity-80',
        selected && 'ring-2 ring-accent ring-offset-2 ring-offset-canvas',
      )}
    >
      {msg.deleted ? (
        <p className="text-[15px] italic">{t('deleted')}</p>
      ) : (
        <div className="grid gap-2">
          {photos.length > 0 && (
            <div className={clsx('grid gap-1.5', photos.length > 1 && 'grid-cols-2')}>
              {photos.map((p) => (
                <button
                  key={p.fileId}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPhoto(p.fileId);
                  }}
                  aria-label={t('conversation.openPhoto')}
                  className="block overflow-hidden rounded-xl bg-black/10"
                >
                  <img
                    src={fileUrl(p.fileId)}
                    alt={mine ? '' : t('conversation.photoAlt', { name: isolate(otherName) })}
                    loading="lazy"
                    // A fixed shape: the space is kept before the photo loads, so opening the chat lands on the newest message.
                    // One photo is shown whole (a portrait keeps its head); several fill square tiles.
                    className={clsx('w-full', photos.length > 1 ? 'aspect-square object-cover' : 'aspect-[4/3] object-contain')}
                  />
                </button>
              ))}
            </div>
          )}
          {docs.map((d) => (
            <DocumentChip key={d.fileId} fileId={d.fileId} name={d.name} mime={d.mime} size={d.size} tone={mine ? 'accent' : 'surface'} />
          ))}
          {msg.body && (
            <p dir="auto" className="text-start text-[16px] leading-relaxed whitespace-pre-wrap break-words">
              {msg.body}
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <li className={clsx('flex flex-col', mine ? 'items-end' : 'items-start')}>
      {tappable ? (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={selected}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect();
            }
          }}
          className="flex w-full cursor-pointer justify-end"
        >
          {bubble}
        </div>
      ) : (
        bubble
      )}
      <span className="mt-0.5 flex items-center gap-1.5 px-1 text-xs text-muted">
        <span className="tabular-nums">{time}</span>
        {rc && (
          <span className={clsx('inline-flex items-center gap-0.5 font-medium', rc === 'seen' && 'text-accent')}>
            {rc === 'seen' ? <CheckCheck className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
            {t(rc === 'seen' ? 'conversation.seen' : 'conversation.sent')}
          </span>
        )}
      </span>
      {selected && tappable && (
        <div className="mt-1 flex flex-col items-end gap-1">
          <Button variant="danger-ghost" size="lg" icon={Trash2} onClick={onDelete}>
            {t('conversation.deleteMessage')}
          </Button>
          <span className="px-1 text-xs text-muted">{t('conversation.canDeleteHint')}</span>
        </div>
      )}
    </li>
  );
}
