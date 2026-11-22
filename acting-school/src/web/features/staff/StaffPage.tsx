import clsx from 'clsx';
import { Plus, UserCog } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StaffMember } from '@shared/schemas/staff';
import { Avatar, Badge, Button, EmptyState, ErrorState, List, ListRow, PageHeader, PageLoader, StatusBadge } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { useStaffList } from './api';
import { RoleGuide } from './components/bits';
import { AddStaffModal, EditStaffModal } from './components/StaffModals';

export default function StaffPage() {
  const { t } = useTranslation(['staff', 'common']);
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
      <div className="grid gap-6">
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
      <RoleGuide className="mb-5" />
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

  return (
    <ListRow
      onClick={onOpen}
      className={clsx('min-h-16', !member.active && 'text-muted')}
      leading={<Avatar name={member.name} className={clsx(!member.active && 'opacity-50 grayscale')} />}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className={clsx('truncate', !member.active && 'text-muted')}>{member.name}</span>
          {isMe && <Badge tone="neutral">{t('you')}</Badge>}
        </span>
      }
      subtitle={
        <>
          {/* LTR so a long address keeps its start visible; still aligned to the row's start in Arabic. */}
          <span dir="ltr" className="block truncate rtl:text-end">
            {member.email}
          </span>
          <span className="block truncate text-xs">{lastSeen}</span>
        </>
      }
      trailing={
        <span className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          {!member.active && <Badge tone="danger">{t('inactive')}</Badge>}
          <StatusBadge group="role" value={member.role} />
        </span>
      }
    />
  );
}
