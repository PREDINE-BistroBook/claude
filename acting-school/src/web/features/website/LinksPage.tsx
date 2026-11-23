import { Camera, GraduationCap, Link2, Megaphone, MessageCircle, Pencil, Plus, Trash2, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_SITE_LINKS, siteLinkInput, type SiteContent, type SiteLink } from '@shared/schemas/site';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormError,
  Modal,
  PageHeader,
  PageLoader,
  Switch,
  TextField,
  useToast,
} from '@web/components/ui';
import { errorMessageKey, useForm } from '@web/lib/forms';
import { useSiteContent, useSiteSummary, useSiteWorkshops, useUpdateSiteContent } from './api';
import { BigSwitch } from './components/BigSwitch';
import { BilingualField } from './components/BilingualField';
import { MoveButtons } from './components/MoveButtons';
import { PublicLinkRow } from './components/PublicLink';
import { linkLabel, moveItem, previewUrlFor, replaceLink, shortUrl } from './utils';

/**
 * /website/links — the link-in-bio page: its address to put in the Instagram
 * bio, the buttons the site adds by itself, and the studio's own links (add,
 * edit, delete with confirm, move up/down, show or hide). Every change is
 * saved at once.
 */
export default function LinksPage() {
  const { t } = useTranslation(['website', 'common']);
  const content = useSiteContent();
  const summary = useSiteSummary();
  return (
    <div>
      <PageHeader title={t('linkPage.title')} subtitle={t('linkPage.subtitle')} />
      {content.isPending ? (
        <PageLoader />
      ) : content.isError ? (
        <ErrorState error={content.error} onRetry={() => void content.refetch()} />
      ) : (
        // Block layout, not grid: a grid item would grow to fit a long link that is meant to be cut with "…".
        <div className="space-y-4 sm:space-y-5">
          <Card title={t('linkPage.bioTitle')} description={summary.data && !summary.data.published ? `${t('linkPage.bioHint')} ${t('home.pagesHintNotPublic')}` : t('linkPage.bioHint')} padded={false}>
            {summary.data ? (
              <ul className="divide-y divide-line">
                <PublicLinkRow label={t('linkPage.arabicPage')} url={summary.data.urls.ar.links} previewUrl={previewUrlFor(summary.data, 'ar', 'links')} />
                <PublicLinkRow label={t('linkPage.englishPage')} url={summary.data.urls.en.links} previewUrl={previewUrlFor(summary.data, 'en', 'links')} />
              </ul>
            ) : summary.isError ? (
              <ErrorState error={summary.error} onRetry={() => void summary.refetch()} className="py-6" />
            ) : (
              <PageLoader />
            )}
          </Card>
          <AutomaticButtons content={content.data} />
          <CustomLinks links={content.data.links} />
        </div>
      )}
    </div>
  );
}

function AutomaticButtons({ content }: { content: SiteContent }) {
  const { t } = useTranslation(['website', 'common']);
  const workshops = useSiteWorkshops();
  const taking = workshops.data?.items.filter((w) => w.onSite && w.acceptingApplications).length;
  const rows: { icon: LucideIcon; label: string; detail: ReactNode; on: boolean }[] = [
    {
      icon: GraduationCap,
      label: t('linkPage.autoWorkshops'),
      detail: taking === undefined ? '…' : t('linkPage.autoWorkshopsCount', { count: taking }),
      on: (taking ?? 0) > 0,
    },
    {
      icon: Megaphone,
      label: t('linkPage.autoCasting'),
      detail: content.castingCall.open ? t('linkPage.autoCastingOpen') : t('linkPage.autoCastingClosed'),
      on: content.castingCall.open,
    },
    {
      icon: MessageCircle,
      label: t('linkPage.autoWhatsappWorkshops'),
      detail: content.whatsappWorkshops ? <Ltr>{content.whatsappWorkshops}</Ltr> : t('linkPage.notSet'),
      on: !!content.whatsappWorkshops,
    },
    {
      icon: MessageCircle,
      label: t('linkPage.autoWhatsappCasting'),
      detail: content.whatsappCasting ? <Ltr>{content.whatsappCasting}</Ltr> : t('linkPage.notSet'),
      on: !!content.whatsappCasting,
    },
    {
      icon: Camera,
      label: t('linkPage.autoInstagram'),
      detail: content.instagram ? <Ltr>@{content.instagram}</Ltr> : t('linkPage.notSet'),
      on: !!content.instagram,
    },
  ];
  return (
    <Card title={t('linkPage.automatic')} description={t('linkPage.automaticHint')} padded={false}>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${r.on ? 'bg-section-soft text-section' : 'bg-surface-2 text-muted'}`} aria-hidden>
              <r.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink">{r.label}</span>
              <span className="block text-sm text-muted">{r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const Ltr = ({ children }: { children: ReactNode }) => (
  <bdi dir="ltr" className="font-medium">
    {children}
  </bdi>
);

function CustomLinks({ links }: { links: SiteLink[] }) {
  const { t, i18n } = useTranslation(['website', 'common']);
  const toast = useToast();
  const update = useUpdateSiteContent();
  const [editing, setEditing] = useState<SiteLink | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SiteLink | null>(null);

  const saveLinks = (change: (current: SiteLink[]) => SiteLink[], message?: string, after?: () => void) =>
    update.mutate((current) => ({ links: change(current.links) }), {
      onSuccess: () => {
        if (message) toast.success(message);
        after?.();
      },
      onError: (err) => toast.error(t(errorMessageKey(err))),
    });

  const move = (link: SiteLink, delta: -1 | 1) =>
    saveLinks((current) => {
      const i = current.findIndex((l) => l.id === link.id);
      return i < 0 ? current : moveItem(current, i, delta);
    }, t('move.saved'));

  const full = links.length >= MAX_SITE_LINKS;
  const add = (
    <Button variant="primary" size="lg" icon={Plus} onClick={() => setEditing('new')} disabled={full}>
      {t('linkPage.add')}
    </Button>
  );

  return (
    <Card title={t('linkPage.custom')} description={t('linkPage.customHint')} actions={links.length > 0 ? <span className="hidden sm:block">{add}</span> : undefined}>
      {links.length === 0 ? (
        <EmptyState icon={Link2} title={t('linkPage.empty')} description={t('linkPage.emptyHint')} action={add} className="py-8" />
      ) : (
        <>
          <ol className="grid gap-3">
            {links.map((l, i) => {
              const label = linkLabel(l, i18n.language);
              return (
                <li key={l.id} className="grid min-w-0 gap-3 rounded-xl border border-line p-3 [&>*]:min-w-0">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted" aria-hidden>
                      <Link2 className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <bdi className="block font-semibold text-ink">{label}</bdi>
                      <div dir="ltr" className="truncate text-start text-sm text-muted [unicode-bidi:plaintext]">
                        {shortUrl(l.url)}
                      </div>
                      <div className="mt-1">{l.visible ? <Badge tone="success">{t('linkPage.shown')}</Badge> : <Badge>{t('linkPage.hidden')}</Badge>}</div>
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface-2 px-3 [&_[role=switch]]:h-12">
                    <Switch
                      checked={l.visible}
                      disabled={update.isPending}
                      onChange={(on) => saveLinks((current) => current.map((x) => (x.id === l.id ? { ...x, visible: on } : x)))}
                      label={
                        <>
                          {t('linkPage.show')}
                          <span className="sr-only">: {label}</span>
                        </>
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center [&>*]:min-w-0">
                    <MoveButtons name={label} index={i} count={links.length} onMove={(d) => move(l, d)} disabled={update.isPending} />
                    <div className="grid grid-cols-2 gap-2 sm:ms-auto sm:flex [&>*]:min-w-0">
                      <Button size="lg" icon={Pencil} onClick={() => setEditing(l)}>
                        {t('common:actions.edit')}
                        <span className="sr-only">: {label}</span>
                      </Button>
                      <Button size="lg" variant="danger-ghost" icon={Trash2} onClick={() => setDeleting(l)}>
                        {t('common:actions.delete')}
                        <span className="sr-only">: {label}</span>
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 grid sm:hidden">{add}</div>
          {full && <p className="mt-3 text-sm text-muted">{t('linkPage.max', { max: MAX_SITE_LINKS })}</p>}
        </>
      )}

      <LinkModal
        link={editing}
        saving={update.isPending}
        onClose={() => setEditing(null)}
        onSave={(link, onError) =>
          update.mutate((current) => ({ links: link.id ? replaceLink(current.links, link) : [...current.links, link] }), {
            onSuccess: () => {
              toast.success(t('linkPage.saved'));
              setEditing(null);
            },
            onError,
          })
        }
      />

      <ConfirmDialog
        open={!!deleting}
        title={t('linkPage.deleteTitle')}
        message={deleting ? t('linkPage.deleteMessage', { label: linkLabel(deleting, i18n.language) }) : undefined}
        loading={update.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const id = deleting?.id;
          saveLinks((current) => current.filter((l) => l.id !== id), t('linkPage.deleted'), () => setDeleting(null));
        }}
      />
    </Card>
  );
}

interface LinkValues extends Record<string, unknown> {
  labelEn: string;
  labelAr: string;
  url: string;
  visible: boolean;
}

/** Add or edit one custom link. A new link has no id yet: the server gives it one. */
function LinkModal({
  link,
  saving,
  onClose,
  onSave,
}: {
  link: SiteLink | 'new' | null;
  saving: boolean;
  onClose: () => void;
  onSave: (link: SiteLink, onError: (err: unknown) => void) => void;
}) {
  const { t } = useTranslation(['website', 'common']);
  return (
    <Modal open={!!link} onClose={onClose} title={link === 'new' ? t('linkPage.newTitle') : t('linkPage.editTitle')}>
      {link && <LinkForm key={link === 'new' ? 'new' : link.id} link={link === 'new' ? null : link} saving={saving} onCancel={onClose} onSave={onSave} />}
    </Modal>
  );
}

function LinkForm({
  link,
  saving,
  onCancel,
  onSave,
}: {
  link: SiteLink | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (link: SiteLink, onError: (err: unknown) => void) => void;
}) {
  const { t } = useTranslation(['website', 'common']);
  const form = useForm<LinkValues>({ labelEn: link?.label.en ?? '', labelAr: link?.label.ar ?? '', url: link?.url ?? '', visible: link?.visible ?? true });
  const v = form.values;

  const submit = () => {
    const parsed = form.validate(siteLinkInput, { id: link?.id ?? null, label: { en: v.labelEn, ar: v.labelAr }, url: v.url, visible: v.visible });
    if (!parsed) return;
    // The server answers field issues for the whole content (links.<n>.url): show them as a message on the form.
    onSave({ id: parsed.id ?? '', label: parsed.label, url: parsed.url, visible: parsed.visible }, (err) => form.setFormError(errorMessageKey(err)));
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid gap-4"
    >
      <FormError messageKey={form.formError} />
      <BilingualField
        label={t('linkPage.label')}
        required
        maxLength={60}
        idPrefix="f-link-label"
        value={{ en: v.labelEn, ar: v.labelAr }}
        onChange={(half, text) => form.set(half === 'en' ? 'labelEn' : 'labelAr', text)}
        errors={{ en: form.error('label.en'), ar: form.error('label.ar') }}
      />
      <TextField
        label={t('linkPage.url')}
        hint={t('linkPage.urlHint')}
        type="url"
        inputMode="url"
        dir="ltr"
        placeholder="https://"
        required
        {...form.bind('url')}
        error={form.error('url')}
      />
      <BigSwitch checked={v.visible} onChange={(on) => form.set('visible', on)} label={t('linkPage.show')} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <Button size="lg" variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common:actions.cancel')}
        </Button>
        <Button type="submit" size="lg" variant="primary" loading={saving}>
          {saving ? t('common:actions.saving') : t('common:actions.save')}
        </Button>
      </div>
    </form>
  );
}
