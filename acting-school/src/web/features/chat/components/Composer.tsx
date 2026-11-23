import clsx from 'clsx';
import { Camera, FileText, LoaderCircle, Paperclip, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_MESSAGE_ATTACHMENTS, MAX_MESSAGE_LENGTH, type ChatMessage } from '@shared/schemas/chat';
import { useToast } from '@web/components/ui';
import { useMediaQuery } from '@web/lib/hooks';
import { discardUpload, DOCUMENT_ACCEPT, PHOTO_ACCEPT, uploadAny, type Uploaded } from '@web/lib/files';
import { teamErrorKey } from '../../team/api';
import { isolate } from '../../team/utils';
import { useSendMessage } from '../api';

interface Pending {
  key: number;
  name: string;
  /** A local preview of a picked photo (revoked when removed or sent). */
  preview: string | null;
  uploaded: Uploaded | null;
}

/**
 * The message box at the bottom of a conversation: camera/gallery and file
 * buttons, the text, and Send. Picked files upload at once (photos are made
 * smaller on the phone first); Send waits for them. Enter sends on a computer;
 * on a phone Enter is a new line and the Send button sends.
 */
export function Composer({ conversationId, onSent }: { conversationId: number; onSent: (m: ChatMessage) => void }) {
  const { t } = useTranslation(['chat', 'team', 'common']);
  const toast = useToast();
  const send = useSendMessage(conversationId);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const nextKey = useRef(1);
  const finePointer = useMediaQuery('(pointer: fine)');

  // Leaving the conversation: free the local previews, and take back uploads that were never
  // sent (unless a send is on its way, which attaches them).
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const sending = useRef(false);
  useEffect(
    () => () =>
      pendingRef.current.forEach((p) => {
        if (p.preview) URL.revokeObjectURL(p.preview);
        if (!sending.current) discardUpload(p.uploaded?.id);
      }),
    [],
  );

  // Grow with the text, up to about five lines.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const uploading = pending.some((p) => !p.uploaded);
  const canSend = !send.isPending && !uploading && (text.trim().length > 0 || pending.length > 0);

  const pick = async (list: FileList | null, input: HTMLInputElement | null) => {
    const files = list ? Array.from(list) : [];
    if (input) input.value = '';
    if (!files.length) return;
    const room = MAX_MESSAGE_ATTACHMENTS - pending.length;
    if (files.length > room) toast.error(t('conversation.tooManyAttachments', { count: MAX_MESSAGE_ATTACHMENTS }));
    const chosen = files.slice(0, Math.max(0, room));
    const added = chosen.map((file) => ({
      key: nextKey.current++,
      name: file.name,
      preview: file.type.startsWith('image/') && file.type !== 'image/heic' && file.type !== 'image/heif' ? URL.createObjectURL(file) : null,
      uploaded: null,
      file,
    }));
    setPending((ps) => [...ps, ...added.map(({ file: _f, ...p }) => p)]);
    for (const a of added) {
      try {
        const uploaded = await uploadAny(a.file);
        // Removed while it was uploading: take it back.
        if (!pendingRef.current.some((p) => p.key === a.key)) {
          discardUpload(uploaded.id);
          continue;
        }
        setPending((ps) => ps.map((p) => (p.key === a.key ? { ...p, uploaded } : p)));
      } catch (err) {
        toast.error(`${t('team:files.uploadFailed', { name: isolate(a.name) })} ${t(teamErrorKey(err))}`);
        if (a.preview) URL.revokeObjectURL(a.preview);
        setPending((ps) => ps.filter((p) => p.key !== a.key));
      }
    }
  };

  const remove = (key: number) => {
    const p = pending.find((x) => x.key === key);
    if (p?.preview) URL.revokeObjectURL(p.preview);
    // A picked file that won't be sent is deleted from the server too (the wrong document, say).
    discardUpload(p?.uploaded?.id);
    setPending((ps) => ps.filter((x) => x.key !== key));
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    const body = text.trim() || null;
    const fileIds = pending.map((p) => p.uploaded!.id);
    sending.current = true;
    send.mutate(
      { body, fileIds: fileIds.length ? fileIds : undefined },
      {
        onSettled: () => {
          sending.current = false;
        },
        onSuccess: (msg) => {
          pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
          setPending([]);
          setText('');
          onSent(msg);
          textRef.current?.focus();
        },
        onError: (err) => toast.error(t(teamErrorKey(err))),
      },
    );
  };

  const toolBtn =
    'inline-flex min-h-12 min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium leading-none text-ink/80 hover:bg-surface-2 hover:text-ink disabled:opacity-40';

  return (
    <form
      onSubmit={submit}
      className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-4 border-t max-lg:-mb-6 border-line bg-surface/95 px-2 pb-2 pt-2 backdrop-blur sm:-mx-6 sm:px-4 lg:bottom-0 lg:mx-0 lg:rounded-2xl lg:border lg:shadow-sm"
    >
      {pending.length > 0 && (
        <ul className="mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
          {pending.map((p) => (
            <li key={p.key} className={clsx('flex shrink-0 flex-col', p.preview ? 'w-24' : 'w-36')}>
              <div className="relative">
                {p.preview ? (
                  <img src={p.preview} alt="" className="h-16 w-full rounded-xl object-cover" />
                ) : (
                  <span className="flex h-16 w-full items-center gap-2 rounded-xl border border-line bg-surface-2 px-2 text-xs">
                    <FileText className="size-5 shrink-0 text-accent" aria-hidden />
                    <bdi dir="auto" className="line-clamp-2 break-all">
                      {p.name}
                    </bdi>
                  </span>
                )}
                {!p.uploaded && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40" role="status">
                    <LoaderCircle className="size-6 animate-spin text-white" aria-hidden />
                    <span className="sr-only">{t('conversation.uploading')}</span>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(p.key)}
                aria-label={t('conversation.removeAttachment', { name: isolate(p.name) })}
                className="inline-flex min-h-12 items-center justify-center gap-1 rounded-xl px-1 text-sm font-medium text-danger hover:bg-danger-soft"
              >
                <X className="size-4 shrink-0" aria-hidden />
                {t('conversation.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1">
        <input ref={photoInput} type="file" accept={PHOTO_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files, photoInput.current)} />
        <input ref={fileInput} type="file" accept={DOCUMENT_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files, fileInput.current)} />
        <button
          type="button"
          className={toolBtn}
          onClick={() => photoInput.current?.click()}
          disabled={pending.length >= MAX_MESSAGE_ATTACHMENTS}
          aria-label={t('conversation.addPhotoLabel')}
          data-testid="chat-add-photo"
        >
          <Camera className="size-[22px]" aria-hidden />
          {t('conversation.addPhoto')}
        </button>
        <button
          type="button"
          className={toolBtn}
          onClick={() => fileInput.current?.click()}
          disabled={pending.length >= MAX_MESSAGE_ATTACHMENTS}
          aria-label={t('conversation.addFileLabel')}
        >
          <Paperclip className="size-[22px]" aria-hidden />
          {t('conversation.addFile')}
        </button>
        <label htmlFor="chat-text" className="sr-only">
          {t('conversation.placeholder')}
        </label>
        <textarea
          id="chat-text"
          ref={textRef}
          rows={1}
          dir="auto"
          value={text}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={t('conversation.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && finePointer && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="min-h-12 min-w-0 flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <button
          type="submit"
          disabled={!canSend}
          className={clsx(
            'inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-2xl px-3.5 text-base font-semibold transition-colors',
            'bg-accent text-accent-ink hover:bg-accent-hover disabled:opacity-40',
          )}
        >
          {send.isPending ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <SendHorizontal className="size-5 rtl:-scale-x-100" aria-hidden />}
          {t('conversation.send')}
        </button>
      </div>
    </form>
  );
}
