import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@web/components/ui';

export default function SchedulePage() {
  const { t } = useTranslation('schedule');
  return <ComingSoon title={t('title')} />;
}
