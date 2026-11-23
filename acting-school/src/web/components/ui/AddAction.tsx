import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button, ButtonLink, type ButtonVariant } from './Button';

/**
 * "+ Add …" (Part K2): one look for every Add in the app — a Plus icon and the
 * words, at least 48 px tall. Which screen has which Add, and who sees it, is
 * layout/addActions.ts; these only draw it.
 */
interface AddProps {
  /** The words, already translated ("Add student"). */
  label: string;
  /** A page to open… */
  to?: string;
  /** …or a dialog on this screen. */
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  /** For tests and the phone walkthrough. */
  testId?: string;
}

/**
 * The "+ Add …" at the top of a block inside a record (a workshop's sessions,
 * a casting's roles…), and inside an empty list ("Add the first one").
 */
export function AddButton({ label, to, onClick, disabled, className, testId, variant = 'secondary' }: AddProps & { variant?: ButtonVariant }) {
  const cls = clsx('min-h-12', className);
  if (to && !disabled)
    return (
      <ButtonLink to={to} variant={variant} size="lg" icon={Plus} className={cls} data-testid={testId}>
        {label}
      </ButtonLink>
    );
  return (
    <Button variant={variant} size="lg" icon={Plus} onClick={onClick} disabled={disabled} className={cls} data-testid={testId}>
      {label}
    </Button>
  );
}

/**
 * A list screen's Add: in the page header on desktop (put it in PageHeader's
 * `actions`), and on phones a big button fixed at the bottom-end, just above
 * the tab bar. While it is on screen the page gets extra room at its end
 * (styles.css: body:has([data-add-fab])), so it never covers the last row,
 * and toasts move up above it; it steps aside for a sticky bar at the bottom
 * (a form's Save, a chat's composer, the cafeteria's "Send order" —
 * [data-sticky-bottom]). Render it only for someone allowed to add (canAdd).
 */
export function ListAddAction(props: AddProps) {
  const fab = (
    <div data-add-fab className="pointer-events-none fixed inset-x-4 bottom-[calc(4.25rem+1px+env(safe-area-inset-bottom)+0.75rem)] z-30 flex justify-end lg:hidden">
      <AddButton
        {...props}
        variant="primary"
        testId={props.testId ? `${props.testId}-fab` : 'add-fab'}
        className="pointer-events-auto h-14 max-w-full truncate rounded-2xl px-5 text-base shadow-lg shadow-black/25"
      />
    </div>
  );
  return (
    <>
      <span className="hidden lg:contents">
        <AddButton {...props} variant="primary" testId={props.testId ?? 'add-header'} />
      </span>
      {/* Phones: in <body>, so nothing on the page (a transform, an overflow) can move it. */}
      {typeof document === 'undefined' ? null : createPortal(fab, document.body)}
    </>
  );
}

/** Inside an empty list's EmptyState: the same action, worded "Add the first one". */
export function EmptyAddAction({ to, onClick, disabled, testId }: Omit<AddProps, 'label'>) {
  const { t } = useTranslation();
  return <AddButton label={t('common:add.first')} to={to} onClick={onClick} disabled={disabled} variant="primary" testId={testId ?? 'add-first'} />;
}
