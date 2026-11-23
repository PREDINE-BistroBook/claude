import { BellRing, Globe, GraduationCap, Inbox, LayoutDashboard, MessageSquarePlus, Sparkles, UserPlus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { todayISO } from '@shared/dates';
import { EmptyState, ErrorState, PageLoader } from '@web/components/ui';
import { SectionHomeHeader } from '@web/layout/SectionHomeHeader';
import { useAuth } from '@web/lib/auth';
import { VideoHomeCards, videoHomeCardKinds } from '../videos/components/VideoHomeCards';
import { useVideoCounts } from '../videos/api';
import { useDashboard } from './api';
import { CardGrid, QuickActions, StatGrid, useAllowedCount, useGreetingLine, type HomeStat, type QuickAction } from './components/HomeParts';
import { AttendanceCard, FollowUpsCard, InterviewsCard, TodayClassesCard } from './components/Sections';

const STATS: HomeStat[] = [
  { key: 'openLeads', to: '/admissions?tab=open', icon: Inbox },
  { key: 'newLeadsThisWeek', to: '/admissions?tab=open', icon: Sparkles },
  // Enquiries sent from the public website and not yet answered: Admissions' "New" tab, website only.
  { key: 'newWebsiteLeads', to: '/admissions?tab=new&source=website', icon: Globe },
  { key: 'activeStudents', to: '/students', icon: Users },
  { key: 'activeCourses', to: '/classes', icon: GraduationCap },
];

const ACTIONS: QuickAction[] = [
  { key: 'newEnquiry', to: '/admissions/new', icon: MessageSquarePlus, permission: 'admissions.write' },
  { key: 'newStudent', to: '/students/new', icon: UserPlus, permission: 'students.write' },
  // For those who may call people to the office: the Team page has the button beside everyone.
  { key: 'callToOffice', to: '/team', icon: BellRing, permission: 'staff.summon' },
];

/**
 * /school — the School section's home: the video cards for whoever edits,
 * checks or adds class videos, today's sessions (a coach's own), attendance
 * still to take, admissions follow-ups and interviews, and the school's
 * counts. Nothing from casting.
 */
export default function SchoolHomePage() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { can } = useAuth();
  const dashboard = useDashboard();
  const data = dashboard.data;
  const today = data?.today ?? todayISO();
  const greeting = useGreetingLine(today);
  const allowedActions = useAllowedCount(ACTIONS);
  // The video pipeline's cards (Part L): the editor's, the reviewer's, the coach's — from the 20-second poll.
  const videoCards = videoHomeCardKinds(useVideoCounts()).length;

  const cards = data
    ? [
        data.todaySessions && <TodayClassesCard key="today" sessions={data.todaySessions} today={today} mine={!can('classes.all')} />,
        data.followUpsDue && (
          <FollowUpsCard key="followUps" leads={data.followUpsDue} total={data.followUpsDueCount ?? data.followUpsDue.length} today={today} />
        ),
        data.upcomingInterviews && <InterviewsCard key="interviews" interviews={data.upcomingInterviews} />,
        data.attendanceToDo && data.attendanceToDo.length > 0 && (
          <AttendanceCard key="attendance" sessions={data.attendanceToDo} total={data.attendanceToDoCount ?? data.attendanceToDo.length} today={today} />
        ),
      ].filter(Boolean)
    : [];
  const hasStats = !!data && STATS.some((s) => data.counts[s.key] != null);

  let body;
  if (dashboard.isPending) body = <PageLoader />;
  else if (dashboard.isError || !data) body = <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  else if (!hasStats && !allowedActions && !cards.length && !videoCards)
    body = <EmptyState icon={LayoutDashboard} title={t('empty.title')} description={t('empty.hint')} className="rounded-2xl border border-dashed border-line-strong" />;
  else
    body = (
      <div className="space-y-6">
        <VideoHomeCards />
        <StatGrid stats={STATS} counts={data.counts} />
        <QuickActions actions={ACTIONS} />
        <CardGrid>{cards}</CardGrid>
      </div>
    );

  return (
    <div>
      <SectionHomeHeader section="school" subtitle={greeting} />
      {body}
    </div>
  );
}
