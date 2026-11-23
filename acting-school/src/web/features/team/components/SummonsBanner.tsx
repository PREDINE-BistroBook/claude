import clsx from 'clsx';
import { BellRing, Footprints, LoaderCircle, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SummonsAnswer } from '@shared/enums';
import { Avatar, useToast } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { teamErrorKey, useAnswerSummons, useUnread } from '../api';
import { bannerSummons, clockOf, isolate, vibrateIfAllowed } from '../utils';

/** A short buzz when a new call to the office shows up (where the browser allows it: after the page has been tapped). */
const buzz = () => vibrateIfAllowed([300, 150, 300]);

/**
 * The can't-miss banner for a call to the office: full width at the top of
 * every screen, the caller's photo and name, the note, and two big buttons.
 * It comes from the same 20-second poll as the Messages badge, so it shows up
 * within about 20 seconds of the call.
 */
export function SummonsBanner() {
  const { t } = useTranslation(['team', 'common']);
  const f = useFormat();
  const toast = useToast();
  const unread = useUnread();
  const answer = useAnswerSummons();
  const { first, more } = bannerSummons(unread.data?.summons ?? [], Date.now());
  const buzzed = useRef(new Set<number>());

  useEffect(() => {
    if (!first || buzzed.current.has(first.id)) return;
    buzzed.current.add(first.id);
    buzz();
  }, [first]);

  if (!first) return null;

  const reply = (status: SummonsAnswer) =>
    answer.mutate(
      { id: first.id, status },
      {
        onSuccess: () => toast.success(t('banner.sent', { answer: t(status === 'on_my_way' ? 'banner.onMyWay' : 'banner.cantNow') })),
        onError: (err) => toast.error(t(teamErrorKey(err))),
      },
    );
  const busy = answer.isPending;
  const calledAt = t('banner.calledAt', { time: f.time(clockOf(first.createdAt)) });

  return (
    <section role="alert" aria-live="assertive" aria-label={t('banner.label')} className="border-b-4 border-warning-ink/20 bg-warning text-warning-ink shadow-lg">
      {/* Phones: compact (a smaller photo, the time and note on one line) so a waiting call doesn't take
          half the screen; it stays at the top with its two big buttons until answered. */}
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4 md:flex-row md:items-center lg:px-8">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="shrink-0 sm:hidden">
            <Avatar name={first.from.name} fileId={first.from.photoFileId} size="md" className="ring-2 ring-warning-ink/40" />
          </span>
          <span className="hidden shrink-0 sm:block">
            <Avatar name={first.from.name} fileId={first.from.photoFileId} size="lg" className="ring-2 ring-warning-ink/40" />
          </span>
          <div className="min-w-0">
            <p className="hidden items-center gap-1.5 text-sm font-semibold opacity-90 sm:flex">
              <BellRing className="size-4 shrink-0 animate-pulse" aria-hidden />
              {t('banner.label')} · {calledAt}
            </p>
            <p className="line-clamp-2 text-lg font-bold leading-snug sm:line-clamp-none">{t('banner.title', { name: isolate(first.from.name) })}</p>
            <p className="line-clamp-2 text-sm font-medium break-words opacity-95 sm:hidden">
              <BellRing className="me-1 inline size-4 animate-pulse align-[-3px]" aria-hidden />
              {calledAt}
              {first.note && (
                <>
                  {' · '}
                  <bdi>{first.note}</bdi>
                </>
              )}
            </p>
            {first.note && (
              <p className="mt-0.5 hidden text-base break-words sm:block">
                <span className="font-semibold">{t('banner.noteLabel')}: </span>
                <bdi dir="auto">{first.note}</bdi>
              </p>
            )}
            {more > 0 && <p className="mt-0.5 text-sm opacity-90">{t('banner.more', { count: more })}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:flex md:shrink-0">
          <BannerButton icon={Footprints} solid loading={busy && answer.variables?.status === 'on_my_way'} disabled={busy} onClick={() => reply('on_my_way')}>
            {t('banner.onMyWay')}
          </BannerButton>
          <BannerButton icon={X} loading={busy && answer.variables?.status === 'cant_now'} disabled={busy} onClick={() => reply('cant_now')}>
            {t('banner.cantNow')}
          </BannerButton>
        </div>
      </div>
    </section>
  );
}

/** The banner's two big answers: white "On my way", outlined "Can't come now" (on the banner's own colour, both themes). */
function BannerButton({
  icon: Icon,
  solid,
  loading,
  disabled,
  onClick,
  children,
}: {
  icon: LucideIcon;
  solid?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex min-h-14 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition-colors disabled:opacity-60',
        solid ? 'bg-surface text-ink shadow-sm hover:bg-surface-2' : 'border-2 border-warning-ink/60 text-warning-ink hover:bg-warning-ink/10',
      )}
    >
      {loading ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Icon className="size-5 shrink-0" aria-hidden />}
      {children}
    </button>
  );
}
