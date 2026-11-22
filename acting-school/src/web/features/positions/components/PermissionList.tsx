import clsx from 'clsx';
import { Check, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PERMISSION_GROUPS, type Permission } from '@shared/permissions';

/** i18n key of a permission's label/description: 'staff.manage' → 'positions:perm.staff.manage.label'. */
export const permLabelKey = (p: Permission) => `positions:perm.${p}.label`;
export const permDescriptionKey = (p: Permission) => `positions:perm.${p}.description`;

/**
 * Grouped checkboxes, one per permission, each with its one-line description.
 * Permissions in `locked` can't be changed (the person doesn't hold them) and
 * say so; `disabled` turns the whole list read-only.
 */
export function PermissionChecklist({
  value,
  onChange,
  locked,
  disabled,
}: {
  value: readonly Permission[];
  onChange: (next: Permission[]) => void;
  locked: (p: Permission) => boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation(['positions', 'common']);
  const selected = new Set(value);
  const toggle = (p: Permission, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(p);
    else next.delete(p);
    onChange(PERMISSION_GROUPS.flatMap((g) => g.permissions).filter((x) => next.has(x)));
  };

  return (
    <div className="grid gap-5">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset key={group.id} className="min-w-0">
          <legend className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{t(`groups.${group.id}`)}</legend>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {group.permissions.map((p) => {
              const isLocked = locked(p);
              const off = disabled || isLocked;
              const id = `perm-${p.replace('.', '-')}`;
              return (
                <li key={p}>
                  <label
                    htmlFor={id}
                    className={clsx('flex min-h-14 items-start gap-3 px-3.5 py-3', off ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-surface-2')}
                  >
                    <input
                      id={id}
                      type="checkbox"
                      className="mt-0.5 size-5 shrink-0 rounded accent-[var(--accent)] disabled:opacity-60"
                      checked={selected.has(p)}
                      disabled={off}
                      aria-describedby={`${id}-desc`}
                      onChange={(e) => toggle(p, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block text-sm font-medium', off && !selected.has(p) ? 'text-muted' : 'text-ink')}>{t(permLabelKey(p))}</span>
                      <span id={`${id}-desc`} className="mt-0.5 block text-xs text-muted">
                        {t(permDescriptionKey(p))}
                      </span>
                      {isLocked && !disabled && (
                        <span className="mt-1 flex items-center gap-1 text-xs font-medium text-warning">
                          <Lock className="size-3.5 shrink-0" aria-hidden />
                          {t('form.cantGive')}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

/** Read-only, plain-language list of what a set of permissions allows, grouped (profile page). */
export function PermissionSummary({ permissions }: { permissions: readonly Permission[] }) {
  const { t } = useTranslation(['positions', 'common']);
  const held = new Set(permissions);
  const groups = PERMISSION_GROUPS.map((g) => ({ ...g, held: g.permissions.filter((p) => held.has(p)) })).filter((g) => g.held.length);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map((g) => (
        <section key={g.id} className="min-w-0">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{t(`groups.${g.id}`)}</h3>
          <ul className="grid gap-2">
            {g.held.map((p) => (
              <li key={p} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                  <Check className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{t(permLabelKey(p))}</span>
                  <span className="block text-xs text-muted">{t(permDescriptionKey(p))}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
