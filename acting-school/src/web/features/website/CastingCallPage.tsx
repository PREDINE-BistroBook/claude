import clsx from 'clsx';
import { ChevronRight, CircleCheck, CircleOff, UserRoundPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { siteContent, type SiteContent } from '@shared/schemas/site';
import { Button, ErrorState, FormActions, FormError, FormPage, FormSection, PageHeader, PageLoader, useToast } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { errorMessageKey, useForm } from '@web/lib/forms';
import { useSiteContent, useSiteSummary, useUpdateSiteContent } from './api';
import { BigSwitch } from './components/BigSwitch';
import { BilingualField } from './components/BilingualField';

/**
 * /website/casting-call — open or close the casting call (saved at once, like
 * the switch on the Website home), and the two texts its page shows.
 */
export default function CastingCallPage() {
  const { t } = useTranslation(['website', 'common']);
  const content = useSiteContent();
  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('castingCall.title')} subtitle={t('castingCall.subtitle')} />
      </div>
      {content.isPending ? (
        <PageLoader />
      ) : content.isError ? (
        <ErrorState error={content.error} onRetry={() => void content.refetch()} />
      ) : (
        <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5">
          <OpenSwitch open={content.data.castingCall.open} />
          <ApplicationsLink />
          <CastingTexts content={content.data} />
        </div>
      )}
    </div>
  );
}

function OpenSwitch({ open }: { open: boolean }) {
  const { t } = useTranslation(['website', 'common']);
  const toast = useToast();
  const update = useUpdateSiteContent();
  const [pending, setPending] = useState<boolean | null>(null);
  const isOpen = pending ?? open;

  const set = (next: boolean) => {
    setPending(next);
    update.mutate((current) => ({ castingCall: { ...current.castingCall, open: next } }), {
      onSuccess: () => toast.success(t(next ? 'castingToast.opened' : 'castingToast.closed')),
      onError: (err) => toast.error(t(errorMessageKey(err))),
      onSettled: () => setPending(null),
    });
  };

  return (
    <section aria-labelledby="cc-state" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 id="cc-state" className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
        {t('castingCall.state')}
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
            isOpen ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted',
          )}
        >
          {isOpen ? <CircleCheck className="size-4" aria-hidden /> : <CircleOff className="size-4" aria-hidden />}
          {isOpen ? t('castingCall.open') : t('castingCall.closed')}
        </span>
      </h2>
      <BigSwitch className="mt-4" checked={isOpen} onChange={set} disabled={update.isPending} label={t('castingCall.switchLabel')} />
      <ul className="mt-4 grid gap-2 text-sm">
        <li className={clsx('rounded-xl px-3 py-2', isOpen ? 'bg-success-soft text-ink' : 'text-muted')}>{t('castingCall.openExplain')}</li>
        <li className={clsx('rounded-xl px-3 py-2', !isOpen ? 'bg-surface-2 text-ink' : 'text-muted')}>{t('castingCall.closedExplain')}</li>
      </ul>
    </section>
  );
}

/** Straight to Casting › Applications, with the number of new ones (for people who may see them). */
function ApplicationsLink() {
  const { t } = useTranslation(['website', 'common']);
  const { can } = useAuth();
  const summary = useSiteSummary();
  if (!can('talent.read')) return null;
  const count = summary.data?.newCastingApplications ?? null;
  return (
    <Link
      to="/casting/applications"
      className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:bg-surface-2"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-section-soft text-section" aria-hidden>
        <UserRoundPlus className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{t('castingCall.applications')}</span>
        {count !== null && <span className="block text-sm text-muted">{t('castingCall.newApplications', { count })}</span>}
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}

interface TextValues extends Record<string, unknown> {
  introEn: string;
  introAr: string;
  lookingForEn: string;
  lookingForAr: string;
}

function CastingTexts({ content }: { content: SiteContent }) {
  const { t } = useTranslation(['website', 'common']);
  const toast = useToast();
  const save = useUpdateSiteContent();
  const cc = content.castingCall;
  const form = useForm<TextValues>({ introEn: cc.intro.en, introAr: cc.intro.ar, lookingForEn: cc.lookingFor.en, lookingForAr: cc.lookingFor.ar });
  const v = form.values;

  const submit = () => {
    const texts = { intro: { en: v.introEn, ar: v.introAr }, lookingFor: { en: v.lookingForEn, ar: v.lookingForAr } };
    const parsed = form.validate(siteContent, { ...content, castingCall: { ...cc, ...texts } });
    if (!parsed) return;
    // Only the texts: the open/closed state stays whatever it is on the server now.
    save.mutate((current) => ({ castingCall: { ...current.castingCall, intro: parsed.castingCall.intro, lookingFor: parsed.castingCall.lookingFor } }), {
      onSuccess: () => toast.success(t('castingCall.saved')),
      onError: form.setServerError,
    });
  };

  const pair = (field: 'intro' | 'lookingFor') => ({
    value: { en: v[`${field}En` as const], ar: v[`${field}Ar` as const] },
    onChange: (half: 'en' | 'ar', text: string) => form.set(half === 'en' ? (`${field}En` as const) : (`${field}Ar` as const), text),
    errors: { en: form.error(`castingCall.${field}.en`), ar: form.error(`castingCall.${field}.ar`) },
    idPrefix: `f-${field}`,
  });

  return (
    <FormPage onSubmit={submit} className="w-full">
      <FormError messageKey={form.formError} />
      <FormSection title={t('castingCall.texts')} description={t('castingCall.textsHint')}>
        <BilingualField label={t('castingCall.intro')} hint={t('castingCall.introHint')} multiline rows={5} maxLength={2000} {...pair('intro')} />
        <BilingualField label={t('castingCall.lookingFor')} hint={t('castingCall.lookingForHint')} multiline rows={5} maxLength={2000} {...pair('lookingFor')} />
      </FormSection>
      <FormActions>
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          {save.isPending ? t('common:actions.saving') : t('common:actions.saveChanges')}
        </Button>
      </FormActions>
    </FormPage>
  );
}
