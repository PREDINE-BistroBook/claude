import clsx from 'clsx';
import { ClipboardCheck, GraduationCap, Lock, Mail, Pencil, Phone, ShieldCheck, ShieldX, Star, Trash2, TriangleAlert, UserPlus, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { ATTENDANCE_STATUSES, COURSE_COLORS, type AttendanceStatus, type CourseColor } from '@shared/enums';
import type { StudentDetail } from '@shared/schemas/students';
import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  ErrorState,
  ListRow,
  PageHeader,
  PageLoader,
  StatusBadge,
  useEnumLabel,
  useToast,
} from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { courseColor } from '@web/lib/colors';
import { ageOn, fullName, useFormat } from '@web/lib/format';
import { errorMessageKey } from '@web/lib/forms';
import { useDeleteStudent, useStudent } from './api';
import { BidiText } from '@web/components/ui';

const isCourseColor = (c: string | null): c is CourseColor => !!c && (COURSE_COLORS as readonly string[]).includes(c);

/** "tel:" wants digits and a leading +, nothing else. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

export default function StudentDetailPage() {
  const { t } = useTranslation(['students', 'common']);
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const del = useDeleteStudent(id);
  const student = useStudent(id, valid && !del.isSuccess);

  if (!valid || student.isError) {
    return (
      <div>
        <PageHeader title={t('title')} back="/students" />
        <ErrorState
          error={valid ? student.error : new ApiError(404, 'not_found', 'Not found')}
          onRetry={valid ? () => void student.refetch() : undefined}
        />
      </div>
    );
  }
  if (student.isPending) return <PageLoader />;
  return <StudentView student={student.data} del={del} />;
}

function StudentView({ student: s, del }: { student: StudentDetail; del: ReturnType<typeof useDeleteStudent> }) {
  const { t } = useTranslation(['students', 'common']);
  const f = useFormat();
  const enumLabel = useEnumLabel();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const name = fullName(s);
  const age = ageOn(s.dateOfBirth);
  const isMinor = age !== null && age < 18;
  const canWrite = can('students.write');

  const onDelete = () =>
    del.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('detail.deleted'));
        navigate('/students', { replace: true });
      },
      onError: (err) => {
        setConfirmOpen(false);
        toast.error(t(errorMessageKey(err)));
      },
    });

  const actions = (
    <>
      {s.talentId !== null && can('talent.read') && (
        <ButtonLink to={`/talent/${s.talentId}`} icon={Star}>
          {t('detail.talentProfile')}
        </ButtonLink>
      )}
      {s.talentId === null && can('talent.write') && (
        <ButtonLink to={`/talent/new?studentId=${s.id}`} icon={UserPlus}>
          {t('detail.addToTalent')}
        </ButtonLink>
      )}
      {canWrite && (
        <>
          <ButtonLink to={`/students/${s.id}/edit`} icon={Pencil}>
            {t('common:actions.edit')}
          </ButtonLink>
          {/* Icon-only on phones so the actions stay on one row; the label stays for screen readers. */}
          <Button variant="danger-ghost" icon={Trash2} onClick={() => setConfirmOpen(true)} title={t('common:actions.delete')} className="max-sm:px-3">
            <span className="max-sm:sr-only">{t('common:actions.delete')}</span>
          </Button>
        </>
      )}
    </>
  );

  const hasGuardian = !!(s.guardianName || s.guardianPhone || s.guardianEmail);
  const hasEmergency = !!(s.emergencyName || s.emergencyPhone);

  return (
    <div>
      <PageHeader
        back="/students"
        title={name}
        leading={<Avatar name={name} fileId={s.photoFileId} size="xl" className="max-sm:size-16 max-sm:text-xl" />}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge group="studentStatus" value={s.status} />
            {age !== null && <span>{t('common:units.years', { count: age })}</span>}
            {s.joinedOn && (
              <span className="whitespace-nowrap">
                {age !== null && <span aria-hidden>· </span>}
                {t('detail.joined', { date: f.date(s.joinedOn) })}
              </span>
            )}
          </span>
        }
        actions={actions}
      />

      {/* grid-cols-1 (minmax(0, 1fr)) so long emails truncate instead of widening the page. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {s.contactHidden ? (
          <Card title={t('detail.contact')} className="md:col-span-2">
            <ContactHidden />
          </Card>
        ) : (
          <>
            <Card title={t('detail.contact')}>
              {s.phone || s.email ? (
                <ul className="-my-1 grid gap-1">
                  {s.phone && <ContactLink href={telHref(s.phone)} icon={Phone} label={t('common:fields.phone')} value={s.phone} />}
                  {s.email && <ContactLink href={`mailto:${s.email}`} icon={Mail} label={t('common:fields.email')} value={s.email} />}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('detail.noContact')}</p>
              )}
            </Card>

            <Card title={t('detail.guardianEmergency')}>
              {isMinor && !hasGuardian && (
                <p className="mb-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning" role="note">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {t('detail.minorNoGuardian')}
                </p>
              )}
              {hasGuardian || hasEmergency ? (
                <div className="grid gap-4">
                  {hasGuardian && (
                    <PersonBlock heading={t('detail.guardian')} name={s.guardianName}>
                      {s.guardianPhone && <ContactLink href={telHref(s.guardianPhone)} icon={Phone} label={t('common:fields.phone')} value={s.guardianPhone} />}
                      {s.guardianEmail && <ContactLink href={`mailto:${s.guardianEmail}`} icon={Mail} label={t('common:fields.email')} value={s.guardianEmail} />}
                    </PersonBlock>
                  )}
                  {hasEmergency && (
                    <PersonBlock heading={t('detail.emergency')} name={s.emergencyName}>
                      {s.emergencyPhone && <ContactLink href={telHref(s.emergencyPhone)} icon={Phone} label={t('common:fields.phone')} value={s.emergencyPhone} />}
                    </PersonBlock>
                  )}
                </div>
              ) : (
                !isMinor && <p className="text-sm text-muted">{t('detail.noGuardian')}</p>
              )}
            </Card>
          </>
        )}

        <Card title={t('detail.classes')} padded={false}>
          {s.enrollments.length ? (
            <ul className="divide-y divide-line">
              {s.enrollments.map((e) => (
                <ListRow
                  key={e.id}
                  to={`/classes/${e.courseId}`}
                  leading={
                    <span className="flex size-8 items-center justify-center" aria-hidden>
                      <span className={clsx('size-3 rounded-full', courseColor(isCourseColor(e.courseColor) ? e.courseColor : null).dot)} />
                    </span>
                  }
                  title={<BidiText>{e.courseName}</BidiText>}
                  subtitle={t('detail.enrolledOn', { date: f.date(e.enrolledOn) })}
                  trailing={<StatusBadge group="enrollmentStatus" value={e.status} />}
                />
              ))}
            </ul>
          ) : (
            <EmptyState icon={GraduationCap} title={t('detail.noClasses')} className="py-8" />
          )}
        </Card>

        <Card title={t('detail.attendance')}>
          <AttendanceSummary counts={s.attendance} />
        </Card>

        <Card title={t('detail.personal')}>
          <DescriptionList
            items={[
              {
                label: t('common:fields.dateOfBirth'),
                value: s.dateOfBirth ? `${f.date(s.dateOfBirth, 'long')}${age !== null ? ` (${t('common:units.years', { count: age })})` : ''}` : null,
              },
              { label: t('common:fields.gender'), value: enumLabel('gender', s.gender) || null },
              { label: t('detail.joinedOn'), value: s.joinedOn ? f.date(s.joinedOn, 'long') : null },
            ]}
          />
        </Card>

        <Card title={t('detail.consent')}>
          <div
            className={clsx('flex items-start gap-3 rounded-xl px-3.5 py-3', s.mediaConsent ? 'bg-success-soft' : 'bg-danger-soft')}
            role="status"
          >
            {s.mediaConsent ? (
              <ShieldCheck className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
            ) : (
              <ShieldX className="mt-0.5 size-6 shrink-0 text-danger" aria-hidden />
            )}
            <div className="min-w-0">
              <p className={clsx('font-semibold', s.mediaConsent ? 'text-success' : 'text-danger')}>
                {s.mediaConsent ? t('detail.consentYes') : t('detail.consentNo')}
              </p>
              <p className="mt-0.5 text-sm text-ink/80">{s.mediaConsent ? t('detail.consentYesHint') : t('detail.consentNoHint')}</p>
            </div>
          </div>
        </Card>

        <Card title={t('detail.notes')} className="md:col-span-2">
          {s.notes ? (
            <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-line break-words text-ink">
              {s.notes}
            </p>
          ) : (
            <p className="text-sm text-muted">{t('detail.noNotes')}</p>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('detail.deleteTitle', { name })}
        message={t('detail.deleteMessage')}
        loading={del.isPending}
        onConfirm={onDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/** Shown instead of phone, email, guardian and emergency contacts to someone whose position can't see them. */
function ContactHidden() {
  const { t } = useTranslation('common');
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <Lock className="size-4 shrink-0" aria-hidden />
      {t('states.contactHidden')}
    </p>
  );
}

/** A tappable phone/email row: icon, small label, the value (always left-to-right). */
function ContactLink({ href, icon: Icon, label, value }: { href: string; icon: LucideIcon; label: string; value: string }) {
  return (
    <li>
      <a href={href} className="-mx-2 flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-surface-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-xs text-muted">{label}</span>
          <BidiText dir="ltr" className="text-sm font-medium text-ink">
            {value}
          </BidiText>
        </span>
      </a>
    </li>
  );
}

function PersonBlock({ heading, name, children }: { heading: string; name: string | null; children?: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{heading}</h3>
      {name && <p className="mt-1 text-sm font-medium text-ink">{name}</p>}
      <ul className="mt-1 grid gap-1">{children}</ul>
    </section>
  );
}

const ATTENDANCE_DOT: Record<AttendanceStatus, string> = {
  present: 'bg-success',
  late: 'bg-warning',
  absent: 'bg-danger',
  excused: 'bg-info',
};

function AttendanceSummary({ counts }: { counts: StudentDetail['attendance'] }) {
  const { t } = useTranslation(['students', 'common']);
  const f = useFormat();
  if (!counts.total) return <EmptyState icon={ClipboardCheck} title={t('detail.noAttendance')} className="py-6" />;
  const rate = (counts.present + counts.late) / counts.total;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted uppercase">{t('detail.attendanceRate')}</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">{f.percent(rate)}</div>
        </div>
        <div className="pb-1 text-sm text-muted">{t('detail.basedOn', { count: counts.total })}</div>
      </div>
      <div
        className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${t('detail.attendanceRate')}: ${f.percent(rate)}`}
      >
        {ATTENDANCE_STATUSES.map((st) =>
          counts[st] ? <span key={st} className={ATTENDANCE_DOT[st]} style={{ width: `${(counts[st] / counts.total) * 100}%` }} /> : null,
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
        {ATTENDANCE_STATUSES.map((st) => (
          <div key={st} className="rounded-xl bg-surface-2 px-3 py-2">
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              <span className={clsx('size-2 rounded-full', ATTENDANCE_DOT[st])} aria-hidden />
              {t(`common:enums.attendanceStatus.${st}`)}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-ink tabular-nums">{f.number(counts[st])}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">{t('detail.rateHint')}</p>
    </div>
  );
}
