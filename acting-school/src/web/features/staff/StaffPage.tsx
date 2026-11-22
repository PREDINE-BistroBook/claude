import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@web/components/ui';

export default function StaffPage() {
  const { t } = useTranslation('staff');
  return <ComingSoon title={t('title')} />;
}
