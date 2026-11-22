import clsx from 'clsx';
import { ChevronDown, Crown, Dices, GraduationCap, ShieldCheck, Star } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ROLES, type Role } from '@shared/roles';
import { Card, IconButton, Input, StatusBadge } from '@web/components/ui';
import { generatePassword } from '../api';

/** On/off switch with a label and help text. The whole control is at least 40px tall. */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className={clsx('text-sm font-medium text-ink', !disabled && 'cursor-pointer')}>
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-xs text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="group flex h-10 shrink-0 items-center rounded-full px-0.5 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          className={clsx(
            'flex h-7 w-12 items-center rounded-full p-1 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-accent/40',
            checked ? 'bg-accent' : 'bg-line-strong',
          )}
        >
          <span className={clsx('size-5 rounded-full bg-white shadow-sm transition-[margin] duration-150', checked ? 'ms-5' : 'ms-0')} />
        </span>
      </button>
    </div>
  );
}

/** Visible text input for a temporary password, with a "generate" button. */
export function TempPasswordInput({ onGenerate, ...input }: { onGenerate: (value: string) => void } & InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation('staff');
  return (
    <div className="flex gap-2">
      <Input {...input} type="text" dir="ltr" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="font-mono" />
      <IconButton icon={Dices} label={t('form.generate')} variant="secondary" className="shrink-0 max-sm:size-11" onClick={() => onGenerate(generatePassword())} />
    </div>
  );
}

const ROLE_ICONS: Record<Role, typeof Crown> = { owner: Crown, admin: ShieldCheck, teacher: GraduationCap, agent: Star };

/** Collapsible plain-words guide to the four roles. */
export function RoleGuide({ className }: { className?: string }) {
  const { t } = useTranslation('staff');
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <Card padded={false} className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={clsx(
          'flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-surface-2 sm:px-5',
          open ? 'rounded-t-2xl' : 'rounded-2xl',
        )}
      >
        <span className="font-medium text-ink">{t('roles.title')}</span>
        <span className="sr-only">{open ? t('roles.hide') : t('roles.show')}</span>
        <ChevronDown className={clsx('size-5 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul id={panelId} className="grid gap-3 border-t border-line px-4 py-4 sm:grid-cols-2 sm:px-5">
          {ROLES.map((role) => {
            const Icon = ROLE_ICONS[role];
            return (
              <li key={role} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <StatusBadge group="role" value={role} />
                  <p className="mt-1 text-sm text-muted">{t(`roles.${role}`)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
