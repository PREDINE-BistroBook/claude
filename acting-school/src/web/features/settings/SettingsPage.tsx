import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@web/components/ui';

export default function SettingsPage() {
  const { t } = useTranslation('settings');
  return <ComingSoon title={t('title')} />;
}
