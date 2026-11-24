import { useTranslation } from 'react-i18next';
import type { PositionSummary } from '@shared/schemas/auth';

/** A position's name in the current language: the Arabic name in Arabic when there is one, else the English name. */
export function positionName(p: Pick<PositionSummary, 'name' | 'nameAr'>, language: string): string {
  return language === 'ar' && p.nameAr ? p.nameAr : p.name;
}

/** `const name = usePositionName(); name(position)` — re-renders on language change. */
export function usePositionName() {
  const { i18n } = useTranslation();
  return (p: Pick<PositionSummary, 'name' | 'nameAr'>) => positionName(p, i18n.language);
}

/** Several positions as one line ("Acting coach · Finance"). */
export function usePositionNames() {
  const name = usePositionName();
  return (list: readonly Pick<PositionSummary, 'name' | 'nameAr'>[]) => list.map(name).join(' · ');
}
