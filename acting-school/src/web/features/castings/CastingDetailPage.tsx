import { CalendarClock, Clapperboard, Mail, Pencil, Phone, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import type { CastingDetail, CastingRole, Submission } from '@shared/schemas/castings';
import {
  AddButton,
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  DescriptionList,
  EmptyAddAction,
  EmptyState,
  ErrorState,
  PageHeader,
  PageLoader,
  StatusBadge,
  useEnumLabel,
  useToast,
} from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { RecordFiles } from '../team/components/RecordFiles';
import { castingsErrorKey, useCasting, useDeleteCasting, useDeleteRole } from './api';
import { AddTalentModal } from './components/AddTalentModal';
import { CastingTypeIcon, DeadlineBadge } from './components/bits';
import { RoleCard } from './components/RoleCard';
import { RoleFormModal } from './components/RoleFormModal';
import { SubmissionModal } from './components/SubmissionModal';
import { isolate, telHref } from './utils';

export default function CastingDetailPage() {
  const { t } = useTranslation(['castings', 'common']);
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const del = useDeleteCasting(id);
  const casting = useCasting(id, valid && !del.isSuccess);

  if (!valid || casting.isError) {
    return (
      <div>
        <PageHeader title={t('title')} back="/castings" />
        <ErrorState
          error={valid ? casting.error : new ApiError(404, 'not_found', 'Not found')}
          onRetry={valid ? () => void casting.refetch() : undefined}
        />
      </div>
    );
  }
  if (casting.isPending) return <PageLoader />;
  return <CastingView casting={casting.data} del={del} />;
}

function CastingView({ casting: c, del }: { casting: CastingDetail; del: ReturnType<typeof useDeleteCasting> }) {
  const { t } = useTranslation(['castings', 'common']);
  const f = useFormat();
  const enumLabel = useEnumLabel();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const canWrite = can('castings.write');
  const deleteRole = useDeleteRole(c.id);

  const [confirmDelete, setConfirmDelete] = useState(false);
  // Which dialog is open. Roles/submissions are looked up by id in the latest data so dialogs see refetched values.
  const [roleForm, setRoleForm] = useState<{ roleId: number | null } | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<number | null>(null);
  const [pickerRoleId, setPickerRoleId] = useState<number | null>(null);
  const [submissionId, setSubmissionId] = useState<number | null>(null);

  const roleById = (rid: number | null): CastingRole | undefined => (rid === null ? undefined : c.roles.find((r) => r.id === rid));
  const submissionRole = submissionId === null ? undefined : c.roles.find((r) => r.submissions.some((s) => s.id === submissionId));
  const openSubmission: Submission | null = submissionRole?.submissions.find((s) => s.id === submissionId) ?? null;
  const deletingRole = roleById(roleToDelete);

  const onDelete = () =>
    del.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('detail.deleted'));
        navigate('/castings', { replace: true });
      },
      onError: (err) => {
        setConfirmDelete(false);
        toast.error(t(castingsErrorKey(err)));
      },
    });

  const onDeleteRole = () => {
    if (!deletingRole) return;
    deleteRole.mutate(deletingRole.id, {
      onSuccess: () => {
        toast.success(t('roles.deleted'));
        setRoleToDelete(null);
      },
      onError: (err) => {
        setRoleToDelete(null);
        toast.error(t(castingsErrorKey(err)));
      },
    });
  };

  const subtitleBits = [c.production, enumLabel('castingType', c.type)].filter(Boolean) as string[];

  const shootDates =
    c.shootStart && c.shootEnd
      ? c.shootStart === c.shootEnd
        ? f.date(c.shootStart, 'long')
        : `${f.date(c.shootStart)} – ${f.date(c.shootEnd)}`
      : c.shootStart
        ? t('detail.shootFrom', { date: f.date(c.shootStart) })
        : c.shootEnd
          ? t('detail.shootUntil', { date: f.date(c.shootEnd) })
          : null;

  const details: { label: ReactNode; value: ReactNode; wide?: boolean }[] = [
    {
      label: t('detail.deadline'),
      value: c.submissionDeadline ? f.date(c.submissionDeadline, 'long') : null,
    },
    { label: t('detail.castingDirector'), value: c.castingDirector ? <bdi>{c.castingDirector}</bdi> : null },
    { label: t('detail.email'), value: c.contactEmail ? <ContactLink href={`mailto:${c.contactEmail}`} icon={Mail} value={c.contactEmail} /> : null },
    { label: t('detail.phone'), value: c.contactPhone ? <ContactLink href={telHref(c.contactPhone)} icon={Phone} value={c.contactPhone} /> : null },
    { label: t('detail.location'), value: c.location ? <bdi>{c.location}</bdi> : null },
    { label: t('detail.shootDates'), value: shootDates },
    { label: t('detail.rate'), value: c.rate ? <bdi>{c.rate}</bdi> : null },
  ];
  const hasDetails = details.some((d) => d.value !== null);
  const submissionsTotal = c.roles.reduce((n, r) => n + r.submissions.length, 0);

  return (
    <div>
      <PageHeader
        back="/castings"
        documentTitle={c.title}
        title={<bdi>{c.title}</bdi>}
        leading={<CastingTypeIcon type={c.type} status={c.status} className="size-12 max-sm:hidden" />}
        subtitle={
          <span className="flex flex-col gap-1.5">
            {subtitleBits.length > 0 && (
              <span>
                {subtitleBits.map((b, i) => (
                  <span key={i}>
                    {i > 0 && <span aria-hidden> · </span>}
                    <bdi>{b}</bdi>
                  </span>
                ))}
              </span>
            )}
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge group="castingStatus" value={c.status} />
              {c.submissionDeadline && (
                <Badge>
                  <CalendarClock className="size-3" aria-hidden />
                  {t('list.deadline', { date: f.date(c.submissionDeadline) })}
                </Badge>
              )}
              <DeadlineBadge casting={c} />
            </span>
          </span>
        }
        actions={
          canWrite && (
            <>
              <ButtonLink to={`/castings/${c.id}/edit`} icon={Pencil}>
                {t('common:actions.edit')}
              </ButtonLink>
              {/* Icon-only on phones so the actions stay on one row; the label stays for screen readers. */}
              <Button variant="danger-ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} title={t('common:actions.delete')} className="max-sm:px-3">
                <span className="max-sm:sr-only">{t('common:actions.delete')}</span>
              </Button>
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
        <div className="grid min-w-0 grid-cols-1 gap-5">
          <Card title={t('detail.details')}>
            {hasDetails ? (
              <DescriptionList items={details} hideEmpty columns={1} className="sm:grid-cols-2 lg:grid-cols-1" />
            ) : (
              <p className="text-sm text-muted">{t('detail.noDetails')}</p>
            )}
            {c.description && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{t('detail.description')}</h3>
                <p dir="auto" className="mt-1 text-start text-sm leading-relaxed whitespace-pre-line break-words text-ink">
                  {c.description}
                </p>
              </div>
            )}
          </Card>
          {/* Breakdowns, scripts, sides, reference photos: castings.read sees them, castings.write adds or deletes. */}
          <Card title={t('team:files.files')}>
            <RecordFiles resource="castings" recordId={c.id} canAdd={canWrite} />
          </Card>
        </div>

        <section aria-labelledby="roles-heading" className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="roles-heading" className="flex items-center gap-2 text-lg font-semibold text-ink">
              {t('roles.title')}
              {c.roles.length > 0 && (
                <span className="text-sm font-normal text-muted">
                  {t('counts.roles', { count: c.roles.length })} · {t('counts.submissions', { count: submissionsTotal })}
                </span>
              )}
            </h2>
            {canWrite && c.roles.length > 0 && <AddButton label={t('common:add.role')} onClick={() => setRoleForm({ roleId: null })} />}
          </div>

          {c.roles.length === 0 ? (
            <EmptyState
              icon={Clapperboard}
              title={t('roles.emptyTitle')}
              description={canWrite ? t('roles.emptyHint') : undefined}
              action={canWrite && <EmptyAddAction onClick={() => setRoleForm({ roleId: null })} />}
              className="rounded-2xl border border-dashed border-line-strong"
            />
          ) : (
            // grid-cols-1 (minmax(0, 1fr)) so long names truncate instead of widening the page.
            <div className="grid grid-cols-1 gap-4">
              {c.roles.map((role) => (
                <RoleCard
                  key={role.id}
                  role={role}
                  canWrite={canWrite}
                  onEdit={() => setRoleForm({ roleId: role.id })}
                  onDelete={() => setRoleToDelete(role.id)}
                  onAddTalent={() => setPickerRoleId(role.id)}
                  onOpenSubmission={(s) => setSubmissionId(s.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <RoleFormModal
        open={roleForm !== null}
        onClose={() => setRoleForm(null)}
        castingId={c.id}
        role={roleForm ? roleById(roleForm.roleId) : undefined}
      />
      <AddTalentModal role={roleById(pickerRoleId) ?? null} onClose={() => setPickerRoleId(null)} />
      <SubmissionModal submission={openSubmission} roleName={submissionRole?.name ?? ''} onClose={() => setSubmissionId(null)} />

      <ConfirmDialog
        open={deletingRole !== undefined}
        title={deletingRole ? t('roles.deleteTitle', { name: isolate(deletingRole.name) }) : undefined}
        message={
          deletingRole?.submissions.length
            ? t('roles.deleteWithSubmissions', { count: deletingRole.submissions.length })
            : t('roles.deleteMessage')
        }
        loading={deleteRole.isPending}
        onConfirm={onDeleteRole}
        onCancel={() => setRoleToDelete(null)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t('detail.deleteTitle', { title: isolate(c.title) })}
        message={t('detail.deleteMessage')}
        loading={del.isPending}
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** Tappable email/phone value, always left-to-right. */
function ContactLink({ href, icon: Icon, value }: { href: string; icon: typeof Mail; value: string }) {
  return (
    <a href={href} className="inline-flex max-w-full items-center gap-1.5 font-medium text-accent hover:underline">
      <Icon className="size-4 shrink-0" aria-hidden />
      <span dir="ltr" className="truncate">
        {value}
      </span>
    </a>
  );
}
