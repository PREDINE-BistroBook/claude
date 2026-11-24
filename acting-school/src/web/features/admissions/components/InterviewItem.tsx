import { ClipboardPen, Pencil, UserX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { nowTime, splitDateTime, timeToMinutes, todayISO } from '@shared/dates';
import { INTERVIEW_SCORE_MAX } from '@shared/enums';
import type { Interview } from '@shared/schemas/admissions';
import type { InterviewCriterion } from '@shared/schemas/settings';
import { Button, DataLine, StatusBadge } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { averageScore, criteriaFor, criterionLabel } from '../utils';
import { ScoreBar } from './bits';

/** "HH:MM" + minutes, capped at 23:59 (as the schedule does). */
function addMinutes(time: string, minutes: number): string {
  const total = Math.min(timeToMinutes(time) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Has the interview's start passed (so "didn't come" makes sense)? */
function hasStarted(scheduledAt: string): boolean {
  const { date, time } = splitDateTime(scheduledAt);
  const today = todayISO();
  return date < today || (date === today && time <= nowTime());
}

/**
 * One interview on the lead page: when, where, who, status; once done, the
 * scores, recommendation and notes. Actions follow the permission split:
 * recording/editing the assessment needs admissions.decide; editing a scheduled
 * interview and marking a no-show need admissions.write.
 */
export function InterviewItem({
  interview: iv,
  criteria,
  canWrite,
  canDecide,
  onAssess,
  onEdit,
  onNoShow,
  noShowPending,
}: {
  interview: Interview;
  criteria: InterviewCriterion[];
  canWrite: boolean;
  canDecide: boolean;
  onAssess: () => void;
  onEdit: () => void;
  onNoShow: () => void;
  noShowPending?: boolean;
}) {
  const { t, i18n } = useTranslation(['admissions', 'common']);
  const f = useFormat();
  const { date, time } = splitDateTime(iv.scheduledAt);
  const scheduled = iv.status === 'scheduled';
  const done = iv.status === 'done';
  const avg = averageScore(iv.scores ?? {});
  const rows = criteriaFor(criteria, iv.scores ?? {}).filter((c) => iv.scores?.[c.key] !== undefined);

  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {f.date(date, 'weekday')} · <span className="whitespace-nowrap tabular-nums">{f.timeRange(time, addMinutes(time, iv.durationMinutes))}</span>
          </p>
          {(iv.room || iv.interviewerName) && (
            <DataLine parts={[iv.room, iv.interviewerName && t('interview.with', { name: iv.interviewerName })]} className="mt-0.5 text-sm text-muted" />
          )}
        </div>
        <StatusBadge group="interviewStatus" value={iv.status} className="shrink-0" />
      </div>

      {done && (
        <div className="mt-2.5 grid gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            {avg !== null && (
              <span className="font-semibold text-ink tabular-nums">
                {t('assessment.average', { value: f.number(avg, { maximumFractionDigits: 1 }), max: INTERVIEW_SCORE_MAX })}
              </span>
            )}
            {iv.recommendation && (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-muted">{t('timeline.recommendation')}</span>
                <StatusBadge group="interviewRecommendation" value={iv.recommendation} />
              </span>
            )}
            {(iv.recommendedLevel || iv.recommendedCourseName) && (
              <DataLine
                parts={[iv.recommendedLevel && t(`common:enums.courseLevel.${iv.recommendedLevel}`), iv.recommendedCourseName]}
                className="text-muted"
              />
            )}
          </div>
          {(rows.length > 0 || iv.strengths || iv.areasToWork || iv.notes) && (
            <details className="group rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-ink marker:text-muted">{t('assessment.details')}</summary>
              {rows.length > 0 && (
                <dl className="mt-2 grid gap-1.5">
                  {rows.map((c) => {
                    const label = c.removed ? c.key : criterionLabel(c, i18n.language);
                    const score = iv.scores[c.key]!;
                    return (
                      <div key={c.key} className="flex items-center justify-between gap-3">
                        <dt className="min-w-0 truncate text-ink/80">{label}</dt>
                        <dd className="flex shrink-0 items-center gap-2">
                          <ScoreBar value={score} label={t('assessment.scoreOf', { value: score, max: INTERVIEW_SCORE_MAX })} />
                          <span className="w-3 text-end text-xs font-semibold tabular-nums text-ink">{score}</span>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
              <NoteBlock label={t('fields.strengths')} text={iv.strengths} />
              <NoteBlock label={t('fields.areasToWork')} text={iv.areasToWork} />
              <NoteBlock label={t('fields.notes')} text={iv.notes} />
              {iv.recordedByName && iv.recordedAt && (
                <p className="mt-2 text-xs text-muted">{t('assessment.recordedBy', { name: iv.recordedByName, when: f.timestamp(iv.recordedAt) })}</p>
              )}
            </details>
          )}
        </div>
      )}

      {!done && iv.notes && (
        <p dir="auto" className="mt-1.5 text-start text-sm whitespace-pre-line break-words text-ink/80">
          {iv.notes}
        </p>
      )}

      {((scheduled && (canDecide || canWrite)) || (done && canDecide)) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canDecide && (scheduled || done) && (
            <Button size="sm" variant={scheduled ? 'primary' : 'secondary'} icon={ClipboardPen} onClick={onAssess}>
              {t(done ? 'assessment.editTitle' : 'assessment.record')}
            </Button>
          )}
          {scheduled && canWrite && (
            <Button size="sm" icon={Pencil} onClick={onEdit}>
              {t('interview.edit')}
            </Button>
          )}
          {scheduled && canWrite && hasStarted(iv.scheduledAt) && (
            <Button size="sm" variant="ghost" icon={UserX} onClick={onNoShow} loading={noShowPending}>
              {t('interview.noShow')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function NoteBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p dir="auto" className="mt-0.5 text-start whitespace-pre-line break-words text-ink">
        {text}
      </p>
    </div>
  );
}
