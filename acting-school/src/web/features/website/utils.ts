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

/** What PUT /api/site/content takes: the whole content, with "Website is public" only when it is being changed. */
export type SiteContentSave = Omit<SiteContent, 'published'> & { published?: boolean };

/**
 * The content to PUT after changing part of it. Always start from the content
 * just read from the server, so a change made on another screen (or by someone
 * else) isn't overwritten with an old copy.
 *
 * "Website is public" (`published`) is sent only when it is the thing being
 * changed. Every other save leaves it out and the API then keeps the stored
 * switch — so a save of texts that is slow to arrive (a phone on a bad line)
 * can never carry an old copy of the switch and undo what someone turned in
 * the meantime: hiding the website must stick.
 */
export function withContentChange(current: SiteContent, change: Partial<SiteContent>): SiteContentSave {
  const { published: _stored, ...rest } = current;
  return { ...rest, ...change };
}

/** Replace one custom link (same id), keeping the order. */
export function replaceLink(links: readonly SiteLink[], link: SiteLink): SiteLink[] {
  return links.map((l) => (l.id === link.id ? link : l));
}

/**
 * Where "Open" should lead for a page of the site: while the website is not
 * public its public address only shows "coming soon", so the button opens the
 * preview (and says so); once public, undefined — the public address itself.
 */
export function previewUrlFor<K extends string>(
  summary: { published: boolean; previewUrls: Record<Locale, Record<K, string>> },
  lang: Locale,
  page: K,
): string | undefined {
  return summary.published ? undefined : summary.previewUrls[lang][page];
}

/** The two plain sentences under the "Website is public" switch (keys in website:publish), with or without a domain to name. */
export function publishStateKey(published: boolean, publicHost: string | null): 'publish.on' | 'publish.off' | 'publish.onNoHost' | 'publish.offNoHost' {
  if (publicHost) return published ? 'publish.on' : 'publish.off';
  return published ? 'publish.onNoHost' : 'publish.offNoHost';
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
