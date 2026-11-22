import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@web/components/ui';

export default function TalentPage() {
  const { t } = useTranslation('talent');
  return <ComingSoon title={t('title')} />;
}
