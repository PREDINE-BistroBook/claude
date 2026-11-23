import clsx from 'clsx';
import { ChevronRight, ExternalLink, GraduationCap, Home, Inbox, Link2, Megaphone, Presentation, UserRoundPlus, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { todayISO } from '@shared/dates';
import type { Locale } from '@shared/enums';
import type { SiteUrls } from '@shared/schemas/site';
import { Card, ErrorState, PageLoader, Segmented, buttonClasses, useToast } from '@web/components/ui';
import { SectionHomeHeader } from '@web/layout/SectionHomeHeader';
import { errorMessageKey } from '@web/lib/forms';
import { useFormat } from '@web/lib/format';
import { useGreetingLine } from '../dashboard/components/HomeParts';
import { useSiteSummary, useUpdateSiteContent } from './api';
import { BigSwitch } from './components/BigSwitch';
import { PublicLinkRow } from './components/PublicLink';
import { linkLocale } from './utils';

const PAGES: { key: keyof SiteUrls; icon: LucideIcon }[] = [
  { key: 'home', icon: Home },
  { key: 'workshops', icon: GraduationCap },
  { key: 'castingCall', icon: Megaphone },
  { key: 'links', icon: Link2 },
];

/**
 * /website — the Website section's home: one big "Open the website" button,
 * the numbers that need someone (new enquiries, new casting applications), the
 * casting call with a quick switch, what the site shows, and every public page
 * with "Open" and "Copy link" in either language.
 */
export default function WebsiteHomePage() {
  const { t, i18n } = useTranslation(['website', 'common']);
  const f = useFormat();
  const toast = useToast();
  const greeting = useGreetingLine(todayISO());
  const summary = useSiteSummary();
  const update = useUpdateSiteContent();
  const [lang, setLang] = useState<Locale>(linkLocale(i18n.language));
  // The switch moves as soon as it's tapped; it settles on the saved state.
  const [pendingOpen, setPendingOpen] = useState<boolean | null>(null);

  const data = summary.data;
  // The summary's own address for the site (its origin, or the studio's domain once the server gives it); /site until it loads.
  const siteHome = data?.urls[linkLocale(i18n.language)].home ?? '/site';

  const setCastingOpen = (open: boolean) => {
    setPendingOpen(open);
    update.mutate((current) => ({ castingCall: { ...current.castingCall, open } }), {
      onSuccess: () => toast.success(t(open ? 'castingToast.opened' : 'castingToast.closed')),
      onError: (err) => toast.error(t(errorMessageKey(err))),
      onSettled: () => setPendingOpen(null),
    });
  };

  let body: ReactNode;
  if (summary.isPending) body = <PageLoader />;
  else if (summary.isError || !data) body = <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  else {
    const castingOpen = pendingOpen ?? data.castingCallOpen;
    body = (
      <div className="space-y-6">
        <section aria-label={t('home.status')} className="grid gap-3 sm:grid-cols-2">
          {data.newWebsiteLeads !== null && (
            <StatusTile
              to="/admissions?tab=new&source=website"
              icon={Inbox}
              label={t('home.newEnquiries')}
              value={f.number(data.newWebsiteLeads)}
              highlight={data.newWebsiteLeads > 0}
            />
          )}
          {data.newCastingApplications !== null && (
            <StatusTile
              to="/casting/applications"
              icon={UserRoundPlus}
              label={t('home.newApplications')}
              value={f.number(data.newCastingApplications)}
              highlight={data.newCastingApplications > 0}
            />
          )}
          <div className="rounded-2xl border border-line bg-surface p-4 sm:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Link to="/website/casting-call" className="flex min-h-11 min-w-0 items-center gap-2 font-semibold text-ink hover:underline">
                <Megaphone className="size-5 shrink-0 text-muted" aria-hidden />
                {t('home.castingCall')}
                <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
              </Link>
            </div>
            <BigSwitch
              checked={castingOpen}
              onChange={setCastingOpen}
              disabled={update.isPending}
              label={t('home.castingCallSwitch')}
              description={castingOpen ? t('home.castingCallOpen') : t('home.castingCallClosed')}
            />
          </div>
          <StatusTile to="/website/workshops" icon={GraduationCap} label={t('home.workshopsShown')} value={f.number(data.visibleWorkshops)} />
          <StatusTile to="/website/coaches" icon={Presentation} label={t('home.coachesShown')} value={f.number(data.visibleCoaches)} />
        </section>

        <Card title={t('home.pages')} description={t('home.pagesHint')} padded={false}>
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <Segmented
              label={t('home.pageLanguage')}
              value={lang}
              onChange={setLang}
              options={[
                { value: 'en', label: <span lang="en">{t('bilingual.en')}</span> },
                { value: 'ar', label: <span lang="ar">{t('bilingual.ar')}</span> },
              ]}
              className="[&_button]:min-h-11 [&_button]:px-5 [&_button]:text-base"
            />
          </div>
          <ul className="divide-y divide-line">
            {PAGES.map((p) => (
              <PublicLinkRow
                key={p.key}
                label={t(`home.page.${p.key}`)}
                url={data.urls[lang][p.key]}
                icon={
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-section-soft text-section" aria-hidden>
                    <p.icon className="size-5" />
                  </span>
                }
              />
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHomeHeader section="website" subtitle={greeting} />
      <a
        href={siteHome}
        target="_blank"
        rel="noopener"
        className={buttonClasses('primary', 'lg', 'mb-6 h-14 w-full text-lg sm:w-auto sm:px-8')}
      >
        <ExternalLink className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
        {t('home.open')}
        <span className="sr-only"> {t('links.opensNewTab')}</span>
      </a>
      {body}
    </div>
  );
}

function StatusTile({ to, icon: Icon, label, value, highlight }: { to: string; icon: LucideIcon; label: string; value: string; highlight?: boolean }) {
  return (
    <Link
      to={to}
      className={clsx(
        'flex min-h-20 items-center gap-4 rounded-2xl border p-4 transition-colors hover:bg-surface-2',
        highlight ? 'border-section bg-section-soft' : 'border-line bg-surface',
      )}
    >
      <span className={clsx('flex size-12 shrink-0 items-center justify-center rounded-xl', highlight ? 'bg-section text-section-ink' : 'bg-surface-2 text-muted')} aria-hidden>
        <Icon className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-muted">{label}</span>
        <span className="block text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}
