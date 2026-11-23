import { Binoculars, Clapperboard, LayoutDashboard, Star, UserRoundPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { todayISO } from '@shared/dates';
import { EmptyState, ErrorState, PageLoader } from '@web/components/ui';
import { HOME_QUICK_ACTIONS } from '@web/layout/addActions';
import { SectionHomeHeader } from '@web/layout/SectionHomeHeader';
import { useDashboard } from './api';
import { CardGrid, QuickActions, StatGrid, useAllowedCount, useGreetingLine, type HomeStat, type QuickAction } from './components/HomeParts';
import { AuditionsCard, ClosingCastingsCard } from './components/Sections';

const STATS: HomeStat[] = [
  { key: 'activeTalent', to: '/talent', icon: Star },
  { key: 'openCastings', to: '/castings', icon: Clapperboard },
  // Casting-call applications from the website still waiting for someone.
  { key: 'newCastingApplications', to: '/casting/applications', icon: UserRoundPlus },
  // Casting calls the team saw elsewhere and nobody has looked at yet (Part K1).
  { key: 'newOpportunities', to: '/casting/opportunities', icon: Binoculars },
];

/** New talent, New casting, Add opportunity, then Call to the office (layout/addActions.ts). */
const ACTIONS: QuickAction[] = [...HOME_QUICK_ACTIONS.casting];

/**
 * /casting — the Casting section's home: upcoming auditions, castings closing
 * soon, the roster size, open castings, new casting-call applications and new
 * opportunities.
 * Nothing from the school.
 */
export default function CastingHomePage() {
  const { t } = useTranslation(['dashboard', 'common']);
  const dashboard = useDashboard();
  const data = dashboard.data;
  const today = data?.today ?? todayISO();
  const greeting = useGreetingLine(today);
  const allowedActions = useAllowedCount(ACTIONS);

  const cards = data
    ? [
        data.upcomingAuditions && <AuditionsCard key="auditions" auditions={data.upcomingAuditions} />,
        data.closingCastings && <ClosingCastingsCard key="closing" castings={data.closingCastings} today={today} />,
      ].filter(Boolean)
    : [];
  const hasStats = !!data && STATS.some((s) => data.counts[s.key] != null);

  let body;
  if (dashboard.isPending) body = <PageLoader />;
  else if (dashboard.isError || !data) body = <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  else if (!hasStats && !allowedActions && !cards.length)
    body = <EmptyState icon={LayoutDashboard} title={t('empty.title')} description={t('empty.hint')} className="rounded-2xl border border-dashed border-line-strong" />;
  else
    body = (
      <div className="space-y-6">
        <StatGrid stats={STATS} counts={data.counts} />
        <QuickActions actions={ACTIONS} />
        <CardGrid>{cards}</CardGrid>
      </div>
    );

  return (
    <div>
      <SectionHomeHeader section="casting" subtitle={greeting} />
      {body}
    </div>
  );
}
