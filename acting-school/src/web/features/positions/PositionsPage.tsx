import { BadgeCheck, Crown, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Position } from '@shared/schemas/positions';
import { Badge, EmptyState, ErrorState, List, ListRow, PageHeader, PageLoader } from '@web/components/ui';
import { ScreenAddAction, ScreenEmptyAdd } from '@web/layout/ScreenAdd';
import { useAuth } from '@web/lib/auth';
import { usePositionName } from '@web/lib/positions';
import { usePositions } from './api';
import { heldByOthersBeyondReach } from './utils';

export default function PositionsPage() {
  const { t } = useTranslation(['positions', 'common']);
  const positions = usePositions();
  const items = positions.data?.items ?? [];


  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('title')} subtitle={positions.isSuccess ? t('summary', { count: items.length }) : undefined} actions={<ScreenAddAction screen="positions" />} />
      <p className="mb-5 max-w-prose text-sm text-muted">{t('intro')}</p>
      {positions.isPending ? (
        <PageLoader />
      ) : positions.isError ? (
        <ErrorState error={positions.error} onRetry={() => void positions.refetch()} />
      ) : !items.length ? (
        <EmptyState icon={BadgeCheck} title={t('emptyTitle')} action={<ScreenEmptyAdd screen="positions" />} className="rounded-2xl border border-dashed border-line-strong" />
      ) : (
        <List>
          {items.map((p) => (
            <PositionRow key={p.id} position={p} />
          ))}
        </List>
      )}
    </div>
  );
}

function PositionRow({ position: p }: { position: Position }) {
  const { t } = useTranslation(['positions', 'common']);
  const name = usePositionName();
  const { user } = useAuth();
  const lockedLabel = t(heldByOthersBeyondReach(p, user?.permissions ?? []) ? 'lockedHolders' : 'locked');
  const Icon = p.isOwner ? Crown : BadgeCheck;
  const allows = p.isOwner ? t('allowsEverything') : p.permissions.length ? t('allows', { count: p.permissions.length }) : t('allowsNothing');
  return (
    <ListRow
      to={`/positions/${p.id}`}
      className="min-h-16"
      leading={
        <span className={p.isOwner ? 'flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent' : 'flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted'}>
          <Icon className="size-5" aria-hidden />
        </span>
      }
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{name(p)}</span>
          {p.isOwner && <Badge tone="accent">{t('owner')}</Badge>}
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span>{allows}</span>
          <span aria-hidden>·</span>
          <span>{p.holderCount ? t('holders', { count: p.holderCount }) : t('noHolders')}</span>
        </span>
      }
      trailing={
        !p.editable && (
          <span className="flex items-center text-muted" title={lockedLabel}>
            <Lock className="size-4" aria-hidden />
            <span className="sr-only">{lockedLabel}</span>
          </span>
        )
      }
    />
  );
}
