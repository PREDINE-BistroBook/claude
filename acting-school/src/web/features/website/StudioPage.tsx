import { useTranslation } from 'react-i18next';
import { siteContent, type SiteContent } from '@shared/schemas/site';
import { Button, ErrorState, Field, FormActions, FormError, FormGrid, FormPage, FormSection, PageHeader, PageLoader, TextField, useToast } from '@web/components/ui';
import { useForm } from '@web/lib/forms';
import { useSiteContent, useUpdateSiteContent } from './api';
import { BilingualField } from './components/BilingualField';
import { CoverPhotoInput } from './components/CoverPhotoInput';

/**
 * /website/pages — "Studio & contact": the studio's texts (short line, about,
 * main photo) and the contact lines the website shows. One form, one Save.
 */
export default function StudioPage() {
  const { t } = useTranslation(['website', 'common']);
  const content = useSiteContent();
  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('studio.title')} subtitle={t('studio.subtitle')} />
      </div>
      {content.isPending ? (
        <PageLoader />
      ) : content.isError ? (
        <ErrorState error={content.error} onRetry={() => void content.refetch()} />
      ) : (
        <StudioForm content={content.data} />
      )}
    </div>
  );
}

interface StudioValues extends Record<string, unknown> {
  taglineEn: string;
  taglineAr: string;
  aboutEn: string;
  aboutAr: string;
  addressEn: string;
  addressAr: string;
  heroFileId: string | null;
  whatsappWorkshops: string;
  whatsappCasting: string;
  phone: string;
  email: string;
  instagram: string;
  mapUrl: string;
}

function initial(c: SiteContent): StudioValues {
  return {
    taglineEn: c.tagline.en,
    taglineAr: c.tagline.ar,
    aboutEn: c.about.en,
    aboutAr: c.about.ar,
    addressEn: c.address.en,
    addressAr: c.address.ar,
    heroFileId: c.heroFileId,
    whatsappWorkshops: c.whatsappWorkshops ?? '',
    whatsappCasting: c.whatsappCasting ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    instagram: c.instagram ? `@${c.instagram}` : '',
    mapUrl: c.mapUrl ?? '',
  };
}

/** This form's part of the site content (the casting call and the links are edited on their own screens). */
function studioPart(v: StudioValues) {
  return {
    tagline: { en: v.taglineEn, ar: v.taglineAr },
    about: { en: v.aboutEn, ar: v.aboutAr },
    address: { en: v.addressEn, ar: v.addressAr },
    heroFileId: v.heroFileId,
    whatsappWorkshops: v.whatsappWorkshops,
    whatsappCasting: v.whatsappCasting,
    phone: v.phone,
    email: v.email,
    instagram: v.instagram,
    mapUrl: v.mapUrl,
  };
}

function StudioForm({ content }: { content: SiteContent }) {
  const { t } = useTranslation(['website', 'common']);
  const toast = useToast();
  const form = useForm<StudioValues>(initial(content));
  const save = useUpdateSiteContent();
  const v = form.values;

  const submit = () => {
    // Check this form's fields with the shared schema before sending (the rest of the content is the server's copy).
    const parsed = form.validate(siteContent, { ...content, ...studioPart(v) });
    if (!parsed) return;
    save.mutate(
      () => ({
        tagline: parsed.tagline,
        about: parsed.about,
        address: parsed.address,
        heroFileId: parsed.heroFileId,
        whatsappWorkshops: parsed.whatsappWorkshops,
        whatsappCasting: parsed.whatsappCasting,
        phone: parsed.phone,
        email: parsed.email,
        instagram: parsed.instagram,
        mapUrl: parsed.mapUrl,
      }),
      {
        onSuccess: (saved) => {
          form.setValues(initial(saved));
          toast.success(t('studio.saved'));
        },
        onError: form.setServerError,
      },
    );
  };

  const bi = (prefix: 'tagline' | 'about' | 'address') => ({
    value: { en: v[`${prefix}En` as const], ar: v[`${prefix}Ar` as const] },
    onChange: (half: 'en' | 'ar', text: string) => form.set(half === 'en' ? (`${prefix}En` as const) : (`${prefix}Ar` as const), text),
    errors: { en: form.error(`${prefix}.en`), ar: form.error(`${prefix}.ar`) },
    idPrefix: `f-${prefix}`,
  });

  return (
    <FormPage onSubmit={submit}>
      <FormError messageKey={form.formError} />

      <FormSection title={t('studio.about')} description={t('studio.aboutHint')}>
        <BilingualField label={t('studio.tagline')} hint={t('studio.taglineHint')} maxLength={160} {...bi('tagline')} />
        <BilingualField label={t('studio.aboutText')} hint={t('studio.aboutTextHint')} multiline rows={7} maxLength={4000} {...bi('about')} />
        <Field label={t('studio.photo')} hint={t('studio.photoHint')} error={form.error('heroFileId')} htmlFor="f-heroFileId">
          <CoverPhotoInput id="f-heroFileId" value={v.heroFileId} onChange={(id) => form.set('heroFileId', id)} alt={t('studio.photo')} />
        </Field>
      </FormSection>

      <FormSection title={t('studio.contact')} description={t('studio.contactHint')}>
        <FormGrid>
          <TextField
            label={t('studio.whatsappWorkshops')}
            hint={t('studio.whatsappWorkshopsHint')}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            dir="ltr"
            placeholder="01094635959"
            {...form.bind('whatsappWorkshops')}
            error={form.error('whatsappWorkshops')}
          />
          <TextField
            label={t('studio.whatsappCasting')}
            hint={t('studio.whatsappCastingHint')}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            dir="ltr"
            placeholder="01119003100"
            {...form.bind('whatsappCasting')}
            error={form.error('whatsappCasting')}
          />
          <TextField label={t('studio.phone')} type="tel" inputMode="tel" dir="ltr" {...form.bind('phone')} error={form.error('phone')} optional />
          <TextField label={t('studio.email')} type="email" inputMode="email" dir="ltr" {...form.bind('email')} error={form.error('email')} optional />
          <TextField
            label={t('studio.instagram')}
            hint={t('studio.instagramHint')}
            dir="ltr"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="@turquoisecastingstudio"
            {...form.bind('instagram')}
            error={form.error('instagram')}
          />
          <TextField
            label={t('studio.mapUrl')}
            hint={t('studio.mapUrlHint')}
            type="url"
            inputMode="url"
            dir="ltr"
            placeholder="https://maps.app.goo.gl/…"
            {...form.bind('mapUrl')}
            error={form.error('mapUrl')}
            optional
          />
        </FormGrid>
        <BilingualField label={t('studio.address')} maxLength={300} {...bi('address')} />
      </FormSection>

      <FormActions>
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          {save.isPending ? t('common:actions.saving') : t('common:actions.saveChanges')}
        </Button>
      </FormActions>
    </FormPage>
  );
}
