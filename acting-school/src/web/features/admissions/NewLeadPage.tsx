import { useTranslation } from 'react-i18next';
import { PageHeader } from '@web/components/ui';
import { LeadForm } from './components/LeadForm';

export default function NewLeadPage() {
  const { t } = useTranslation('admissions');
  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('newLead')} back="/admissions" />
      </div>
      <LeadForm />
    </div>
  );
}
