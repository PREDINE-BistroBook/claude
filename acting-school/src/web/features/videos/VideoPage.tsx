import clsx from 'clsx';
import { CircleCheck, ExternalLink, Hammer, History, MessageCircle, MessageSquareWarning, PencilLine, Plus, RotateCcw, Send, Trash2, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { todayISO } from '@shared/dates';
import type { VideoEventType } from '@shared/enums';
import { VIDEO_NOTE_MAX, videoActions, videoLinkHost, videoNoteInput, type VideoDetail, type VideoEvent } from '@shared/schemas/videos';
import { Avatar, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, PageLoader, TextAreaField, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { fullName, useFormat } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { useCourse } from '../classes/api';
import { useVideo, useVideoActions, videoErrorKey } from './api';
import { AddVideoModal } from './components/AddVideoModal';
import { NextStepButtons, NoteBox, VideoLinkButton, VideoStatusBadge, WRAP, WhenLabel, useNoteLabels, useViewer } from './components/VideoParts';
import { VIDEOS_PATH } from './utils';

/**
 * /videos/:id — one video: its status in words, both links as big buttons
 * ("Open raw footage" / "Watch the edit", with their hosts), the next step for
 * the viewer's role, the notes (the coach's, the editor's, the reviewer's
 * changes), where it is from and who is in it, the history, and comments.
 */
export default function VideoPage() {
  const { t } = useTranslation(['videos', 'common']);
  const id = Number(useParams().id);
  const video = useVideo(id);
  if (video.isPending) return <PageLoader />;
  if (video.isError) {
    if (video.error instanceof ApiError && video.error.status === 404) {
      return (
        <div>
          <PageHeader back={VIDEOS_PATH} title={t('title')} />
          <EmptyState icon={History} title={t('page.notFound')} className="rounded-2xl border border-dashed border-line-strong py-10" />
        </div>
      );
    }
    return <ErrorState error={video.error} onRetry={() => void video.refetch()} />;
  }
  return <VideoView video={video.data} />;
}

function VideoView({ video: v }: { video: VideoDetail }) {
  const { t } = useTranslation(['videos', 'common']);
  const f = useFormat();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const viewer = useViewer();
  const actions = videoActions(v, viewer);
  const mutations = useVideoActions();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const course = useCourse(v.courseId, editing && can('courses.read'));
  const today = todayISO();
  const seesWorkshops = can('courses.read');
  const labels = useNoteLabels();
  const approved = v.status === 'approved';
  // Once handed in, the edit is what the page is for: "Watch the edit" comes first (and is the main button).
  const editFirst = !!v.editedLink && (v.status === 'in_review' || approved);
  /** A link inside the facts: a full 48 px target. */
  const factLink = 'inline-flex min-h-12 items-center font-medium text-accent hover:underline';

  const remove = () =>
    void mutations.remove.mutateAsync(v.id).then(
      () => {
        toast.success(t('toasts.deleted'));
        navigate(v.sessionId && seesWorkshops ? `/sessions/${v.sessionId}` : VIDEOS_PATH, { replace: true });
      },
      (err: unknown) => {
        setConfirmDelete(false);
        toast.error(t(videoErrorKey(err)));
      },
    );

  const facts: { label: string; value: ReactNode }[] = [
    {
      label: t('page.workshop'),
      value: seesWorkshops ? (
        <Link to={`/classes/${v.courseId}`} className={factLink}>
          <bdi>{v.courseName}</bdi>
        </Link>
      ) : (
        <bdi>{v.courseName}</bdi>
      ),
    },
    {
      label: t('page.session'),
      value: v.sessionDate ? (
        seesWorkshops && v.sessionId ? (
          <Link to={`/sessions/${v.sessionId}`} className={factLink}>
            {f.date(v.sessionDate, 'weekday')}
          </Link>
        ) : (
          f.date(v.sessionDate, 'weekday')
        )
      ) : (
        t('card.noSession')
      ),
    },
    { label: t('page.kind'), value: t(`common:enums.videoKind.${v.kind}`) },
    // The date only (today / tomorrow / late is in the header); once approved, the day it was approved instead.
    approved && v.decidedAt
      ? {
          label: t('page.approvedOn'),
          value: f.timestamp(v.decidedAt, 'weekday'),
        }
      : { label: t('page.due'), value: f.date(v.dueOn, 'weekday') },
    {
      label: t('page.addedBy'),
      value: v.addedBy ? <Person person={v.addedBy} /> : '—',
    },
    {
      label: t('page.editor'),
      value: v.editor ? <Person person={v.editor} /> : <span className="text-muted">{t('page.notStarted')}</span>,
    },
    ...(v.reviewer ? [{ label: t('page.reviewer'), value: <Person person={v.reviewer} /> }] : []),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={VIDEOS_PATH}
        documentTitle={v.title}
        title={<bdi className={WRAP}>{v.title}</bdi>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <VideoStatusBadge video={v} />
            {/* Approved: the green line below says by whom and when. */}
            {!approved && <WhenLabel video={v} today={today} />}
          </span>
        }
        actions={
          (actions.edit || actions.remove) && (
            <>
              {actions.edit && (
                <Button icon={PencilLine} size="lg" onClick={() => setEditing(true)}>
                  {t('actions.edit')}
                </Button>
              )}
              {actions.remove && (
                <Button icon={Trash2} size="lg" variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
                  {t('actions.delete')}
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-5">
        {/* The links and the next step: what the page is for. */}
        <Card>
          <div className="grid gap-3">
            {approved && (
              <p role="status" className={clsx('flex items-start gap-2 rounded-xl bg-success-soft px-3 py-2.5 font-semibold text-success', WRAP)}>
                <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  {v.reviewer && v.decidedAt
                    ? t('page.approvedBanner', {
                        name: `\u2068${v.reviewer.name}\u2069`,
                        date: f.timestamp(v.decidedAt, 'weekday'),
                      })
                    : t('page.approvedBannerNoName')}
                </span>
              </p>
            )}
            {v.changesNote && (v.status === 'changes_requested' || v.status === 'editing') && (
              <NoteBox tone="warning" icon={MessageSquareWarning} label={labels.changes(v.reviewer)}>
                {v.changesNote}
              </NoteBox>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {editFirst ? (
                <>
                  <VideoLinkButton href={v.editedLink!} kind="edit" primary className="sm:w-full" />
                  <VideoLinkButton href={v.rawLink} kind="raw" className="sm:w-full" />
                </>
              ) : (
                <>
                  <VideoLinkButton href={v.rawLink} kind="raw" className="sm:w-full" />
                  {v.editedLink ? (
                    <VideoLinkButton href={v.editedLink} kind="edit" className="sm:w-full" />
                  ) : (
                    <p className="flex min-h-12 items-center justify-center rounded-xl border border-dashed border-line-strong px-3 text-sm text-muted">{t('page.notYet')}</p>
                  )}
                </>
              )}
            </div>
            {v.changesNote && v.status === 'in_review' && <NoteBox label={t('card.changes')}>{v.changesNote}</NoteBox>}
            {v.notesForEditor && <NoteBox label={labels.coach(v.addedBy)}>{v.notesForEditor}</NoteBox>}
            {v.editorNotes && <NoteBox label={labels.editor(v.editor)}>{v.editorNotes}</NoteBox>}
            <NextStepButtons video={v} />
          </div>
        </Card>

        <Card>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-xs font-medium text-muted">{fact.label}</dt>
                <dd className={clsx('mt-0.5 text-base text-ink', WRAP)}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title={t('page.students')}>
          {v.students.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {v.students.map((s) => (
                <li key={s.id}>
                  <Link to={`/students/${s.id}`} className="flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                    <Avatar name={fullName(s)} fileId={s.photoFileId} size="sm" />
                    <span className={clsx('min-w-0 font-medium text-ink', WRAP)}>
                      <bdi>{fullName(s)}</bdi>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            !v.studentsHidden && <p className="text-sm text-muted">{t('page.noStudents')}</p>
          )}
          {v.studentsHidden > 0 && <p className="mt-2 text-sm text-muted">{t('page.hiddenStudents', { count: v.studentsHidden })}</p>}
        </Card>

        <Card title={t('page.history')}>
          <HistoryList events={v.events} />
          {actions.comment && <CommentForm videoId={v.id} />}
        </Card>
      </div>

      {actions.edit && (
        <AddVideoModal
          open={editing && (!seesWorkshops || !!course.data)}
          onClose={() => setEditing(false)}
          course={{ id: v.courseId, name: v.courseName }}
          students={(course.data?.enrollments ?? [])
            .filter((e) => e.status !== 'withdrawn')
            .map((e) => ({
              id: e.studentId,
              firstName: e.firstName,
              lastName: e.lastName,
              photoFileId: e.photoFileId,
            }))}
          video={v}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title={t('confirmDelete.title')}
        message={t('confirmDelete.message')}
        confirmLabel={t('actions.delete')}
        loading={mutations.remove.isPending}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function Person({ person }: { person: { id: number; name: string; photoFileId: string | null } }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar name={person.name} fileId={person.photoFileId} size="xs" />
      <bdi>{person.name}</bdi>
    </span>
  );
}

const EVENT_LOOK: Record<VideoEventType, { icon: LucideIcon; tone: string }> = {
  added: { icon: Plus, tone: 'bg-accent-soft text-accent' },
  taken: { icon: Hammer, tone: 'bg-info-soft text-info' },
  submitted: { icon: Send, tone: 'bg-warning-soft text-warning' },
  changes_requested: {
    icon: MessageSquareWarning,
    tone: 'bg-danger-soft text-danger',
  },
  approved: { icon: CircleCheck, tone: 'bg-success-soft text-success' },
  reopened: { icon: RotateCcw, tone: 'bg-danger-soft text-danger' },
  comment: { icon: MessageCircle, tone: 'bg-surface-2 text-ink' },
};

/** The history, oldest first, like an enquiry's timeline: who did what, when, with its note or link. */
function HistoryList({ events }: { events: VideoEvent[] }) {
  const { t } = useTranslation('videos');
  const f = useFormat();
  return (
    <ol className="relative grid gap-4 before:absolute before:inset-y-2 before:start-[1.0625rem] before:w-px before:bg-line">
      {events.map((e) => {
        const look = EVENT_LOOK[e.type];
        return (
          <li key={e.id} className="relative flex gap-3">
            <span className={clsx('relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full ring-4 ring-surface', look.tone)}>
              <look.icon className="size-4" aria-hidden />
            </span>
            <div className={clsx('min-w-0 flex-1 pt-1.5', WRAP)}>
              <p className="text-sm font-medium text-ink">
                <bdi>{e.by?.name ?? t('history.someone')}</bdi> · {t(`history.${e.type}`)}
              </p>
              {e.note && (
                <p dir="auto" className="mt-1 text-start text-sm leading-relaxed whitespace-pre-line text-ink">
                  {e.note}
                </p>
              )}
              {/* The big buttons above carry the links; here only where it went, as a short link (its host). */}
              {e.link && (
                <a href={e.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                  <ExternalLink className="size-4 shrink-0" aria-hidden />
                  <bdi dir="ltr">{videoLinkHost(e.link) ?? e.link}</bdi>
                  <span className="sr-only">({t('links.opensNewTab')})</span>
                </a>
              )}
              <p className="mt-1 text-xs text-muted">{f.timestampTime(e.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A comment for the people working on the video (the coach, the editors, the reviewers, owners). */
function CommentForm({ videoId }: { videoId: number }) {
  const { t } = useTranslation(['videos', 'common']);
  const toast = useToast();
  const { comment } = useVideoActions();
  const form = useForm({ note: '' });
  const send = () => {
    const data = form.validate(videoNoteInput);
    if (!data) return;
    comment.mutate(
      { id: videoId, note: data.note },
      {
        onSuccess: () => {
          form.setValues({ note: '' });
          toast.success(t('toasts.commented'));
        },
        onError: form.setServerError,
      },
    );
  };
  return (
    <div className="mt-5 grid gap-2 border-t border-line pt-4">
      <TextAreaField label={t('page.commentLabel')} {...form.bind('note')} error={form.error('note')} placeholder={t('page.commentPlaceholder')} maxLength={VIDEO_NOTE_MAX} rows={2} />
      {form.formError && <p className="text-sm text-danger">{t(form.formError)}</p>}
      <div className="flex justify-end">
        <Button icon={MessageCircle} size="lg" loading={comment.isPending} onClick={send} disabled={!form.values.note.trim()}>
          {t('actions.comment')}
        </Button>
      </div>
    </div>
  );
}
