import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@web/components/ui';

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  return <ComingSoon title={t('title')} />;
}
