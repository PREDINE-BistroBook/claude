import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COURSE_LEVELS, INTERVIEW_RECOMMENDATIONS, INTERVIEW_SCORE_MAX, type InterviewRecommendation } from '@shared/enums';
import { interviewUpdateInput, type AdmissionsCourseOption, type Interview, type LeadDetail } from '@shared/schemas/admissions';
import type { InterviewCriterion } from '@shared/schemas/settings';
import { Button, EnumSelect, Field, FormError, FormGrid, Modal, Segmented, TextAreaField, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useFormat } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { admissionsErrorKey, useUpdateInterview } from '../api';
import { averageScore, criteriaFor, criterionLabel } from '../utils';
import { CourseSelect, ScoreControl } from './bits';

interface Props {
  open: boolean;
  onClose: () => void;
  lead: LeadDetail;
  interview: Interview;
  criteria: InterviewCriterion[];
  courses: AdmissionsCourseOption[];
  coursesLoading?: boolean;
}

/**
 * Record (or edit) an interview's assessment: a 1–5 score per criterion from
 * settings, strengths, areas to work on, notes, recommendation, level and class.
 * Saving records the interview as done. Mounted only while open.
 */
export function AssessmentModal(props: Props) {
  return props.open ? <AssessmentDialog {...props} /> : null;
}

type RecommendationChoice = InterviewRecommendation | '';

function AssessmentDialog({ onClose, lead, interview, criteria, courses, coursesLoading }: Props) {
  const { t, i18n } = useTranslation(['admissions', 'common']);
  const f = useFormat();
  const toast = useToast();
  const update = useUpdateInterview(lead.id);
  const [scores, setScores] = useState<Record<string, number>>(interview.scores ?? {});
  const form = useForm({
    strengths: interview.strengths ?? '',
    areasToWork: interview.areasToWork ?? '',
    notes: interview.notes ?? '',
    recommendation: (interview.recommendation ?? '') as RecommendationChoice,
    recommendedLevel: interview.recommendedLevel ?? '',
    recommendedCourseId: interview.recommendedCourseId ? String(interview.recommendedCourseId) : '',
  });
  const v = form.values;
  const rows = criteriaFor(criteria, interview.scores ?? {});
  const avg = averageScore(scores);
  const wasDone = interview.status === 'done';

  const setScore = (key: string, value: number | undefined) =>
    setScores((s) => {
      const next = { ...s };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  const submit = () => {
    const data = form.validate(interviewUpdateInput, { status: 'done', scores, ...v });
    if (!data) return;
    update.mutate(
      { interviewId: interview.id, data },
      {
        onSuccess: () => {
          toast.success(t(wasDone ? 'assessment.updated' : 'assessment.saved'));
          onClose();
        },
        onError: (err) => {
          if (err instanceof ApiError && err.issues?.length) {
            form.setServerError(err);
            const scoreIssue = err.issues.find((i) => i.path[0] === 'scores');
            if (scoreIssue) form.setFormError(scoreIssue.message);
          } else form.setFormError(admissionsErrorKey(err));
        },
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t(wasDone ? 'assessment.editTitle' : 'assessment.title')}
      description={t('assessment.subtitle', { when: f.dateTime(interview.scheduledAt) })}
      footer={
        <>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" form="assessment-form" variant="primary" loading={update.isPending}>
            {t(wasDone ? 'common:actions.saveChanges' : 'assessment.save')}
          </Button>
        </>
      }
    >
      <form
        id="assessment-form"
        noValidate
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError messageKey={form.formError} />

        <section aria-labelledby="scores-heading">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 id="scores-heading" className="text-sm font-semibold text-ink">
              {t('assessment.scores')}
            </h3>
            <span className="text-sm text-muted tabular-nums" aria-live="polite">
              {avg === null ? t('assessment.noScores') : t('assessment.average', { value: f.number(avg, { maximumFractionDigits: 1 }), max: INTERVIEW_SCORE_MAX })}
            </span>
          </div>
          {rows.length ? (
            <ul className="grid gap-3">
              {rows.map((c) => {
                const id = `criterion-${c.key}`;
                return (
                  <li key={c.key} className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center sm:gap-4">
                    <span id={id} className="text-sm text-ink">
                      {c.removed ? (
                        <>
                          <span dir="ltr" className="font-mono text-xs">
                            {c.key}
                          </span>{' '}
                          <span className="text-xs text-muted">({t('assessment.removedCriterion')})</span>
                        </>
                      ) : (
                        criterionLabel(c, i18n.language)
                      )}
                    </span>
                    <ScoreControl label={criterionLabel(c, i18n.language)} labelledBy={id} value={scores[c.key]} onChange={(n) => setScore(c.key, n)} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t('assessment.noCriteria')}</p>
          )}
          <p className="mt-2 text-xs text-muted">{t('assessment.scaleHint')}</p>
        </section>

        <TextAreaField label={t('fields.strengths')} optional rows={3} dir="auto" {...form.bind('strengths')} error={form.error('strengths')} />
        <TextAreaField label={t('fields.areasToWork')} optional rows={3} dir="auto" {...form.bind('areasToWork')} error={form.error('areasToWork')} />
        <TextAreaField label={t('fields.notes')} optional rows={2} dir="auto" {...form.bind('notes')} error={form.error('notes')} />

        <Field label={t('fields.recommendation')} error={form.error('recommendation')}>
          <Segmented<RecommendationChoice>
            label={t('fields.recommendation')}
            value={v.recommendation}
            onChange={(r) => form.set('recommendation', r)}
            options={[
              { value: '', label: t('assessment.notYet') },
              ...INTERVIEW_RECOMMENDATIONS.map((r) => ({ value: r, label: t(`common:enums.interviewRecommendation.${r}`) })),
            ]}
            className="w-full *:flex-1"
          />
        </Field>

        <FormGrid>
          <Field label={t('fields.recommendedLevel')} htmlFor="f-recommendedLevel" optional error={form.error('recommendedLevel')}>
            <EnumSelect group="courseLevel" values={COURSE_LEVELS} allowEmpty {...form.bind('recommendedLevel')} />
          </Field>
          <CourseSelect
            label={t('fields.recommendedCourse')}
            emptyLabel={t('form.noPreference')}
            optional
            options={courses}
            loading={coursesLoading}
            current={interview.recommendedCourseId ? { id: interview.recommendedCourseId, name: interview.recommendedCourseName ?? `#${interview.recommendedCourseId}` } : null}
            hint={t('assessment.courseHint')}
            {...form.bind('recommendedCourseId')}
            error={form.error('recommendedCourseId')}
          />
        </FormGrid>
      </form>
    </Modal>
  );
}
