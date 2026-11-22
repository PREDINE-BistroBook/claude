import clsx from 'clsx';
import { SlidersHorizontal, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ageOn } from '@shared/dates';
import type { CastingRole } from '@shared/schemas/castings';
import type { TalentListItem } from '@shared/schemas/talent';
import { Avatar, Button, Checkbox, EmptyState, ErrorState, FormError, Modal, SearchInput, Spinner, StatusBadge, useToast } from '@web/components/ui';
import { displayName } from '@web/lib/format';
import { useDebounced } from '@web/lib/hooks';
import { castingsErrorKey, useActiveTalent, useAddSubmissions } from '../api';
import { isolate, matchesRole, roleHasRequirements } from '../utils';
import { BidiText, RoleRequirementChips } from './bits';

const MAX_RESULTS = 100;

interface Props {
  role: CastingRole | null;
  onClose: () => void;
}

/** Pick several active talent (filtered to the role's gender and age by default) and put them forward together. */
export function AddTalentModal(props: Props) {
  return props.role ? <AddTalentDialog key={props.role.id} role={props.role} onClose={props.onClose} /> : null;
}

function AddTalentDialog({ role, onClose }: { role: CastingRole; onClose: () => void }) {
  const { t } = useTranslation(['castings', 'common']);
  const toast = useToast();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 250);
  const talent = useActiveTalent(debounced);
  const add = useAddSubmissions(role.id);
  const hasRequirements = roleHasRequirements(role);
  const [matchOnly, setMatchOnly] = useState(hasRequirements);
  const [selected, setSelected] = useState<Map<number, TalentListItem>>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  const onRole = new Map(role.submissions.map((s) => [s.talentId, s]));
  const all = talent.data?.items ?? [];
  const matching = matchOnly && hasRequirements ? all.filter((p) => matchesRole(p, role)) : all;
  const hidden = all.length - matching.length;
  // Talent already on the role sink to the bottom so the ones you can pick come first.
  const shown = [...matching].sort((a, b) => Number(onRole.has(a.id)) - Number(onRole.has(b.id))).slice(0, MAX_RESULTS);

  const toggle = (p: TalentListItem) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });

  const submit = () => {
    const ids = [...selected.keys()];
    if (!ids.length) return;
    setError(null);
    add.mutate(ids, {
      onSuccess: ({ added, failed }) => {
        if (added.length) toast.success(t('picker.added', { count: added.length, role: isolate(role.name) }));
        if (!failed.length) return onClose();
        // Keep the ones that failed selected so a retry is one tap.
        setSelected((prev) => new Map([...prev].filter(([id]) => !added.includes(id))));
        // One shared reason (e.g. "already on the role") is shown in the dialog; otherwise just how many failed.
        const reasons = new Set(failed.map((f) => castingsErrorKey(f.error)));
        if (reasons.size === 1) setError([...reasons][0]!);
        else toast.error(t('picker.failed', { count: failed.length }));
      },
    });
  };

  const count = selected.size;

  let list;
  if (talent.isPending)
    list = (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  else if (talent.isError) list = <ErrorState error={talent.error} onRetry={() => void talent.refetch()} className="py-6" />;
  else if (!shown.length)
    list = (
      <EmptyState
        icon={Users}
        title={!all.length ? (debounced ? t('picker.noMatches') : t('picker.noTalent')) : t('picker.noMatchesFiltered')}
        action={
          hidden > 0 ? (
            <Button size="sm" onClick={() => setMatchOnly(false)}>
              {t('picker.showAll')}
            </Button>
          ) : undefined
        }
        className="py-8"
      />
    );
  else
    list = (
      <>
        <ul className={clsx('-mx-2 divide-y divide-line', talent.isFetching && 'opacity-70')} aria-busy={talent.isFetching || undefined}>
          {shown.map((p) => (
            <TalentOption
              key={p.id}
              talent={p}
              existingStatus={onRole.get(p.id)?.status}
              checked={selected.has(p.id)}
              disabled={add.isPending}
              onToggle={() => toggle(p)}
            />
          ))}
        </ul>
        {matching.length > MAX_RESULTS && <p className="text-center text-xs text-muted">{t('picker.refine', { max: MAX_RESULTS })}</p>}
      </>
    );

  return (
    <Modal
      open
      onClose={onClose}
      title={t('picker.title')}
      description={t('picker.description', { role: isolate(role.name) })}
      footer={
        <>
          <span className="me-auto self-center text-sm text-muted" aria-live="polite">
            {count > 0 && t('picker.selected', { count })}
          </span>
          <Button onClick={onClose} disabled={add.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} disabled={!count} loading={add.isPending}>
            {count ? t('picker.addN', { count }) : t('picker.add')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <SearchInput value={q} onChange={setQ} placeholder={t('picker.searchPlaceholder')} autoFocus />
        {hasRequirements && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-surface-2 px-3 py-2">
            <Checkbox
              label={
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <SlidersHorizontal className="size-4 text-muted" aria-hidden />
                  {t('picker.match')}
                </span>
              }
              checked={matchOnly}
              onChange={(e) => setMatchOnly(e.target.checked)}
              className="min-h-10"
            />
            <RoleRequirementChips role={role} />
          </div>
        )}
        {matchOnly && hidden > 0 && shown.length > 0 && (
          <p className="text-xs text-muted">
            {t('picker.hiddenByMatch', { count: hidden })}{' '}
            <button type="button" onClick={() => setMatchOnly(false)} className="font-medium text-accent hover:underline">
              {t('picker.showAll')}
            </button>
          </p>
        )}
        <FormError messageKey={error} />
        {list}
      </div>
    </Modal>
  );
}

function TalentOption({
  talent: p,
  existingStatus,
  checked,
  disabled,
  onToggle,
}: {
  talent: TalentListItem;
  existingStatus: CastingRole['submissions'][number]['status'] | undefined;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation(['castings', 'common']);
  const name = displayName(p);
  const already = existingStatus !== undefined;
  const details: string[] = [];
  if (p.playingAgeMin != null && p.playingAgeMax != null)
    details.push(p.playingAgeMin === p.playingAgeMax ? t('picker.playsExact', { age: p.playingAgeMin }) : t('picker.plays', { min: p.playingAgeMin, max: p.playingAgeMax }));
  else if (p.playingAgeMin != null) details.push(t('picker.playsFrom', { min: p.playingAgeMin }));
  else if (p.playingAgeMax != null) details.push(t('picker.playsUpTo', { max: p.playingAgeMax }));
  else {
    const age = ageOn(p.dateOfBirth);
    if (age !== null) details.push(t('common:units.years', { count: age }));
  }
  if (p.gender) details.push(t(`common:enums.gender.${p.gender}`));
  if (p.city) details.push(p.city);

  return (
    <li>
      <label
        className={clsx(
          'flex min-h-14 items-center gap-3 rounded-xl px-2 py-2',
          already ? 'cursor-default' : 'cursor-pointer hover:bg-surface-2',
          checked && 'bg-accent-soft/40',
        )}
      >
        <input
          type="checkbox"
          checked={already || checked}
          disabled={already || disabled}
          onChange={onToggle}
          className="size-5 shrink-0 accent-[var(--accent)] disabled:opacity-50"
        />
        <Avatar name={name} fileId={p.headshotFileId} size="md" shape="rounded" className={clsx(already && 'opacity-60')} />
        <span className="min-w-0 flex-1">
          <BidiText className={clsx('font-medium', already ? 'text-muted' : 'text-ink')}>{name}</BidiText>
          {details.length > 0 && (
            <span className="block truncate text-sm text-muted">
              {details.map((d, i) => (
                <span key={i}>
                  {i > 0 && <span aria-hidden> · </span>}
                  <bdi>{d}</bdi>
                </span>
              ))}
            </span>
          )}
        </span>
        {already && <StatusBadge group="submissionStatus" value={existingStatus} />}
      </label>
    </li>
  );
}
