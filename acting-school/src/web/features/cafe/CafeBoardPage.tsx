import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellRing, CircleCheck, CircleX, ClipboardList, Footprints, MapPin, Volume2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { MAX_CAFE_REASON, cafeStatusInput, type CafeOrder } from '@shared/schemas/cafe';
import { Avatar, Button, EmptyState, ErrorState, Modal, PageHeader, PageLoader, Textarea, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useFormat } from '@web/lib/format';
import { clockOf, isolate, vibrateIfAllowed } from '../team/utils';
import { teamKeys } from '../team/api';
import { cafeErrorKey, useCafeBoard, useCafeStatus, useMoveOrder } from './api';
import { CafeGate, CafeTabs, OrderLines, useAgo, useCafeNames, useNow } from './components/CafeParts';
import { ring, soundReady, soundSupported, unlockSound } from './sound';
import { boardSections, finishedAt, newArrivals, orderIdFrom } from './utils';

/**
 * /cafeteria/board — the orders board (cafeteria.serve): the Office helper's
 * home screen. New orders at the top as big cards — who, where, what, how long
 * ago — each with one big button for its next step (On the way → Delivered)
 * and "Can't do this one" with a reason; then the orders on the way; then
 * today's delivered and cancelled ones. It reads again every 10 seconds while
 * it is on screen, and rings and buzzes for a new order once the page has
 * been tapped (browsers allow sound only then).
 */
export default function CafeBoardPage() {
  const { t } = useTranslation(['cafe']);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('board.title')} subtitle={t('board.subtitle')} />
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
  const { search } = useLocation();
  const board = useCafeBoard(true);
  const now = useNow();
  const [turningDown, setTurningDown] = useState<CafeOrder | null>(null);
  const focusId = orderIdFrom(search);

  // Ring and buzz for orders that weren't there at the last look (never for what was waiting when the board opened).
  const known = useRef<Set<number> | null>(null);
  const items = board.data?.items;
  useEffect(() => {
    if (!items) return;
    const arrivals = newArrivals(known.current, items);
    known.current = new Set([...(known.current ?? []), ...items.filter((o) => o.status === 'new').map((o) => o.id)]);
    if (!arrivals.length) return;
    ring();
    vibrateIfAllowed([200, 100, 200]);
    toast.success(t('board.newFrom', { name: isolate(arrivals[0]!.by.name) }));
  }, [items, toast, t]);

  // The board reads every 10 seconds, the badges every 20: when the board knows better, the count on "Orders" follows at once.
  const qc = useQueryClient();
  const polled = useCafeStatus()?.newOrders;
  const waiting = items?.filter((o) => o.status === 'new').length;
  useEffect(() => {
    if (waiting !== undefined && polled !== undefined && polled !== waiting) void qc.invalidateQueries({ queryKey: teamKeys.unread });
    // Only when the board itself changes: the poll's own answer must not ask for another.
  }, [waiting, qc]);

  if (board.isPending) return <PageLoader />;
  if (board.isError || !items) return <ErrorState error={board.error} onRetry={() => void board.refetch()} />;

  const { fresh, onTheWay, done } = boardSections(items);
  return (
    <div className="space-y-6">
      <SoundStrip />
      {fresh.length === 0 && onTheWay.length === 0 && (
        <EmptyState icon={ClipboardList} title={t('board.empty')} description={t('board.emptyHint')} className="rounded-2xl border border-dashed border-line-strong" />
      )}
      <OpenOrders id="cafe-new" title={t('board.fresh')} orders={fresh} now={now} focusId={focusId} onTurnDown={setTurningDown} />
      <OpenOrders id="cafe-on-the-way" title={t('board.onTheWay')} orders={onTheWay} now={now} focusId={focusId} onTurnDown={setTurningDown} />
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
      <TurnDownModal order={turningDown} onClose={() => setTurningDown(null)} />
    </div>
  );
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

function OpenOrders({
  id,
  title,
  orders,
  now,
  focusId,
  onTurnDown,
}: {
  id: string;
  title: string;
  orders: CafeOrder[];
  now: number;
  focusId: number | null;
  onTurnDown: (order: CafeOrder) => void;
}) {
  if (!orders.length) return null;
  return (
    <section aria-labelledby={id}>
      <SectionTitle id={id} title={title} count={orders.length} />
      <ul className="grid gap-4">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} now={now} focused={order.id === focusId} onTurnDown={() => onTurnDown(order)} />
        ))}
      </ul>
    </section>
  );
}

/** One open order: who, how long ago, where, what, the note — and the one big button for its next step. */
function OrderCard({ order, now, focused, onTurnDown }: { order: CafeOrder; now: number; focused: boolean; onTurnDown: () => void }) {
  const { t } = useTranslation(['cafe']);
  const toast = useToast();
  const ago = useAgo();
  const { placeLabel } = useCafeNames();
  const move = useMoveOrder();
  const ref = useRef<HTMLLIElement>(null);
  const fresh = order.status === 'new';

  // Opened from an alert: bring that order into view.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);

  const next = fresh ? ('on_the_way' as const) : ('delivered' as const);
  const step: { label: string; icon: LucideIcon } = fresh ? { label: t('board.setOff'), icon: Footprints } : { label: t('board.delivered'), icon: CircleCheck };
  // mutateAsync, not mutate with callbacks: once the board has re-read itself this card is gone from its list
  // (it moved to "On the way" or "Done today"), and callbacks given to mutate() are dropped with the card.
  const advance = () =>
    void move.mutateAsync({ id: order.id, status: next }).then(
      () => toast.success(fresh ? t('board.movedOnTheWay', { name: isolate(order.by.name) }) : t('board.movedDelivered')),
      // Someone else moved it, or the person cancelled: the board has re-read itself.
      (err: unknown) => toast.error(t(err instanceof ApiError && (err.code === 'not_next_step' || err.code === 'order_closed') ? 'board.changed' : cafeErrorKey(err))),
    );

  return (
    <li
      ref={ref}
      className={clsx(
        'rounded-2xl border-2 bg-surface p-4 shadow-sm sm:p-5',
        fresh ? 'border-warning' : 'border-accent/60',
        focused && 'ring-4 ring-accent/30',
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar name={order.by.name} fileId={order.by.photoFileId} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-ink">
            <bdi>{order.by.name}</bdi>
          </p>
          <p className="text-sm text-muted">
            <time dateTime={new Date(order.createdAt).toISOString()}>{ago(order.createdAt, now)}</time>
          </p>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
        <MapPin className="mt-1 size-5 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-muted">{t('board.where')}</span>
          <span className="block text-xl font-bold leading-tight text-ink">
            <bdi>{placeLabel(order.place)}</bdi>
          </span>
        </span>
      </p>

      <div className="mt-4">
        <OrderLines lines={order.items} size="lg" />
      </div>
      {order.note && (
        <p className="mt-3 rounded-xl border border-line px-3 py-2 text-base text-ink">
          <span className="font-semibold">{t('board.note')}: </span>
          <bdi>{order.note}</bdi>
        </p>
      )}

      <div className="mt-4 grid gap-2">
        <Button variant="primary" size="lg" icon={step.icon} loading={move.isPending} onClick={advance} className="h-16 w-full text-xl [&>svg]:size-6">
          {step.label}
        </Button>
        <Button variant="danger-ghost" size="lg" icon={CircleX} disabled={move.isPending} onClick={onTurnDown} className="w-full">
          {t('board.cant')}
        </Button>
      </div>
    </li>
  );
}

/** A finished order in "Done today": who, what, and how it ended. */
function DoneRow({ order }: { order: CafeOrder }) {
  const { t } = useTranslation(['cafe']);
  const f = useFormat();
  const { placeLabel } = useCafeNames();
  const time = f.time(clockOf(finishedAt(order)));
  const cancelled = order.status === 'cancelled';
  // Cancelled by whoever serves (with a reason) or by the person who ordered (no reason, nobody handled it).
  const ending = !cancelled
    ? t('board.deliveredAt', { time })
    : order.cancelReason || order.handledBy
      ? t('board.cancelledAt', { time })
      : t('board.cancelledBy', { name: isolate(order.by.name), time });
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <Avatar name={order.by.name} fileId={order.by.photoFileId} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">
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
        {order.cancelReason && (
          <p className="mt-0.5 text-sm text-muted">
            {t('board.reasonGiven', { reason: isolate(order.cancelReason) })}
          </p>
        )}
      </div>
    </li>
  );
}

/** "Can't do this one": a short reason for the person who ordered — one tap on a ready-made one, or their own words. */
function TurnDownModal({ order, onClose }: { order: CafeOrder | null; onClose: () => void }) {
  const { t } = useTranslation(['cafe']);
  const toast = useToast();
  const move = useMoveOrder();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const orderId = order?.id;
  useEffect(() => {
    setReason('');
    setError(null);
  }, [orderId]);

  const quick = ['out', 'closed', 'busy'] as const;
  const submit = () => {
    if (!order) return;
    const input = cafeStatusInput.safeParse({ status: 'cancelled', reason });
    if (!input.success) {
      setError('errors.reasonRequired');
      return;
    }
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
        {quick.map((key) => {
          const text = t(`board.quick.${key}`);
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
 * after the page has been tapped: until then a big button asks for that tap;
 * afterwards a quiet line says the ring is on, with a way to hear it.
 */
function SoundStrip() {
  const { t } = useTranslation(['cafe']);
  const [ready, setReady] = useState(soundReady);
  useEffect(() => {
    if (ready || !soundSupported()) return;
    // Any tap on the page will do (the first "On the way" counts too).
    const unlock = () => void unlockSound().then((ok) => ok && setReady(true));
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, [ready]);
  if (!soundSupported()) return null;
  if (!ready)
    return (
      <button
        type="button"
        onClick={() => void unlockSound().then((ok) => ok && setReady(true))}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 border-dashed border-warning bg-warning-soft px-4 py-3 text-start text-base font-semibold text-ink"
      >
        <BellRing className="size-6 shrink-0 text-warning" aria-hidden />
        {t('board.soundOff')}
      </button>
    );
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-success-soft px-4 py-2">
      <p className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-ink">
        <BellRing className="size-5 shrink-0 text-success" aria-hidden />
        {t('board.soundOn')}
      </p>
      <Button size="lg" variant="ghost" icon={Volume2} onClick={ring} className="shrink-0">
        {t('board.soundTest')}
      </Button>
    </div>
  );
}
