import clsx from 'clsx';
import { Check, Plus } from 'lucide-react';
import { useEffect, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, todayISO } from '@shared/dates';
import { VIDEO_KINDS, type VideoKind } from '@shared/enums';
import { VIDEO_NOTE_MAX, VIDEO_TITLE_MAX, videoInput, videoUpdateInput, type Video, type VideoDetail } from '@shared/schemas/videos';
import { Avatar, Button, Field, Modal, SelectField, TextAreaField, TextField, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { fullName, useFormat } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { useVideoActions, videoErrorKey } from '../api';
import { defaultVideoTitle, tidyLink, toggleStudent } from '../utils';
import { WRAP } from './VideoParts';

export interface VideoFormStudent {
  id: number;
  firstName: string;
  lastName: string;
  photoFileId: string | null;
}

export interface VideoFormProps {
  open: boolean;
  onClose: () => void;
  course: { id: number; name: string };
  /** Added from a session: the video is that session's. */
  session?: { id: number; date: string } | null;
  /** Added from the workshop: its sessions so far, to pick one (or none). */
  sessions?: { id: number; date: string; startTime: string }[];
  /** The students to tick: the session's roster, or the workshop's students. */
  students: VideoFormStudent[];
  /** Change an existing video (while it is new) instead of adding one. */
  video?: Video;
  onSaved?: (v: VideoDetail) => void;
}

type Values = { title: string; kind: VideoKind; rawLink: string; notesForEditor: string; dueOn: string; sessionId: string; studentIds: number[] };

/**
 * "+ Add video" (and "Change" while the video is new): the title — offered as
 * "<workshop> — <date>" —, what it is, the raw footage link, who is in it as
 * big tick boxes, notes for the editor and the day it is needed (tomorrow).
 * A bottom sheet on phones.
 */
export function AddVideoModal({ open, onClose, course, session, sessions, students, video, onSaved }: VideoFormProps) {
  const { t } = useTranslation(['videos', 'common']);
  const f = useFormat();
  const toast = useToast();
  const actions = useVideoActions();
  const mutation = video ? actions.update : actions.add;
  const kindLabelId = useId();
  const studentsLabelId = useId();
  const initial = useMemo<Values>(
    () =>
      video
        ? {
            title: video.title,
            kind: video.kind,
            rawLink: video.rawLink,
            notesForEditor: video.notesForEditor ?? '',
            dueOn: video.dueOn,
            sessionId: video.sessionId ? String(video.sessionId) : '',
            studentIds: video.students.map((s) => s.id),
          }
        : {
            title: defaultVideoTitle(course.name, session ? f.date(session.date, 'medium') : null),
            kind: 'scene',
            rawLink: '',
            notesForEditor: '',
            dueOn: addDays(todayISO(), 1),
            sessionId: sessions?.length ? String(sessions[sessions.length - 1]!.id) : '',
            studentIds: [],
          },
    [video, course.name, session, sessions, f],
  );
  const form = useForm<Values>(initial);
  // Each time the sheet opens it starts from the video (or a fresh form).
  useEffect(() => {
    if (open) {
      form.setValues(initial);
      form.setErrors({});
      form.setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const v = form.values;
  const allTicked = students.length > 0 && students.every((s) => v.studentIds.includes(s.id));

  const save = () => {
    const payload = {
      title: v.title,
      kind: v.kind,
      rawLink: tidyLink(v.rawLink),
      notesForEditor: v.notesForEditor,
      dueOn: v.dueOn,
      studentIds: v.studentIds,
    };
    if (video) {
      const data = form.validate(videoUpdateInput, payload);
      if (!data) return;
      actions.update.mutate({ id: video.id, ...data }, { onSuccess: done('toasts.saved'), onError: failed });
      return;
    }
    const where = session ? { sessionId: session.id } : v.sessionId ? { sessionId: Number(v.sessionId) } : { courseId: course.id };
    const data = form.validate(videoInput, { ...payload, ...where });
    if (!data) return;
    actions.add.mutate(data, { onSuccess: done('toasts.added'), onError: failed });
  };
  const done = (key: string) => (saved: VideoDetail) => {
    toast.success(t(key));
    onClose();
    onSaved?.(saved);
  };
  // Field problems show under their fields; anything else (the editor has just started on it…) above the buttons.
  const failed = (err: unknown) => {
    form.setServerError(err);
    if (!(err instanceof ApiError && err.issues?.length)) form.setFormError(videoErrorKey(err));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t(video ? 'form.editTitle' : 'form.addTitle')}
      description={video ? undefined : t('form.intro')}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button size="lg" variant="primary" icon={video ? Check : Plus} loading={mutation.isPending} onClick={save}>
            {t(video ? 'form.saveChanges' : 'form.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <TextField
          label={t('form.rawLink')}
          {...form.bind('rawLink')}
          onBlur={() => form.set('rawLink', tidyLink(v.rawLink))}
          error={form.error('rawLink')}
          hint={t('form.rawLinkHint')}
          type="url"
          inputMode="url"
          dir="ltr"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://"
          required
        />
        <TextField label={t('form.title')} {...form.bind('title')} error={form.error('title')} maxLength={VIDEO_TITLE_MAX} required />

        <Field label={<span id={kindLabelId}>{t('form.kind')}</span>} error={form.error('kind')}>
          <div role="radiogroup" aria-labelledby={kindLabelId} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {VIDEO_KINDS.map((k) => {
              const on = v.kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => form.set('kind', k)}
                  className={clsx(
                    'inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-3 text-base font-medium transition-colors',
                    on ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-surface text-ink hover:bg-surface-2',
                  )}
                >
                  {on && <Check className="size-4 shrink-0" aria-hidden />}
                  {t(`common:enums.videoKind.${k}`)}
                </button>
              );
            })}
          </div>
        </Field>

        {!session && !video && sessions && sessions.length > 0 && (
          <SelectField label={t('form.session')} {...form.bind('sessionId')} error={form.error('sessionId')}>
            {[...sessions].reverse().map((s) => (
              <option key={s.id} value={s.id}>
                {f.date(s.date, 'weekday')} · {f.time(s.startTime)}
              </option>
            ))}
            <option value="">{t('form.noSession')}</option>
          </SelectField>
        )}

        <Field label={<span id={studentsLabelId}>{t('form.students')}</span>} hint={students.length ? t('form.studentsHint') : undefined} error={form.error('studentIds')}>
          {students.length ? (
            <div role="group" aria-labelledby={studentsLabelId} className="grid gap-2">
              <StudentTick
                label={t('form.allStudents')}
                checked={allTicked}
                onChange={() => form.set('studentIds', allTicked ? [] : students.map((s) => s.id))}
                strong
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {students.map((s) => (
                  <StudentTick key={s.id} student={s} label={fullName(s)} checked={v.studentIds.includes(s.id)} onChange={() => form.set('studentIds', toggleStudent(v.studentIds, s.id))} />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('form.noStudents')}</p>
          )}
        </Field>

        <TextAreaField
          label={t('form.notes')}
          {...form.bind('notesForEditor')}
          error={form.error('notesForEditor')}
          placeholder={t('form.notesPlaceholder')}
          maxLength={VIDEO_NOTE_MAX}
          rows={3}
          optional
        />
        <TextField label={t('form.due')} type="date" {...form.bind('dueOn')} error={form.error('dueOn')} hint={t('form.dueHint')} required />
        {form.formError && <p className="text-sm text-danger">{t(form.formError)}</p>}
      </div>
    </Modal>
  );
}

/** One big tick box: the whole row (≥ 48 px) is the target. */
function StudentTick({ student, label, checked, onChange, strong }: { student?: VideoFormStudent; label: string; checked: boolean; onChange: () => void; strong?: boolean }) {
  return (
    <label
      className={clsx(
        'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors',
        checked ? 'border-accent bg-accent-soft/60' : 'border-line-strong bg-surface hover:bg-surface-2',
      )}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="size-5 shrink-0 rounded accent-[var(--accent)]" />
      {student && <Avatar name={label} fileId={student.photoFileId} size="sm" />}
      <span className={clsx('min-w-0 flex-1 text-base', strong ? 'font-semibold' : 'font-medium', WRAP)}>
        <bdi>{label}</bdi>
      </span>
    </label>
  );
}
