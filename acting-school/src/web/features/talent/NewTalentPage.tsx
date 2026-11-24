import { useQuery } from '@tanstack/react-query';
import { Info, Star, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { StudentDetail } from '@shared/schemas/students';
import { Avatar, ButtonLink, EmptyState, PageHeader, PageLoader } from '@web/components/ui';
import { api } from '@web/lib/api';
import { fullName } from '@web/lib/format';
import { TalentForm } from './components/TalentForm';

/** /talent/new, or /talent/new?studentId=ID to start from a student record. */
export default function NewTalentPage() {
  const { t } = useTranslation(['talent', 'common']);
  const [params] = useSearchParams();
  const raw = params.get('studentId');
  const studentId = raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;

  const student = useQuery({
    queryKey: ['students', studentId],
    queryFn: () => api.get<StudentDetail>(`/students/${studentId}`),
    enabled: studentId !== null,
  });

  let body;
  if (studentId === null) body = <TalentForm key="blank" />;
  else if (student.isPending) body = <PageLoader />;
  else if (student.isError)
    body = (
      <EmptyState
        icon={TriangleAlert}
        title={t('form.studentLoadFailed')}
        className="mx-auto max-w-3xl rounded-2xl border border-dashed border-line-strong"
        action={
          <ButtonLink to="/talent/new" replace>
            {t('form.startBlank')}
          </ButtonLink>
        }
      />
    );
  else if (student.data.talentId !== null)
    body = (
      <EmptyState
        icon={Star}
        title={t('form.alreadyTalent', { name: fullName(student.data) })}
        className="mx-auto max-w-3xl rounded-2xl border border-dashed border-line-strong"
        action={
          <ButtonLink to={`/talent/${student.data.talentId}`} variant="primary">
            {t('form.viewProfile')}
          </ButtonLink>
        }
      />
    );
  else {
    const s = student.data;
    body = (
      <>
        <div className="mx-auto mb-4 flex max-w-3xl items-start gap-3 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info sm:mb-5" role="note">
          {s.photoFileId ? (
            <Avatar name={fullName(s)} fileId={s.photoFileId} size="md" />
          ) : (
            <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="font-semibold">{t('form.fromStudent', { name: fullName(s) })}</p>
            <p className="mt-0.5 text-ink/80">
              {t('form.fromStudentHint')} {s.photoFileId && t('form.fromStudentPhoto')}
            </p>
          </div>
        </div>
        <TalentForm key={`student-${s.id}`} student={s} />
      </>
    );
  }

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('newTalent')} back="/talent" />
      </div>
      {body}
    </div>
  );
}
