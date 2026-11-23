import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/ui/States';
import { SectionHomeHeader } from './SectionHomeHeader';

/**
 * Stand-in for the Website section until its pages exist (Part C of
 * docs/SECTIONS_AND_WEBSITE.md). Delete this file and its route in router.tsx
 * when features/website/routes.tsx is added.
 */
export default function WebsitePlaceholder() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionHomeHeader section="website" />
      <EmptyState icon={Globe} title={t('sections.website')} description={t('states.comingSoon')} className="rounded-2xl border border-dashed border-line-strong" />
    </div>
  );
}
