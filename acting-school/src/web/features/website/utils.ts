import type { Locale } from '@shared/enums';
import type { Bilingual, SiteCoach, SiteContent, SiteLink, SiteWorkshop } from '@shared/schemas/site';

/**
 * Small pure helpers for the Website section (tested in tests/unit/website-ui.test.ts).
 */

/** The list with the item at `index` moved one place up (-1) or down (+1); the same list when it can't move. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** A bilingual text in the screen's language, falling back to the other half (the public site does the same). */
export function pickBilingual(b: Bilingual, lang: string): string {
  const first = lang === 'ar' ? b.ar : b.en;
  const second = lang === 'ar' ? b.en : b.ar;
  return first.trim() || second.trim();
}

/** A coach's name in the screen's language (or the other one). */
export function coachName(c: Pick<SiteCoach, 'nameEn' | 'nameAr'>, lang: string): string {
  return pickBilingual({ en: c.nameEn, ar: c.nameAr }, lang);
}

/** A coach's title in the screen's language (or the other one). */
export function coachTitle(c: Pick<SiteCoach, 'titleEn' | 'titleAr'>, lang: string): string {
  return pickBilingual({ en: c.titleEn, ar: c.titleAr }, lang);
}

/** The title visitors see in that language: its public title, else the course name (as loadPublicWorkshops does on the public site). */
export function workshopTitle(w: Pick<SiteWorkshop, 'titleEn' | 'titleAr' | 'courseName'>, lang: string): string {
  return (lang === 'ar' ? w.titleAr : w.titleEn).trim() || w.courseName;
}

/** A link's button text in the screen's language (or the other one). */
export function linkLabel(l: Pick<SiteLink, 'label'>, lang: string): string {
  return pickBilingual(l.label, lang);
}

/** "https://www.example.com/a/" → "example.com/a" — easier to read in a list. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}

/**
 * The content to PUT after changing part of it. Always start from the content
 * just read from the server, so a change made on another screen (or by someone
 * else) isn't overwritten with an old copy.
 */
export function withContentChange(current: SiteContent, change: Partial<SiteContent>): SiteContent {
  return { ...current, ...change };
}

/** Replace one custom link (same id), keeping the order. */
export function replaceLink(links: readonly SiteLink[], link: SiteLink): SiteLink[] {
  return links.map((l) => (l.id === link.id ? link : l));
}

/** Which language's public links to show first: the screen's language. */
export function linkLocale(lang: string): Locale {
  return lang === 'ar' ? 'ar' : 'en';
}

/**
 * Copy text to the clipboard: the Clipboard API where the browser allows it,
 * otherwise the old select-and-copy way. Resolves to false when neither works
 * (the page then tells people to press and hold the link).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Blocked (no permission, not a secure page): try the fallback.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
