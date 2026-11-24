import clsx from 'clsx';
import { Link2, TriangleAlert, UserPlus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayISO } from '@shared/dates';
import { ADMISSIONS_ERROR_CODES, type AdmissionsCourseOption, type LeadDetail, type PossibleDuplicateDetails } from '@shared/schemas/admissions';
import { Badge, BidiText, Button, EmptyState, FormError, Modal, PageLoader, TextField, useToast } from '@web/components/ui';
import { fullName, useFormat } from '@web/lib/format';
import { ColorDot } from '../../classes/components/CourseColor';
import { scheduleLines } from '../../classes/utils';
import { admissionsErrorKey, isApiCode, useAdmissionsSettings, useCourseOptions, useEnrol } from '../api';
import { latestDoneInterview } from '../utils';

interface Props {
  open: boolean;
  onClose: () => void;
  lead: LeadDetail;
}

/**
 * Enrol the lead: pick the class (so the coach), which creates the student and
 * the enrollment in one go. A student with the same phone/email answers 409
 * possible_duplicate: link to that student, or create a new one anyway.
 * Mounted only while open.
 */
export function EnrolModal(props: Props) {
  return props.open ? <EnrolDialog {...props} /> : null;
}

function EnrolDialog({ onClose, lead }: Props) {
  const { t } = useTranslation(['admissions', 'common']);
  const toast = useToast();
  const courses = useCourseOptions();
  const enrol = useEnrol(lead.id);
  const options = courses.data?.items ?? [];
  // Prefill: the class the interview recommended, else the one they asked for.
  const recommended = latestDoneInterview(lead.interviews)?.recommendedCourseId ?? null;
  const suggested = recommended ?? lead.preferredCourseId;
  const [picked, setPicked] = useState<number | null>(null);
  const suggestedOption = options.find((c) => c.id === suggested && c.freePlaces !== 0);
  const courseId = picked ?? suggestedOption?.id ?? null;
  const [joinedOn, setJoinedOn] = useState(todayISO());
  const [duplicate, setDuplicate] = useState<PossibleDuplicateDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = (extra: { linkStudentId?: number; createNew?: true } = {}) => {
    if (!courseId) return setError('admissions:errors.pickClass');
    setError(null);
    enrol.mutate(
      { courseId, joinedOn: joinedOn || undefined, ...extra },
      {
        onSuccess: (res) => {
          toast.success(t(res.createdStudent ? 'enrol.doneCreated' : 'enrol.doneLinked'));
          onClose();
        },
        onError: (err) => {
          if (isApiCode(err, ADMISSIONS_ERROR_CODES.possibleDuplicate)) {
            const details = err.details as PossibleDuplicateDetails | undefined;
            setDuplicate({ matches: details?.matches ?? [] });
          } else {
            setDuplicate(null);
            setError(admissionsErrorKey(err));
          }
        },
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('enrol.title', { name: fullName(lead) })}
      description={t('enrol.subtitle')}
      footer={
        duplicate ? (
          <Button onClick={() => setDuplicate(null)}>{t('enrol.backToClasses')}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button variant="primary" icon={UserPlus} onClick={() => send()} loading={enrol.isPending} disabled={!courseId}>
              {t('enrol.submit')}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4">
        <FormError messageKey={error} />
        {duplicate ? (
          <DuplicateChoice matches={duplicate.matches} loading={enrol.isPending} onLink={(id) => send({ linkStudentId: id })} onCreate={() => send({ createNew: true })} />
        ) : courses.isPending ? (
          <PageLoader />
        ) : courses.isError ? (
          <FormError messageKey={admissionsErrorKey(courses.error)} />
        ) : !options.length ? (
          <EmptyState title={t('enrol.noClasses')} description={t('enrol.noClassesHint')} />
        ) : (
          <>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">{t('enrol.pickClass')}</legend>
              <div role="radiogroup" className="grid gap-2">
                {options.map((c) => (
                  <CourseOption key={c.id} course={c} selected={c.id === courseId} recommended={c.id === recommended} onSelect={() => setPicked(c.id)} />
                ))}
              </div>
            </fieldset>
            <TextField label={t('enrol.joinedOn')} type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} className="sm:max-w-56" hint={t('enrol.joinedOnHint')} />
          </>
        )}
      </div>
    </Modal>
  );
}

/** One class as a selectable card: name, coach, level, weekly times, free places. A full class can't be picked. */
function CourseOption({ course: c, selected, recommended, onSelect }: { course: AdmissionsCourseOption; selected: boolean; recommended: boolean; onSelect: () => void }) {
  const { t } = useTranslation(['admissions', 'common']);
  const f = useFormat();
  const { weekStartsOn } = useAdmissionsSettings();
  const full = c.freePlaces === 0;
  const lines = scheduleLines(c.schedule, f, weekStartsOn);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={full}
      onClick={onSelect}
      className={clsx(
        'grid gap-1 rounded-2xl border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        selected ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line bg-surface hover:bg-surface-2',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ColorDot color={c.color} />
        <BidiText className="min-w-0 flex-1 font-medium text-ink">{c.name}</BidiText>
        {recommended && <Badge tone="accent">{t('enrol.recommended')}</Badge>}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span className="inline-flex min-w-0 items-center gap-1">
          <UserRound className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">{t('enrol.coach')}</span>
          {c.teacherName ? <bdi className="truncate">{c.teacherName}</bdi> : t('enrol.noCoach')}
        </span>
        {c.level && <Badge>{t(`common:enums.courseLevel.${c.level}`)}</Badge>}
        <Badge tone={c.freePlaces === null ? 'neutral' : full ? 'danger' : c.freePlaces <= 2 ? 'warning' : 'success'}>
          {c.freePlaces === null ? t('enrol.noLimit') : full ? t('enrol.full') : t('enrol.placesLeft', { count: c.freePlaces })}
        </Badge>
      </span>
      {lines.map((l) => (
        <span key={l} className="text-xs text-muted">
          {l}
        </span>
      ))}
      <span className="text-xs text-muted">{t('enrol.dates', { from: f.date(c.startDate), to: f.date(c.endDate) })}</span>
    </button>
  );
}

function DuplicateChoice({ matches, loading, onLink, onCreate }: { matches: { id: number; name: string }[]; loading: boolean; onLink: (id: number) => void; onCreate: () => void }) {
  const { t } = useTranslation('admissions');
  return (
    <div className="grid gap-3">
      <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning" role="alert">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('enrol.duplicate', { count: matches.length })}
      </p>
      <ul className="grid gap-2">
        {matches.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2">
              <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
              <bdi className="truncate font-medium text-ink">{m.name}</bdi>
            </span>
            <Button size="sm" variant="primary" icon={Link2} onClick={() => onLink(m.id)} loading={loading}>
              {t('enrol.linkExisting')}
            </Button>
          </li>
        ))}
      </ul>
      <div className="border-t border-line pt-3">
        <Button icon={UserPlus} onClick={onCreate} disabled={loading} className="w-full sm:w-auto">
          {t('enrol.createNew')}
        </Button>
        <p className="mt-1.5 text-xs text-muted">{t('enrol.createNewHint')}</p>
      </div>
    </div>
  );
}
