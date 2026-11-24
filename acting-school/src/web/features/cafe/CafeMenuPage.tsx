import clsx from 'clsx';
import { ArrowUpDown, Check, MapPin, Pencil, Sparkles, Trash2, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CAFE_CATEGORIES, type CafeCategory } from '@shared/enums';
import { MAX_CAFE_ITEM_NAME, MAX_CAFE_ITEMS, MAX_CAFE_PLACE, MAX_CAFE_PLACES, cafeItemInput, cafePlacesInput, type CafeItem, type CafePlace } from '@shared/schemas/cafe';
import { AddButton, Button, Card, ConfirmDialog, EmptyState, ErrorState, FormActions, Input, Modal, PageHeader, PageLoader, Select, Switch, useToast } from '@web/components/ui';
import { useFocusNewRow } from '@web/lib/focusNewRow';
import { MoveButtons } from '../website/components/MoveButtons';
import { isolate } from '../team/utils';
import { cafeErrorKey, useCafeMenu, useMenuEditor } from './api';
import { CafeGate, CafeTabs, useCafeNames } from './components/CafeParts';
import { menuGroups, moveInGroup, nameFieldsInOrder, placeRowErrors } from './utils';

/**
 * /cafeteria/menu — the Menu tab (cafeteria.serve, or settings.manage like the
 * director): add an item, rename it in English and Arabic, switch "Available"
 * off for today (the switch says which it is: "Available now" / "Not available
 * now"), remove it, and — behind "Change the order" on each group, so the page
 * stays short — move it up or down; and the list of places an order can be
 * brought to. On an empty menu, "Add the usual items" puts tea, coffee,
 * water… there in one tap. No prices.
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
  /** The group whose order is being changed (its cards show Move up / Move down). */
  const [reordering, setReordering] = useState<CafeCategory | null>(null);

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
              <AddButton label={t('common:add.menuItem')} onClick={() => setEditing('new')} />
            </div>
          }
        />
      ) : (
        <>
          <AddButton variant="primary" label={t('common:add.menuItem')} onClick={() => setEditing('new')} disabled={items.length >= MAX_CAFE_ITEMS} className="w-full sm:w-auto" />
          {menuGroups(items).map((group) => (
            <section key={group.category} aria-labelledby={`cafe-group-${group.category}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id={`cafe-group-${group.category}`} className="text-lg font-semibold text-ink">
                  {t(`categories.${group.category}`)}
                </h2>
                {group.items.length > 1 && (
                  <Button
                    size="lg"
                    variant={reordering === group.category ? 'primary' : 'ghost'}
                    icon={reordering === group.category ? Check : ArrowUpDown}
                    aria-pressed={reordering === group.category}
                    onClick={() => setReordering(reordering === group.category ? null : group.category)}
                  >
                    {t(reordering === group.category ? 'menu.reorderDone' : 'menu.reorder')}
                    <span className="sr-only">: {t(`categories.${group.category}`)}</span>
                  </Button>
                )}
              </div>
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
                        <Switch checked={item.available} onChange={(next) => setAvailable(item, next)} label={<AvailableLabel available={item.available} />} disabled={editor.update.isPending} />
                      </div>
                      {reordering === group.category && (
                        <div className="mt-3">
                          <MoveButtons name={name} index={index} count={group.items.length} onMove={(delta) => move(item, delta)} disabled={busy} />
                        </div>
                      )}
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

/** "Available now" in green, or "Not available now" in grey: the switch's state in words, not only its colour. */
function AvailableLabel({ available }: { available: boolean }) {
  const { t } = useTranslation(['cafe']);
  return <span className={clsx('font-semibold', available ? 'text-success' : 'text-muted')}>{t(available ? 'menu.availableNow' : 'menu.notAvailableNow')}</span>;
}

/** Add an item, or edit one: its two names, its group, Available — and "Remove from the menu" (asked twice). */
function ItemModal({ editing, onClose }: { editing: CafeItem | 'new' | null; onClose: () => void }) {
  const { t, i18n } = useTranslation(['cafe', 'common']);
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
          {/* Said before the fields: someone who types only Arabic (or only English) knows that is enough. */}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {t(error)}
            </p>
          ) : (
            <p className="text-sm text-muted">{t('menu.nameHint')}</p>
          )}
          {/* The screen's own language first. */}
          <div className="-mt-1 grid gap-3 sm:grid-cols-2">
            {nameFieldsInOrder(i18n.language).map((lang) =>
              lang === 'en' ? (
                <div key="en" className="flex flex-col gap-1.5">
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
              ) : (
                <div key="ar" className="flex flex-col gap-1.5">
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
              ),
            )}
          </div>
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
            <Switch checked={available} onChange={setAvailable} label={<AvailableLabel available={available} />} />
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

/**
 * The places an order can be brought to: each in English and Arabic (one is
 * enough, the screen's own language first), in order, saved together. Once
 * something changed, "Not saved yet" and "Save places" stay in sight at the
 * bottom of the screen; removing a saved place asks first; two places with
 * the same name are refused before anything is sent.
 */
function PlacesEditor({ places }: { places: CafePlace[] }) {
  const { t, i18n } = useTranslation(['cafe', 'common']);
  const toast = useToast();
  const editor = useMenuEditor();
  // Both names as they are stored (a place typed in one language has the same text in both, until the other is added).
  const [rows, setRows] = useState<PlaceDraft[]>(() => places.map((p, i) => ({ rowId: i, en: p.en, ar: p.ar })));
  const [nextId, setNextId] = useState(places.length);
  const placesRef = useFocusNewRow<HTMLUListElement>(rows.length);
  const [touched, setTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [removing, setRemoving] = useState<PlaceDraft | null>(null);

  const change = (next: PlaceDraft[]) => (setRows(next), setTouched(true));
  const errors = placeRowErrors(rows);
  const save = () => {
    if (errors.size) {
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
  // A row that came from the saved list (new rows have ids from places.length up): removing it asks first.
  const saved = (r: PlaceDraft) => r.rowId < places.length;
  const remove = (row: PlaceDraft) => change(rows.filter((r) => r !== row));

  const field = (row: PlaceDraft, lang: 'en' | 'ar', invalid: boolean) => (
    <div key={lang} className="flex flex-col gap-1">
      <label htmlFor={`place-${lang}-${row.rowId}`} lang={lang} className="text-xs font-semibold text-muted">
        {t(lang === 'en' ? 'menu.placeEn' : 'menu.placeAr')}
      </label>
      <Input
        id={`place-${lang}-${row.rowId}`}
        value={row[lang]}
        maxLength={MAX_CAFE_PLACE}
        dir={lang === 'en' ? 'ltr' : 'rtl'}
        lang={lang}
        className="text-start"
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => change(rows.map((r) => (r === row ? { ...r, [lang]: e.target.value } : r)))}
      />
    </div>
  );

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <MapPin className="size-5 shrink-0 text-muted" aria-hidden />
          {t('menu.placesTitle')}
        </span>
      }
      description={t('menu.placesHint')}
      // "+ Add a place" at the top of the block (Part K2); the new row opens at the end with the cursor in it.
      actions={
        <AddButton
          label={t('common:add.place')}
          disabled={rows.length >= MAX_CAFE_PLACES}
          onClick={() => {
            change([...rows, { rowId: nextId, en: '', ar: '' }]);
            setNextId(nextId + 1);
          }}
        />
      }
    >
      {rows.length === 0 && <p className="mb-3 text-sm text-muted">{t('menu.noPlaces')}</p>}
      {rows.length > 0 && <p className="mb-3 text-sm text-muted">{t('menu.nameHint')}</p>}
      <ul ref={placesRef} className="grid gap-3">
        {rows.map((row, i) => {
          const name = nameOf(row, i);
          const problem = showErrors ? errors.get(i) : undefined;
          return (
            <li key={row.rowId} className={clsx('rounded-xl border p-3', problem ? 'border-danger' : 'border-line')}>
              <div className="grid gap-2 sm:grid-cols-2">{nameFieldsInOrder(i18n.language).map((lang) => field(row, lang, !!problem))}</div>
              {problem && (
                <p role="alert" className="mt-1.5 text-sm text-danger">
                  {t(problem === 'twice' ? 'errors.placeTwice' : 'errors.placeRequired')}
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
                <Button size="lg" variant="danger-ghost" icon={Trash2} onClick={() => (saved(row) ? setRemoving(row) : remove(row))}>
                  {t('common:actions.remove')}
                  <span className="sr-only">: {name}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {touched && (
        <FormActions className="mt-4 items-center justify-between">
          <p className="text-sm font-semibold text-warning">{t('menu.placesUnsaved')}</p>
          <Button size="lg" variant="primary" loading={editor.savePlaces.isPending} onClick={save}>
            {t('menu.savePlaces')}
          </Button>
        </FormActions>
      )}
      <ConfirmDialog
        open={!!removing}
        title={removing ? t('menu.removePlaceTitle', { name: isolate(nameOf(removing, rows.indexOf(removing))) }) : undefined}
        message={t('menu.removePlaceMessage')}
        confirmLabel={t('menu.removePlaceYes')}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove(removing);
          setRemoving(null);
        }}
      />
    </Card>
  );
}
