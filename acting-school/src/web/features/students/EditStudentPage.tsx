import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ErrorState, PageHeader, PageLoader } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { fullName } from '@web/lib/format';
import { useStudent } from './api';
import { StudentForm } from './components/StudentForm';

export default function EditStudentPage() {
  const { t } = useTranslation('students');
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const student = useStudent(id, valid);

  let body;
  if (!valid) body = <ErrorState error={new ApiError(404, 'not_found', 'Not found')} />;
  else if (student.isPending) body = <PageLoader />;
  else if (student.isError) body = <ErrorState error={student.error} onRetry={() => void student.refetch()} />;
  else body = <StudentForm key={student.data.id} student={student.data} />;

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={t('editStudent')}
          subtitle={student.data ? fullName(student.data) : undefined}
          back={valid ? `/students/${id}` : '/students'}
        />
      </div>
      {body}
    </div>
  );
}
