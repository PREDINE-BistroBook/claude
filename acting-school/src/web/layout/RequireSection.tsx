import type { ReactNode } from 'react';
import { NoAccess } from '../components/ui/States';
import { useAuth } from '../lib/auth';
import { visibleSections, type SectionKey } from './sections';

/** A section's own pages (its home): "no access" for people whose positions don't open the section. */
export function RequireSection({ section, children }: { section: SectionKey; children: ReactNode }) {
  const { can } = useAuth();
  return visibleSections(can).some((s) => s.key === section) ? <>{children}</> : <NoAccess />;
}
