import clsx from 'clsx';
import {
  ArrowLeft,
  Ban,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Info,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  ShieldAlert,
  Star,
  Trash2,
  Undo2,
  UserRoundPlus,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { telLink, whatsAppLink } from '@shared/phone';
import { CASTING_APPLICATION_ERROR_CODES, type CastingApplicationDetail } from '@shared/schemas/castingApplications';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  DescriptionList,
  ErrorState,
  IconButton,
  Modal,
  PageLoader,
  StatusBadge,
  buttonClasses,
  useEnumLabel,
  useToast,
} from '@web/components/ui';
import { ApiError, fileUrl } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { fullName, useFormat } from '@web/lib/format';
import { errorMessageKey } from '@web/lib/forms';
import { usePageTitle, useSchoolName } from '@web/lib/hooks';
import { useAdmissionsSettings } from '../admissions/api';
import { useAcceptApplication, useApplication, useDeleteApplication, useSetApplicationStatus } from './api';
import { applicationActions, type ApplicationAction } from './utils';

const LIST = '/casting/applications';

/** /casting/applications/:id — one application: photos, details, contact, and what to do with it. */
export default function ApplicationDetailPage() {
  const { t } = useTranslation(['applications', 'common']);
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const del = useDeleteApplication(id);
  const query = useApplication(id, valid && !del.isSuccess);

  if (!valid || query.isError) {
    return (
      <div>
        <BackLink />
        <ErrorState error={valid ? query.error : new ApiError(404, 'not_found', 'Not found')} onRetry={valid ? () => void query.refetch() : undefined} />
      </div>
    );
  }
  if (query.isPending) return <PageLoader />;
  return <ApplicationView application={query.data} del={del} />;
}

function BackLink() {
  const { t } = useTranslation(['applications', 'common']);
  return (
    <Link to={LIST} className="-ms-2 mb-2 inline-flex min-h-12 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink">
      <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
      {t('detail.back')}
    </Link>
  );
}

function ApplicationView({ application: a, del }: { application: CastingApplicationDetail; del: ReturnType<typeof useDeleteApplication> }) {
  const { t } = useTranslation(['applications', 'common']);
  const f = useFormat();
  const enumLabel = useEnumLabel();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const name = fullName(a);
  usePageTitle(name);
  const accept = useAcceptApplication(a.id);
  const setStatus = useSetApplicationStatus(a.id);
  const [confirm, setConfirm] = useState<'accept' | 'delete' | null>(null);
  // Added to the roster, but that talent profile was deleted since: the application is open again.
  const profileGone = a.status === 'accepted' && a.talentId === null;
  const actions = applicationActions(a.status, can('talent.write'), profileGone);
  // The parent's or guardian's phone lives only here (never in the talent profile's notes).
  const keepsGuardian = a.talentId !== null && (a.minor || !!a.guardianName);
  // Two to a row on phones: the label may wrap instead of filling the button edge to edge.
  const half = 'min-w-0 px-3! whitespace-normal! leading-tight';
  const showContact = can('talent.contact') && !a.contactHidden;

  const onAccept = () =>
    accept.mutate(undefined, {
      onSuccess: ({ talentId }) => {
        toast.success(t('actions.accepted'));
        navigate(`/talent/${talentId}`);
      },
      onError: (err) => {
        setConfirm(null);
        toast.error(err instanceof ApiError && err.code === CASTING_APPLICATION_ERROR_CODES.alreadyAccepted ? t('actions.alreadyAccepted') : t(errorMessageKey(err)));
      },
    });

  const onStatus = (status: 'new' | 'reviewing' | 'declined') =>
    setStatus.mutate(status, {
      onSuccess: () => toast.success(t('actions.statusSaved', { status: t(`common:enums.castingApplicationStatus.${status}`) })),
      onError: (err) => toast.error(t(errorMessageKey(err))),
    });

  const onDelete = () =>
    del.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('actions.deleted'));
        navigate(LIST, { replace: true });
      },
      onError: (err) => {
        setConfirm(null);
        toast.error(t(errorMessageKey(err)));
      },
    });

  const busy = accept.isPending || setStatus.isPending || del.isPending;
  const button = (action: ApplicationAction): ReactNode => {
    switch (action) {
      case 'accept':
        return (
          <Button key={action} variant="primary" size="lg" icon={UserRoundPlus} onClick={() => setConfirm('accept')} disabled={busy} className="col-span-2 sm:col-span-1">
            {t('actions.accept')}
          </Button>
        );
      case 'reviewing':
        return (
          <Button key={action} size="lg" icon={Eye} onClick={() => onStatus('reviewing')} loading={setStatus.isPending && setStatus.variables === 'reviewing'} disabled={busy} className={half}>
            {t('actions.reviewing')}
          </Button>
        );
      case 'new':
        return (
          <Button key={action} size="lg" icon={Undo2} onClick={() => onStatus('new')} loading={setStatus.isPending && setStatus.variables === 'new'} disabled={busy} className={half}>
            {t('actions.new')}
          </Button>
        );
      case 'decline':
        return (
          <Button key={action} size="lg" icon={Ban} onClick={() => onStatus('declined')} loading={setStatus.isPending && setStatus.variables === 'declined'} disabled={busy} className={half}>
            {t('actions.decline')}
          </Button>
        );
      case 'delete':
        return (
          <Button key={action} size="lg" variant="danger-ghost" icon={Trash2} onClick={() => setConfirm('delete')} disabled={busy} className={half}>
            {t('actions.delete')}
          </Button>
        );
    }
  };

  const facts = [
    a.age !== null ? t('common:units.years', { count: a.age }) : null,
    enumLabel('gender', a.gender) || null,
    a.city,
    a.heightCm ? t('common:units.cm', { value: f.number(a.heightCm) }) : null,
  ].filter(Boolean) as string[];

  return (
    <div>
      <BackLink />

      {/* ── Who ─────────────────────────────────────────────────────── */}
      <header className="mb-5 flex items-start gap-4">
        <Avatar name={name} fileId={a.photos[0]?.fileId} size="xl" shape="rounded" className="shadow-sm" />
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words text-ink sm:text-[1.75rem]">
            <bdi>{name}</bdi>
          </h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StatusBadge group="castingApplicationStatus" value={a.status} />
            {a.minor && (
              <Badge tone="warning">
                <ShieldAlert className="size-3.5" aria-hidden />
                {t('minor')}
              </Badge>
            )}
          </div>
          {facts.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              {facts.map((x, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  <bdi>{x}</bdi>
                </span>
              ))}
            </p>
          )}
        </div>
      </header>

      {/* ── What next ───────────────────────────────────────────────── */}
      {a.status === 'accepted' && a.talentId && (
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-success/30 bg-success-soft p-4 sm:flex-row sm:items-center">
          <p className="flex flex-1 items-center gap-2 font-medium text-ink">
            <Star className="size-5 shrink-0 text-success" aria-hidden />
            {t('detail.onRoster')}
          </p>
          <ButtonLink to={`/talent/${a.talentId}`} variant="primary" size="lg">
            {t('detail.openProfile')}
          </ButtonLink>
        </div>
      )}
      {profileGone && (
        <p className="mb-5 flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm font-medium text-ink">
          <Info className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          {t('detail.profileGone')}
        </p>
      )}
      {actions.length > 0 && (
        <section aria-label={t('actions.title')} className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {actions.map(button)}
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
          <Photos application={a} name={name} />
          {a.minor && <GuardianCard application={a} showContact={showContact} />}
          <Card title={t('detail.about')}>
            <DescriptionList
              columns={1}
              items={[
                { label: t('common:fields.dateOfBirth'), value: a.dateOfBirth ? `${f.date(a.dateOfBirth, 'long')}${a.age !== null ? ` (${t('common:units.years', { count: a.age })})` : ''}` : null },
                { label: t('common:fields.gender'), value: enumLabel('gender', a.gender) || null },
                { label: t('detail.height'), value: a.heightCm ? t('common:units.cm', { value: f.number(a.heightCm) }) : null },
                { label: t('detail.city'), value: a.city ? <bdi>{a.city}</bdi> : null },
                { label: t('detail.languages'), value: a.languages.length ? <Tags items={a.languages} /> : null },
                { label: t('detail.skills'), value: a.skills.length ? <Tags items={a.skills} /> : null },
                { label: t('detail.experience'), value: a.experience ? <Paragraphs text={a.experience} /> : null },
                { label: t('detail.message'), value: a.message ? <Paragraphs text={a.message} /> : null },
              ]}
            />
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <ContactCard application={a} showContact={showContact} />
          <Card>
            <DescriptionList
              columns={1}
              items={[
                { label: t('detail.appliedOn'), value: f.timestampTime(a.createdAt, 'long') },
                { label: t('detail.appliedIn'), value: <span lang={a.locale}>{t(`detail.locale.${a.locale}`)}</span> },
              ]}
            />
            {a.reviewedAt && a.reviewedByName && (
              <p className="mt-3 text-xs text-muted">{t('detail.reviewed', { name: a.reviewedByName, date: f.timestampTime(a.reviewedAt) })}</p>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'accept'}
        tone="primary"
        title={t('actions.acceptTitle', { name })}
        message={t('actions.acceptMessage')}
        confirmLabel={t('actions.accept')}
        loading={accept.isPending}
        onConfirm={onAccept}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={t('actions.deleteTitle')}
        message={
          <>
            {t('actions.deleteMessage')}
            {keepsGuardian && <span className="mt-2 block font-medium text-ink">{t('actions.deleteGuardianNote')}</span>}
          </>
        }
        loading={del.isPending}
        onConfirm={onDelete}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/** The photos (the first is the headshot); tap one to see it large, with previous / next. */
function Photos({ application: a, name }: { application: CastingApplicationDetail; name: string }) {
  const { t } = useTranslation(['applications', 'common']);
  const [view, setView] = useState<number | null>(null);
  const total = a.photos.length;
  const current = view !== null ? a.photos[view] : undefined;
  return (
    <Card title={t('detail.photos')}>
      {total === 0 ? (
        <p className="text-sm text-muted">{t('detail.noPhotos')}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {a.photos.map((p, i) => (
            <li key={p.fileId}>
              <button
                type="button"
                onClick={() => setView(i)}
                className="group relative block w-full overflow-hidden rounded-xl bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                aria-label={t('detail.openPhoto', { n: i + 1 })}
              >
                <img src={fileUrl(p.fileId)} alt="" loading="lazy" className="aspect-[3/4] w-full object-cover transition-transform group-hover:scale-[1.02]" />
                {i === 0 && (
                  <span className="absolute start-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">{t('detail.headshot')}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!current} onClose={() => setView(null)} size="lg" title={<bdi>{name}</bdi>} description={view !== null ? t('detail.photoOf', { n: view + 1, total }) : undefined}>
        {current && view !== null && (
          <div className="grid gap-3">
            <img src={fileUrl(current.fileId)} alt={t('detail.photoOf', { n: view + 1, total })} className="max-h-[65dvh] w-full rounded-xl bg-surface-2 object-contain" />
            {total > 1 && (
              <div className="flex justify-between gap-2">
                <IconButton icon={ChevronLeft} label={t('common:actions.previous')} size="lg" variant="secondary" className="rtl:-scale-x-100" onClick={() => setView((view - 1 + total) % total)} />
                <IconButton icon={ChevronRight} label={t('common:actions.next')} size="lg" variant="secondary" className="rtl:-scale-x-100" onClick={() => setView((view + 1) % total)} />
              </div>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}

function GuardianCard({ application: a, showContact }: { application: CastingApplicationDetail; showContact: boolean }) {
  const { t } = useTranslation(['applications', 'common']);
  return (
    <section aria-labelledby="guardian" className="rounded-2xl border-2 border-warning/40 bg-warning-soft p-4 sm:p-5">
      <h2 id="guardian" className="flex items-center gap-2 text-base font-semibold text-ink">
        <ShieldAlert className="size-5 shrink-0 text-warning" aria-hidden />
        {t('detail.guardian')}
      </h2>
      <p className="mt-1 text-sm text-ink/80">{t('detail.guardianHint')}</p>
      <dl className="mt-3 grid gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted">{t('detail.guardianName')}</dt>
          <dd className="font-medium text-ink">{a.guardianName ? <bdi>{a.guardianName}</bdi> : t('detail.nothing')}</dd>
        </div>
        {showContact && (
          <div>
            <dt className="text-xs text-muted">{t('detail.guardianPhone')}</dt>
            <dd className="font-medium text-ink">{a.guardianPhone ? <bdi dir="ltr">{a.guardianPhone}</bdi> : t('detail.nothing')}</dd>
          </div>
        )}
      </dl>
      <p className={clsx('mt-3 text-sm font-medium', a.guardianConsent ? 'text-success' : 'text-danger')}>
        {a.guardianConsent ? t('detail.consentGiven') : t('detail.consentMissing')}
      </p>
      {showContact && a.guardianPhone && <ContactButtons phone={a.guardianPhone} greetName={a.guardianName ?? ''} locale={a.locale} />}
    </section>
  );
}

function ContactCard({ application: a, showContact }: { application: CastingApplicationDetail; showContact: boolean }) {
  const { t } = useTranslation(['applications', 'common']);
  if (!showContact) {
    return (
      <Card title={t('detail.contact')}>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Lock className="size-4 shrink-0" aria-hidden />
          {t('common:states.contactHidden')}
        </p>
      </Card>
    );
  }
  const links = a.links ?? [];
  return (
    <Card title={t('detail.contact')}>
      {a.phone || a.email || links.length ? (
        <div className="grid gap-3">
          {a.phone && (
            <div>
              <bdi dir="ltr" className="block text-lg font-semibold text-ink">
                {a.phone}
              </bdi>
              <ContactButtons phone={a.phone} greetName={a.firstName} locale={a.locale} />
            </div>
          )}
          {a.email && <ContactLink href={`mailto:${a.email}`} icon={Mail} label={t('detail.email')} value={a.email} />}
          {links.map((url) => (
            <ContactLink key={url} href={url} external icon={ExternalLink} label={t('detail.links')} value={url.replace(/^https?:\/\/(www\.)?/, '')} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">{t('detail.noContact')}</p>
      )}
    </Card>
  );
}

/** Big WhatsApp and Call buttons; the WhatsApp message is written in the language they applied in. */
function ContactButtons({ phone, greetName, locale }: { phone: string; greetName: string; locale: 'en' | 'ar' }) {
  const { t, i18n } = useTranslation(['applications', 'common']);
  const settings = useAdmissionsSettings();
  const school = useSchoolName();
  const text = i18n.getFixedT(locale, 'applications')('detail.whatsappText', { name: greetName, school: (locale === 'ar' && settings.schoolNameAr) || settings.schoolName || school });
  const wa = whatsAppLink(phone, settings.defaultCountryCode, text);
  const tel = telLink(phone);
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'lg', 'px-3')}>
          <MessageCircle className="size-5 shrink-0 text-success" aria-hidden />
          {t('detail.whatsapp')}
        </a>
      )}
      {tel && (
        <a href={tel} className={buttonClasses('secondary', 'lg', 'px-3')}>
          <Phone className="size-5 shrink-0" aria-hidden />
          {t('detail.call')}
        </a>
      )}
    </div>
  );
}

function ContactLink({ href, icon: Icon, label, value, external }: { href: string; icon: LucideIcon; label: string; value: string; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="-mx-2 flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-surface-2"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted">{label}</span>
        <bdi dir="ltr" className="block truncate text-sm font-medium text-ink">
          {value}
        </bdi>
      </span>
    </a>
  );
}

function Tags({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((x) => (
        <li key={x} dir="auto" className="rounded-lg bg-accent-soft px-2.5 py-1 text-sm font-medium text-accent">
          {x}
        </li>
      ))}
    </ul>
  );
}

function Paragraphs({ text }: { text: string }) {
  return (
    <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-line break-words text-ink">
      {text}
    </p>
  );
}
