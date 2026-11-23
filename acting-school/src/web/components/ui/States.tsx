import clsx from 'clsx';
import { Drama, Inbox, LoaderCircle, Lock, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '../../lib/forms';
import { ApiError } from '../../lib/api';
import { BrandMark } from './BrandMark';
import { Button } from './Button';

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={clsx('size-5 animate-spin text-muted', className)} aria-hidden />;
}

/** Centered spinner for a page or section that is loading. */
export function PageLoader({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-muted" role="status">
      <Spinner />
      <span className="text-sm">{label ?? t('common:states.loading')}</span>
    </div>
  );
}

/** Full-screen loader while we find out who is signed in. */
export function SplashScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas" role="status" aria-label="Loading">
      <BrandMark className="size-12 animate-pulse" />
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
        <Icon className="size-6" aria-hidden />
      </div>
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** For a failed query: translated message + retry. 404/403 get their own wording. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation();
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 404)
    return <EmptyState className={className} icon={TriangleAlert} title={t('common:errors.notFound')} description={t('common:errors.notFoundHint')} />;
  if (status === 403)
    return <EmptyState className={className} icon={Lock} title={t('common:errors.forbidden')} description={t('common:errors.forbiddenHint')} />;
  return (
    <EmptyState
      className={className}
      icon={TriangleAlert}
      title={t(errorMessageKey(error))}
      action={onRetry && <Button onClick={onRetry}>{t('common:actions.retry')}</Button>}
    />
  );
}

export function NoAccess() {
  const { t } = useTranslation();
  return <EmptyState icon={Lock} title={t('common:noAccess.title')} description={t('common:noAccess.message')} className="min-h-[50vh]" />;
}

/** Placeholder for a section that isn't built yet. */
export function ComingSoon({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <EmptyState icon={Drama} title={title} description={t('common:states.comingSoon')} />
    </div>
  );
}

/** Banner for form-level errors (useForm().formError). */
export function FormError({ messageKey }: { messageKey: string | null | undefined }) {
  const { t } = useTranslation();
  if (!messageKey) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{t(messageKey)}</span>
    </div>
  );
}
