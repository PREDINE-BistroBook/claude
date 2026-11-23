import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { sectionForPath, sectionTabTarget, type Section, type SectionKey } from './sections';

/**
 * The School / Casting / Website switch. Plain links: each goes back to the
 * last page visited in that section (or its home); the tab of the section
 * you're in goes to its home. The current one is filled with its section's
 * colour. Rendered only for people who see two or more sections.
 *
 * Phones: a full-width segmented control under the header. Desktop: a row of
 * tabs at the top of the content area.
 */
export function SectionTabs({
  sections,
  current,
  pathname,
  userId,
  className,
}: {
  sections: readonly Section[];
  current: SectionKey | null;
  pathname: string;
  userId: number | null;
  className?: string;
}) {
  const { t } = useTranslation();
  if (sections.length < 2) return null;
  const inSection = sectionForPath(pathname);
  return (
    <nav aria-label={t('sections.label')} className={className}>
      <ul className={clsx('grid gap-1 rounded-2xl border border-line bg-surface-2 p-1', sections.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {sections.map((s) => {
          const active = s.key === current;
          return (
            <li key={s.key} data-section={s.key} className="min-w-0">
              <Link
                to={sectionTabTarget(s.key, pathname, userId)}
                // "page" when this page is in the section; on admin pages and the profile the section stays highlighted as the one you're in.
                aria-current={active ? (inSection === s.key ? 'page' : 'true') : undefined}
                className={clsx(
                  'flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-[15px] font-semibold transition-colors',
                  active ? 'bg-section text-section-ink shadow-sm' : 'text-ink hover:bg-surface',
                )}
              >
                <s.icon className={clsx('size-5 shrink-0', !active && 'text-section')} aria-hidden strokeWidth={2} />
                <span className="truncate">{t(s.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
