import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { FileText, Image, MessageCirclePlus, MessagesSquare } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { ConversationSummary } from '@shared/schemas/chat';
import { Avatar, Button, ButtonLink, EmptyState, ErrorState, Modal, PageHeader, PageLoader, SearchInput, Spinner, useToast } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { teamErrorKey, useOpenConversation, useTeam, useUnread } from '../team/api';
import { clockOf, filterTeam } from '../team/utils';
import { chatKeys, useConversations } from './api';
import { dayKind, previewParts } from './utils';

/** /messages — my conversations, newest first, with unread counts; "New message" to start one. */
export default function MessagesPage() {
  const { t } = useTranslation(['chat', 'common']);
  const qc = useQueryClient();
  const list = useConversations();
  const unread = useUnread();
  const [picking, setPicking] = useState(false);

  // The 20-second unread poll notices new messages: refresh the list when its total changes.
  const total = unread.data?.total;
  useEffect(() => {
    if (total !== undefined) void qc.invalidateQueries({ queryKey: chatKeys.conversations });
  }, [total, qc]);

  const items = list.data?.items ?? [];
  const newButton = (
    <Button variant="primary" size="lg" icon={MessageCirclePlus} onClick={() => setPicking(true)}>
      {t('newMessage')}
    </Button>
  );

  let body;
  if (list.isPending) body = <PageLoader />;
  else if (list.isError) body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  else if (!items.length)
    body = (
      <EmptyState
        icon={MessagesSquare}
        title={t('empty')}
        description={t('emptyHint')}
        className="rounded-2xl border border-dashed border-line-strong"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {newButton}
            <ButtonLink to="/team" size="lg">
              {t('openTeam')}
            </ButtonLink>
          </div>
        }
      />
    );
  else
    body = (
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {items.map((c) => (
          <ConversationRow key={c.id} conversation={c} />
        ))}
      </ul>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={items.length > 0 ? newButton : undefined} />
      {body}
      <PersonPicker open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}

function ConversationRow({ conversation: c }: { conversation: ConversationSummary }) {
  const { t } = useTranslation(['chat', 'common']);
  const f = useFormat();
  const p = previewParts(c.lastMessage);
  const unread = c.unread > 0;
  let preview: ReactNode = null;
  if (p.kind === 'deleted') preview = <span className="italic">{t('deleted')}</span>;
  // The text is cut on its own side (its own direction), so an Arabic message in the English app
  // (or the other way round) shows its beginning, not its end.
  else if (p.kind === 'text')
    preview = (
      <bdi dir="auto" className="block min-w-0 truncate">
        {p.text}
      </bdi>
    );
  else if (p.kind === 'photos')
    preview = (
      <span className="inline-flex items-center gap-1">
        <Image className="size-4 shrink-0" aria-hidden />
        {p.count > 1 ? t('photos', { count: p.count }) : t('photo')}
      </span>
    );
  else if (p.kind === 'files')
    preview = (
      <span className="inline-flex items-center gap-1">
        <FileText className="size-4 shrink-0" aria-hidden />
        {p.count > 1 ? t('files', { count: p.count }) : t('file')}
      </span>
    );
  const mine = c.lastMessage?.mine && p.kind !== 'none';
  const at = c.lastMessageAt ?? c.lastMessage?.createdAt ?? null;
  const when = at === null ? '' : dayKind(at) === 'today' ? f.time(clockOf(at)) : dayKind(at) === 'yesterday' ? t('yesterday') : f.timestamp(at, 'short');

  return (
    <li>
      <Link to={`/messages/${c.id}`} className="flex min-h-[4.5rem] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5">
        <Avatar name={c.other.name} fileId={c.other.photoFileId} size="lg" className={clsx(!c.other.active && 'opacity-60 grayscale')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={clsx('min-w-0 truncate text-[17px] text-ink', unread ? 'font-bold' : 'font-semibold')}>
              <bdi>{c.other.name}</bdi>
            </span>
            <span className={clsx('shrink-0 text-xs', unread ? 'font-semibold text-accent' : 'text-muted')}>{when}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className={clsx('flex min-w-0 items-baseline text-[15px]', unread ? 'font-medium text-ink' : 'text-muted')}>
              {mine && <span className="shrink-0 whitespace-pre">{t('you', { text: '' })}</span>}
              {p.kind === 'text' ? preview : <span className="min-w-0 truncate">{preview}</span>}
            </span>
            {unread && (
              <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full bg-accent px-2 text-xs font-bold leading-6 text-accent-ink tabular-nums">
                <span className="sr-only">{t('unread', { count: c.unread })}</span>
                <span aria-hidden>{f.number(c.unread)}</span>
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

/** "New message": pick a colleague (the Team directory), then the conversation opens. */
function PersonPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['chat', 'team', 'common']);
  const toast = useToast();
  const navigate = useNavigate();
  const team = useTeam(open);
  const openConv = useOpenConversation();
  const [q, setQ] = useState('');
  const people = useMemo(() => filterTeam((team.data?.items ?? []).filter((m) => !m.isMe), q), [team.data, q]);

  const pick = (userId: number) =>
    openConv.mutate(userId, {
      onSuccess: (conv) => {
        onClose();
        navigate(`/messages/${conv.id}`);
      },
      onError: (err) => toast.error(t(teamErrorKey(err))),
    });

  return (
    <Modal open={open} onClose={onClose} title={t('pickPerson')}>
      <SearchInput value={q} onChange={setQ} placeholder={t('team:search')} className="mb-3" />
      {team.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : team.isError ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      ) : people.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t('team:noResults')}</p>
      ) : (
        <ul className="-mx-5 divide-y divide-line">
          {people.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                disabled={openConv.isPending}
                onClick={() => pick(m.id)}
                className="flex min-h-16 w-full items-center gap-3 px-5 py-2.5 text-start transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                <Avatar name={m.name} fileId={m.photoFileId} size="md" />
                {/* The flex box follows the page's direction (the name sits next to its photo); the bdi only keeps the name's own letter order. */}
                <span className="min-w-0 flex-1 truncate text-base font-medium text-ink">
                  <bdi>{m.name}</bdi>
                </span>
                {openConv.isPending && openConv.variables === m.id && <Spinner />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
