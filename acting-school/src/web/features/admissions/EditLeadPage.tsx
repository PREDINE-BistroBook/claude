import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ErrorState, PageHeader, PageLoader } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { fullName } from '@web/lib/format';
import { useLead } from './api';
import { LeadForm } from './components/LeadForm';

export default function EditLeadPage() {
  const { t } = useTranslation('admissions');
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const lead = useLead(id, valid);

  let body;
  if (!valid) body = <ErrorState error={new ApiError(404, 'not_found', 'Not found')} />;
  else if (lead.isPending) body = <PageLoader />;
  else if (lead.isError) body = <ErrorState error={lead.error} onRetry={() => void lead.refetch()} />;
  else body = <LeadForm key={lead.data.id} lead={lead.data} />;

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('editLead')} subtitle={lead.data ? fullName(lead.data) : undefined} back={valid ? `/admissions/${id}` : '/admissions'} />
      </div>
      {body}
    </div>
  );
}
