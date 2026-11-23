import { Clapperboard, Globe, School, type LucideIcon } from 'lucide-react';
import type { Permission } from '@shared/permissions';

/**
 * The staff app's three sections, switched with the tabs at the top
 * (SectionTabs). Each section has its own home, its own colour (the
 * --color-section-<key> tokens in styles.css) and its own menu (nav.ts).
 * Pages outside every section (profile, staff, positions, settings) keep the
 * section the person was last in.
 */
export type SectionKey = 'school' | 'casting' | 'website';

export interface Section {
  key: SectionKey;
  /** The section's home page. */
  home: string;
  icon: LucideIcon;
  /** Key in the common namespace. */
  labelKey: `sections.${SectionKey}`;
  /** Shown to anyone holding at least one of these. */
  anyPermission: readonly Permission[];
  /** Paths that belong to the section: the prefix itself or anything under it ("/talent", "/talent/12"). */
  prefixes: readonly string[];
}

export const SECTIONS: readonly Section[] = [
  {
    key: 'school',
    home: '/school',
    icon: School,
    labelKey: 'sections.school',
    anyPermission: ['courses.read', 'students.read', 'admissions.read'],
    prefixes: ['/school', '/schedule', '/admissions', '/students', '/classes', '/sessions'],
  },
  {
    key: 'casting',
    home: '/casting',
    icon: Clapperboard,
    labelKey: 'sections.casting',
    anyPermission: ['talent.read', 'castings.read'],
    // "/casting" covers /casting/schedule and /casting/applications.
    prefixes: ['/casting', '/talent', '/castings'],
  },
  {
    key: 'website',
    home: '/website',
    icon: Globe,
    labelKey: 'sections.website',
    anyPermission: ['website.manage'],
    prefixes: ['/website'],
  },
];

export const SECTION_KEYS: readonly SectionKey[] = SECTIONS.map((s) => s.key);

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value);
}

export function sectionByKey(key: SectionKey): Section {
  return SECTIONS.find((s) => s.key === key)!;
}

/** The sections the person's permissions open, in tab order. Owners hold every permission, so they see all three. */
export function visibleSections(can: (p: Permission) => boolean): Section[] {
  return SECTIONS.filter((s) => s.anyPermission.some(can));
}

const underPrefix = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Which section a path belongs to, by prefix; null for pages outside every section (profile, staff, positions, settings, "/"). */
export function sectionForPath(pathname: string): SectionKey | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const s of SECTIONS) if (s.prefixes.some((p) => underPrefix(path, p))) return s.key;
  return null;
}

/**
 * Where someone starts when nothing is remembered ("/" on a first visit, and
 * the menu shown on profile / admin pages then): their first section in tab
 * order — School, Casting, Website — with one exception. Someone whose School
 * is only the student list (students.read without courses.read or
 * admissions.read) and who sees Casting starts in Casting: for the casting
 * team, School is one card and their work is all under Casting.
 */
export function defaultSection(visible: readonly Section[], can: (p: Permission) => boolean): SectionKey | null {
  const keys = visible.map((s) => s.key);
  if (keys.includes('school') && keys.includes('casting') && !can('courses.read') && !can('admissions.read')) return 'casting';
  return keys[0] ?? null;
}

/** Where "/" goes: the remembered section when the person still sees it, else their default one; null when they see none. */
export function startSection(visible: readonly Section[], can: (p: Permission) => boolean, remembered: SectionKey | null): SectionKey | null {
  if (remembered && visible.some((s) => s.key === remembered)) return remembered;
  return defaultSection(visible, can);
}

/**
 * The section the person is in: the path's own section when they can see it,
 * otherwise (admin pages, profile, a link to a section they can't open) the one
 * they were last in, otherwise their default section (with `can`: defaultSection;
 * without: the first); null when they see none.
 */
export function currentSection(pathname: string, visible: readonly Section[], remembered: SectionKey | null, can?: (p: Permission) => boolean): SectionKey | null {
  const keys = visible.map((s) => s.key);
  const own = sectionForPath(pathname);
  if (own && keys.includes(own)) return own;
  if (remembered && keys.includes(remembered)) return remembered;
  return can ? defaultSection(visible, can) : (keys[0] ?? null);
}

// ── Memory: the last section, and the last page visited in each ────────────
// Kept in memory and in localStorage (every access in try/catch: private
// windows, blocked storage and the test runner have none — memory still works).

const SECTION_STORAGE_KEY = 'section';
const SECTION_USER_STORAGE_KEY = 'sectionUser';
const ROUTES_STORAGE_KEY = 'sectionRoutes';

let memorySection: { key: SectionKey; user: number | null } | null = null;
let memoryRoutes: { user: number | null; routes: Partial<Record<SectionKey, string>> } = { user: null, routes: {} };

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Remember the section someone is in — with who they are, so the next person to sign in on a shared phone or computer starts in their own. */
export function rememberSection(key: SectionKey, userId: number | null = null): void {
  memorySection = { key, user: userId };
  try {
    const store = storage();
    store?.setItem(SECTION_STORAGE_KEY, key);
    if (userId === null) store?.removeItem(SECTION_USER_STORAGE_KEY);
    else store?.setItem(SECTION_USER_STORAGE_KEY, String(userId));
  } catch {
    // Storage full or blocked: memory is enough for this visit.
  }
}

/**
 * The remembered section. With `userId` (the signed-in person): only when it
 * was remembered for them, or for nobody in particular — someone else's
 * section is not theirs to inherit.
 */
export function rememberedSection(userId: number | null = null): SectionKey | null {
  const mine = (owner: number | null) => userId === null || owner === null || owner === userId;
  try {
    const store = storage();
    const stored = store?.getItem(SECTION_STORAGE_KEY);
    if (isSectionKey(stored)) {
      const owner = Number(store?.getItem(SECTION_USER_STORAGE_KEY) ?? NaN);
      return mine(Number.isInteger(owner) ? owner : null) ? stored : null;
    }
  } catch {
    // Fall back to memory.
  }
  return memorySection && mine(memorySection.user) ? memorySection.key : null;
}

/** A path (with its query) is safe to send someone back to when it is an in-app path inside that section. */
function validRoute(key: SectionKey, route: unknown): route is string {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.length > 500) return false;
  const pathname = route.split(/[?#]/)[0] ?? '';
  return sectionForPath(pathname) === key;
}

function readRoutes(): typeof memoryRoutes {
  try {
    const raw = storage()?.getItem(ROUTES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { user?: unknown; routes?: unknown };
      const routes: Partial<Record<SectionKey, string>> = {};
      if (parsed.routes && typeof parsed.routes === 'object') {
        for (const key of SECTION_KEYS) {
          const r = (parsed.routes as Record<string, unknown>)[key];
          if (validRoute(key, r)) routes[key] = r;
        }
      }
      return { user: typeof parsed.user === 'number' ? parsed.user : null, routes };
    }
  } catch {
    // Unreadable: fall back to memory.
  }
  return memoryRoutes;
}

/**
 * Remember the page (path + query) someone last had open in a section, so its
 * tab brings them back there. Kept per signed-in person: someone else signing
 * in on the same phone starts from each section's home.
 */
export function rememberRoute(key: SectionKey, route: string, userId: number | null = null): void {
  if (!validRoute(key, route)) return;
  const current = readRoutes();
  const next = { user: userId, routes: current.user === userId ? { ...current.routes, [key]: route } : { [key]: route } };
  memoryRoutes = next;
  try {
    storage()?.setItem(ROUTES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Memory is enough for this visit.
  }
}

/** The page last visited in a section by this person, or null. */
export function lastRoute(key: SectionKey, userId: number | null = null): string | null {
  const stored = readRoutes();
  if (stored.user !== userId) return null;
  return stored.routes[key] ?? null;
}

/** Where a section's tab goes: back to the last page visited there, or its home. Tapping the tab of the section you're in goes to its home. */
export function sectionTabTarget(key: SectionKey, pathname: string, userId: number | null = null): string {
  const home = sectionByKey(key).home;
  if (sectionForPath(pathname) === key) return home;
  return lastRoute(key, userId) ?? home;
}

/** Tests only: forget everything kept in memory. */
export function resetSectionMemoryForTests(): void {
  memorySection = null;
  memoryRoutes = { user: null, routes: {} };
}
