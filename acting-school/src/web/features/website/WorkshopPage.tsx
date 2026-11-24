import { Eye, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { todayISO } from '@shared/dates';
import { siteWorkshopInput, type SiteWorkshop } from '@shared/schemas/site';
import { Button, ButtonLink, ErrorState, Field, FormActions, FormError, FormPage, FormSection, PageHeader, PageLoader, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useForm } from '@web/lib/forms';
import { useSaveSiteWorkshop, useSiteWorkshop } from './api';
import { BigSwitch } from './components/BigSwitch';
import { BackLink } from './components/BackLink';
import { BilingualField } from './components/BilingualField';
import { CoverPhotoInput } from './components/CoverPhotoInput';
import { WorkshopFacts } from './components/WorkshopFacts';
import { workshopTitle } from './utils';

/** /website/workshops/:courseId — how one workshop appears on the website. */
export default function WorkshopPage() {
  const { t } = useTranslation(['website', 'common']);
  const courseId = Number(useParams().courseId);
  const valid = Number.isInteger(courseId) && courseId > 0;
  const query = useSiteWorkshop(courseId, valid);
  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <BackLink to="/website/workshops">{t('workshops.title')}</BackLink>
        <PageHeader title={t('workshops.editTitle')} subtitle={query.data ? <bdi>{query.data.courseName}</bdi> : undefined} />
      </div>
      {!valid || query.isError ? (
        <ErrorState error={valid ? query.error : new ApiError(404, 'not_found', 'Not found')} onRetry={valid ? () => void query.refetch() : undefined} />
      ) : query.isPending ? (
        <PageLoader />
      ) : (
        <WorkshopForm key={query.data.courseId} workshop={query.data} />
      )}
    </div>
  );
}

interface WorkshopValues extends Record<string, unknown> {
  visible: boolean;
  acceptingApplications: boolean;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  coverFileId: string | null;
}

function WorkshopForm({ workshop: w }: { workshop: SiteWorkshop }) {
  const { t, i18n } = useTranslation(['website', 'common']);
  const toast = useToast();
  const navigate = useNavigate();
  const save = useSaveSiteWorkshop();
  const form = useForm<WorkshopValues>({
    visible: w.visible,
    acceptingApplications: w.acceptingApplications,
    titleEn: w.titleEn,
    titleAr: w.titleAr,
    descriptionEn: w.descriptionEn,
    descriptionAr: w.descriptionAr,
    coverFileId: w.coverFileId,
  });
  const v = form.values;
  // The site shows a workshop only while its course is active and not over: the switch can't bring back an ended one.
  const canAppear = w.onSite || (w.courseStatus === 'active' && w.endDate >= todayISO());

  const submit = () => {
    const data = form.validate(siteWorkshopInput, v);
    if (!data) return;
    save.mutate(
      { courseId: w.courseId, data },
      {
        onSuccess: () => {
          toast.success(t('workshops.saved'));
          navigate('/website/workshops');
        },
        onError: form.setServerError,
      },
    );
  };

  const pair = (field: 'title' | 'description') => ({
    value: { en: v[`${field}En` as const], ar: v[`${field}Ar` as const] },
    onChange: (half: 'en' | 'ar', text: string) => form.set(half === 'en' ? (`${field}En` as const) : (`${field}Ar` as const), text),
    errors: { en: form.error(`${field}En`), ar: form.error(`${field}Ar`) },
    idPrefix: `f-${field}`,
  });

  return (
    <FormPage onSubmit={submit}>
      <FormError messageKey={form.formError} />

      <section className="rounded-2xl border border-line bg-surface-2 p-4 sm:p-5" aria-labelledby="ws-preview">
        <h2 id="ws-preview" className="flex items-center gap-2 text-sm font-semibold text-muted">
          <Eye className="size-4" aria-hidden />
          {t('workshops.preview')}
        </h2>
        <p className="mt-2 text-lg font-semibold text-ink">
          <bdi>{workshopTitle({ titleEn: v.titleEn, titleAr: v.titleAr, courseName: w.courseName }, i18n.language)}</bdi>
        </p>
        <WorkshopFacts workshop={w} className="mt-2 grid gap-1.5 text-sm text-ink/80" />
        <p className="mt-3 text-xs text-muted">{t('workshops.noFees')}</p>
      </section>

      {!canAppear && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('workshops.notOnSite')}
        </p>
      )}

      <FormSection title={t('workshops.onWebsite')}>
        <BigSwitch checked={v.visible} onChange={(on) => form.set('visible', on)} label={t('workshops.show')} />
        <BigSwitch
          checked={v.acceptingApplications}
          onChange={(on) => form.set('acceptingApplications', on)}
          label={t('workshops.accepting')}
          description={t('workshops.acceptingHint')}
        />
      </FormSection>

      <FormSection title={t('workshops.publicTexts')} description={t('workshops.publicTextsHint')}>
        <BilingualField
          label={t('workshops.publicTitle')}
          hint={t('workshops.publicTitleHint')}
          maxLength={120}
          placeholder={{ en: w.courseName, ar: w.courseName }}
          {...pair('title')}
        />
        <BilingualField label={t('workshops.description')} hint={t('workshops.descriptionHint')} multiline rows={6} maxLength={4000} {...pair('description')} />
      </FormSection>

      <FormSection title={t('workshops.cover')} description={t('workshops.coverHint')}>
        <Field error={form.error('coverFileId')}>
          <CoverPhotoInput value={v.coverFileId} onChange={(id) => form.set('coverFileId', id)} alt={t('workshops.cover')} />
        </Field>
      </FormSection>

      <FormActions>
        <ButtonLink to="/website/workshops" variant="ghost" size="lg">
          {t('common:actions.cancel')}
        </ButtonLink>
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          {save.isPending ? t('common:actions.saving') : t('common:actions.saveChanges')}
        </Button>
      </FormActions>
    </FormPage>
  );
}
