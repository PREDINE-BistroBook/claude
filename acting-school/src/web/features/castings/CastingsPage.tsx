import { useTranslation } from 'react-i18next';
import { ComingSoon } from '@web/components/ui';

export default function CastingsPage() {
  const { t } = useTranslation('castings');
  return <ComingSoon title={t('title')} />;
}
