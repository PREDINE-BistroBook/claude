import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ErrorState, PageHeader, PageLoader } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useCasting } from './api';
import { CastingForm } from './components/CastingForm';

export default function EditCastingPage() {
  const { t } = useTranslation('castings');
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const casting = useCasting(id, valid);

  let body;
  if (!valid) body = <ErrorState error={new ApiError(404, 'not_found', 'Not found')} />;
  else if (casting.isPending) body = <PageLoader />;
  else if (casting.isError) body = <ErrorState error={casting.error} onRetry={() => void casting.refetch()} />;
  else body = <CastingForm key={casting.data.id} casting={casting.data} />;

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={t('editCasting')}
          subtitle={casting.data ? <bdi>{casting.data.title}</bdi> : undefined}
          documentTitle={t('editCasting')}
          back={valid ? `/castings/${id}` : '/castings'}
        />
      </div>
      {body}
    </div>
  );
}
