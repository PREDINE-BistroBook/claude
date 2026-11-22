import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-colors select-none disabled:opacity-50 disabled:pointer-events-none';
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
  'danger-ghost': 'text-danger hover:bg-danger-soft',
};
const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) {
  return clsx(base, variants[variant], sizes[size], className);
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Put the icon after the label (mirrors in RTL automatically). */
  iconEnd?: boolean;
  children?: ReactNode;
}

export interface ButtonProps extends CommonProps, ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, iconEnd, loading, children, className, type = 'button', disabled, ...rest }: ButtonProps) {
  const iconEl = loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null;
  return (
    <button type={type} className={buttonClasses(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {!iconEnd && iconEl}
      {children}
      {iconEnd && iconEl}
    </button>
  );
}

/** A react-router Link that looks like a Button. */
export function ButtonLink({ variant = 'secondary', size = 'md', icon: Icon, iconEnd, children, className, ...rest }: CommonProps & LinkProps) {
  const iconEl = Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null;
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {!iconEnd && iconEl}
      {children}
      {iconEnd && iconEl}
    </Link>
  );
}

/** Square icon-only button. `label` is required for screen readers. */
export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: { icon: LucideIcon; label: string; variant?: ButtonVariant; size?: ButtonSize } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const dims = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-10';
  return (
    <button type={type} aria-label={label} title={label} className={clsx(base, variants[variant], dims, 'p-0', className)} {...rest}>
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
