import type { TFunction } from 'i18next';
import { ageOn } from '@web/lib/format';

/**
 * "Plays 20–28" / "Plays 20+" / "Plays up to 28" from the playing range, or
 * null when there is none.
 */
export function playingRangeLabel(t: TFunction, p: { playingAgeMin: number | null; playingAgeMax: number | null }): string | null {
  const { playingAgeMin: min, playingAgeMax: max } = p;
  if (min != null && max != null) return min === max ? t('talent:list.chipAge', { age: min }) : t('talent:list.plays', { min, max });
  if (min != null) return t('talent:list.playsFrom', { min });
  if (max != null) return t('talent:list.playsUpTo', { max });
  return null;
}

/** The playing range if set, otherwise the real age ("26 years"), otherwise null. */
export function ageLabel(t: TFunction, p: { playingAgeMin: number | null; playingAgeMax: number | null; dateOfBirth: string | null }): string | null {
  const range = playingRangeLabel(t, p);
  if (range) return range;
  const age = ageOn(p.dateOfBirth);
  return age !== null && age >= 0 ? t('common:units.years', { count: age }) : null;
}

/** "tel:" wants digits and a leading +, nothing else. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

export const instagramUrl = (handle: string) => `https://instagram.com/${encodeURIComponent(handle.replace(/^@+/, ''))}`;

export { BidiText } from '@web/components/ui';
