import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@web/components/ui';

export default function ClassesPage() {
  const { t } = useTranslation('classes');
  return <ComingSoon title={t('title')} />;
}
