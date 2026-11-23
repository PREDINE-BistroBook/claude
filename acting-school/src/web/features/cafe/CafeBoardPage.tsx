import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellRing, CalendarDays, CircleCheck, CircleX, ClipboardList, Footprints, Hourglass, MapPin, Volume2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { CAFE_QUICK_REASONS, MAX_CAFE_REASON, cafeReason, cafeStatusInput, type CafeOrder } from '@shared/schemas/cafe';
import { Avatar, Button, ButtonLink, EmptyState, ErrorState, Modal, PageHeader, PageLoader, Textarea, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { visibleSections } from '../../layout/sections';
import { PushCard } from '../team/components/PushCard';
import { clockOf, isolate, vibrateIfAllowed } from '../team/utils';
import { teamKeys } from '../team/api';
import { cafeErrorKey, useCafeBoard, useCafeStatus, useMoveOrder } from './api';
import { CafeGate, CafeTabs, OrderLines, WRAP_ANYWHERE, useAgo, useCafeNames, useNow } from './components/CafeParts';
import { ring, soundState, subscribeSound, unlockSound } from './sound';
import {
  BOARD_MOVE_REST_MS,
  CAFE_REPORT_PATH,
  boardIsHome,
  boardPins,
  boardResting,
  boardSections,
  finishedAt,
  newArrivals,
  orderIdFrom,
  shouldRemind,
  staleOrderTags,
  type BoardSection,
} from './utils';

/**
 * /cafeteria/board — the orders board (cafeteria.serve): the Office helper's
 * home screen. New orders at the top as big cards — a status strip, who,
 * where, what, how long ago — each with one big button for what he does next
 * ("I'm taking it now" → "I've delivered it", in two colours) and "Can't do
 * this one" with a reason; then the orders on the way; then today's delivered
 * and cancelled ones. It reads again every 10 seconds while it is on screen,
 * rings and buzzes for a new order once the page has been tapped (browsers
 * allow sound only then), rings again every minute while an order waits and
 * nobody has touched the screen, and keeps the screen on where the browser can.
 */
export default function CafeBoardPage() {
  const { t } = useTranslation(['cafe']);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('board.title')} />
      <CafeGate>
        <CafeTabs />
        <Board />
      </CafeGate>
    </div>
  );
}

function Board() {
  const { t } = useTranslation(['cafe']);
  const toast = useToast();
  const { can } = useAuth();
  const { search } = useLocation();
  const board = useCafeBoard(true);
  const cafe = useCafeStatus();
  const now = useNow();
  const [turningDown, setTurningDown] = useState<CafeOrder | null>(null);
  const focusId = orderIdFrom(search);
  const home = boardIsHome(can, visibleSections(can).length, cafe?.enabled);

  // After a tap on any step button, every step button rests for two seconds and the cards stay where they were:
  // a second tap on the same spot must not mark the order Delivered, nor take the order that slid under the finger.
  const [rest, setRest] = useState<{ at: number; pins: Map<number, BoardSection> } | null>(null);
  useEffect(() => {
    if (!rest) return;
    const id = setTimeout(() => setRest(null), Math.max(0, BOARD_MOVE_REST_MS - (Date.now() - rest.at)));
    return () => clearTimeout(id);
  }, [rest]);
  const items = board.data?.items;
  // (Cleared by the timer above; the time check also covers a render that comes before it.)
  const resting = boardResting(rest?.at ?? null, Date.now());
  const startRest = () => items && setRest({ at: Date.now(), pins: boardPins(items) });

  // Ring and buzz for orders that weren't there at the last look (never for what was waiting when the board opened).
  const known = useRef<Set<number> | null>(null);
  const lastRingAt = useRef<number | null>(null);
  const lastTapAt = useRef<number | null>(null);
  useEffect(() => {
    const tap = () => (lastTapAt.current = Date.now());
    window.addEventListener('pointerdown', tap);
    return () => window.removeEventListener('pointerdown', tap);
  }, []);
  const alarm = () => {
    void ring();
    vibrateIfAllowed([200, 100, 200]);
    lastRingAt.current = Date.now();
  };
  useEffect(() => {
    if (!items) return;
    const arrivals = newArrivals(known.current, items);
    known.current = new Set([...(known.current ?? []), ...items.filter((o) => o.status === 'new').map((o) => o.id)]);
    if (!arrivals.length) return;
    alarm();
    toast.success(t('board.newFrom', { name: isolate(arrivals[0]!.by.name) }));
  }, [items, toast, t]);

  // An order still waiting and nobody has touched the screen since the ring: ring again, once a minute.
  const waitingCount = items?.filter((o) => o.status === 'new').length ?? 0;
  useEffect(() => {
    if (shouldRemind({ waiting: waitingCount, lastRingAt: lastRingAt.current, lastTapAt: lastTapAt.current, now })) alarm();
  }, [now, waitingCount]);

  // "New order from …" notifications on this phone for orders that no longer wait (taken here or elsewhere, cancelled): closed.
  useEffect(() => {
    if (!items || !('serviceWorker' in navigator)) return;
    const waiting = new Set(items.filter((o) => o.status === 'new').map((o) => o.id));
    void navigator.serviceWorker
      .getRegistration()
      .then(async (reg) => {
        const shown = (await reg?.getNotifications()) ?? [];
        const stale = new Set(staleOrderTags(shown.map((n) => n.tag), waiting));
        for (const n of shown) if (stale.has(n.tag)) n.close();
      })
      .catch(() => undefined);
  }, [items]);

  useScreenWakeLock();

  // The board reads every 10 seconds, the badges every 20: when the board knows better, the count on "Orders" follows at once.
  const qc = useQueryClient();
  const polled = cafe?.newOrders;
  useEffect(() => {
    if (items && polled !== undefined && polled !== waitingCount) void qc.invalidateQueries({ queryKey: teamKeys.unread });
    // Only when the board itself changes: the poll's own answer must not ask for another.
  }, [waitingCount, qc]);

  if (board.isPending) return <PageLoader />;
  if (board.isError || !items) return <ErrorState error={board.error} onRetry={() => void board.refetch()} />;

  const { fresh, onTheWay, done } = boardSections(items, resting ? rest!.pins : undefined);
  const cardProps = { now, focusId, resting, onMoved: startRest, onTurnDown: setTurningDown };
  return (
    <div className="space-y-6">
      <SoundStrip />
      {fresh.length === 0 && onTheWay.length === 0 && (
        <EmptyState icon={ClipboardList} title={t('board.empty')} description={t('board.emptyHint')} className="rounded-2xl border border-dashed border-line-strong" />
      )}
      <OpenOrders id="cafe-new" title={t('board.fresh')} orders={fresh} {...cardProps} />
      <OpenOrders id="cafe-on-the-way" title={t('board.onTheWay')} orders={onTheWay} {...cardProps} />
      {/* Below the orders, so it never pushes the first order's button off the screen. */}
      {home && <PushCard prompt={{ title: t('board.pushTitle'), description: t('board.pushHint') }} />}
      {done.length > 0 && (
        <section aria-labelledby="cafe-done">
          <SectionTitle id="cafe-done" title={t('board.done')} count={done.length} />
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {done.map((order) => (
              <DoneRow key={order.id} order={order} />
            ))}
          </ul>
        </section>
      )}
      {/* The monthly page, for someone whose home this is and who has no tabs above (with cafeteria.report). */}
      {home && can('cafeteria.report') && (
        <ButtonLink to={CAFE_REPORT_PATH} icon={CalendarDays} size="lg" className="w-full sm:w-auto">
          {t('report.open')}
        </ButtonLink>
      )}
      <TurnDownModal order={turningDown} onClose={() => setTurningDown(null)} onDone={startRest} />
    </div>
  );
}

/** Keeps the screen on while the board is visible, where the browser can (asked again after the page comes back). */
function useScreenWakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return;
    let lock: { release: () => Promise<void> } | null = null;
    let gone = false;
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      void nav
        .wakeLock!.request('screen')
        .then((l) => (gone ? void l.release() : (lock = l)))
        .catch(() => undefined);
    };
    ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', ask);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

function SectionTitle({ id, title, count }: { id: string; title: string; count: number }) {
  const f = useFormat();
  return (
    <h2 id={id} className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink">
      {title}
      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-2 px-2 text-sm font-bold text-muted tabular-nums">{f.number(count)}</span>
    </h2>
  );
}

interface CardProps {
  now: number;
  focusId: number | null;
  /** The step buttons rest after a tap (BOARD_MOVE_REST_MS). */
  resting: boolean;
  onMoved: () => void;
  onTurnDown: (order: CafeOrder) => void;
}

function OpenOrders({ id, title, orders, ...card }: { id: string; title: string; orders: CafeOrder[] } & CardProps) {
  if (!orders.length) return null;
  return (
    <section aria-labelledby={id}>
      <SectionTitle id={id} title={title} count={orders.length} />
      <ul className="grid gap-4">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} {...card} />
        ))}
      </ul>
    </section>
  );
}

const STRIP: Record<CafeOrder['status'], { icon: LucideIcon; label: string; strip: string; border: string }> = {
  new: { icon: Hourglass, label: 'board.statusNew', strip: 'bg-warning text-warning-ink', border: 'border-warning' },
  on_the_way: { icon: Footprints, label: 'board.statusOnTheWay', strip: 'bg-accent text-accent-ink', border: 'border-accent' },
  delivered: { icon: CircleCheck, label: 'status.delivered', strip: 'bg-success text-success-ink', border: 'border-success' },
  cancelled: { icon: CircleX, label: 'status.cancelled', strip: 'bg-danger text-danger-ink', border: 'border-danger' },
};

/** One open order: its status strip (with how long ago), who, where, what, the note — and the one big button for its next step. */
function OrderCard({ order, now, focusId, resting, onMoved, onTurnDown }: { order: CafeOrder } & CardProps) {
  const { t } = useTranslation(['cafe']);
  const toast = useToast();
  const ago = useAgo();
  const { placeLabel } = useCafeNames();
  const move = useMoveOrder();
  const ref = useRef<HTMLLIElement>(null);
  const focused = order.id === focusId;
  const look = STRIP[order.status];
  const open = order.status === 'new' || order.status === 'on_the_way';

  // Opened from an alert: bring that order into view.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  const fresh = order.status === 'new';
  const step: { label: string; icon: LucideIcon; variant: 'primary' | 'success' } = fresh
    ? { label: t('board.setOff'), icon: Footprints, variant: 'primary' }
    : { label: t('board.delivered'), icon: CircleCheck, variant: 'success' };
  // mutateAsync, not mutate with callbacks: once the board has re-read itself this card may be gone from its list
  // (it moved to "On the way" or "Done today"), and callbacks given to mutate() are dropped with the card.
  const advance = () => {
    if (resting) return;
    onMoved();
    void move.mutateAsync({ id: order.id, status: fresh ? 'on_the_way' : 'delivered' }).then(
      () => toast.success(fresh ? t('board.movedOnTheWay', { name: isolate(order.by.name) }) : t('board.movedDelivered')),
      // Someone else moved it, or the person cancelled: the board has re-read itself.
      (err: unknown) => toast.error(t(err instanceof ApiError && (err.code === 'not_next_step' || err.code === 'order_closed') ? 'board.changed' : cafeErrorKey(err))),
    );
  };

  return (
    <li
      ref={ref}
      className={clsx('overflow-hidden rounded-2xl border-2 bg-surface shadow-sm', look.border, focused && 'ring-4 ring-accent/30', WRAP_ANYWHERE)}
      data-status={order.status}
    >
      <p className={clsx('flex min-h-10 items-center gap-2 px-4 py-2 text-base font-bold', look.strip)}>
        <look.icon className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{t(look.label)}</span>
        <time dateTime={new Date(order.createdAt).toISOString()} className="shrink-0 text-sm font-semibold">
          {ago(order.createdAt, now)}
        </time>
      </p>
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Avatar name={order.by.name} fileId={order.by.photoFileId} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold leading-tight text-ink">
              <bdi>{order.by.name}</bdi>
            </p>
            {!order.by.active && <p className="text-sm font-medium text-danger">{t('board.left')}</p>}
            <p className="mt-0.5 flex items-start gap-1.5 text-lg font-bold leading-tight text-ink">
              <MapPin className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0">
                <span className="font-medium text-muted">{t('board.where')}: </span>
                <bdi>{placeLabel(order.place)}</bdi>
              </span>
            </p>
          </div>
        </div>

        <div className="mt-3">
          <OrderLines lines={order.items} size="lg" />
        </div>
        {order.note && (
          <p className="mt-3 rounded-xl border border-line px-3 py-2 text-base text-ink">
            <span className="font-semibold">{t('board.note')}: </span>
            <bdi>{order.note}</bdi>
          </p>
        )}

        {open && (
          <div className="mt-4 grid gap-2">
            <Button
              variant={step.variant}
              size="lg"
              icon={step.icon}
              loading={move.isPending}
              disabled={resting}
              onClick={advance}
              className="h-16 w-full text-xl [&>svg]:size-6"
            >
              {step.label}
            </Button>
            <Button variant="danger-ghost" size="lg" icon={CircleX} disabled={move.isPending || resting} onClick={() => onTurnDown(order)} className="w-full">
              {t('board.cant')}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** A finished order in "Done today": who, what, and how it ended. */
function DoneRow({ order }: { order: CafeOrder }) {
  const { t } = useTranslation(['cafe']);
  const f = useFormat();
  const { placeLabel, reasonLabel } = useCafeNames();
  const time = f.time(clockOf(finishedAt(order)));
  const cancelled = order.status === 'cancelled';
  // Cancelled by whoever serves (with a reason) or by the person who ordered (no reason, nobody handled it).
  const ending = !cancelled
    ? t('board.deliveredAt', { time })
    : order.cancelReason || order.handledBy
      ? t('board.cancelledAt', { time })
      : t('board.cancelledBy', { name: isolate(order.by.name), time });
  return (
    <li className={clsx('flex items-start gap-3 px-4 py-3 sm:px-5', WRAP_ANYWHERE)}>
      <Avatar name={order.by.name} fileId={order.by.photoFileId} size="md" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">
          <bdi>{order.by.name}</bdi>
          <span className="font-normal text-muted">
            {' · '}
            <bdi>{placeLabel(order.place)}</bdi>
          </span>
        </p>
        <div className="mt-1">
          <OrderLines lines={order.items} />
        </div>
        <p className={clsx('mt-1 flex items-center gap-1.5 text-sm font-medium', cancelled ? 'text-danger' : 'text-success')}>
          {cancelled ? <CircleX className="size-4 shrink-0" aria-hidden /> : <CircleCheck className="size-4 shrink-0" aria-hidden />}
          {ending}
        </p>
        {order.cancelReason && <p className="mt-0.5 text-sm text-muted">{t('board.reasonGiven', { reason: isolate(reasonLabel(order.cancelReason)) })}</p>}
      </div>
    </li>
  );
}

/**
 * "Can't do this one": a short reason for the person who ordered — one tap on
 * a ready-made one, or their own words. A ready-made one is read by each
 * person in their own language (the server keeps it by its English words).
 */
function TurnDownModal({ order, onClose, onDone }: { order: CafeOrder | null; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation(['cafe']);
  const toast = useToast();
  const move = useMoveOrder();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const orderId = order?.id;
  useEffect(() => {
    setReason('');
    setError(null);
  }, [orderId]);

  const submit = () => {
    if (!order) return;
    const input = cafeStatusInput.safeParse({ status: 'cancelled', reason });
    if (!input.success) {
      setError('errors.reasonRequired');
      return;
    }
    onDone();
    move.mutate(
      { id: order.id, status: 'cancelled', reason: input.data.reason ?? undefined },
      {
        onSuccess: () => {
          toast.success(t('board.movedCancelled', { name: isolate(order.by.name) }));
          onClose();
        },
        onError: (err) => {
          toast.error(t(cafeErrorKey(err)));
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title={t('board.cantTitle')}
      description={order ? t('board.cantDescription', { name: isolate(order.by.name) }) : undefined}
      footer={
        <>
          <Button size="lg" onClick={onClose} disabled={move.isPending}>
            {t('board.keep')}
          </Button>
          <Button size="lg" variant="danger" icon={CircleX} loading={move.isPending} onClick={submit}>
            {t('board.cantSend')}
          </Button>
        </>
      }
    >
      <p id="cafe-quick" className="mb-2 text-sm font-medium text-ink">
        {t('board.quickLabel')}
      </p>
      <div role="group" aria-labelledby="cafe-quick" className="grid gap-2">
        {CAFE_QUICK_REASONS.map((key) => {
          const words = cafeReason(key);
          const text = i18n.language === 'ar' ? words.ar : words.en;
          const picked = reason === text;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={picked}
              onClick={() => {
                setReason(text);
                setError(null);
              }}
              className={clsx(
                'flex min-h-12 items-center rounded-xl border-2 px-3 py-2 text-start text-base font-medium transition-colors',
                picked ? 'border-accent bg-accent-soft text-ink' : 'border-line-strong bg-surface text-ink hover:bg-surface-2',
              )}
            >
              {text}
            </button>
          );
        })}
      </div>
      <label htmlFor="cafe-reason" className="mb-1.5 mt-4 block text-sm font-medium text-ink">
        {t('board.reason')}
      </label>
      <Textarea
        id="cafe-reason"
        rows={2}
        maxLength={MAX_CAFE_REASON}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setError(null);
        }}
        placeholder={t('board.reasonPlaceholder')}
        dir="auto"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'cafe-reason-error' : undefined}
      />
      {error && (
        <p id="cafe-reason-error" role="alert" className="mt-1.5 text-sm text-danger">
          {t(error)}
        </p>
      )}
    </Modal>
  );
}

/**
 * Whether this phone will ring for a new order. Browsers only allow sound
 * after the page has been tapped: until then — and again whenever the phone
 * takes the audio back — a big button asks for that tap. Once the ring is on,
 * one short line says so, with a way to hear it (and what to check when
 * nothing is heard).
 */
function SoundStrip() {
  const { t } = useTranslation(['cafe']);
  const state = useSyncExternalStore(subscribeSound, soundState);
  const [tested, setTested] = useState(false);
  useEffect(() => {
    if (state !== 'locked') return;
    // Any tap on the page will do (the first "I'm taking it now" counts too).
    const unlock = () => void unlockSound();
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, [state]);
  if (state === 'unsupported') return null;
  if (state === 'locked')
    return (
      <button
        type="button"
        onClick={() => void unlockSound()}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 border-dashed border-warning bg-warning-soft px-4 py-3 text-start text-base font-semibold text-ink"
      >
        <BellRing className="size-6 shrink-0 text-warning" aria-hidden />
        {t('board.soundOff')}
      </button>
    );
  return (
    <div className="rounded-2xl bg-success-soft px-3 py-1">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
          <BellRing className="size-5 shrink-0 text-success" aria-hidden />
          {t('board.soundOn')}
        </p>
        <Button
          size="lg"
          variant="ghost"
          icon={Volume2}
          onClick={() => {
            setTested(true);
            void ring();
          }}
          className="shrink-0 px-3"
        >
          {t('board.soundTest')}
        </Button>
      </div>
      {tested && <p className="pb-2 text-sm text-ink">{t('board.soundFailed')}</p>}
    </div>
  );
}
