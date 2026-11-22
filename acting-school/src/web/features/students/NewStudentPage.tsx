import { useTranslation } from 'react-i18next';
import { PageHeader } from '@web/components/ui';
import { StudentForm } from './components/StudentForm';

export default function NewStudentPage() {
  const { t } = useTranslation('students');
  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('newStudent')} back="/students" />
      </div>
      <StudentForm />
    </div>
  );
}
