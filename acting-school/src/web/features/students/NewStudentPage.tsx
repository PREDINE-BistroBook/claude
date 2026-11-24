import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@web/components/ui';
import { StudentForm } from './components/StudentForm';

/** /students/new — or /students/new?courseId=ID from a workshop's "Add student" (the student is enrolled there once saved). */
export default function NewStudentPage() {
  const { t } = useTranslation('students');
  const courseId = useSearchParams()[0].get('courseId');
  const back = courseId && /^\d+$/.test(courseId) ? `/classes/${courseId}` : '/students';
  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('newStudent')} back={back} />
      </div>
      <StudentForm />
    </div>
  );
}
