import clsx from 'clsx';
import { ChevronRight, Plus, UserCog } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StaffMember } from '@shared/schemas/staff';
import { Avatar, Badge, Button, EmptyState, ErrorState, List, PageHeader, PageLoader } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { useStaffList } from './api';
import { PositionChips, PositionsGuideLink } from './components/bits';
import { AddStaffModal, EditStaffModal } from './components/StaffModals';
import { PersonActions } from '../team/components/PersonActions';

export default function StaffPage() {
  const { t } = useTranslation(['staff', 'common']);
  const { can } = useAuth();
  const staff = useStaffList();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const items = staff.data?.items ?? [];
  const active = items.filter((s) => s.active);
  const inactive = items.filter((s) => !s.active);
  // Look the member up from fresh data so the modal never edits a stale copy.
  const editing = editingId === null ? null : (items.find((s) => s.id === editingId) ?? null);

  const addButton = (
    <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
      {t('addStaff')}
    </Button>
  );

  let body;
  if (staff.isPending) body = <PageLoader />;
  else if (staff.isError) body = <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />;
  else if (!items.length)
    body = (
      <EmptyState
        icon={UserCog}
        title={t('emptyTitle')}
        description={t('emptyHint')}
        action={addButton}
        className="rounded-2xl border border-dashed border-line-strong"
      />
    );
  else
    body = (
      // grid-cols-1 (minmax(0, 1fr)): a long email in a row truncates instead of widening the list.
      <div className="grid grid-cols-1 gap-6">
        <List>
          {active.map((s) => (
            <StaffRow key={s.id} member={s} onOpen={() => setEditingId(s.id)} />
          ))}
        </List>
        {inactive.length > 0 && (
          <section aria-labelledby="inactive-heading">
            <div className="mb-2 px-1">
              <h2 id="inactive-heading" className="text-sm font-semibold text-ink">
                {t('inactiveSection')} <span className="font-normal text-muted">({inactive.length})</span>
              </h2>
              <p className="text-xs text-muted">{t('inactiveHint')}</p>
            </div>
            <List>
              {inactive.map((s) => (
                <StaffRow key={s.id} member={s} onOpen={() => setEditingId(s.id)} />
              ))}
            </List>
          </section>
        )}
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('title')}
        subtitle={staff.isSuccess && items.length > 0 ? t('summary', { count: active.length }) : undefined}
        actions={addButton}
      />
      {can('positions.manage') && <PositionsGuideLink className="mb-5" />}
      {body}
      <AddStaffModal open={adding} onClose={() => setAdding(false)} />
      <EditStaffModal member={editing} onClose={() => setEditingId(null)} />
    </div>
  );
}

function StaffRow({ member, onOpen }: { member: StaffMember; onOpen: () => void }) {
  const { t } = useTranslation(['staff', 'common']);
  const f = useFormat();
  const { user } = useAuth();
  const isMe = member.id === user?.id;
  const lastSeen = member.lastLoginAt ? t('lastSignIn', { date: f.timestamp(member.lastLoginAt) }) : t('neverSignedIn');

  // Not a ListRow: the row opens the person, and "Message" / "Call to the office" sit under it (no buttons inside a button).
  return (
    <li className={clsx('min-h-16', !member.active && 'text-muted')}>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 pt-3 text-start transition-colors hover:bg-surface-2 sm:px-5 [&:last-child]:pb-3">
        <Avatar name={member.name} fileId={member.photoFileId} className={clsx(!member.active && 'opacity-50 grayscale')} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
            <bdi className={clsx('truncate', !member.active && 'text-muted')}>{member.name}</bdi>
            {isMe && <Badge tone="neutral">{t('you')}</Badge>}
          </span>
          <span className="mt-0.5 block text-sm text-muted">
            {/* LTR so a long address keeps its start visible; still aligned to the row's start in Arabic. */}
            <span dir="ltr" className="block truncate rtl:text-end">
              {member.email}
            </span>
            <span className="block truncate text-xs">{lastSeen}</span>
            <PositionChips positions={member.positions} className="mt-1.5 whitespace-normal" />
          </span>
        </span>
        {!member.active && <Badge tone="danger">{t('inactive')}</Badge>}
        <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
      </button>
      {/* Only active colleagues (they're in the Team directory); never yourself. */}
      <PersonActions userId={member.id} compact className="ps-[4.25rem] pe-4 pb-3 pt-2 sm:ps-[4.75rem]" />
    </li>
  );
}
