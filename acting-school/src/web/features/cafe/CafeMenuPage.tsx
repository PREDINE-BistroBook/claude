import clsx from 'clsx';
import { MapPin, Pencil, Plus, Sparkles, Trash2, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CAFE_CATEGORIES, type CafeCategory } from '@shared/enums';
import { MAX_CAFE_ITEM_NAME, MAX_CAFE_ITEMS, MAX_CAFE_PLACE, MAX_CAFE_PLACES, cafeItemInput, type CafeItem, type CafePlace } from '@shared/schemas/cafe';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Select, Switch, useToast } from '@web/components/ui';
import { MoveButtons } from '../website/components/MoveButtons';
import { isolate } from '../team/utils';
import { cafeErrorKey, useCafeMenu, useMenuEditor } from './api';
import { CafeGate, CafeTabs, useCafeNames } from './components/CafeParts';
import { menuGroups, moveInGroup } from './utils';

/**
 * /cafeteria/menu — the Menu tab (cafeteria.serve, or settings.manage like the
 * director): add an item, rename it in English and Arabic, move it up or down
 * in its group, switch "Available" off for today, remove it; and the list of
 * places an order can come to. On an empty menu, "Add the usual items" puts
 * tea, coffee, water… there in one tap. No prices.
 */
export default function CafeMenuPage() {
  const { t } = useTranslation(['cafe']);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('menu.title')} subtitle={t('menu.subtitle')} />
      <CafeGate>
        <CafeTabs />
        <MenuEditor />
      </CafeGate>
    </div>
  );
}

function MenuEditor() {
  const { t } = useTranslation(['cafe', 'common']);
  const toast = useToast();
  const menu = useCafeMenu();
  const editor = useMenuEditor();
  const { itemName } = useCafeNames();
  /** 'new', or the item being edited. */
  const [editing, setEditing] = useState<CafeItem | 'new' | null>(null);

  if (menu.isPending) return <PageLoader />;
  if (menu.isError || !menu.data) return <ErrorState error={menu.error} onRetry={() => void menu.refetch()} />;
  const items = menu.data.items;
  const fail = (err: unknown) => toast.error(t(cafeErrorKey(err)));
  const busy = editor.reorder.isPending || editor.update.isPending;

  const move = (item: CafeItem, delta: -1 | 1) => {
    const ids = moveInGroup(items, item.id, delta);
    if (ids) editor.reorder.mutate(ids, { onError: fail });
  };
  const setAvailable = (item: CafeItem, available: boolean) =>
    editor.update.mutate(
      { id: item.id, available },
      { onSuccess: () => toast.success(t(available ? 'menu.availableOn' : 'menu.availableOff', { name: isolate(itemName(item)) })), onError: fail },
    );

  return (
    <div className="space-y-6">
      {items.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title={t('menu.empty')}
          description={t('menu.addUsualHint')}
          className="rounded-2xl border border-dashed border-line-strong"
          action={
            <div className="grid gap-2">
              <Button
                variant="primary"
                size="lg"
                icon={Sparkles}
                loading={editor.addUsual.isPending}
                onClick={() => editor.addUsual.mutate(undefined, { onSuccess: () => toast.success(t('menu.added')), onError: fail })}
                className="h-14 px-6 text-lg"
              >
                {t('menu.addUsual')}
              </Button>
              <Button size="lg" icon={Plus} onClick={() => setEditing('new')}>
                {t('menu.add')}
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <Button variant="primary" size="lg" icon={Plus} onClick={() => setEditing('new')} disabled={items.length >= MAX_CAFE_ITEMS} className="w-full sm:w-auto">
            {t('menu.add')}
          </Button>
          {menuGroups(items).map((group) => (
            <section key={group.category} aria-labelledby={`cafe-group-${group.category}`}>
              <h2 id={`cafe-group-${group.category}`} className="mb-3 text-lg font-semibold text-ink">
                {t(`categories.${group.category}`)}
              </h2>
              <ul className="grid gap-3">
                {group.items.map((item, index) => {
                  const name = itemName(item);
                  const otherName = name === item.nameEn ? item.nameAr : item.nameEn;
                  return (
                    <li key={item.id} className={clsx('rounded-2xl border bg-surface p-4', item.available ? 'border-line' : 'border-dashed border-line-strong')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={clsx('text-lg font-semibold', item.available ? 'text-ink' : 'text-muted')}>
                            <bdi>{name}</bdi>
                          </p>
                          {otherName !== name && (
                            <p className="text-sm text-muted">
                              <bdi>{otherName}</bdi>
                            </p>
                          )}
                        </div>
                        <Button size="lg" icon={Pencil} onClick={() => setEditing(item)} className="shrink-0">
                          {t('menu.edit')}
                          <span className="sr-only">: {name}</span>
                        </Button>
                      </div>
                      <div className="mt-3 rounded-xl bg-surface-2 px-3 [&_[role=switch]]:h-12 [&_label]:text-base">
                        <Switch checked={item.available} onChange={(next) => setAvailable(item, next)} label={t('menu.available')} disabled={editor.update.isPending} />
                      </div>
                      <div className="mt-3">
                        <MoveButtons name={name} index={index} count={group.items.length} onMove={(delta) => move(item, delta)} disabled={busy} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      <PlacesEditor key={JSON.stringify(menu.data.places)} places={menu.data.places} />
      <ItemModal editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/** Add an item, or edit one: its two names, its group, Available — and "Remove from the menu" (asked twice). */
function ItemModal({ editing, onClose }: { editing: CafeItem | 'new' | null; onClose: () => void }) {
  const { t } = useTranslation(['cafe', 'common']);
  const toast = useToast();
  const editor = useMenuEditor();
  const { itemName } = useCafeNames();
  const item = editing && editing !== 'new' ? editing : null;
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [category, setCategory] = useState<CafeCategory>('hot');
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Start each opening from the item as it is (or from blanks).
  const openKey = editing === 'new' ? 'new' : (editing?.id ?? null);
  useEffect(() => {
    // Both names as they are stored (an item typed in one language has the same text in both, until the other is added).
    setNameEn(item?.nameEn ?? '');
    setNameAr(item?.nameAr ?? '');
    setCategory(item?.category ?? 'hot');
    setAvailable(item?.available ?? true);
    setError(null);
    setConfirmRemove(false);
  }, [openKey]);

  const saving = editor.add.isPending || editor.update.isPending;
  const save = () => {
    const parsed = cafeItemInput.safeParse({ nameEn, nameAr, category, available });
    if (!parsed.success) {
      setError('common:errors.required');
      return;
    }
    const done = { onSuccess: () => (toast.success(t(item ? 'menu.saved' : 'menu.added')), onClose()), onError: (err: unknown) => toast.error(t(cafeErrorKey(err))) };
    // Both names are always sent: a blank one takes the other's text on the server.
    if (item) editor.update.mutate({ id: item.id, nameEn, nameAr, category, available }, done);
    else editor.add.mutate(parsed.data, done);
  };

  return (
    <>
      <Modal
        open={!!editing && !confirmRemove}
        onClose={onClose}
        title={item ? t('menu.editTitle', { name: isolate(itemName(item)) }) : t('menu.addTitle')}
        footer={
          <>
            <Button size="lg" onClick={onClose} disabled={saving}>
              {t('common:actions.cancel')}
            </Button>
            <Button size="lg" variant="primary" loading={saving} onClick={save}>
              {t('common:actions.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cafe-name-en" lang="en" className="text-sm font-medium text-ink">
                {t('menu.nameEn')}
              </label>
              <Input
                id="cafe-name-en"
                value={nameEn}
                maxLength={MAX_CAFE_ITEM_NAME}
                onChange={(e) => (setNameEn(e.target.value), setError(null))}
                dir="ltr"
                lang="en"
                className="text-start"
                aria-invalid={error ? true : undefined}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cafe-name-ar" lang="ar" className="text-sm font-medium text-ink">
                {t('menu.nameAr')}
              </label>
              <Input
                id="cafe-name-ar"
                value={nameAr}
                maxLength={MAX_CAFE_ITEM_NAME}
                onChange={(e) => (setNameAr(e.target.value), setError(null))}
                dir="rtl"
                lang="ar"
                className="text-start"
                aria-invalid={error ? true : undefined}
              />
            </div>
          </div>
          {error ? (
            <p role="alert" className="-mt-2 text-sm text-danger">
              {t(error)}
            </p>
          ) : (
            <p className="-mt-2 text-xs text-muted">{t('menu.nameHint')}</p>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cafe-category" className="text-sm font-medium text-ink">
              {t('menu.category')}
            </label>
            <Select id="cafe-category" value={category} onChange={(e) => setCategory(e.target.value as CafeCategory)}>
              {CAFE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="rounded-xl bg-surface-2 px-3 [&_[role=switch]]:h-12 [&_label]:text-base">
            <Switch checked={available} onChange={setAvailable} label={t('menu.available')} />
          </div>
          {item && (
            <Button size="lg" variant="danger-ghost" icon={Trash2} onClick={() => setConfirmRemove(true)} className="justify-self-start">
              {t('menu.remove')}
            </Button>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={!!item && confirmRemove}
        title={item ? t('menu.removeTitle', { name: isolate(itemName(item)) }) : undefined}
        message={t('menu.removeMessage')}
        confirmLabel={t('menu.removeYes')}
        loading={editor.remove.isPending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() =>
          item &&
          editor.remove.mutate(item.id, {
            onSuccess: () => (toast.success(t('menu.removed')), onClose()),
            onError: (err) => (toast.error(t(cafeErrorKey(err))), setConfirmRemove(false)),
          })
        }
      />
    </>
  );
}

interface PlaceDraft {
  rowId: number;
  en: string;
  ar: string;
}

/** The places an order can come to: each in English and Arabic (one is enough), in order, saved together. */
function PlacesEditor({ places }: { places: CafePlace[] }) {
  const { t, i18n } = useTranslation(['cafe', 'common']);
  const toast = useToast();
  const editor = useMenuEditor();
  // Both names as they are stored (a place typed in one language has the same text in both, until the other is added).
  const [rows, setRows] = useState<PlaceDraft[]>(() => places.map((p, i) => ({ rowId: i, en: p.en, ar: p.ar })));
  const [nextId, setNextId] = useState(places.length);
  const [touched, setTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const change = (next: PlaceDraft[]) => (setRows(next), setTouched(true));
  const blank = (r: PlaceDraft) => !r.en.trim() && !r.ar.trim();
  const save = () => {
    if (rows.some(blank)) {
      setShowErrors(true);
      return;
    }
    // mutateAsync, not mutate with callbacks: the saved list comes back as a fresh editor (MenuEditor keys it by the
    // places), and callbacks given to mutate() would be dropped with this one.
    void editor.savePlaces.mutateAsync(rows.map((r) => ({ en: r.en, ar: r.ar }))).then(
      () => (toast.success(t('menu.placesSaved')), setTouched(false), setShowErrors(false)),
      (err: unknown) => toast.error(t(cafeErrorKey(err))),
    );
  };
  const nameOf = (r: PlaceDraft, i: number) => (i18n.language === 'ar' ? r.ar.trim() || r.en.trim() : r.en.trim() || r.ar.trim()) || t('menu.placeN', { n: i + 1 });

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <MapPin className="size-5 shrink-0 text-muted" aria-hidden />
          {t('menu.placesTitle')}
        </span>
      }
      description={t('menu.placesHint')}
    >
      {rows.length === 0 && <p className="mb-3 text-sm text-muted">{t('menu.noPlaces')}</p>}
      <ul className="grid gap-3">
        {rows.map((row, i) => {
          const name = nameOf(row, i);
          const invalid = showErrors && blank(row);
          return (
            <li key={row.rowId} className={clsx('rounded-xl border p-3', invalid ? 'border-danger' : 'border-line')}>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`place-en-${row.rowId}`} lang="en" className="text-xs font-semibold text-muted">
                    {t('menu.placeEn')}
                  </label>
                  <Input
                    id={`place-en-${row.rowId}`}
                    value={row.en}
                    maxLength={MAX_CAFE_PLACE}
                    dir="ltr"
                    lang="en"
                    className="text-start"
                    aria-invalid={invalid ? true : undefined}
                    onChange={(e) => change(rows.map((r) => (r === row ? { ...r, en: e.target.value } : r)))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`place-ar-${row.rowId}`} lang="ar" className="text-xs font-semibold text-muted">
                    {t('menu.placeAr')}
                  </label>
                  <Input
                    id={`place-ar-${row.rowId}`}
                    value={row.ar}
                    maxLength={MAX_CAFE_PLACE}
                    dir="rtl"
                    lang="ar"
                    className="text-start"
                    aria-invalid={invalid ? true : undefined}
                    onChange={(e) => change(rows.map((r) => (r === row ? { ...r, ar: e.target.value } : r)))}
                  />
                </div>
              </div>
              {invalid && (
                <p role="alert" className="mt-1.5 text-sm text-danger">
                  {t('errors.placeRequired')}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <MoveButtons
                  name={name}
                  index={i}
                  count={rows.length}
                  onMove={(delta) => {
                    const next = [...rows];
                    [next[i], next[i + delta]] = [next[i + delta]!, next[i]!];
                    change(next);
                  }}
                />
                <Button size="lg" variant="danger-ghost" icon={Trash2} onClick={() => change(rows.filter((r) => r !== row))}>
                  {t('common:actions.remove')}
                  <span className="sr-only">: {name}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Button
          size="lg"
          icon={Plus}
          disabled={rows.length >= MAX_CAFE_PLACES}
          onClick={() => {
            change([...rows, { rowId: nextId, en: '', ar: '' }]);
            setNextId(nextId + 1);
          }}
        >
          {t('menu.addPlace')}
        </Button>
        <Button size="lg" variant="primary" disabled={!touched} loading={editor.savePlaces.isPending} onClick={save}>
          {t('menu.savePlaces')}
        </Button>
      </div>
    </Card>
  );
}
