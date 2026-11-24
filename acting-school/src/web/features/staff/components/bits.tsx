import clsx from 'clsx';
import { BadgeCheck, ChevronRight, Crown, Dices, Lock } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { PositionSummary } from '@shared/schemas/auth';
import type { Position } from '@shared/schemas/positions';
import { Badge, IconButton, Input, Spinner } from '@web/components/ui';
import { usePositionName } from '@web/lib/positions';
import { generatePassword } from '../api';

/** Visible text input for a temporary password, with a "generate" button. */
export function TempPasswordInput({ onGenerate, ...input }: { onGenerate: (value: string) => void } & InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation('staff');
  return (
    <div className="flex gap-2">
      <Input {...input} type="text" dir="ltr" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="font-mono" />
      <IconButton icon={Dices} label={t('form.generate')} variant="secondary" className="shrink-0 max-sm:size-12" onClick={() => onGenerate(generatePassword())} />
    </div>
  );
}

/** Small chips with someone's positions; owner positions stand out. */
export function PositionChips({ positions, className }: { positions: readonly PositionSummary[]; className?: string }) {
  const { t } = useTranslation('staff');
  const name = usePositionName();
  if (!positions.length) return <Badge className={className}>{t('positions.none')}</Badge>;
  return (
    <span className={clsx('flex flex-wrap gap-1', className)}>
      {positions.map((p) => (
        <Badge key={p.id} tone={p.isOwner ? 'accent' : 'info'}>
          {p.isOwner && <Crown className="size-3" aria-hidden />}
          {name(p)}
        </Badge>
      ))}
    </span>
  );
}

/** A link to the positions screen, for people who can open it. */
export function PositionsGuideLink({ className }: { className?: string }) {
  const { t } = useTranslation('staff');
  return (
    <Link
      to="/positions"
      className={clsx('flex min-h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5', className)}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
        <BadgeCheck className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink">{t('positions.guide')}</span>
        <span className="block text-sm text-muted">{t('positions.guideHint')}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}

/**
 * Checkboxes for the positions someone holds. Only positions the signed-in
 * person may assign can be ticked or unticked; one they hold but can't assign
 * stays ticked and locked, with the reason.
 */
export function PositionPicker({
  positions,
  loading,
  failed,
  value,
  onChange,
  disabled,
}: {
  positions: readonly Position[];
  loading?: boolean;
  failed?: boolean;
  value: readonly number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(['staff', 'positions']);
  const name = usePositionName();
  if (loading) return <Spinner className="my-2" />;
  if (failed) return <p className="text-sm text-danger">{t('positions.loadError')}</p>;
  const selected = new Set(value);
  const toggle = (id: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    // Keep the positions list order.
    onChange([...positions.map((p) => p.id).filter((x) => next.has(x)), ...value.filter((x) => !positions.some((p) => p.id === x))]);
  };
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {positions.map((p) => {
        const off = disabled || !p.assignable;
        const id = `pos-${p.id}`;
        const allows = p.isOwner ? t('positions:allowsEverything') : p.permissions.length ? t('positions:allows', { count: p.permissions.length }) : t('positions:allowsNothing');
        return (
          <li key={p.id}>
            <label htmlFor={id} className={clsx('flex min-h-12 items-start gap-3 px-3.5 py-2.5', off ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-surface-2')}>
              <input
                id={id}
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 rounded accent-[var(--accent)] disabled:opacity-60"
                checked={selected.has(p.id)}
                disabled={off}
                onChange={(e) => toggle(p.id, e.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className={clsx('flex flex-wrap items-center gap-1.5 text-sm font-medium', off && !selected.has(p.id) ? 'text-muted' : 'text-ink')}>
                  {name(p)}
                  {p.isOwner && <Badge tone="accent">{t('positions:owner')}</Badge>}
                </span>
                <span className="block text-xs text-muted">{allows}</span>
                {!p.assignable && !disabled && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-warning">
                    <Lock className="size-3.5 shrink-0" aria-hidden />
                    {t('positions.locked')}
                  </span>
                )}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
