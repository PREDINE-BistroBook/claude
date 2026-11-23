import clsx from 'clsx';
import {
  CalendarPlus,
  Check,
  CircleSlash,
  GraduationCap,
  MessageCircle,
  NotebookPen,
  Pencil,
  Phone,
  RotateCcw,
  Trash2,
  TriangleAlert,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { isClosedLeadStatus } from '@shared/enums';
import { telLink } from '@shared/phone';
import type { Interview, LeadDetail } from '@shared/schemas/admissions';
import {
  AddButton,
  Avatar,
  BidiText,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  DescriptionList,
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
import { ageOn, fullName, useFormat } from '@web/lib/format';
import { admissionsErrorKey, useAdmissionsSettings, useCourseOptions, useDeleteLead, useLead, useUpdateInterview, useUpdateLead } from './api';
import { PersonActions } from '../team/components/PersonActions';
import { PersonAvatar } from '../team/components/PersonAvatar';
import { AssessmentModal } from './components/AssessmentModal';
import { FollowUpLabel, SourceLabel } from './components/bits';
import { EnrolModal } from './components/EnrolModal';
import { InterviewItem } from './components/InterviewItem';
import { InterviewModal } from './components/InterviewModal';
import { FollowUpModal, LostModal } from './components/LeadModals';
import { LogContactModal } from './components/LogContactModal';
import { Timeline } from './components/Timeline';
import { WhatsAppModal } from './components/WhatsAppModal';
import { canReopen, canScheduleInterview, latestDoneInterview, nextScheduledInterview } from './utils';

export default function LeadDetailPage() {
  const { t } = useTranslation(['admissions', 'common']);
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const del = useDeleteLead(id);
  const lead = useLead(id, valid && !del.isSuccess);

  if (!valid || lead.isError) {
    return (
      <div>
        <PageHeader title={t('title')} back="/admissions" />
        <ErrorState error={valid ? lead.error : new ApiError(404, 'not_found', 'Not found')} onRetry={valid ? () => void lead.refetch() : undefined} />
      </div>
    );
  }
  if (lead.isPending) return <PageLoader />;
  return <LeadView lead={lead.data} del={del} />;
}

type Dialog =
  | { kind: 'whatsapp' | 'log' | 'schedule' | 'enrol' | 'lost' | 'followUp' | 'decline' | 'delete' }
  | { kind: 'editInterview' | 'assess'; interview: Interview }
  | null;

function LeadView({ lead, del }: { lead: LeadDetail; del: ReturnType<typeof useDeleteLead> }) {
  const { t } = useTranslation(['admissions', 'common']);
  const f = useFormat();
  const enumLabel = useEnumLabel();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const settings = useAdmissionsSettings();
  const canWrite = can('admissions.write');
  const canDecide = can('admissions.decide');
  // Class options feed the assessment's "recommended class"; only deciders record assessments.
  const courses = useCourseOptions(canDecide);
  const update = useUpdateLead(lead.id);
  const ivUpdate = useUpdateInterview(lead.id);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  const name = fullName(lead);
  const age = ageOn(lead.dateOfBirth);
  const isMinor = age !== null && age < 18;
  const closed = isClosedLeadStatus(lead.status);
  const enrolled = lead.status === 'enrolled';
  const tel = telLink(lead.phone);
  const nextIv = nextScheduledInterview(lead.interviews);
  const lastDone = latestDoneInterview(lead.interviews);
  const enrolledEntry = lead.activities.find((a) => a.type === 'enrolled');

  const setStatus = (status: 'accepted' | 'declined' | 'contacted', message: string) =>
    update.mutate(
      { status },
      {
        onSuccess: () => {
          toast.success(message);
          close();
        },
        onError: (err) => {
          close();
          toast.error(t(admissionsErrorKey(err)));
        },
      },
    );

  const markNoShow = (iv: Interview) =>
    ivUpdate.mutate(
      { interviewId: iv.id, data: { status: 'no_show' } },
      { onSuccess: () => toast.success(t('interview.noShowDone')), onError: (err) => toast.error(t(admissionsErrorKey(err))) },
    );

  const onDelete = () =>
    del.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('detail.deleted'));
        navigate('/admissions', { replace: true });
      },
      onError: (err) => {
        close();
        toast.error(t(admissionsErrorKey(err)));
      },
    });

  const headerActions = (canWrite || canDecide) && (
    <>
      {canWrite && (
        <ButtonLink to={`/admissions/${lead.id}/edit`} icon={Pencil}>
          {t('common:actions.edit')}
        </ButtonLink>
      )}
      {canDecide && (
        <Button variant="danger-ghost" icon={Trash2} onClick={() => setDialog({ kind: 'delete' })} title={t('common:actions.delete')} className="max-sm:px-3">
          <span className="max-sm:sr-only">{t('common:actions.delete')}</span>
        </Button>
      )}
    </>
  );

  // Contact actions: always Call and WhatsApp; logging and interviews with admissions.write.
  const tiles: ReactNode[] = [];
  if (tel) tiles.push(<ActionTile key="call" href={tel} icon={Phone} label={t('detail.call')} />);
  tiles.push(<ActionTile key="wa" icon={MessageCircle} label={t('detail.whatsapp')} onClick={() => setDialog({ kind: 'whatsapp' })} />);
  if (canWrite) tiles.push(<ActionTile key="log" icon={NotebookPen} label={t('detail.logContact')} onClick={() => setDialog({ kind: 'log' })} />);
  if (canWrite && canScheduleInterview(lead.status))
    tiles.push(<ActionTile key="iv" icon={CalendarPlus} label={t('detail.interview')} onClick={() => setDialog({ kind: 'schedule' })} />);

  return (
    <div>
      <PageHeader
        back="/admissions"
        title={name}
        leading={<Avatar name={name} size="lg" className="max-sm:size-12" />}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge group="leadStatus" value={lead.status} />
            {age !== null && <span>{t('common:units.years', { count: age })}</span>}
            <span aria-hidden>·</span>
            <SourceLabel source={lead.source} />
            {lead.sourceDetail && (
              <span className="min-w-0 truncate">
                (<bdi>{lead.sourceDetail}</bdi>)
              </span>
            )}
          </span>
        }
        actions={headerActions}
      />

      <div className={clsx('mb-5 grid gap-2 sm:flex sm:flex-wrap', tiles.length === 4 ? 'grid-cols-4' : tiles.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {tiles}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <Card title={t('detail.nextStep')}>
            <dl className="grid gap-3 text-sm">
              <InfoRow label={t('common:fields.status')}>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge group="leadStatus" value={lead.status} />
                  {lead.status === 'lost' && lead.lostReason && <span className="text-muted">{enumLabel('leadLostReason', lead.lostReason)}</span>}
                </span>
              </InfoRow>
              {!closed && (
                <InfoRow
                  label={t('fields.nextFollowUpOn')}
                  action={
                    canWrite && (
                      <Button size="sm" variant="ghost" className="-my-1 text-accent" onClick={() => setDialog({ kind: 'followUp' })}>
                        {lead.nextFollowUpOn ? t('followUp.change') : t('followUp.set')}
                      </Button>
                    )
                  }
                >
                  {lead.nextFollowUpOn ? (
                    <span className="grid gap-0.5">
                      <span className="text-ink">{f.date(lead.nextFollowUpOn, 'weekday')}</span>
                      <FollowUpLabel date={lead.nextFollowUpOn} wrap />
                    </span>
                  ) : (
                    <span className="text-muted">{t('followUp.notSet')}</span>
                  )}
                </InfoRow>
              )}
              <InfoRow label={t('fields.assignedTo')}>
                {lead.assignedToName ? (
                  <span className="grid gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <PersonAvatar userId={lead.assignedToId} name={lead.assignedToName} />
                      <BidiText className="text-ink">{lead.assignedToName}</BidiText>
                    </span>
                    {/* "Message" / "Call to the office" for the person handling this enquiry. */}
                    <PersonActions userId={lead.assignedToId} compact />
                  </span>
                ) : (
                  <span className="text-muted">{t('form.unassigned')}</span>
                )}
              </InfoRow>
              {nextIv && (
                <InfoRow label={t('detail.nextInterview')}>
                  <span className="text-ink">{f.dateTime(nextIv.scheduledAt)}</span>
                </InfoRow>
              )}
              {lastDone?.recommendation && (
                <InfoRow label={t('detail.interviewSays')}>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge group="interviewRecommendation" value={lastDone.recommendation} />
                    {lastDone.recommendedCourseName && <bdi className="text-muted">{lastDone.recommendedCourseName}</bdi>}
                  </span>
                </InfoRow>
              )}
            </dl>

            {enrolled && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-success-soft px-3.5 py-3">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-success">
                  <GraduationCap className="size-5 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    {enrolledEntry?.meta?.courseName ? t('detail.enrolledIn', { course: enrolledEntry.meta.courseName }) : t('detail.enrolled')}
                    {enrolledEntry && <span className="block text-xs font-normal text-ink/75">{f.timestamp(enrolledEntry.createdAt, 'long')}</span>}
                  </span>
                </p>
                {lead.student?.visible && (
                  <ButtonLink to={`/students/${lead.student.id}`} size="sm" icon={GraduationCap}>
                    {t('detail.openStudent')}
                  </ButtonLink>
                )}
              </div>
            )}

            {!closed && (canDecide || canWrite) && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                {canDecide && (
                  <Button variant={lead.status === 'accepted' ? 'primary' : 'secondary'} icon={UserPlus} onClick={() => setDialog({ kind: 'enrol' })}>
                    {t('detail.enrol')}
                  </Button>
                )}
                {canDecide && lead.status !== 'accepted' && (
                  <Button
                    variant={lead.status === 'interviewed' ? 'primary' : 'secondary'}
                    icon={Check}
                    loading={update.isPending && update.variables?.status === 'accepted'}
                    onClick={() => setStatus('accepted', t('detail.acceptedToast'))}
                  >
                    {t('detail.accept')}
                  </Button>
                )}
                {canDecide && (
                  <Button variant="ghost" icon={X} onClick={() => setDialog({ kind: 'decline' })}>
                    {t('detail.decline')}
                  </Button>
                )}
                {canWrite && (
                  <Button variant="danger-ghost" icon={CircleSlash} onClick={() => setDialog({ kind: 'lost' })} className="sm:ms-auto">
                    {t('detail.closeLost')}
                  </Button>
                )}
              </div>
            )}

            {canReopen(lead.status) && canWrite && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                <p className="text-sm text-muted">{t('detail.reopenHint')}</p>
                <Button icon={RotateCcw} loading={update.isPending} onClick={() => setStatus('contacted', t('detail.reopened'))}>
                  {t('detail.reopen')}
                </Button>
              </div>
            )}
          </Card>

          <Card title={t('detail.details')}>
            {isMinor && !lead.guardianName && !lead.guardianPhone && (
              <p className="mb-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning" role="note">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('detail.minorNoGuardian')}
              </p>
            )}
            <DescriptionList
              hideEmpty
              items={[
                {
                  label: t('common:fields.phone'),
                  value: tel ? (
                    <a href={tel} dir="ltr" className="font-medium text-accent hover:underline">
                      {lead.phone}
                    </a>
                  ) : (
                    <bdi dir="ltr">{lead.phone}</bdi>
                  ),
                },
                {
                  label: t('common:fields.email'),
                  value: lead.email && (
                    <a href={`mailto:${lead.email}`} dir="ltr" className="break-all text-accent hover:underline">
                      {lead.email}
                    </a>
                  ),
                },
                {
                  label: t('common:fields.dateOfBirth'),
                  value: lead.dateOfBirth ? `${f.date(lead.dateOfBirth, 'long')}${age !== null ? ` (${t('common:units.years', { count: age })})` : ''}` : null,
                },
                { label: t('common:fields.gender'), value: enumLabel('gender', lead.gender) || null },
                { label: t('fields.city'), value: lead.city && <bdi>{lead.city}</bdi> },
                { label: t('fields.guardianName'), value: lead.guardianName && <bdi>{lead.guardianName}</bdi> },
                {
                  label: t('fields.guardianPhone'),
                  value: lead.guardianPhone && (
                    <a href={telLink(lead.guardianPhone) ?? undefined} dir="ltr" className="text-accent hover:underline">
                      {lead.guardianPhone}
                    </a>
                  ),
                },
                {
                  label: t('fields.preferredCourse'),
                  value: lead.preferredCourse && (
                    <bdi>
                      {lead.preferredCourse.name}
                      {lead.preferredCourse.teacherName && ` · ${lead.preferredCourse.teacherName}`}
                    </bdi>
                  ),
                },
                { label: t('fields.interest'), value: lead.interest && <Multiline text={lead.interest} />, wide: true },
                { label: t('fields.experience'), value: lead.experience && <Multiline text={lead.experience} />, wide: true },
                { label: t('fields.notes'), value: lead.notes && <Multiline text={lead.notes} />, wide: true },
                {
                  label: t('detail.added'),
                  value: lead.createdByName ? t('detail.addedBy', { name: lead.createdByName, date: f.timestamp(lead.createdAt) }) : f.timestamp(lead.createdAt),
                  wide: true,
                },
              ]}
            />
          </Card>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4">
          <Card
            title={t('detail.interviews')}
            padded={false}
            actions={
              canWrite && canScheduleInterview(lead.status) && <AddButton label={t('common:add.interview')} onClick={() => setDialog({ kind: 'schedule' })} />
            }
          >
            {lead.interviews.length ? (
              <ul className="divide-y divide-line">
                {lead.interviews.map((iv) => (
                  <InterviewItem
                    key={iv.id}
                    interview={iv}
                    criteria={settings.interviewCriteria}
                    canWrite={canWrite}
                    canDecide={canDecide}
                    onAssess={() => setDialog({ kind: 'assess', interview: iv })}
                    onEdit={() => setDialog({ kind: 'editInterview', interview: iv })}
                    onNoShow={() => markNoShow(iv)}
                    noShowPending={ivUpdate.isPending && ivUpdate.variables?.interviewId === iv.id}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState icon={CalendarPlus} title={t('detail.noInterviews')} description={closed ? undefined : t('detail.noInterviewsHint')} className="py-8" />
            )}
          </Card>

          <Card title={t('detail.timeline')} actions={canWrite && <AddButton label={t('common:add.contact')} onClick={() => setDialog({ kind: 'log' })} />}>
            <Timeline activities={lead.activities} />
          </Card>
        </div>
      </div>

      <WhatsAppModal open={dialog?.kind === 'whatsapp'} onClose={close} lead={lead} />
      <LogContactModal open={dialog?.kind === 'log'} onClose={close} lead={lead} />
      <InterviewModal open={dialog?.kind === 'schedule'} onClose={close} lead={lead} />
      <InterviewModal open={dialog?.kind === 'editInterview'} onClose={close} lead={lead} interview={dialog?.kind === 'editInterview' ? dialog.interview : undefined} />
      {dialog?.kind === 'assess' && (
        <AssessmentModal
          open
          onClose={close}
          lead={lead}
          interview={dialog.interview}
          criteria={settings.interviewCriteria}
          courses={courses.data?.items ?? []}
          coursesLoading={courses.isPending}
        />
      )}
      <EnrolModal open={dialog?.kind === 'enrol'} onClose={close} lead={lead} />
      <LostModal open={dialog?.kind === 'lost'} onClose={close} lead={lead} />
      <FollowUpModal open={dialog?.kind === 'followUp'} onClose={close} lead={lead} />
      <ConfirmDialog
        open={dialog?.kind === 'decline'}
        title={t('detail.declineTitle', { name })}
        message={t('detail.declineMessage')}
        confirmLabel={t('detail.decline')}
        loading={update.isPending}
        onConfirm={() => setStatus('declined', t('detail.declinedToast'))}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        title={t('detail.deleteTitle', { name })}
        message={t('detail.deleteMessage')}
        loading={del.isPending}
        onConfirm={onDelete}
        onCancel={close}
      />
    </div>
  );
}

/** A big tappable contact action (icon over label on phones). */
function ActionTile({ icon: Icon, label, href, onClick }: { icon: LucideIcon; label: string; href?: string; onClick?: () => void }) {
  const cls =
    'flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-surface px-1 py-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm';
  const inner = (
    <>
      <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent sm:size-7">
        <Icon className="size-[18px] sm:size-4" aria-hidden />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </>
  );
  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/** Label / value row in the "Next step" card, with an optional action at the end. */
function InfoRow({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
      {action ? <dd className="shrink-0">{action}</dd> : <span aria-hidden />}
    </div>
  );
}

function Multiline({ text }: { text: string }) {
  return (
    <span dir="auto" className="block text-start leading-relaxed whitespace-pre-line">
      {text}
    </span>
  );
}
