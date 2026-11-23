import { CalendarCheck, CalendarClock, CalendarDays, CheckCheck, ClipboardCheck, Clapperboard, Hourglass, UserRoundSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ClassSession } from '@shared/schemas/courses';
import type { LeadListItem } from '@shared/schemas/admissions';
import type { ClosingCasting, DashboardAudition } from '@shared/schemas/dashboard';
import type { InterviewEvent } from '@shared/schemas/schedule';
import { Badge, DataLine, EmptyState, ListRow, StatusBadge, type Tone } from '@web/components/ui';
import { fullName } from '@web/lib/format';
import { followUpTone } from '../../admissions/utils';
import { ColorDot } from '../../schedule/components/ColorDot';
import { DataText } from '../../schedule/components/DataText';
import { useCalendarFormat } from '../../schedule/format';
import { DateTile, TimeStack } from './DateTile';
import { SectionCard, SectionList } from './SectionCard';

/** Room · teacher (not for the teacher themself) · topic — user data, so laid out in its own direction. */
function placeLine(s: ClassSession, mine: boolean) {
  return s.room || (!mine && s.teacherName) || s.topic ? <DataLine parts={[s.room, !mine && s.teacherName, s.topic]} /> : undefined;
}

function CourseTitle({ session }: { session: ClassSession }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ColorDot color={session.color} />
      <DataText className={session.status === 'cancelled' ? 'text-muted line-through' : undefined}>{session.courseName}</DataText>
    </span>
  );
}

/** Today's classes: time, course, room (· teacher), and whether attendance is in. */
export function TodayClassesCard({ sessions, today, mine }: { sessions: ClassSession[]; today: string; mine: boolean }) {
  const { t } = useTranslation(['dashboard', 'common']);
  return (
    <SectionCard title={mine ? t('today.titleMine') : t('today.title')} viewAll={`/schedule?date=${today}`}>
      {sessions.length ? (
        <SectionList>
          {sessions.map((s) => (
            <ListRow
              key={s.id}
              to={`/sessions/${s.id}`}
              leading={<TimeStack start={s.startTime} end={s.endTime} />}
              title={<CourseTitle session={s} />}
              subtitle={placeLine(s, mine)}
              trailing={
                s.status === 'cancelled' ? (
                  <StatusBadge group="sessionStatus" value="cancelled" />
                ) : s.attendanceTaken ? (
                  <Badge tone="success">
                    <CheckCheck className="size-3.5" aria-hidden />
                    {/* Icon only on narrow phones; the words from sm up (still read out everywhere). */}
                    <span className="max-sm:sr-only">{t('today.attendanceTaken')}</span>
                  </Badge>
                ) : undefined
              }
            />
          ))}
        </SectionList>
      ) : (
        <EmptyState icon={CalendarDays} title={t('today.empty')} description={t('today.emptyHint')} className="py-10" />
      )}
    </SectionCard>
  );
}

/** Past sessions still waiting for a register. Only rendered when there are some. */
export function AttendanceCard({ sessions, total, today }: { sessions: ClassSession[]; total: number; today: string }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const f = useCalendarFormat();
  const more = total - sessions.length;
  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <ClipboardCheck className="size-[18px] text-warning" aria-hidden />
          {t('attendance.title')}
          <Badge tone="warning">{f.number(total)}</Badge>
        </span>
      }
      description={t('attendance.hint', { count: total })}
      footer={more > 0 ? t('attendance.more', { count: more }) : undefined}
    >
      <SectionList>
        {sessions.map((s) => (
          <ListRow
            key={s.id}
            to={`/sessions/${s.id}`}
            leading={<DateTile date={s.date} tone="warning" />}
            title={<CourseTitle session={s} />}
            subtitle={`${f.date(s.date, 'weekday')} · ${f.timeRange(s.startTime, s.endTime)}`}
            trailing={<span className="hidden text-xs text-muted first-letter:uppercase sm:inline-block">{f.relativeDays(s.date, today)}</span>}
          />
        ))}
      </SectionList>
    </SectionCard>
  );
}

/** Auditions in the next two weeks. */
export function AuditionsCard({ auditions }: { auditions: DashboardAudition[] }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const f = useCalendarFormat();
  return (
    <SectionCard title={t('auditions.title')} description={t('auditions.subtitle')} viewAll="/schedule?show=auditions">
      {auditions.length ? (
        <SectionList>
          {auditions.map((a) => (
            <ListRow
              key={a.id}
              to={`/castings/${a.castingId}`}
              leading={<DateTile date={a.date} />}
              title={<DataText>{a.talentName}</DataText>}
              subtitle={
                <span className="flex min-w-0 gap-1">
                  <span className="shrink-0">{f.time(a.startTime)} ·</span>
                  <DataLine parts={[a.title, a.roleName]} />
                </span>
              }
              trailing={<StatusBadge group="submissionStatus" value={a.status} />}
            />
          ))}
        </SectionList>
      ) : (
        <EmptyState icon={Clapperboard} title={t('auditions.empty')} description={t('auditions.emptyHint')} className="py-10" />
      )}
    </SectionCard>
  );
}

/** Open castings whose submission deadline falls in the next 7 days. */
export function ClosingCastingsCard({ castings, today }: { castings: ClosingCasting[]; today: string }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const f = useCalendarFormat();
  const tone = (deadline: string): Tone => {
    const days = f.daysBetween(today, deadline);
    return days <= 0 ? 'danger' : days <= 2 ? 'warning' : 'neutral';
  };
  return (
    <SectionCard title={t('closing.title')} description={t('closing.subtitle')} viewAll="/castings?status=open">
      {castings.length ? (
        <SectionList>
          {castings.map((c) => (
            <ListRow
              key={c.id}
              to={`/castings/${c.id}`}
              leading={
                <span aria-hidden className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted">
                  <CalendarClock className="size-5" />
                </span>
              }
              title={<DataText>{c.title}</DataText>}
              subtitle={t('closing.deadline', { date: f.date(c.submissionDeadline, 'weekday') })}
              trailing={
                <Badge tone={tone(c.submissionDeadline)}>
                  <span className="inline-block first-letter:uppercase">{f.relativeDays(c.submissionDeadline, today)}</span>
                </Badge>
              }
            />
          ))}
        </SectionList>
      ) : (
        <EmptyState icon={Hourglass} title={t('closing.empty')} description={t('closing.emptyHint')} className="py-10" />
      )}
    </SectionCard>
  );
}

/** Open enquiries whose follow-up is due today or overdue, most overdue first (admissions.read). */
export function FollowUpsCard({ leads, total, today }: { leads: LeadListItem[]; total: number; today: string }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const f = useCalendarFormat();
  const more = total - leads.length;
  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          {t('followUps.title')}
          {total > 0 && <Badge tone="warning">{f.number(total)}</Badge>}
        </span>
      }
      description={total > 0 ? t('followUps.hint', { count: total }) : undefined}
      viewAll="/admissions?tab=follow_up"
      footer={more > 0 ? t('followUps.more', { count: more }) : undefined}
    >
      {leads.length ? (
        <SectionList>
          {leads.map((l) => {
            const due = l.nextFollowUpOn ?? today;
            const tone = followUpTone(due, today);
            return (
              <ListRow
                key={l.id}
                to={`/admissions/${l.id}`}
                leading={<DateTile date={due} tone={tone === 'danger' ? 'danger' : 'warning'} />}
                title={<DataText>{fullName(l)}</DataText>}
                subtitle={
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="shrink-0">{t(`common:enums.leadSource.${l.source}`)}</span>
                    {l.assignedToName && (
                      <>
                        <span aria-hidden className="shrink-0">
                          ·
                        </span>
                        <DataText>{l.assignedToName}</DataText>
                      </>
                    )}
                  </span>
                }
                trailing={
                  <span className="flex flex-col items-end gap-1">
                    <StatusBadge group="leadStatus" value={l.status} />
                    <span className={tone === 'danger' ? 'text-xs font-medium text-danger' : 'text-xs font-medium text-warning'}>
                      <span className="inline-block first-letter:uppercase">{f.relativeDays(due, today)}</span>
                    </span>
                  </span>
                }
              />
            );
          })}
        </SectionList>
      ) : (
        <EmptyState icon={CalendarCheck} title={t('followUps.empty')} description={t('followUps.emptyHint')} className="py-10" />
      )}
    </SectionCard>
  );
}

/** Admissions interviews in the next 7 days (admissions.read). */
export function InterviewsCard({ interviews }: { interviews: InterviewEvent[] }) {
  const { t } = useTranslation(['dashboard', 'common']);
  const f = useCalendarFormat();
  return (
    <SectionCard title={t('interviews.title')} description={t('interviews.subtitle')} viewAll="/schedule?show=interviews">
      {interviews.length ? (
        <SectionList>
          {interviews.map((i) => (
            <ListRow
              key={i.id}
              to={`/admissions/${i.leadId}`}
              leading={<DateTile date={i.date} tone="info" />}
              title={<DataText>{i.title}</DataText>}
              subtitle={
                <span className="flex min-w-0 gap-1">
                  <span className="shrink-0 tabular-nums">{f.timeRange(i.startTime, i.endTime)}</span>
                  {(i.room || i.interviewerName) && (
                    <>
                      <span aria-hidden className="shrink-0">
                        ·
                      </span>
                      <DataLine parts={[i.room, i.interviewerName]} />
                    </>
                  )}
                </span>
              }
            />
          ))}
        </SectionList>
      ) : (
        <EmptyState icon={UserRoundSearch} title={t('interviews.empty')} description={t('interviews.emptyHint')} className="py-10" />
      )}
    </SectionCard>
  );
}
