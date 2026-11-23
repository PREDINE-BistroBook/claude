import clsx from 'clsx';
import { Plus, SearchX, SlidersHorizontal, Star, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { GENDERS, TALENT_STATUSES, type Gender, type TalentStatus } from '@shared/enums';
import { Button, ButtonLink, EmptyState, ErrorState, PageHeader, PageLoader, SearchInput, Segmented } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { useDebounced } from '@web/lib/hooks';
import { useTalentList, type TalentFilters } from './api';
import { FiltersModal, type ExtraFilters } from './components/FiltersModal';
import { TalentCard } from './components/TalentCard';

/** ?status= values: absent means Active (the default view), 'all' means every status. */
type StatusFilter = TalentStatus | 'all';
const EXTRA_KEYS = ['gender', 'age', 'skill', 'language'] as const;

const isStatus = (v: string | null): v is TalentStatus => !!v && (TALENT_STATUSES as readonly string[]).includes(v);
const isGender = (v: string | null): v is Gender => !!v && (GENDERS as readonly string[]).includes(v);

function readExtra(params: URLSearchParams): ExtraFilters {
  const gender = params.get('gender');
  const ageText = params.get('age');
  const age = ageText !== null && /^\d{1,3}$/.test(ageText) && Number(ageText) <= 120 ? Number(ageText) : undefined;
  return {
    gender: isGender(gender) ? gender : undefined,
    age,
    skill: params.get('skill')?.trim() || undefined,
    language: params.get('language')?.trim() || undefined,
  };
}

export default function TalentPage() {
  const { t } = useTranslation(['talent', 'common']);
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = params.get('q') ?? '';
  const statusParam = params.get('status');
  const statusFilter: StatusFilter = statusParam === 'all' ? 'all' : isStatus(statusParam) ? statusParam : 'active';
  const extra = readExtra(params);

  // The box updates instantly; the URL (and so the query) follows after a pause in typing.
  const [text, setText] = useState(q);
  const debounced = useDebounced(text.trim(), 300);
  const pushed = useRef(q);

  const update = (fn: (next: URLSearchParams) => void) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        fn(next);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if (debounced === pushed.current) return;
    pushed.current = debounced;
    update((next) => (debounced ? next.set('q', debounced) : next.delete('q')));
  }, [debounced]);

  // Back/forward (or a link) changed ?q= — reflect it in the box.
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q;
      setText(q);
    }
  }, [q]);

  const setStatus = (value: StatusFilter) => update((next) => (value === 'active' ? next.delete('status') : next.set('status', value)));

  const applyExtra = (f: ExtraFilters) => {
    update((next) => {
      for (const key of EXTRA_KEYS) {
        const v = f[key];
        if (v === undefined || v === '') next.delete(key);
        else next.set(key, String(v));
      }
    });
    setFiltersOpen(false);
  };

  const clearAll = () => {
    pushed.current = '';
    setText('');
    update((next) => {
      next.delete('q');
      for (const key of EXTRA_KEYS) next.delete(key);
    });
  };

  const filters: TalentFilters = {
    q: q || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    ...extra,
  };
  const list = useTalentList(filters);
  const items = list.data?.items ?? [];
  const canWrite = can('talent.write');

  const chips: { key: (typeof EXTRA_KEYS)[number]; label: string }[] = [];
  if (extra.gender) chips.push({ key: 'gender', label: t(`common:enums.gender.${extra.gender}`) });
  if (extra.age !== undefined) chips.push({ key: 'age', label: t('list.chipAge', { age: extra.age }) });
  if (extra.skill) chips.push({ key: 'skill', label: t('list.chipSkill', { value: extra.skill }) });
  if (extra.language) chips.push({ key: 'language', label: t('list.chipLanguage', { value: extra.language }) });
  const searching = !!q || chips.length > 0;

  const addButton = canWrite ? (
    <ButtonLink to="/talent/new" variant="primary" icon={Plus}>
      {t('addTalent')}
    </ButtonLink>
  ) : null;

  let body;
  if (list.isPending) body = <PageLoader />;
  else if (list.isError) body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  else if (!items.length && !searching && statusFilter === 'active')
    body = (
      <EmptyState
        icon={Star}
        title={t('list.emptyTitle')}
        description={canWrite ? t('list.emptyHint') : t('list.emptyHintReadOnly')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {addButton}
            <Button onClick={() => setStatus('all')}>{t('list.showAllStatuses')}</Button>
          </div>
        }
        className="rounded-2xl border border-dashed border-line-strong"
      />
    );
  else if (!items.length)
    body = (
      <EmptyState
        icon={SearchX}
        title={t('common:states.noResults')}
        description={t('common:states.noResultsHint')}
        action={
          searching ? (
            <Button onClick={clearAll}>{t('list.clearAll')}</Button>
          ) : (
            <Button onClick={() => setStatus('all')}>{t('list.showAllStatuses')}</Button>
          )
        }
      />
    );
  else
    body = (
      <>
        <p className="mb-2 px-1 text-sm text-muted" aria-live="polite">
          {t('list.count', { count: items.length })}
        </p>
        <ul
          className={clsx(
            'grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5',
            list.isPlaceholderData && 'opacity-60',
          )}
        >
          {items.map((p) => (
            <TalentCard key={p.id} talent={p} />
          ))}
        </ul>
      </>
    );

  return (
    <div>
      <PageHeader title={t('title')} actions={addButton} />

      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-2 md:w-full md:max-w-md">
          <SearchInput value={text} onChange={setText} placeholder={t('list.searchPlaceholder')} className="min-w-0 flex-1" />
          <Button icon={SlidersHorizontal} onClick={() => setFiltersOpen(true)} className="h-11 shrink-0 sm:h-10" aria-haspopup="dialog">
            <span className="max-sm:sr-only">{t('list.filters')}</span>
            {chips.length > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink tabular-nums">
                {chips.length}
              </span>
            )}
          </Button>
        </div>
        <Segmented<StatusFilter>
          label={t('list.statusFilter')}
          value={statusFilter}
          onChange={setStatus}
          options={[
            ...TALENT_STATUSES.map((s) => ({ value: s, label: t(`common:enums.talentStatus.${s}`) })),
            { value: 'all' as const, label: t('list.all') },
          ]}
          className="self-start md:self-auto"
        />
      </div>

      {chips.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={t('list.activeFilters')}>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => applyExtra({ ...extra, [chip.key]: undefined })}
              aria-label={t('list.removeFilter', { label: chip.label })}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-accent-soft py-1 ps-3 pe-2 text-sm font-medium text-accent transition-colors hover:bg-accent/15 hover:text-accent-hover sm:min-h-8"
            >
              <span dir="auto">{chip.label}</span>
              <X className="size-4 shrink-0" aria-hidden />
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => applyExtra({})} className="max-sm:h-10">
            {t('list.clearAll')}
          </Button>
        </div>
      )}

      {body}

      <FiltersModal open={filtersOpen} value={extra} onApply={applyExtra} onClose={() => setFiltersOpen(false)} />
    </div>
  );
}
