import { GraduationCap, Info, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SiteWorkshop } from '@shared/schemas/site';
import { Avatar, Badge, ButtonLink, EmptyState, ErrorState, PageHeader, PageLoader, useToast } from '@web/components/ui';
import { errorMessageKey } from '@web/lib/forms';
import { useOrderSiteWorkshops, useSaveSiteWorkshop, useSiteWorkshops } from './api';
import { BigSwitch } from './components/BigSwitch';
import { MoveButtons } from './components/MoveButtons';
import { WorkshopFacts } from './components/WorkshopFacts';
import { moveItem, workshopTitle } from './utils';

/**
 * /website/workshops — every active or upcoming workshop with a big "Show on
 * website" switch, what visitors will see about it, and its place in the order.
 */
export default function WorkshopsPage() {
  const { t } = useTranslation(['website', 'common']);
  const toast = useToast();
  const workshops = useSiteWorkshops();
  const order = useOrderSiteWorkshops();
  const items = workshops.data?.items ?? [];

  const move = (index: number, delta: -1 | 1) =>
    order.mutate(
      moveItem(items, index, delta).map((w) => w.courseId),
      { onError: (err) => toast.error(t(errorMessageKey(err))) },
    );

  return (
    <div>
      <PageHeader title={t('workshops.title')} subtitle={t('workshops.subtitle')} />
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-info-soft px-3.5 py-3 text-sm text-info">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('workshops.noFees')}
      </p>
      {workshops.isPending ? (
        <PageLoader />
      ) : workshops.isError ? (
        <ErrorState error={workshops.error} onRetry={() => void workshops.refetch()} />
      ) : !items.length ? (
        <EmptyState
          icon={GraduationCap}
          title={t('workshops.empty')}
          description={t('workshops.emptyHint')}
          className="rounded-2xl border border-dashed border-line-strong"
        />
      ) : (
        <ol className="grid gap-3">
          {items.map((w, i) => (
            <WorkshopRow key={w.courseId} workshop={w} index={i} count={items.length} onMove={(d) => move(i, d)} moving={order.isPending} />
          ))}
        </ol>
      )}
    </div>
  );
}

function WorkshopRow({ workshop: w, index, count, onMove, moving }: { workshop: SiteWorkshop; index: number; count: number; onMove: (d: -1 | 1) => void; moving: boolean }) {
  const { t, i18n } = useTranslation(['website', 'common']);
  const toast = useToast();
  const save = useSaveSiteWorkshop();
  const [pending, setPending] = useState<boolean | null>(null);
  const title = workshopTitle(w, i18n.language);
  const visible = pending ?? w.visible;
  const to = `/website/workshops/${w.courseId}`;

  const toggle = (on: boolean) => {
    setPending(on);
    save.mutate(
      { courseId: w.courseId, data: { visible: on } },
      {
        onSuccess: () => toast.success(t(on ? 'workshops.shownToast' : 'workshops.hiddenToast')),
        onError: (err) => toast.error(t(errorMessageKey(err))),
        onSettled: () => setPending(null),
      },
    );
  };

  return (
    <li className="grid gap-3 rounded-2xl border border-line bg-surface p-3 sm:p-4">
      <Link to={to} className="-m-1 flex min-w-0 items-start gap-3 rounded-xl p-1 hover:bg-surface-2">
        <Avatar name={title} fileId={w.coverFileId} size="lg" shape="rounded" />
        <span className="min-w-0 flex-1">
          <bdi className="block font-semibold text-ink">{title}</bdi>
          {title !== w.courseName && <bdi className="block truncate text-xs text-muted">{w.courseName}</bdi>}
          <WorkshopFacts workshop={w} className="mt-1.5 grid gap-1 text-sm text-muted" />
          {visible && (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {w.acceptingApplications ? <Badge tone="success">{t('workshops.taking')}</Badge> : <Badge>{t('workshops.notTaking')}</Badge>}
            </span>
          )}
        </span>
      </Link>
      <BigSwitch checked={visible} onChange={toggle} disabled={save.isPending} label={
          <>
            {t('workshops.show')}
            <span className="sr-only">: {title}</span>
          </>
        }
      />
      <div className="grid gap-2 sm:flex sm:items-center sm:justify-between">
        <ButtonLink to={to} size="lg" icon={Pencil}>
          {t('workshops.edit')}
        </ButtonLink>
        <MoveButtons name={title} index={index} count={count} onMove={onMove} disabled={moving} />
      </div>
    </li>
  );
}
