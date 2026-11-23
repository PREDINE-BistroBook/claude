import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/ui/PageHeader';
import { sectionByKey, type SectionKey } from './sections';

/**
 * Heading of a section's home page (/school, /casting, /website): the
 * section's icon on a tile and its name, both in the section's colour, so
 * "where am I" is the first thing on the screen. Also sets the browser tab title.
 */
export function SectionHomeHeader({ section, subtitle, actions }: { section: SectionKey; subtitle?: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  const s = sectionByKey(section);
  const label = t(s.labelKey);
  return (
    <div data-section={section}>
      <PageHeader
        leading={
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-section text-section-ink">
            <s.icon className="size-6" strokeWidth={2} />
          </span>
        }
        title={<span className="text-section">{label}</span>}
        documentTitle={label}
        subtitle={subtitle}
        actions={actions}
      />
    </div>
  );
}
