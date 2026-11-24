import clsx from 'clsx';
import { ChevronRight, ExternalLink, Eye, Globe, GraduationCap, Home, Inbox, Link2, Megaphone, Presentation, UserRoundPlus, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { todayISO } from '@shared/dates';
import type { Locale } from '@shared/enums';
import type { SiteUrls } from '@shared/schemas/site';
import { Card, ConfirmDialog, ErrorState, PageLoader, Segmented, buttonClasses, useToast } from '@web/components/ui';
import { SectionHomeHeader } from '@web/layout/SectionHomeHeader';
import { errorMessageKey } from '@web/lib/forms';
import { useFormat } from '@web/lib/format';
import { HOME_QUICK_ACTIONS } from '@web/layout/addActions';
import { QuickActions, useGreetingLine } from '../dashboard/components/HomeParts';
import { useSiteSummary, useUpdateSiteContent } from './api';
import { BigSwitch } from './components/BigSwitch';
import { PublicLinkRow } from './components/PublicLink';
import { linkLocale, previewUrlFor, publishStateKey } from './utils';

const PAGES: { key: keyof SiteUrls; icon: LucideIcon }[] = [
  { key: 'home', icon: Home },
  { key: 'workshops', icon: GraduationCap },
  { key: 'castingCall', icon: Megaphone },
  { key: 'links', icon: Link2 },
];

/**
 * /website — the Website section's home: first the master switch, "Website is
 * public" (off: visitors to the studio's domain see "coming soon" and only the
 * team's previews show the site; turning it on asks first), then one big
 * button — "Open the website", or "Preview the website" while it is not public
 * — the numbers that need someone (new enquiries, new casting applications),
 * the casting call with a quick switch, what the site shows, and every public
 * page with "Open" (or "Preview") and "Copy link" in either language.
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
  const [pendingPublished, setPendingPublished] = useState<boolean | null>(null);
  // Turning the website on asks first: the demo content is made up, and the studio's real numbers are next to it.
  const [confirmPublish, setConfirmPublish] = useState(false);

  const data = summary.data;

  const setPublished = (published: boolean) => {
    setPendingPublished(published);
    update.mutate(() => ({ published }), {
      onSuccess: () => toast.success(t(published ? 'publish.toastOn' : 'publish.toastOff')),
      onError: (err) => toast.error(t(errorMessageKey(err))),
      onSettled: () => {
        setPendingPublished(null);
        setConfirmPublish(false);
      },
    });
  };

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
    const published = pendingPublished ?? data.published;
    const screenLang = linkLocale(i18n.language);
    // Not public yet: the public address only shows "coming soon", so the big button opens the team's preview.
    const siteHome = previewUrlFor(data, screenLang, 'home') ?? data.urls[screenLang].home;
    body = (
      <div className="space-y-6">
        <section
          aria-label={t('publish.title')}
          className={clsx('rounded-2xl border-2 p-4 sm:p-5', published ? 'border-success/50 bg-success-soft' : 'border-warning/60 bg-warning-soft')}
        >
          <div className="mb-3 flex items-center gap-3">
            <span className={clsx('flex size-12 shrink-0 items-center justify-center rounded-xl', published ? 'bg-success text-success-ink' : 'bg-warning text-warning-ink')} aria-hidden>
              {published ? <Globe className="size-6" /> : <Eye className="size-6" />}
            </span>
            <h2 className="text-lg font-semibold text-ink">{t('publish.title')}</h2>
          </div>
          <BigSwitch
            checked={published}
            onChange={(next) => (next ? setConfirmPublish(true) : setPublished(false))}
            disabled={update.isPending}
            label={t('publish.switch')}
            className="bg-surface"
          />
          <p className="mt-3 text-base text-ink" role="status">
            {t(publishStateKey(published, data.publicHost), { host: data.publicHost ?? '' })}
          </p>
        </section>

        {/* The site's big button; under it the quick actions: Add coach, Add link, and "Order a drink" (the cafeteria) like every section home. */}
        <a href={siteHome} target="_blank" rel="noopener" className={buttonClasses('primary', 'lg', 'h-14 w-full text-lg sm:w-auto sm:px-8')}>
          <ExternalLink className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
          {t(data.published ? 'home.open' : 'home.preview')}
          <span className="sr-only"> {t('links.opensNewTab')}</span>
        </a>
        <QuickActions actions={[...HOME_QUICK_ACTIONS.website]} />

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
              <Link to="/website/casting-call" className="flex min-h-12 min-w-0 items-center gap-2 font-semibold text-ink hover:underline">
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

        <Card title={t('home.pages')} description={data.published ? t('home.pagesHint') : t('home.pagesHintNotPublic')} padded={false}>
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <Segmented
              label={t('home.pageLanguage')}
              value={lang}
              onChange={setLang}
              options={[
                { value: 'en', label: <span lang="en">{t('bilingual.en')}</span> },
                { value: 'ar', label: <span lang="ar">{t('bilingual.ar')}</span> },
              ]}
              className="[&_button]:min-h-12 [&_button]:px-5 [&_button]:text-base"
            />
          </div>
          <ul className="divide-y divide-line">
            {PAGES.map((p) => (
              <PublicLinkRow
                key={p.key}
                label={t(`home.page.${p.key}`)}
                url={data.urls[lang][p.key]}
                previewUrl={previewUrlFor(data, lang, p.key)}
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
      {body}
      <ConfirmDialog
        open={confirmPublish}
        tone="primary"
        title={t('publish.confirmTitle')}
        message={t('publish.confirmMessage')}
        confirmLabel={t('publish.confirmYes')}
        loading={update.isPending}
        onConfirm={() => setPublished(true)}
        onCancel={() => setConfirmPublish(false)}
      />
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
