import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { todayISO } from '@shared/dates';
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  DescriptionList,
  ErrorState,
  PageHeader,
  PageLoader,
  PhotoViewer,
  StatusBadge,
  useToast,
} from '@web/components/ui';
import { fileUrl } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { errorMessageKey } from '@web/lib/forms';
import { useFormat } from '@web/lib/format';
import { useDeleteOpportunity, useOpportunity } from './api';
import { DeadlineLine, MinorsChip, MoneyFlag, OpportunityActions } from './components/OpportunityParts';
import { addedByArgs } from './utils';

/** /casting/opportunities/:id — everything about one opportunity: the warnings, the facts, the screenshots, and its buttons. */
export default function OpportunityPage() {
  const { t } = useTranslation(['opportunities', 'common']);
  const id = Number(useParams().id);
  const opportunity = useOpportunity(id);
  const { can } = useAuth();
  const f = useFormat();
  const toast = useToast();
  const navigate = useNavigate();
  const del = useDeleteOpportunity(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  if (opportunity.isPending) return <PageLoader />;
  if (opportunity.isError) return <ErrorState error={opportunity.error} onRetry={() => void opportunity.refetch()} />;
  const o = opportunity.data;
  const canWrite = can('castings.write');
  const back = o.status === 'new' ? '/casting/opportunities' : `/casting/opportunities?status=${o.status}`;

  const remove = () =>
    del.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('toast.deleted'));
        navigate(back, { replace: true });
      },
      onError: (err) => {
        setConfirmDelete(false);
        toast.error(t(errorMessageKey(err)));
      },
    });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={back}
        title={<bdi>{o.title}</bdi>}
        documentTitle={o.title}
        subtitle={<StatusBadge group="opportunityStatus" value={o.status} />}
        actions={
          canWrite && (
            <>
              <ButtonLink to={`/casting/opportunities/${o.id}/edit`} size="lg" icon={Pencil}>
                {t('actions.edit')}
              </ButtonLink>
              <Button size="lg" variant="danger-ghost" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                {t('actions.delete')}
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4">
        {o.asksForPayment && <MoneyFlag withHint />}
        <Card>
          <div className="mb-4 grid gap-2">
            <DeadlineLine deadline={o.deadline} today={todayISO()} />
            {o.involvesMinors && (
              <span>
                <MinorsChip />
              </span>
            )}
          </div>
          <DescriptionList
            hideEmpty
            items={[
              { label: t('detail.type'), value: o.projectType ? t(`common:enums.opportunityProjectType.${o.projectType}`) : null },
              { label: t('card.roles'), value: o.roles ? <bdi className="whitespace-pre-line">{o.roles}</bdi> : null },
              { label: t('detail.location'), value: o.location ? <bdi>{o.location}</bdi> : null },
              { label: t('detail.contact'), value: o.contact ? <bdi className="break-words">{o.contact}</bdi> : null },
              { label: t('form.source'), value: o.source ? <bdi>{o.source}</bdi> : null },
              {
                label: t('detail.details'),
                value: o.details ? (
                  <p dir="auto" className="text-start whitespace-pre-line break-words">
                    {o.details}
                  </p>
                ) : null,
              },
            ]}
          />
          {o.createdBy && (
            <p className="mt-4 text-xs text-muted">
              {t('card.addedBy', addedByArgs(o.createdBy.name, f.timestamp(o.createdAt)))}
            </p>
          )}
        </Card>

        <Card title={t('detail.screenshots')}>
          {o.files.length ? (
            <ul className="grid grid-cols-3 gap-2">
              {o.files.map((file, i) => (
                <li key={file.id}>
                  <button type="button" onClick={() => setViewing(i)} className="block w-full overflow-hidden rounded-xl border border-line">
                    <img src={fileUrl(file.fileId)} alt={t('form.screenshotAlt', { n: i + 1 })} loading="lazy" className="aspect-square w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t('detail.noScreenshots')}</p>
          )}
        </Card>

        <OpportunityActions opportunity={o} place="detail" />
      </div>

      <PhotoViewer photos={o.files.map((file, i) => ({ fileId: file.fileId, caption: t('form.screenshotAlt', { n: i + 1 }) }))} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={confirmDelete}
        title={t('confirmDelete.title')}
        message={t('confirmDelete.message', { title: o.title })}
        confirmLabel={t('confirmDelete.yes')}
        loading={del.isPending}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
