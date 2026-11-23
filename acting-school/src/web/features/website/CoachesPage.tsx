import { ChevronRight, Plus, Presentation } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Avatar, Badge, ButtonLink, EmptyState, ErrorState, PageHeader, PageLoader, useToast } from '@web/components/ui';
import { errorMessageKey } from '@web/lib/forms';
import { useOrderSiteCoaches, useSiteCoaches } from './api';
import { MoveButtons } from './components/MoveButtons';
import { coachName, coachTitle, moveItem } from './utils';

/** /website/coaches — the coaches on the website, in their order, with "Move up" / "Move down". */
export default function CoachesPage() {
  const { t, i18n } = useTranslation(['website', 'common']);
  const toast = useToast();
  const coaches = useSiteCoaches();
  const order = useOrderSiteCoaches();
  const items = coaches.data?.items ?? [];

  const move = (index: number, delta: -1 | 1) => {
    const ids = moveItem(items, index, delta).map((c) => c.id);
    order.mutate(ids, { onError: (err) => toast.error(t(errorMessageKey(err))) });
  };

  const add = (
    <ButtonLink to="/website/coaches/new" variant="primary" size="lg" icon={Plus}>
      {t('coaches.add')}
    </ButtonLink>
  );

  return (
    <div>
      <PageHeader title={t('coaches.title')} subtitle={t('coaches.subtitle')} actions={items.length > 0 ? add : undefined} />
      {coaches.isPending ? (
        <PageLoader />
      ) : coaches.isError ? (
        <ErrorState error={coaches.error} onRetry={() => void coaches.refetch()} />
      ) : !items.length ? (
        <EmptyState
          icon={Presentation}
          title={t('coaches.empty')}
          description={t('coaches.emptyHint')}
          action={add}
          className="rounded-2xl border border-dashed border-line-strong"
        />
      ) : (
        <ol className="grid gap-3">
          {items.map((c, i) => {
            const name = coachName(c, i18n.language);
            const title = coachTitle(c, i18n.language);
            return (
              <li key={c.id} className="min-w-0 rounded-2xl border border-line bg-surface p-3 sm:flex sm:items-center sm:gap-4 sm:p-4">
                <Link to={`/website/coaches/${c.id}`} className="-m-1 flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl p-1 hover:bg-surface-2">
                  <Avatar name={name} fileId={c.photoFileId} size="lg" shape="rounded" />
                  <span className="min-w-0 flex-1">
                    <bdi className="block truncate font-semibold text-ink">{name}</bdi>
                    {title && <bdi className="block truncate text-sm text-muted">{title}</bdi>}
                    <span className="mt-1 block">
                      {c.visible ? <Badge tone="success">{t('coaches.shown')}</Badge> : <Badge>{t('coaches.hidden')}</Badge>}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
                </Link>
                <div className="mt-3 sm:mt-0">
                  <MoveButtons name={name} index={i} count={items.length} onMove={(d) => move(i, d)} disabled={order.isPending} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
