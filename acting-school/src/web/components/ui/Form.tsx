import clsx from 'clsx';
import type { FormEvent, ReactNode } from 'react';

/** A titled group of fields inside a form page. */
export function FormSection({ title, description, children, className }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-2xl border border-line bg-surface p-4 sm:p-5', className)}>
      {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className={clsx('grid gap-4', title && 'mt-4')}>{children}</div>
    </section>
  );
}

/** Responsive field grid: one column on phones, `cols` from sm up. */
export function FormGrid({ cols = 2, children, className }: { cols?: 1 | 2 | 3; children: ReactNode; className?: string }) {
  return <div className={clsx('grid gap-4', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-3', className)}>{children}</div>;
}

/**
 * Save/Cancel row. Sticks to the bottom of the screen on phones so it's always reachable — right
 * above the bottom bar, which is 4.25rem tall plus its 1px top border (layout/AppShell.tsx: keep the
 * two in step, a test compares them).
 */
export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'sticky bottom-[calc(4.25rem+1px+env(safe-area-inset-bottom))] z-10 -mx-4 flex justify-end gap-2 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur',
        'lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** <form> that prevents the default submit and stacks its sections. */
export function FormPage({ onSubmit, children, className }: { onSubmit: () => void; children: ReactNode; className?: string }) {
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
      className={clsx('mx-auto grid max-w-3xl gap-4 sm:gap-5', className)}
    >
      {children}
    </form>
  );
}
