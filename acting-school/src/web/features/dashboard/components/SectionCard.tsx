import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card } from '@web/components/ui';

/** A dashboard section: card with a title, optional "View all" link, and rows edge to edge. */
export function SectionCard({
  title,
  description,
  viewAll,
  children,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Where "View all" goes; omitted = no link. */
  viewAll?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card
      padded={false}
      title={title}
      description={description}
      actions={
        viewAll && (
          <Link
            to={viewAll}
            className="-my-2 -me-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-accent hover:bg-accent-soft"
          >
            {t('common:actions.viewAll')}
            <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        )
      }
    >
      {children}
      {footer && <div className="border-t border-line px-4 py-3 text-sm text-muted sm:px-5">{footer}</div>}
    </Card>
  );
}

/** Rows inside a SectionCard (ListRow items). */
export function SectionList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line">{children}</ul>;
}
