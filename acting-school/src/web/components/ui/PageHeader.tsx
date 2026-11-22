import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePageTitle } from '../../lib/hooks';

/**
 * Top of every page: optional back link, title, subtitle, actions.
 * Also sets the browser tab title.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  leading,
  documentTitle,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Path for the back arrow. */
  back?: string;
  actions?: ReactNode;
  /** e.g. an Avatar shown before the title. */
  leading?: ReactNode;
  /** Tab title when `title` isn't plain text. */
  documentTitle?: string;
}) {
  const { t } = useTranslation();
  usePageTitle(documentTitle ?? (typeof title === 'string' ? title : null));
  return (
    <header className="mb-5 sm:mb-6">
      {back && (
        <Link to={back} className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          {t('common:actions.back')}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {leading}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem] text-balance">{title}</h1>
            {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
