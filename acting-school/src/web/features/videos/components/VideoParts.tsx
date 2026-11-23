import clsx from 'clsx';
import { CalendarClock, CircleCheck, ExternalLink, Hammer, MessageSquareWarning, PencilLine, Play, RotateCcw, Send, Users, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { VIDEO_NOTE_MAX, videoActions, videoLinkHost, videoNoteInput, videoSubmitInput, type Video, type VideoDetail } from '@shared/schemas/videos';
import { Badge, Button, buttonClasses, Modal, StatusBadge, TextAreaField, TextField, useToast } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { fullName, useFormat } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { movedVideo, useVideoActions, videoErrorKey } from '../api';
import { dueWords, tidyLink, videoPagePath } from '../utils';

/** Long links, titles and names wrap instead of widening the phone's screen. */
export const WRAP = '[overflow-wrap:anywhere]';

/** The signed-in person as the video rules read them. */
export function useViewer() {
  const { user } = useAuth();
  return { id: user?.id ?? 0, isOwner: !!user?.isOwner, permissions: user?.permissions ?? [] };
}

/** What the viewer may do with this video now (the rule the API enforces). */
export function useVideoActionsFor(video: Video) {
  return videoActions(video, useViewer());
}

/**
 * A big button that opens one of the video's links in a new tab — "Open raw
 * footage" / "Watch the edit" — with the link's host under the words, so
 * people see where it goes (drive.google.com, youtu.be…).
 */
export function VideoLinkButton({ href, kind, primary, className }: { href: string; kind: 'raw' | 'edit'; primary?: boolean; className?: string }) {
  const { t } = useTranslation('videos');
  const host = videoLinkHost(href);
  const Icon = kind === 'edit' ? Play : ExternalLink;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(buttonClasses(primary ? 'primary' : 'secondary', 'lg'), 'h-auto min-h-12 w-full flex-col gap-0 py-1.5 whitespace-normal sm:w-auto', className)}
    >
      <span className="inline-flex items-center gap-2">
        <Icon className="size-5 shrink-0" aria-hidden />
        {t(kind === 'edit' ? 'links.edit' : 'links.raw')}
        <span className="sr-only">({t('links.opensNewTab')})</span>
      </span>
      {host && (
        <span dir="ltr" className={clsx('text-xs font-normal opacity-80', WRAP)}>
          {host}
        </span>
      )}
    </a>
  );
}

/** "Due today" / "Due tomorrow" / "Due Tue 25 Nov" / "2 days late" (red). */
export function DueLabel({ video, today, className }: { video: Pick<Video, 'dueOn' | 'status'>; today: string; className?: string }) {
  const { t } = useTranslation('videos');
  const f = useFormat();
  const words = dueWords(video.dueOn, today, video.status);
  const text = words.late ? t('due.late', { count: words.days }) : words.key === 'on' ? t('due.on', { date: f.date(video.dueOn, 'weekday') }) : t(`due.${words.key}`);
  return (
    <span className={clsx('inline-flex items-center gap-1 text-sm font-medium', words.late ? 'text-danger' : 'text-muted', className)}>
      <CalendarClock className="size-4 shrink-0" aria-hidden />
      {text}
    </span>
  );
}

/** The workshop and session a video comes from: "Screen Acting I · Tue 24 Nov". */
export function VideoSource({ video }: { video: Pick<Video, 'courseName' | 'sessionDate'> }) {
  const { t } = useTranslation('videos');
  const f = useFormat();
  return (
    <span className={WRAP}>
      <bdi>{video.courseName}</bdi> · {video.sessionDate ? f.date(video.sessionDate, 'weekday') : t('card.noSession')}
    </span>
  );
}

/** "Maya Collins, Chloe Bennett" — or "3 students" when the names are hidden from the viewer. */
export function StudentsLine({ video }: { video: Pick<Video, 'students' | 'studentsHidden'> }) {
  const { t, i18n } = useTranslation('videos');
  const total = video.students.length + video.studentsHidden;
  if (!total) return null;
  const sep = i18n.language === 'ar' ? '، ' : ', ';
  return (
    <p className={clsx('flex items-start gap-1.5 text-sm text-muted', WRAP)}>
      <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {video.students.length ? (
          <>
            {video.students.map((s, i) => (
              <span key={s.id}>
                {i > 0 && sep}
                <bdi>{fullName(s)}</bdi>
              </span>
            ))}
            {video.studentsHidden > 0 && ` (+${video.studentsHidden})`}
          </>
        ) : (
          t('card.students', { count: total })
        )}
      </span>
    </p>
  );
}

/** A note in a soft box with its label: the reviewer's changes (warning), the editor's notes, the coach's notes. */
export function NoteBox({ label, children, tone = 'plain', icon: Icon }: { label: ReactNode; children: ReactNode; tone?: 'plain' | 'warning'; icon?: LucideIcon }) {
  return (
    <div className={clsx('rounded-xl border px-3 py-2 text-sm', tone === 'warning' ? 'border-warning/40 bg-warning-soft text-ink' : 'border-line bg-surface-2/50 text-ink', WRAP)}>
      <p className={clsx('flex items-center gap-1.5 font-semibold', tone === 'warning' && 'text-warning')}>
        {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
        {label}
      </p>
      <p dir="auto" className="mt-0.5 text-start whitespace-pre-line">
        {children}
      </p>
    </div>
  );
}

/** The status in words, as a badge. */
export function VideoStatusBadge({ video }: { video: Pick<Video, 'status'> }) {
  return <StatusBadge group="videoStatus" value={video.status} />;
}

// ── The next-step buttons ───────────────────────────────────────────────────

/**
 * The buttons for what the viewer does next with this video — and only those
 * (videoActions): "Start editing" / "Start fixing" (the editor), "Done — send
 * the edit" (the editor editing it), "Approved ✓" and "Needs changes" (the
 * reviewer), "Reopen" (the reviewer, approved). Big, labelled, two colours.
 */
export function NextStepButtons({ video, onMoved, compact }: { video: Video; onMoved?: (v: VideoDetail) => void; compact?: boolean }) {
  const { t } = useTranslation('videos');
  const toast = useToast();
  const can = useVideoActionsFor(video);
  const actions = useVideoActions();
  const [dialog, setDialog] = useState<'submit' | 'changes' | 'reopen' | null>(null);
  const failed = (err: unknown) => {
    const now = movedVideo(err);
    if (now) onMoved?.(now);
    toast.error(t(videoErrorKey(err)));
  };
  const done = (key: string) => (v: VideoDetail) => {
    toast.success(t(key));
    onMoved?.(v);
  };

  const take = () => void actions.take.mutateAsync(video.id).then(done('toasts.taken'), failed);
  const approve = () => void actions.approve.mutateAsync(video.id).then(done('toasts.approved'), failed);
  const takeLabel = video.status === 'changes_requested' ? t('actions.fix') : video.status === 'editing' ? t('actions.takeOver') : t('actions.take');
  const big = clsx('h-auto min-h-12 w-full whitespace-normal py-2', !compact && 'sm:w-auto');

  const buttons: ReactNode[] = [];
  if (can.take)
    buttons.push(
      <Button key="take" variant="primary" size="lg" icon={video.status === 'changes_requested' ? PencilLine : Hammer} loading={actions.take.isPending} onClick={take} className={big}>
        {takeLabel}
      </Button>,
    );
  if (can.submit)
    buttons.push(
      <Button key="submit" variant="success" size="lg" icon={Send} onClick={() => setDialog('submit')} className={big}>
        {t('actions.submit')}
      </Button>,
    );
  if (can.approve)
    buttons.push(
      <Button key="approve" variant="success" size="lg" icon={CircleCheck} loading={actions.approve.isPending} onClick={approve} className={big}>
        {t('actions.approve')}
      </Button>,
    );
  if (can.requestChanges)
    buttons.push(
      <Button key="changes" variant="danger" size="lg" icon={MessageSquareWarning} onClick={() => setDialog('changes')} className={big}>
        {t('actions.requestChanges')}
      </Button>,
    );
  if (can.reopen)
    buttons.push(
      <Button key="reopen" size="lg" icon={RotateCcw} onClick={() => setDialog('reopen')} className={big}>
        {t('actions.reopen')}
      </Button>,
    );
  if (!buttons.length) return null;

  return (
    <>
      <div className={clsx('grid gap-2', buttons.length > 1 && 'grid-cols-2', !compact && 'sm:flex sm:flex-wrap')}>{buttons}</div>
      <SubmitModal open={dialog === 'submit'} video={video} onClose={() => setDialog(null)} onDone={done('toasts.submitted')} onFailed={failed} />
      <NoteModal
        open={dialog === 'changes' || dialog === 'reopen'}
        mode={dialog === 'reopen' ? 'reopen' : 'changes'}
        video={video}
        onClose={() => setDialog(null)}
        onDone={done(dialog === 'reopen' ? 'toasts.reopened' : 'toasts.changes')}
        onFailed={failed}
      />
    </>
  );
}

/** "Done": the edited link (required) and notes for the reviewer. */
function SubmitModal({ open, video, onClose, onDone, onFailed }: { open: boolean; video: Video; onClose: () => void; onDone: (v: VideoDetail) => void; onFailed: (err: unknown) => void }) {
  const { t } = useTranslation(['videos', 'common']);
  const actions = useVideoActions();
  const form = useForm({ editedLink: video.editedLink ?? '', notes: video.editorNotes ?? '' });
  const send = () => {
    const data = form.validate(videoSubmitInput, { editedLink: tidyLink(form.values.editedLink), notes: form.values.notes });
    if (!data) return;
    actions.submit.mutate(
      { id: video.id, editedLink: data.editedLink, notes: data.notes ?? null },
      {
        onSuccess: (v) => {
          onClose();
          onDone(v);
        },
        onError: (err) => {
          form.setServerError(err);
          if (movedVideo(err)) {
            onClose();
            onFailed(err);
          }
        },
      },
    );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('submit.title')}
      description={t('submit.intro')}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button size="lg" variant="success" icon={Send} loading={actions.submit.isPending} onClick={send}>
            {t('submit.send')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextField
          label={t('submit.link')}
          {...form.bind('editedLink')}
          onBlur={() => form.set('editedLink', tidyLink(form.values.editedLink))}
          error={form.error('editedLink')}
          type="url"
          inputMode="url"
          dir="ltr"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://"
          required
        />
        <TextAreaField label={t('submit.notes')} {...form.bind('notes')} error={form.error('notes')} placeholder={t('submit.notesPlaceholder')} maxLength={VIDEO_NOTE_MAX} rows={3} optional />
        {form.formError && <p className="text-sm text-danger">{t(form.formError)}</p>}
      </div>
    </Modal>
  );
}

/** "Needs changes" / "Reopen": a note for the editor (required). */
function NoteModal({
  open,
  mode,
  video,
  onClose,
  onDone,
  onFailed,
}: {
  open: boolean;
  mode: 'changes' | 'reopen';
  video: Video;
  onClose: () => void;
  onDone: (v: VideoDetail) => void;
  onFailed: (err: unknown) => void;
}) {
  const { t } = useTranslation(['videos', 'common']);
  const actions = useVideoActions();
  const mutation = mode === 'reopen' ? actions.reopen : actions.requestChanges;
  const form = useForm({ note: '' });
  const send = () => {
    const data = form.validate(videoNoteInput);
    if (!data) return;
    mutation.mutate(
      { id: video.id, note: data.note },
      {
        onSuccess: (v) => {
          form.setValues({ note: '' });
          onClose();
          onDone(v);
        },
        onError: (err) => {
          form.setServerError(err);
          if (movedVideo(err)) {
            onClose();
            onFailed(err);
          }
        },
      },
    );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(mode === 'reopen' ? 'note.reopenTitle' : 'note.changesTitle')}
      description={t(mode === 'reopen' ? 'note.reopenIntro' : 'note.changesIntro')}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button size="lg" variant="danger" icon={MessageSquareWarning} loading={mutation.isPending} onClick={send}>
            {t('note.send')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <TextAreaField label={t('note.label')} {...form.bind('note')} error={form.error('note')} placeholder={t('note.placeholder')} maxLength={VIDEO_NOTE_MAX} rows={4} autoFocus />
        {form.formError && <p className="text-sm text-danger">{t(form.formError)}</p>}
      </div>
    </Modal>
  );
}

// ── Cards and rows ──────────────────────────────────────────────────────────

/**
 * One video in the queue, as big as the cafeteria board's cards: its status in
 * words (a strip), the title, where it is from, who is in it, the due date —
 * and what the viewer does next. Editors see the reviewer's note on a video
 * sent back, and "Open raw footage"; reviewers see "Watch the edit", the
 * editor's notes and the two big buttons.
 */
export function VideoCard({ video, today }: { video: Video; today: string }) {
  const { t } = useTranslation('videos');
  const can = useVideoActionsFor(video);
  const editorSide = can.take || can.submit;
  const reviewerSide = can.approve || can.requestChanges;
  return (
    <li className={clsx('overflow-hidden rounded-2xl border bg-surface shadow-sm', video.status === 'changes_requested' ? 'border-danger/40' : 'border-line', WRAP)} data-status={video.status}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <VideoStatusBadge video={video} />
        <DueLabel video={video} today={today} />
      </div>
      <div className="grid gap-3 p-4">
        <div>
          <Link to={videoPagePath(video.id)} className="-my-1.5 flex min-h-12 items-center text-lg font-bold leading-snug text-ink hover:underline">
            <bdi>{video.title}</bdi>
          </Link>
          <p className="mt-0.5 text-sm text-muted">
            <VideoSource video={video} /> · {t(`common:enums.videoKind.${video.kind}`)}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {video.status === 'new' || !video.editor ? t('card.from', { name: video.addedBy?.name ?? '—' }) : t('card.editedBy', { name: video.editor.name })}
            {video.status === 'approved' && video.reviewer && <> · {t('card.checkedBy', { name: video.reviewer.name })}</>}
          </p>
        </div>
        <StudentsLine video={video} />
        {video.changesNote && (video.status === 'changes_requested' || video.status === 'editing') && (
          <NoteBox tone="warning" icon={MessageSquareWarning} label={video.reviewer ? t('card.changesBy', { name: video.reviewer.name }) : t('card.changes')}>
            {video.changesNote}
          </NoteBox>
        )}
        {/* Back for a second check: what the reviewer asked for last time, to see it was done. */}
        {reviewerSide && video.changesNote && <NoteBox label={t('card.changes')}>{video.changesNote}</NoteBox>}
        {editorSide && video.notesForEditor && <NoteBox label={t('card.notesForEditor')}>{video.notesForEditor}</NoteBox>}
        {reviewerSide && video.editorNotes && <NoteBox label={t('card.editorNotes')}>{video.editorNotes}</NoteBox>}
        {reviewerSide && video.editedLink && <VideoLinkButton href={video.editedLink} kind="edit" primary className="sm:w-full" />}
        {editorSide && <VideoLinkButton href={video.rawLink} kind="raw" className="sm:w-full" />}
        <NextStepButtons video={video} compact />
        {!editorSide && !reviewerSide && (
          <Link to={videoPagePath(video.id)} className={clsx(buttonClasses('secondary', 'lg'), 'w-full')}>
            {t('card.open')}
          </Link>
        )}
      </div>
    </li>
  );
}

/** One video in a session's or workshop's "Videos" block: title, status in words, who is in it. */
export function VideoRow({ video, today }: { video: Video; today: string }) {
  const { t } = useTranslation('videos');
  const f = useFormat();
  return (
    <li>
      <Link to={videoPagePath(video.id)} className="flex min-h-12 items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5">
        <span className="min-w-0 flex-1">
          <span className={clsx('block font-medium text-ink', WRAP)}>
            <bdi>{video.title}</bdi>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>{t(`common:enums.videoKind.${video.kind}`)}</span>
            {video.students.length + video.studentsHidden > 0 && <span>· {t('card.students', { count: video.students.length + video.studentsHidden })}</span>}
            {video.status !== 'approved' ? <DueLabel video={video} today={today} /> : video.decidedAt ? <span>· {f.timestamp(video.decidedAt, 'weekday')}</span> : null}
          </span>
        </span>
        <span className="shrink-0 pt-0.5">
          <VideoStatusBadge video={video} />
        </span>
      </Link>
    </li>
  );
}

/** A small "N" pill for counts on buttons and headings. */
export function CountPill({ count }: { count: number }) {
  if (!count) return null;
  return <Badge tone="accent">{count}</Badge>;
}
