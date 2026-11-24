import { useTranslation } from 'react-i18next';
import { PageHeader } from '@web/components/ui';
import { CastingForm } from './components/CastingForm';

export default function NewCastingPage() {
  const { t } = useTranslation('castings');
  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('newCasting')} back="/castings" />
      </div>
      <CastingForm />
    </div>
  );
}
