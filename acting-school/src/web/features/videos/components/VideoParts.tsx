import clsx from 'clsx';
import { CalendarClock, CircleCheck, ExternalLink, Hammer, Hourglass, MessageSquareWarning, PencilLine, Play, RotateCcw, Send, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { VIDEO_NOTE_MAX, videoActions, videoChangesInput, videoLinkHost, videoSubmitInput, type Video, type VideoStepResult } from '@shared/schemas/videos';
import type { PersonRef } from '@shared/schemas/team';
import { Badge, Button, buttonClasses, Modal, StatusBadge, TextAreaField, TextField, useToast } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { fullName, useFormat } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { useNow } from '../../cafe/components/CafeParts';
import { movedVideo, useVideoActions, useVideoCounts, videoErrorKey } from '../api';
import { QUEUE_MOVE_REST_MS, cardWhen, dueWords, namesList, tidyLink, videoPagePath, waitedParts, type VideoStep } from '../utils';

/** Long links, titles and names wrap instead of widening the phone's screen. */
export const WRAP = '[overflow-wrap:anywhere]';

/** A name inside a translated sentence, isolated from the sentence's direction (an English name in an Arabic line keeps its colon in place). */
const isolate = (s: string) => `\u2068${s}\u2069`;

/** The signed-in person as the video rules read them. */
export function useViewer() {
  const { user } = useAuth();
  return {
    id: user?.id ?? 0,
    isOwner: !!user?.isOwner,
    permissions: user?.permissions ?? [],
  };
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

/**
 * What a card's header says about time: the due date while the editor still
 * has work to do; "Sent 2 hours ago" once handed in (how long the edit has
 * waited for its check); "Approved Mon 23 Nov" once approved.
 */
export function WhenLabel({ video, today, className }: { video: Pick<Video, 'dueOn' | 'status' | 'submittedAt' | 'decidedAt'>; today: string; className?: string }) {
  const { t } = useTranslation('videos');
  const f = useFormat();
  const now = useNow(60_000);
  const when = cardWhen(video);
  if (when.kind === 'due') return <DueLabel video={video} today={today} className={className} />;
  let text: string;
  if (when.kind === 'approved') text = t('when.approved', { date: f.timestamp(when.at, 'weekday') });
  else {
    const ago = waitedParts(when.at, now);
    text =
      ago.unit === 'now'
        ? t('when.sentNow')
        : t('when.sent', {
            ago: new Intl.RelativeTimeFormat(f.locale, {
              numeric: 'always',
            }).format(-ago.value, ago.unit),
          });
  }
  const Icon = when.kind === 'approved' ? CircleCheck : Hourglass;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-sm font-medium text-muted', className)}>
      <Icon className="size-4 shrink-0" aria-hidden />
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

/**
 * The two notes, each saying who wrote it — "Layla Haddad (coach) asked:" /
 * "Hany Nabil (editor) says:" — so nobody mixes up the coach's request with
 * the editor's message.
 */
export function useNoteLabels() {
  const { t } = useTranslation('videos');
  return {
    coach: (person: Pick<PersonRef, 'name'> | null) => (person ? t('card.coachAsked', { name: isolate(person.name) }) : t('card.coachAskedNoName')),
    editor: (person: Pick<PersonRef, 'name'> | null) => (person ? t('card.editorSays', { name: isolate(person.name) }) : t('card.editorSaysNoName')),
    changes: (person: Pick<PersonRef, 'name'> | null) => (person ? t('card.changesBy', { name: isolate(person.name) }) : t('card.changes')),
  };
}

/** The status in words, as a badge. */
export function VideoStatusBadge({ video }: { video: Pick<Video, 'status'> }) {
  return <StatusBadge group="videoStatus" value={video.status} />;
}

// ── The next-step buttons ───────────────────────────────────────────────────

/**
 * The toast after a step, naming who was told — "Sent for checking — Moaty
 * got an alert" — or saying plainly that nobody was (nobody holds the Video
 * reviewer position yet).
 */
export function useStepToast() {
  const { t, i18n } = useTranslation('videos');
  const toast = useToast();
  return (step: VideoStep | 'add', result: Pick<VideoStepResult, 'told'>, opts: { movedToEditing?: boolean } = {}) => {
    const told = result.told.length > 0;
    const names = namesList(
      result.told.map((p) => p.name),
      i18n.language,
    );
    switch (step) {
      case 'add':
        return told ? toast.success(t('toasts.added', { names })) : toast.error(t('toasts.addedNobody'));
      case 'take':
        return toast.success(t(opts.movedToEditing ? 'toasts.taken' : 'toasts.takenHere'));
      case 'submit':
        return told ? toast.success(t('toasts.submitted', { names })) : toast.error(t('toasts.submittedNobody'));
      case 'approve':
        return toast.success(told ? t('toasts.approved', { names }) : t('toasts.approvedQuiet'));
      case 'changes':
      case 'reopen':
        return toast.success(told ? t('toasts.changes', { names }) : t('toasts.changesQuiet'));
    }
  };
}

/** What the queue hears from a card's buttons: a tap (the cards stay put from now on) and the step's answer. */
export interface StepHooks {
  /** A step button (or a dialog's send button) was tapped: the queue pins its cards and rests its buttons. */
  onTap?: () => void;
  /** The step went through. Answers whether the queue moved to the editor's "Editing" tab (for the toast's words). */
  onStep?: (step: VideoStep, result: VideoStepResult) => { movedToEditing?: boolean } | void;
}

/**
 * The buttons for what the viewer does next with this video — and only those
 * (videoActions): "Start editing" / "Start fixing" (the editor), "Done — send
 * the edit" (the editor editing it), "Approved ✓" and "Needs changes" (the
 * reviewer), "Send back for changes" (the reviewer, approved — on the video
 * page only, never on a card, where it sat next to "Open"). Big, labelled,
 * two colours. After a tap every button rests for two seconds
 * (QUEUE_MOVE_REST_MS): a second tap on the same spot does nothing.
 */
export function NextStepButtons({
  video,
  onMoved,
  compact,
  resting = false,
  onTap,
  onStep,
}: {
  video: Video;
  onMoved?: (v: Video) => void;
  compact?: boolean;
  resting?: boolean;
} & StepHooks) {
  const { t } = useTranslation('videos');
  const toast = useToast();
  const stepToast = useStepToast();
  const can = useVideoActionsFor(video);
  const actions = useVideoActions();
  const [dialog, setDialog] = useState<'submit' | 'changes' | 'reopen' | null>(null);
  // This component's own rest (the video page; the queue also passes `resting` for every card).
  const [restAt, setRestAt] = useState<number | null>(null);
  useEffect(() => {
    if (restAt === null) return;
    const id = setTimeout(() => setRestAt(null), QUEUE_MOVE_REST_MS);
    return () => clearTimeout(id);
  }, [restAt]);
  const busy = resting || restAt !== null;
  const tapped = () => {
    setRestAt(Date.now());
    onTap?.();
  };
  const failed = (err: unknown) => {
    const now = movedVideo(err);
    if (now) onMoved?.(now);
    toast.error(t(videoErrorKey(err)));
  };
  const succeeded = (step: VideoStep) => (result: VideoStepResult) => {
    setRestAt(Date.now());
    const where = onStep?.(step, result) ?? {};
    stepToast(step, result, where);
    onMoved?.(result);
  };

  const take = () => {
    if (busy) return;
    tapped();
    void actions.take.mutateAsync(video.id).then(succeeded('take'), failed);
  };
  const approve = () => {
    if (busy) return;
    tapped();
    void actions.approve.mutateAsync(video.id).then(succeeded('approve'), failed);
  };
  const takeLabel = video.status === 'changes_requested' ? t('actions.fix') : video.status === 'editing' ? t('actions.takeOver') : t('actions.take');
  const big = clsx('h-auto min-h-12 w-full whitespace-normal py-2', !compact && 'sm:w-auto');

  const buttons: ReactNode[] = [];
  if (can.take)
    buttons.push(
      <Button key="take" variant="primary" size="lg" icon={video.status === 'changes_requested' ? PencilLine : Hammer} loading={actions.take.isPending} disabled={busy} onClick={take} className={big}>
        {takeLabel}
      </Button>,
    );
  if (can.submit)
    buttons.push(
      <Button key="submit" variant="success" size="lg" icon={Send} disabled={busy} onClick={() => setDialog('submit')} className={big}>
        {t('actions.submit')}
      </Button>,
    );
  if (can.approve)
    buttons.push(
      <Button key="approve" variant="success" size="lg" icon={CircleCheck} loading={actions.approve.isPending} disabled={busy} onClick={approve} className={big}>
        {t('actions.approve')}
      </Button>,
    );
  if (can.requestChanges)
    buttons.push(
      <Button key="changes" variant="danger" size="lg" icon={MessageSquareWarning} disabled={busy} onClick={() => setDialog('changes')} className={big}>
        {t('actions.requestChanges')}
      </Button>,
    );
  // "Send back for changes" on an approved video: a quieter button, on the video page only.
  const reopen = can.reopen && !compact;

  return (
    <>
      {buttons.length > 0 && <div className={clsx('grid gap-2', buttons.length > 1 && 'grid-cols-2', !compact && 'sm:flex sm:flex-wrap')}>{buttons}</div>}
      {reopen && (
        <div>
          <Button size="lg" icon={RotateCcw} disabled={busy} onClick={() => setDialog('reopen')} className="h-auto min-h-12 whitespace-normal py-2">
            {t('actions.reopen')}
          </Button>
        </div>
      )}
      {/* Mounted whatever the buttons: the answer arrives after the buttons may have changed. */}
      {can.submit && <SubmitModal open={dialog === 'submit'} video={video} onClose={() => setDialog(null)} onSend={tapped} onDone={succeeded('submit')} onFailed={failed} />}
      {(can.requestChanges || reopen) && (
        <NoteModal
          open={dialog === 'changes' || dialog === 'reopen'}
          mode={dialog === 'reopen' ? 'reopen' : 'changes'}
          video={video}
          onClose={() => setDialog(null)}
          onSend={tapped}
          onDone={succeeded(dialog === 'reopen' ? 'reopen' : 'changes')}
          onFailed={failed}
        />
      )}
    </>
  );
}

/**
 * "Done": the edited link (required) and notes for the reviewer. Says who is
 * alerted — or, when nobody holds the Video reviewer position yet, that
 * nobody is.
 */
function SubmitModal({
  open,
  video,
  onClose,
  onSend,
  onDone,
  onFailed,
}: {
  open: boolean;
  video: Video;
  onClose: () => void;
  onSend: () => void;
  onDone: (v: VideoStepResult) => void;
  onFailed: (err: unknown) => void;
}) {
  const { t } = useTranslation(['videos', 'common']);
  const actions = useVideoActions();
  const counts = useVideoCounts();
  const nobodyChecks = counts?.reviewers === 0;
  const form = useForm({
    editedLink: video.editedLink ?? '',
    notes: video.editorNotes ?? '',
  });
  const send = () => {
    const data = form.validate(videoSubmitInput, {
      editedLink: tidyLink(form.values.editedLink),
      notes: form.values.notes,
    });
    if (!data) return;
    onSend();
    // mutateAsync, not mutate(…, { onSuccess }): the card may leave its tab before the answer, and the toast must still say who was told.
    void actions.submit
      .mutateAsync({
        id: video.id,
        editedLink: data.editedLink,
        notes: data.notes ?? null,
      })
      .then(
        (v) => {
          onClose();
          onDone(v);
        },
        (err: unknown) => {
          form.setServerError(err);
          if (movedVideo(err)) {
            onClose();
            onFailed(err);
          }
        },
      );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('submit.title')}
      description={t(nobodyChecks ? 'submit.introNobody' : 'submit.intro')}
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
          // Sent back with changes: the link from last time is offered — say so, so the same edit isn't sent again by mistake.
          hint={video.editedLink ? t('submit.lastLink') : undefined}
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

/** "Needs changes" / "Send back for changes": what the editor should change (required). */
function NoteModal({
  open,
  mode,
  video,
  onClose,
  onSend,
  onDone,
  onFailed,
}: {
  open: boolean;
  mode: 'changes' | 'reopen';
  video: Video;
  onClose: () => void;
  onSend: () => void;
  onDone: (v: VideoStepResult) => void;
  onFailed: (err: unknown) => void;
}) {
  const { t } = useTranslation(['videos', 'common']);
  const actions = useVideoActions();
  const mutation = mode === 'reopen' ? actions.reopen : actions.requestChanges;
  const form = useForm({ note: '' });
  const send = () => {
    const data = form.validate(videoChangesInput);
    if (!data) return;
    onSend();
    void mutation.mutateAsync({ id: video.id, note: data.note }).then(
      (v) => {
        form.setValues({ note: '' });
        onClose();
        onDone(v);
      },
      (err: unknown) => {
        form.setServerError(err);
        if (movedVideo(err)) {
          onClose();
          onFailed(err);
        }
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
 * words (a strip) with how it stands in time, the title, where it is from,
 * who is in it — and what the viewer does next. Editors see the reviewer's
 * note on a video sent back, the coach's request and "Open raw footage";
 * reviewers see "Watch the edit", the editor's message and the two big
 * buttons; an approved video offers "Watch the edit" first, then "Open".
 */
export function VideoCard({ video, today, resting, onTap, onStep }: { video: Video; today: string; resting?: boolean } & StepHooks) {
  const { t } = useTranslation('videos');
  const can = useVideoActionsFor(video);
  const labels = useNoteLabels();
  const editorSide = can.take || can.submit;
  const reviewerSide = can.approve || can.requestChanges;
  const approved = video.status === 'approved';
  return (
    <li className={clsx('overflow-hidden rounded-2xl border bg-surface shadow-sm', video.status === 'changes_requested' ? 'border-danger/40' : 'border-line', WRAP)} data-status={video.status}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <VideoStatusBadge video={video} />
        <WhenLabel video={video} today={today} />
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
            {video.status === 'new' || !video.editor ? t('card.from', { name: isolate(video.addedBy?.name ?? '—') }) : t('card.editedBy', { name: isolate(video.editor.name) })}
            {approved && video.reviewer && <> · {t('card.checkedBy', { name: isolate(video.reviewer.name) })}</>}
          </p>
        </div>
        <StudentsLine video={video} />
        {video.changesNote && (video.status === 'changes_requested' || video.status === 'editing') && (
          <NoteBox tone="warning" icon={MessageSquareWarning} label={labels.changes(video.reviewer)}>
            {video.changesNote}
          </NoteBox>
        )}
        {/* Back for a second check: what the reviewer asked for last time, to see it was done. */}
        {reviewerSide && video.changesNote && <NoteBox label={t('card.changes')}>{video.changesNote}</NoteBox>}
        {editorSide && video.notesForEditor && <NoteBox label={labels.coach(video.addedBy)}>{video.notesForEditor}</NoteBox>}
        {reviewerSide && video.editorNotes && <NoteBox label={labels.editor(video.editor)}>{video.editorNotes}</NoteBox>}
        {(reviewerSide || approved) && video.editedLink && <VideoLinkButton href={video.editedLink} kind="edit" primary className="sm:w-full" />}
        {editorSide && <VideoLinkButton href={video.rawLink} kind="raw" className="sm:w-full" />}
        <NextStepButtons video={video} compact resting={resting} onTap={onTap} onStep={onStep} />
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
  return (
    <li>
      <Link to={videoPagePath(video.id)} className="flex min-h-12 items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5">
        <span className="min-w-0 flex-1">
          <span className={clsx('block font-medium text-ink', WRAP)}>
            <bdi>{video.title}</bdi>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>{t(`common:enums.videoKind.${video.kind}`)}</span>
            {video.students.length + video.studentsHidden > 0 && (
              <span>
                ·{' '}
                {t('card.students', {
                  count: video.students.length + video.studentsHidden,
                })}
              </span>
            )}
            <WhenLabel video={video} today={today} />
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
