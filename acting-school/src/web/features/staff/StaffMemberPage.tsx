import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import type { StaffMember } from '@shared/schemas/staff';
import { Badge, ErrorState, FormSection, PageHeader, PageLoader } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { PersonActions } from '../team/components/PersonActions';
import { BackLink } from '../website/components/BackLink';
import { useStaffMember } from './api';
import { EditDetailsForm, ResetPasswordForm, SelfPasswordNote, StaffPhoto } from './components/StaffForms';

/**
 * /staff/:id (staff.manage) — one team member's account: photo, details,
 * positions, the Active switch and a password reset. Reached from the member's
 * row on the Team page, and goes back there. Someone who can do more than you
 * is shown read-only (the API enforces it); an owner's account is a 404 for
 * non-owners.
 */
export default function StaffMemberPage() {
  const { t } = useTranslation(['staff', 'team', 'common']);
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const query = useStaffMember(id, valid);

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink to="/team">{t('team:title')}</BackLink>
      {!valid || query.isError ? (
        <ErrorState error={valid ? query.error : new ApiError(404, 'not_found', 'Not found')} onRetry={valid ? () => void query.refetch() : undefined} />
      ) : query.isPending ? (
        <PageLoader />
      ) : (
        <MemberAccount key={query.data.id} member={query.data} />
      )}
    </div>
  );
}

function MemberAccount({ member }: { member: StaffMember }) {
  const { t } = useTranslation(['staff', 'common']);
  const f = useFormat();
  const { user } = useAuth();
  const isSelf = member.id === user?.id;
  // Someone who can do more than you is out of your reach (the API enforces it; this just says so up front).
  const readOnly = !member.manageable;
  const meta = [
    member.lastLoginAt ? t('lastSignIn', { date: f.timestamp(member.lastLoginAt) }) : t('neverSignedIn'),
    t('form.added', { date: f.timestamp(member.createdAt) }),
  ].join(' · ');

  return (
    <>
      <PageHeader
        title={<bdi>{t(readOnly ? 'form.viewTitle' : 'form.editTitle', { name: member.name })}</bdi>}
        documentTitle={member.name}
        subtitle={meta}
        actions={!member.active ? <Badge tone="danger">{t('inactive')}</Badge> : undefined}
      />
      <div className="grid gap-4 sm:gap-5">
        <FormSection>
          <StaffPhoto member={member} readOnly={readOnly} isSelf={isSelf} />
          {/* "Message" / "Call to the office" (not for yourself, not for inactive accounts). */}
          <PersonActions userId={member.id} />
        </FormSection>
        {readOnly && (
          <div className="flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-muted">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('form.readOnlyNotice')}</span>
          </div>
        )}
        <EditDetailsForm member={member} isSelf={isSelf} readOnly={readOnly} />
        {!readOnly && <FormSection>{isSelf ? <SelfPasswordNote /> : <ResetPasswordForm member={member} />}</FormSection>}
      </div>
    </>
  );
}
