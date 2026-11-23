import clsx from 'clsx';
import { CircleCheck, CircleX, Coffee, Footprints, Hourglass, MapPin, Minus, Plus, RotateCcw, Send, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import type { CafeOrderStatus } from '@shared/enums';
import { MAX_CAFE_NOTE, MAX_CAFE_OPTIONS, MAX_CAFE_PLACE, type CafeItem, type CafeMenu, type CafeOrder } from '@shared/schemas/cafe';
import { Button, ButtonLink, Card, ConfirmDialog, EmptyState, ErrorState, FormActions, Input, PageHeader, PageLoader, Textarea, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { clockOf, isolate } from '../team/utils';
import { cafeErrorKey, useCafeMenu, useCancelMyOrder, useMyCafeOrders, useSendOrder } from './api';
import { CafeGate, CafeTabs, OrderLines, useCafeNames } from './components/CafeParts';
import {
  CAFE_MENU_PATH,
  OTHER_PLACE,
  addOne,
  addVariant,
  canAddLine,
  canAddOne,
  chosenPlace,
  draftFromOrder,
  dropUnavailable,
  initialPlace,
  linesOf,
  menuGroups,
  orderIdFrom,
  orderProblem,
  removeOne,
  setOptions,
  splitMyOrders,
  toOrderInput,
  type DraftLine,
  type PlaceChoice,
} from './utils';

/**
 * /cafeteria — ordering, for every signed-in team member: what became of my
 * order in large words ("Sent — waiting", "On the way", "Delivered ✓"), the
 * menu by group with − / + rows, where it should come, a note, "Send order",
 * and my recent orders with "Order again". An alert's link
 * ("/cafeteria?order=12") shows that order at the top.
 */
export default function CafeOrderPage() {
  const { t } = useTranslation(['cafe']);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <CafeGate>
        <CafeTabs />
        <OrderScreen />
      </CafeGate>
    </div>
  );
}

function OrderScreen() {
  const { t } = useTranslation(['cafe', 'common']);
  const { can } = useAuth();
  const toast = useToast();
  const { search } = useLocation();
  const menu = useCafeMenu();
  const mine = useMyCafeOrders(true, (orders) => orders.some((o) => o.status === 'new' || o.status === 'on_the_way'));
  const send = useSendOrder();

  const [draft, setDraft] = useState<DraftLine[]>([]);
  // The picker starts on the person's last place; null until they touch it (the menu may still be loading).
  const [placeTouched, setPlaceTouched] = useState<PlaceChoice | null>(null);
  const [note, setNote] = useState('');
  // Said only after a tap on "Send order" with something missing: no red text before the person has tried.
  const [problemShown, setProblemShown] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const items = menu.data?.items;
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  // The menu changed under the person (an item switched off or removed): take it off the order and say so.
  useEffect(() => {
    if (!items) return;
    const next = dropUnavailable(latestDraft.current, items);
    if (!next.dropped) return;
    setDraft(next.draft);
    toast.error(t('order.dropped'));
  }, [items, toast, t]);

  if (menu.isPending) return <PageLoader />;
  if (menu.isError || !menu.data) return <ErrorState error={menu.error} onRetry={() => void menu.refetch()} />;

  const data: CafeMenu = menu.data;
  const place = placeTouched ?? initialPlace(data.lastPlace, data.places);
  const problem = orderProblem(draft, place);
  const { current, recent } = splitMyOrders(mine.data?.items ?? [], Date.now(), orderIdFrom(search));

  const submit = () => {
    const input = toOrderInput(draft, place, note);
    if (!input) {
      setProblemShown(true);
      return;
    }
    send.mutate(input, {
      onSuccess: () => {
        toast.success(t('order.sent'));
        setDraft([]);
        setNote('');
        setProblemShown(false);
        window.scrollTo({ top: 0 });
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'item_unavailable') {
          // Something was switched off a moment ago: off the order it goes, and the menu is read again.
          const gone = new Set((err.details as { itemIds?: number[] } | undefined)?.itemIds ?? []);
          setDraft((lines) => lines.filter((l) => !gone.has(l.itemId)));
          toast.error(t('order.dropped'));
        } else toast.error(t(cafeErrorKey(err)));
      },
    });
  };

  const again = (order: CafeOrder) => {
    const next = draftFromOrder(order, data.items);
    if (!next.draft.length) {
      toast.error(t('mine.againNothing'));
      return;
    }
    setDraft(next.draft);
    setPlaceTouched(initialPlace(order.place, data.places));
    setNote(order.note ?? '');
    setProblemShown(false);
    toast.success(t(next.skipped ? 'mine.againSome' : 'mine.againAdded'));
    formRef.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="space-y-6">
      {current.length > 0 && (
        <section aria-label={t('mine.current')} className="space-y-3">
          {current.map((order) => (
            <StatusCard key={order.id} order={order} onAgain={() => again(order)} />
          ))}
        </section>
      )}

      {data.items.length === 0 ? (
        <EmptyState
          icon={Coffee}
          title={t('order.emptyMenu')}
          description={t('order.emptyMenuHint')}
          className="rounded-2xl border border-dashed border-line-strong"
          action={
            can('cafeteria.serve') || can('settings.manage') ? (
              <ButtonLink to={CAFE_MENU_PATH} icon={UtensilsCrossed} size="lg" variant="primary">
                {t('order.setUpMenu')}
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div ref={formRef} className="space-y-5">
          <Card title={t('order.menuTitle')} padded={false}>
            {menuGroups(data.items).map((group) => (
              <section key={group.category} aria-label={t(`categories.${group.category}`)}>
                <h3 className="border-b border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-muted sm:px-5">{t(`categories.${group.category}`)}</h3>
                <ul className="divide-y divide-line">
                  {group.items.map((item) => (
                    <MenuRow key={item.id} item={item} draft={draft} onChange={setDraft} />
                  ))}
                </ul>
              </section>
            ))}
          </Card>

          <PlacePicker places={data.places} value={place} onChange={setPlaceTouched} invalid={problemShown && problem === 'place'} />

          <Card>
            <label htmlFor="cafe-note" className="mb-1.5 block text-base font-semibold text-ink">
              {t('order.note')} <span className="text-sm font-normal text-muted">({t('common:states.optional')})</span>
            </label>
            <Textarea id="cafe-note" rows={2} maxLength={MAX_CAFE_NOTE} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('order.notePlaceholder')} dir="auto" />
          </Card>

          <FormActions className="flex-col items-stretch sm:flex-row sm:items-center sm:justify-end">
            {!canAddLine(draft) && <p className="text-sm font-medium text-ink sm:me-auto">{t('order.full')}</p>}
            {problemShown && problem && (
              <p role="alert" className="text-sm font-medium text-danger sm:me-auto">
                {t(problem === 'nothing' ? 'order.chooseSomething' : 'order.choosePlace')}
              </p>
            )}
            <Button variant="primary" size="lg" icon={Send} loading={send.isPending} onClick={submit} className="h-14 w-full text-lg sm:w-auto sm:px-8 rtl:[&>svg]:-scale-x-100">
              {send.isPending ? t('order.sending') : t('order.send')}
            </Button>
          </FormActions>
        </div>
      )}

      {recent.length > 0 && (
        <Card title={t('mine.recent')} padded={false}>
          <ul className="divide-y divide-line">
            {recent.map((order) => (
              <RecentRow key={order.id} order={order} onAgain={() => again(order)} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── What became of my order ─────────────────────────────────────────────────

const STATUS_LOOK: Record<CafeOrderStatus, { icon: LucideIcon; box: string; tile: string }> = {
  new: { icon: Hourglass, box: 'border-warning/60 bg-warning-soft', tile: 'bg-warning text-warning-ink' },
  on_the_way: { icon: Footprints, box: 'border-accent/50 bg-accent-soft', tile: 'bg-accent text-accent-ink' },
  delivered: { icon: CircleCheck, box: 'border-success/50 bg-success-soft', tile: 'bg-success text-success-ink' },
  cancelled: { icon: CircleX, box: 'border-danger/40 bg-danger-soft', tile: 'bg-danger text-danger-ink' },
};

/** One of my orders in large words, with "Cancel order" while nobody has taken it yet (and "Order again" once it is finished). */
function StatusCard({ order, onAgain }: { order: CafeOrder; onAgain: () => void }) {
  const { t } = useTranslation(['cafe', 'common']);
  const f = useFormat();
  const toast = useToast();
  const { placeLabel } = useCafeNames();
  const cancel = useCancelMyOrder();
  const [confirm, setConfirm] = useState(false);
  const look = STATUS_LOOK[order.status];
  const finished = order.status === 'delivered' || order.status === 'cancelled';

  let hint: string;
  if (order.status === 'new') hint = t('status.newHint');
  else if (order.status === 'on_the_way') hint = order.handledBy ? t('status.onTheWayHint', { name: isolate(order.handledBy.name) }) : '';
  else if (order.status === 'delivered') hint = t('status.deliveredHint', { time: f.time(clockOf(order.deliveredAt ?? order.createdAt)) });
  else hint = order.cancelReason ? t('status.cancelledReason', { reason: isolate(order.cancelReason) }) : t('status.cancelledByYou');

  return (
    <article className={clsx('rounded-2xl border-2 p-4 sm:p-5', look.box)}>
      <div className="flex items-start gap-3" role="status">
        <span className={clsx('flex size-12 shrink-0 items-center justify-center rounded-xl', look.tile)} aria-hidden>
          <look.icon className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-tight text-ink">{t(`status.${order.status}`)}</p>
          {hint && <p className="mt-1 text-base text-ink">{hint}</p>}
        </div>
      </div>
      <div className="mt-4 rounded-xl bg-surface p-3">
        <OrderLines lines={order.items} />
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-4 shrink-0" aria-hidden />
            {t('status.to', { place: isolate(placeLabel(order.place)) })}
          </span>
          <span>{t('status.sentAt', { time: f.time(clockOf(order.createdAt)) })}</span>
        </p>
        {order.note && (
          <p className="mt-1 text-sm text-muted">
            {t('status.noteLabel')}: <bdi>{order.note}</bdi>
          </p>
        )}
      </div>
      {order.status === 'new' && (
        <Button size="lg" variant="secondary" icon={CircleX} className="mt-3 w-full sm:w-auto" onClick={() => setConfirm(true)}>
          {t('mine.cancel')}
        </Button>
      )}
      {finished && (
        <Button size="lg" variant="secondary" icon={RotateCcw} className="mt-3 w-full sm:w-auto" onClick={onAgain}>
          {t('mine.again')}
        </Button>
      )}
      <ConfirmDialog
        open={confirm}
        title={t('mine.cancelTitle')}
        message={t('mine.cancelMessage')}
        confirmLabel={t('mine.cancelYes')}
        loading={cancel.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          cancel.mutate(order.id, {
            onSuccess: () => toast.success(t('mine.cancelled')),
            onError: (err) => toast.error(t(cafeErrorKey(err))),
            onSettled: () => setConfirm(false),
          })
        }
      />
    </article>
  );
}

/** A finished order in the "Recent orders" list: what it was, how it ended, and "Order again". */
function RecentRow({ order, onAgain }: { order: CafeOrder; onAgain: () => void }) {
  const { t } = useTranslation(['cafe']);
  const f = useFormat();
  const { placeLabel } = useCafeNames();
  const when = order.deliveredAt ?? order.cancelledAt ?? order.createdAt;
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="min-w-0 flex-1">
        <OrderLines lines={order.items} />
        <p className="mt-1 text-sm text-muted">
          <span className={clsx('font-medium', order.status === 'cancelled' ? 'text-danger' : 'text-success')}>{t(`status.${order.status}`)}</span>
          {' · '}
          {f.timestampTime(when, 'short')}
          {' · '}
          <bdi>{placeLabel(order.place)}</bdi>
        </p>
      </div>
      <Button size="lg" icon={RotateCcw} onClick={onAgain} className="w-full shrink-0 sm:w-auto">
        {t('mine.again')}
      </Button>
    </li>
  );
}

// ── The menu rows ───────────────────────────────────────────────────────────

/** One menu item: its name, − / +, and once it is on the order how it is wanted — plus a second line for one made differently. */
function MenuRow({ item, draft, onChange }: { item: CafeItem; draft: DraftLine[]; onChange: (next: DraftLine[]) => void }) {
  const { t } = useTranslation(['cafe', 'common']);
  const { itemName } = useCafeNames();
  const name = itemName(item);
  const lines = linesOf(draft, item.id);

  if (!item.available)
    return (
      <li className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <span className="text-lg font-medium text-muted line-through decoration-1">
          <bdi>{name}</bdi>
        </span>
        <span className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-sm font-medium text-muted">{t('order.notAvailable')}</span>
      </li>
    );

  // Always one row for the item itself (its first line, or an empty one), then any lines made differently.
  const rows: (DraftLine | undefined)[] = lines.length ? lines : [undefined];
  return (
    <li className={clsx('px-4 py-3 sm:px-5', lines.length > 0 && 'bg-accent-soft/40')}>
      {rows.map((line, i) => (
        <div key={line?.key ?? 'empty'} className={clsx(i > 0 && 'mt-3 border-t border-dashed border-line-strong pt-3')}>
          <div className="flex min-h-12 items-center justify-between gap-3">
            <span className="min-w-0 text-lg font-semibold text-ink">
              <bdi>{name}</bdi>
            </span>
            <Stepper
              name={name}
              qty={line?.qty ?? 0}
              canAdd={canAddOne(line, draft)}
              onAdd={() => onChange(addOne(draft, item.id, line?.key))}
              onRemove={() => line && onChange(removeOne(draft, line.key))}
            />
          </div>
          {line && (
            <div className="mt-2">
              <label htmlFor={`how-${line.key}`} className="mb-1 block text-sm font-medium text-ink">
                {t('order.how')} <span className="font-normal text-muted">({t('common:states.optional')})</span>
                <span className="sr-only"> {name}</span>
              </label>
              <Input
                id={`how-${line.key}`}
                value={line.options}
                maxLength={MAX_CAFE_OPTIONS}
                onChange={(e) => onChange(setOptions(draft, line.key, e.target.value))}
                placeholder={t('order.howPlaceholder')}
                dir="auto"
              />
            </div>
          )}
        </div>
      ))}
      {lines.length > 0 && canAddLine(draft) && (
        <button
          type="button"
          onClick={() => onChange(addVariant(draft, item.id))}
          className="mt-2 inline-flex min-h-12 items-center gap-2 rounded-xl px-2 text-start text-sm font-medium text-accent hover:bg-accent-soft"
        >
          <Plus className="size-4 shrink-0" aria-hidden />
          {t('order.another', { name: isolate(name) })}
        </button>
      )}
    </li>
  );
}

/** − 2 + : two 48 px buttons with the number between them. */
function Stepper({ name, qty, canAdd, onAdd, onRemove }: { name: string; qty: number; canAdd: boolean; onAdd: () => void; onRemove: () => void }) {
  const { t } = useTranslation(['cafe']);
  const f = useFormat();
  const button = 'inline-flex size-12 shrink-0 items-center justify-center rounded-xl border-2 text-ink transition-colors disabled:opacity-40';
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" onClick={onRemove} disabled={qty === 0} aria-label={t('order.less', { name })} className={clsx(button, 'border-line-strong bg-surface hover:bg-surface-2')}>
        <Minus className="size-6" aria-hidden />
      </button>
      <span aria-live="polite" className={clsx('min-w-9 text-center text-xl font-bold tabular-nums', qty ? 'text-ink' : 'text-muted')}>
        {f.number(qty)}
      </span>
      <button type="button" onClick={onAdd} disabled={!canAdd} aria-label={t('order.more', { name })} className={clsx(button, 'border-accent bg-accent text-accent-ink hover:bg-accent-hover')}>
        <Plus className="size-6" aria-hidden />
      </button>
    </div>
  );
}

// ── Where should it come? ───────────────────────────────────────────────────

function PlacePicker({ places, value, onChange, invalid }: { places: CafeMenu['places']; value: PlaceChoice; onChange: (next: PlaceChoice) => void; invalid: boolean }) {
  const { t, i18n } = useTranslation(['cafe']);
  const option = (active: boolean) =>
    clsx(
      'flex min-h-14 items-center justify-center rounded-xl border-2 px-3 py-2 text-center text-base font-semibold leading-tight transition-colors',
      active ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-surface text-ink hover:bg-surface-2',
    );
  const other = value.pick === OTHER_PLACE;
  return (
    <section aria-labelledby="cafe-place" className={clsx('rounded-2xl border bg-surface p-4 sm:p-5', invalid ? 'border-danger' : 'border-line')}>
      <h2 id="cafe-place" className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
        <MapPin className="size-5 shrink-0 text-muted" aria-hidden />
        {t('order.placeTitle')}
      </h2>
      <div role="radiogroup" aria-labelledby="cafe-place" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {places.map((p, i) => (
          <button key={`${i}-${p.en}`} type="button" role="radio" aria-checked={value.pick === p.en} onClick={() => onChange({ pick: p.en, other: value.other })} className={option(value.pick === p.en)}>
            <bdi>{i18n.language === 'ar' ? p.ar : p.en}</bdi>
          </button>
        ))}
        <button type="button" role="radio" aria-checked={other} onClick={() => onChange({ pick: OTHER_PLACE, other: value.other })} className={option(other)}>
          {t('order.somewhereElse')}
        </button>
      </div>
      {other && (
        <div className="mt-3">
          <label htmlFor="cafe-place-other" className="mb-1.5 block text-sm font-medium text-ink">
            {t('order.placeOther')}
          </label>
          <Input
            id="cafe-place-other"
            value={value.other}
            maxLength={MAX_CAFE_PLACE}
            onChange={(e) => onChange({ pick: OTHER_PLACE, other: e.target.value })}
            placeholder={t('order.placeOtherPlaceholder')}
            dir="auto"
            aria-invalid={invalid && !chosenPlace(value) ? true : undefined}
          />
        </div>
      )}
    </section>
  );
}
