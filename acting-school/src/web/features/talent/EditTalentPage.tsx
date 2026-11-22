import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ErrorState, PageHeader, PageLoader } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { displayName } from '@web/lib/format';
import { useTalent } from './api';
import { TalentForm } from './components/TalentForm';

export default function EditTalentPage() {
  const { t } = useTranslation(['talent', 'common']);
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const query = useTalent(id, valid);

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={t('editTalent')}
          back={valid ? `/talent/${id}` : '/talent'}
          subtitle={query.data ? <span dir="auto">{displayName(query.data)}</span> : undefined}
        />
      </div>
      {!valid || query.isError ? (
        <ErrorState error={valid ? query.error : new ApiError(404, 'not_found', 'Not found')} onRetry={valid ? () => void query.refetch() : undefined} />
      ) : query.isPending ? (
        <PageLoader />
      ) : (
        // Re-mount when another profile loads so the form starts from its values.
        <TalentForm key={query.data.id} talent={query.data} />
      )}
    </div>
  );
}
