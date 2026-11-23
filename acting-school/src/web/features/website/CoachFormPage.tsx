import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { siteCoachInput, type SiteCoach } from '@shared/schemas/site';
import {
  Button,
  ButtonLink,
  ConfirmDialog,
  ErrorState,
  Field,
  FormActions,
  FormError,
  FormPage,
  FormSection,
  PageHeader,
  PageLoader,
  PhotoInput,
  useToast,
} from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { errorMessageKey, useForm } from '@web/lib/forms';
import { TeacherSelect } from '../classes/components/TeacherSelect';
import { useDeleteSiteCoach, useSaveSiteCoach, useSiteCoach } from './api';
import { BigSwitch } from './components/BigSwitch';
import { BilingualField } from './components/BilingualField';
import { coachName } from './utils';

/** /website/coaches/new and /website/coaches/:id — one coach on the website. */
export default function CoachFormPage() {
  const { t, i18n } = useTranslation(['website', 'common']);
  const param = useParams().id;
  const isNew = param === undefined;
  const id = Number(param);
  const valid = isNew || (Number.isInteger(id) && id > 0);
  const [deleted, setDeleted] = useState(false);
  const query = useSiteCoach(id, !isNew && valid && !deleted);

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={isNew ? t('coaches.newTitle') : t('coaches.editTitle')}
          back="/website/coaches"
          subtitle={query.data ? <bdi>{coachName(query.data, i18n.language)}</bdi> : undefined}
        />
      </div>
      {!valid || query.isError ? (
        <ErrorState error={valid ? query.error : new ApiError(404, 'not_found', 'Not found')} onRetry={valid ? () => void query.refetch() : undefined} />
      ) : !isNew && query.isPending ? (
        <PageLoader />
      ) : (
        <CoachForm key={query.data?.id ?? 'new'} coach={query.data} onDeleted={() => setDeleted(true)} />
      )}
    </div>
  );
}

interface CoachValues extends Record<string, unknown> {
  nameEn: string;
  nameAr: string;
  titleEn: string;
  titleAr: string;
  bioEn: string;
  bioAr: string;
  photoFileId: string | null;
  visible: boolean;
  userId: string;
}

function CoachForm({ coach, onDeleted }: { coach?: SiteCoach; onDeleted: () => void }) {
  const { t, i18n } = useTranslation(['website', 'common']);
  const toast = useToast();
  const navigate = useNavigate();
  const save = useSaveSiteCoach(coach?.id);
  const del = useDeleteSiteCoach(coach?.id ?? 0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const form = useForm<CoachValues>({
    nameEn: coach?.nameEn ?? '',
    nameAr: coach?.nameAr ?? '',
    titleEn: coach?.titleEn ?? '',
    titleAr: coach?.titleAr ?? '',
    bioEn: coach?.bioEn ?? '',
    bioAr: coach?.bioAr ?? '',
    photoFileId: coach?.photoFileId ?? null,
    visible: coach?.visible ?? true,
    userId: coach?.userId ? String(coach.userId) : '',
  });
  const v = form.values;
  const name = coachName({ nameEn: v.nameEn, nameAr: v.nameAr }, i18n.language);

  const submit = () => {
    const data = form.validate(siteCoachInput, {
      nameEn: v.nameEn,
      nameAr: v.nameAr,
      titleEn: v.titleEn,
      titleAr: v.titleAr,
      bioEn: v.bioEn,
      bioAr: v.bioAr,
      photoFileId: v.photoFileId,
      visible: v.visible,
      userId: v.userId ? Number(v.userId) : null,
    });
    if (!data) return;
    save.mutate(data, {
      onSuccess: () => {
        toast.success(t('coaches.saved'));
        navigate('/website/coaches');
      },
      onError: form.setServerError,
    });
  };

  const onDelete = () =>
    del.mutate(undefined, {
      onSuccess: () => {
        onDeleted();
        toast.success(t('coaches.deleted'));
        navigate('/website/coaches', { replace: true });
      },
      onError: (err) => {
        setConfirmOpen(false);
        toast.error(t(errorMessageKey(err)));
      },
    });

  const pair = (field: 'name' | 'title' | 'bio') => ({
    value: { en: v[`${field}En` as const], ar: v[`${field}Ar` as const] },
    onChange: (half: 'en' | 'ar', text: string) => form.set(half === 'en' ? (`${field}En` as const) : (`${field}Ar` as const), text),
    errors: { en: form.error(`${field}En`), ar: form.error(`${field}Ar`) },
    idPrefix: `f-${field}`,
  });

  return (
    <FormPage onSubmit={submit}>
      <FormError messageKey={form.formError} />
      <FormSection title={t('coaches.details')}>
        <BilingualField label={t('coaches.name')} required maxLength={100} {...pair('name')} />
        <BilingualField label={t('coaches.jobTitle')} hint={t('coaches.jobTitleHint')} maxLength={100} {...pair('title')} />
        <BilingualField label={t('coaches.bio')} hint={t('coaches.bioHint')} multiline rows={5} maxLength={2000} {...pair('bio')} />
        <Field label={t('coaches.photo')} error={form.error('photoFileId')}>
          <PhotoInput value={v.photoFileId} onChange={(fileId) => form.set('photoFileId', fileId)} name={name} shape="rounded" />
        </Field>
      </FormSection>

      <FormSection>
        <BigSwitch checked={v.visible} onChange={(on) => form.set('visible', on)} label={t('coaches.show')} description={t('coaches.showHint')} />
        <TeacherSelect
          id="f-userId"
          label={t('coaches.staff')}
          hint={t('coaches.staffHint')}
          emptyLabel={t('coaches.staffNone')}
          optional
          current={coach?.userId ? { id: coach.userId, name: coach.userName } : null}
          {...form.bind('userId')}
          error={form.error('userId')}
        />
      </FormSection>

      <FormActions className="flex-wrap">
        {coach && (
          <Button variant="danger-ghost" size="lg" icon={Trash2} onClick={() => setConfirmOpen(true)} className="me-auto">
            {t('common:actions.delete')}
          </Button>
        )}
        <ButtonLink to="/website/coaches" variant="ghost" size="lg">
          {t('common:actions.cancel')}
        </ButtonLink>
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          {save.isPending ? t('common:actions.saving') : t('common:actions.save')}
        </Button>
      </FormActions>

      <ConfirmDialog
        open={confirmOpen}
        title={t('coaches.deleteTitle', { name })}
        message={t('coaches.deleteMessage')}
        loading={del.isPending}
        onConfirm={onDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </FormPage>
  );
}
