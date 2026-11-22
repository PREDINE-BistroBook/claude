import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@web/components/ui';

export default function StudentsPage() {
  const { t } = useTranslation('students');
  return <ComingSoon title={t('title')} />;
}
