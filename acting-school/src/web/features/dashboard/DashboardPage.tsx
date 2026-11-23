import clsx from 'clsx';
import { Clapperboard, GraduationCap, Inbox, LayoutDashboard, Lock, MessageSquarePlus, Plus, Sparkles, Star, UserPlus, Users, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { todayISO } from '@shared/dates';
import type { Permission } from '@shared/permissions';
import type { DashboardData } from '@shared/schemas/dashboard';
import { ButtonLink, EmptyState, ErrorState, PageHeader, PageLoader, StatCard } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { useDashboard } from './api';
import { AttendanceCard, AuditionsCard, ClosingCastingsCard, FollowUpsCard, InterviewsCard, TodayClassesCard } from './components/Sections';
import { firstName, greetingFor } from './utils';

const STATS: { key: keyof DashboardData['counts']; to: string; icon: LucideIcon }[] = [
  { key: 'openLeads', to: '/admissions?tab=open', icon: Inbox },
  { key: 'newLeadsThisWeek', to: '/admissions?tab=open', icon: Sparkles },
  { key: 'activeStudents', to: '/students', icon: Users },
  { key: 'activeCourses', to: '/classes', icon: GraduationCap },
  { key: 'activeTalent', to: '/talent', icon: Star },
  { key: 'openCastings', to: '/castings', icon: Clapperboard },
];

const QUICK_ACTIONS: { key: string; to: string; icon: LucideIcon; permission: Permission }[] = [
  { key: 'newEnquiry', to: '/admissions/new', icon: MessageSquarePlus, permission: 'admissions.write' },
  { key: 'newStudent', to: '/students/new', icon: UserPlus, permission: 'students.write' },
  { key: 'newClass', to: '/classes/new', icon: Plus, permission: 'courses.write' },
  { key: 'addTalent', to: '/talent/new', icon: Plus, permission: 'talent.write' },
  { key: 'newCasting', to: '/castings/new', icon: Plus, permission: 'castings.write' },
];

/** Tailwind needs the full class names written out. */
const STAT_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-3 lg:grid-cols-5',
  6: 'sm:grid-cols-3 xl:grid-cols-6',
};

export default function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { user, can } = useAuth();
  const f = useFormat();
  const dashboard = useDashboard();
  const data = dashboard.data;
  const today = data?.today ?? todayISO();

  const greeting = t(`greeting.${greetingFor(new Date().getHours())}`, { name: firstName(user?.name) });
  const stats = data ? STATS.filter((s) => data.counts[s.key] !== undefined) : [];
  const actions = QUICK_ACTIONS.filter((a) => can(a.permission));

  // Admissions sit with the school cards, first: follow-ups due are the day's to-do list.
  const school = data
    ? [
        data.followUpsDue && (
          <FollowUpsCard key="followUps" leads={data.followUpsDue} total={data.followUpsDueCount ?? data.followUpsDue.length} today={today} />
        ),
        data.upcomingInterviews && <InterviewsCard key="interviews" interviews={data.upcomingInterviews} />,
        data.todaySessions && <TodayClassesCard key="today" sessions={data.todaySessions} today={today} mine={!can('classes.all')} />,
        data.attendanceToDo && data.attendanceToDo.length > 0 && (
          <AttendanceCard key="attendance" sessions={data.attendanceToDo} total={data.attendanceToDoCount ?? data.attendanceToDo.length} today={today} />
        ),
      ].filter(Boolean)
    : [];
  const agency = data
    ? [
        data.upcomingAuditions && <AuditionsCard key="auditions" auditions={data.upcomingAuditions} />,
        data.closingCastings && <ClosingCastingsCard key="closing" castings={data.closingCastings} today={today} />,
      ].filter(Boolean)
    : [];

  let body;
  if (dashboard.isPending) body = <PageLoader />;
  else if (dashboard.isError || !data) body = <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  else if (!user?.permissions.length)
    // An account whose positions allow nothing (yet): say so here rather than showing a blank page.
    body = (
      <EmptyState icon={Lock} title={t('noAccess')} description={t('common:profile.nothingYet')} className="rounded-2xl border border-dashed border-line-strong" />
    );
  else if (!stats.length && !actions.length && !school.length && !agency.length)
    body = <EmptyState icon={LayoutDashboard} title={t('empty.title')} description={t('empty.hint')} className="rounded-2xl border border-dashed border-line-strong" />;
  else
    body = (
      <div className="space-y-6">
        {stats.length > 0 && (
          <section aria-label={t('stats.label')} className={clsx('grid grid-cols-2 gap-3', STAT_COLS[stats.length])}>
            {stats.map((s) => (
              <StatCard key={s.key} label={t(`stats.${s.key}`)} value={f.number(data.counts[s.key] ?? 0)} icon={s.icon} to={s.to} />
            ))}
          </section>
        )}

        {actions.length > 0 && (
          <section aria-labelledby="quick-actions">
            <h2 id="quick-actions" className="sr-only">
              {t('quick.label')}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {actions.map((a) => (
                <ButtonLink key={a.key} to={a.to} icon={a.icon} className="w-full sm:w-auto">
                  {t(`quick.${a.key}`)}
                </ButtonLink>
              ))}
            </div>
          </section>
        )}

        <SectionColumns school={school} agency={agency} />
      </div>
    );

  return (
    <div>
      <PageHeader title={greeting} subtitle={f.date(today, 'full')} documentTitle={t('title')} />
      {body}
    </div>
  );
}

/**
 * School cards and agency cards. On desktop, when both exist, each group is its
 * own column so a long auditions list doesn't leave a hole under a short card;
 * otherwise the cards simply flow two by two.
 */
function SectionColumns({ school, agency }: { school: ReactNode[]; agency: ReactNode[] }) {
  const a = school.filter(Boolean);
  const b = agency.filter(Boolean);
  if (a.length && b.length) {
    return (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <div className="grid min-w-0 grid-cols-1 gap-5">{a}</div>
        <div className="grid min-w-0 grid-cols-1 gap-5">{b}</div>
      </div>
    );
  }
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">{[...a, ...b]}</div>;
}
