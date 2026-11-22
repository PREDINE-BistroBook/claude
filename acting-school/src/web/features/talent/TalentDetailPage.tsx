import { ArrowLeft, AtSign, Cake, Clapperboard, ExternalLink, Eye, GraduationCap, Lock, Mail, MapPin, Pencil, Phone, Ruler, Scissors, Trash2, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import type { TalentDetail } from '@shared/schemas/talent';
import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  ErrorState,
  ListRow,
  PageHeader,
  PageLoader,
  StatusBadge,
  useEnumLabel,
  useToast,
} from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { ageOn, displayName, fullName, useFormat } from '@web/lib/format';
import { errorMessageKey } from '@web/lib/forms';
import { usePageTitle } from '@web/lib/hooks';
import { useDeleteTalent, useTalent } from './api';
import { Gallery } from './components/Gallery';
import { BidiText, instagramUrl, playingRangeLabel, telHref } from './utils';

export default function TalentDetailPage() {
  const { t } = useTranslation(['talent', 'common']);
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const del = useDeleteTalent(id);
  const query = useTalent(id, valid && !del.isSuccess);

  if (!valid || query.isError) {
    return (
      <div>
        <PageHeader title={t('title')} back="/talent" />
        <ErrorState error={valid ? query.error : new ApiError(404, 'not_found', 'Not found')} onRetry={valid ? () => void query.refetch() : undefined} />
      </div>
    );
  }
  if (query.isPending) return <PageLoader />;
  return <TalentView talent={query.data} del={del} />;
}

function TalentView({ talent: p, del }: { talent: TalentDetail; del: ReturnType<typeof useDeleteTalent> }) {
  const { t } = useTranslation(['talent', 'common']);
  const f = useFormat();
  const enumLabel = useEnumLabel();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const shown = displayName(p);
  const real = fullName(p);
  usePageTitle(shown);
  const age = ageOn(p.dateOfBirth);
  const plays = playingRangeLabel(t, p);
  const canWrite = can('talent.write');

  const onDelete = () =>
    del.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('detail.deleted'));
        navigate('/talent', { replace: true });
      },
      onError: (err) => {
        setConfirmOpen(false);
        toast.error(t(errorMessageKey(err)));
      },
    });

  const facts: { icon: LucideIcon; label: string }[] = [];
  if (age !== null && age >= 0) facts.push({ icon: Cake, label: t('common:units.years', { count: age }) });
  if (plays) facts.push({ icon: Clapperboard, label: plays });
  if (p.heightCm) facts.push({ icon: Ruler, label: t('common:units.cm', { value: f.number(p.heightCm) }) });
  if (p.city) facts.push({ icon: MapPin, label: p.city });
  if (p.eyeColor) facts.push({ icon: Eye, label: t('detail.eyes', { value: p.eyeColor }) });
  if (p.hairColor) facts.push({ icon: Scissors, label: t('detail.hair', { value: p.hairColor }) });

  const actions = canWrite && (
    <>
      <ButtonLink to={`/talent/${p.id}/edit`} icon={Pencil}>
        {t('common:actions.edit')}
      </ButtonLink>
      <Button variant="danger-ghost" icon={Trash2} onClick={() => setConfirmOpen(true)}>
        {t('common:actions.delete')}
      </Button>
    </>
  );

  const hasSkills = p.skills.length > 0 || p.languages.length > 0;

  return (
    <div>
      <Link to="/talent" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-sm text-muted hover:text-ink sm:min-h-0">
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        {t('common:actions.back')}
      </Link>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="mb-5 grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-4 sm:mb-6 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <Avatar name={real} fileId={p.headshotFileId} shape="portrait" className="shadow-sm" />
        <div className="min-w-0 pt-1">
          {/* <bdi>: the name runs in its own direction while the heading keeps the UI's alignment. */}
          <h1 className="text-2xl font-semibold tracking-tight text-balance break-words text-ink sm:text-[2rem] sm:leading-tight">
            <bdi>{shown}</bdi>
          </h1>
          {shown !== real && (
            <p className="mt-0.5 text-sm text-muted">
              {t('detail.realName')}: <bdi>{real}</bdi>
            </p>
          )}
          <div className="mt-2">
            <StatusBadge group="talentStatus" value={p.status} />
          </div>
          {facts.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('detail.quickFacts')}>
              {facts.map(({ icon: Icon, label }) => (
                <li key={label} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-sm text-ink">
                  <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <BidiText>{label}</BidiText>
                </li>
              ))}
            </ul>
          )}
          {actions && <div className="mt-4 hidden flex-wrap gap-2 sm:flex">{actions}</div>}
        </div>
      </section>
      {actions && <div className="-mt-1 mb-5 grid grid-cols-2 gap-2 sm:hidden">{actions}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:col-span-2">
          <Gallery talent={p} name={shown} canWrite={canWrite} />

          <Card title={t('detail.castings')} padded={false}>
            {p.submissions.length ? (
              <ul className="divide-y divide-line">
                {p.submissions.map((s) => (
                  <ListRow
                    key={s.id}
                    to={`/castings/${s.castingId}`}
                    leading={
                      <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted" aria-hidden>
                        <Clapperboard className="size-5" />
                      </span>
                    }
                    title={<BidiText>{s.castingTitle}</BidiText>}
                    subtitle={
                      <span className="flex min-w-0 flex-col whitespace-normal">
                        <BidiText>{s.roleName}</BidiText>
                        {s.auditionAt && <span>{t('detail.audition', { date: f.dateTime(s.auditionAt) })}</span>}
                      </span>
                    }
                    trailing={<StatusBadge group="submissionStatus" value={s.status} />}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState icon={Clapperboard} title={t('detail.noCastings')} className="py-8" />
            )}
          </Card>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <Card title={t('detail.skillsLanguages')}>
            {hasSkills ? (
              <div className="grid gap-4">
                {p.skills.length > 0 && <TagGroup heading={t('detail.skills')} tags={p.skills} />}
                {p.languages.length > 0 && <TagGroup heading={t('detail.languages')} tags={p.languages} />}
              </div>
            ) : (
              <p className="text-sm text-muted">{t('detail.noSkills')}</p>
            )}
          </Card>

          <Card title={t('detail.contact')}>
            {p.contactHidden ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Lock className="size-4 shrink-0" aria-hidden />
                {t('common:states.contactHidden')}
              </p>
            ) : p.phone || p.email ? (
              <ul className="-my-1 grid gap-1">
                {p.phone && <LinkRow href={telHref(p.phone)} icon={Phone} label={t('common:fields.phone')} value={p.phone} />}
                {p.email && <LinkRow href={`mailto:${p.email}`} icon={Mail} label={t('common:fields.email')} value={p.email} />}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t('detail.noContact')}</p>
            )}
          </Card>

          <Card title={t('detail.links')}>
            {p.showreelUrl || p.instagram ? (
              <ul className="-my-1 grid gap-1">
                {p.showreelUrl && <LinkRow href={p.showreelUrl} external icon={ExternalLink} label={t('detail.showreel')} value={p.showreelUrl.replace(/^https?:\/\/(www\.)?/, '')} />}
                {p.instagram && <LinkRow href={instagramUrl(p.instagram)} external icon={AtSign} label={t('detail.instagram')} value={`@${p.instagram}`} />}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t('detail.noLinks')}</p>
            )}
          </Card>

          <Card title={t('detail.details')}>
            <DescriptionList
              columns={1}
              items={[
                {
                  label: t('common:fields.dateOfBirth'),
                  value: p.dateOfBirth ? `${f.date(p.dateOfBirth, 'long')}${age !== null ? ` (${t('common:units.years', { count: age })})` : ''}` : null,
                },
                { label: t('common:fields.gender'), value: enumLabel('gender', p.gender) || null },
                { label: t('detail.representedSince'), value: p.representedSince ? f.date(p.representedSince, 'long') : null },
              ]}
            />
          </Card>

          {p.student && can('students.read') && (
            <Card title={t('detail.student')} padded={false}>
              <ul>
                <ListRow
                  to={`/students/${p.student.id}`}
                  leading={
                    <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
                      <GraduationCap className="size-5" />
                    </span>
                  }
                  title={<BidiText>{fullName(p.student)}</BidiText>}
                  subtitle={t('detail.studentHint')}
                />
              </ul>
            </Card>
          )}

          <Card title={t('detail.notes')}>
            {p.notes ? (
              <p dir="auto" className="text-start text-sm leading-relaxed whitespace-pre-line break-words text-ink">
                {p.notes}
              </p>
            ) : (
              <p className="text-sm text-muted">{t('detail.noNotes')}</p>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('detail.deleteTitle', { name: shown })}
        message={t('detail.deleteMessage')}
        loading={del.isPending}
        onConfirm={onDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function TagGroup({ heading, tags }: { heading: string; tags: string[] }) {
  return (
    <section>
      <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{heading}</h3>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <li key={tag} dir="auto" className="rounded-lg bg-accent-soft px-2.5 py-1 text-sm font-medium text-accent">
            {tag}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A tappable phone / email / link row: icon, small label, the value (always left-to-right). */
function LinkRow({ href, icon: Icon, label, value, external }: { href: string; icon: LucideIcon; label: ReactNode; value: string; external?: boolean }) {
  return (
    <li>
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
          <BidiText dir="ltr" className="text-sm font-medium text-ink">
            {value}
          </BidiText>
        </span>
      </a>
    </li>
  );
}
