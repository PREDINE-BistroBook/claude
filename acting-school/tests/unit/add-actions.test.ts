import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS, type Permission } from '../../src/shared/permissions';
import { HOME_QUICK_ACTIONS, SCREENS, canAdd, type ScreenSpec } from '../../src/web/layout/addActions';

/**
 * Part K2: "Add" everywhere. The app's route table against layout/addActions.ts:
 * every route is named there; a list screen has an Add or says why it has
 * none; an Add (and a section home's quick action) that opens a page carries
 * that page's own permission, so it never shows to someone the page — and the
 * API — would refuse; each list's Add is really on its page; the fixed phone
 * button keeps clear of the tab bar, the last row and the sticky bars.
 */

const SRC = path.resolve(__dirname, '../../src/web');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// The route modules load the app's i18n set-up through Guard, which touches `document`.
beforeAll(() => {
  vi.stubGlobal('document', { documentElement: {} });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** Every route of the signed-in app: the arrays router.tsx spreads, plus its own two. */
async function appRoutes(): Promise<RouteObject[]> {
  const router = read('router.tsx');
  const spread = [...router.matchAll(/\.\.\.(\w+Routes),/g)].map((m) => m[1]!);
  const modules = import.meta.glob('../../src/web/features/*/routes.tsx');
  const routes: RouteObject[] = [];
  const found: string[] = [];
  for (const load of Object.values(modules)) {
    const mod = (await load()) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (name.endsWith('Routes') && Array.isArray(value)) {
        found.push(name);
        if (spread.includes(name)) routes.push(...(value as RouteObject[]));
      }
    }
  }
  // Every feature's route table is in the router (a new feature can't hide from this test)…
  expect(found.sort()).toEqual([...spread].sort());
  // …and the router's own pages.
  expect(router).toContain("{ path: 'profile', element: <ProfilePage /> }");
  expect(router).toContain("{ path: '*', element: <NotFoundPage /> }");
  routes.push({ path: 'profile' }, { path: '*' });
  return routes;
}

const pathOf = (r: RouteObject) => (r.index ? '' : (r.path ?? ''));
/** The permission a route's <Guard permission="…"> asks for; null when it has none. */
const guardOf = (r: RouteObject): Permission | null => {
  const el = r.element as ReactElement<{ permission?: Permission }> | undefined;
  return el?.props && typeof el.props.permission === 'string' ? el.props.permission : null;
};
/** "/website/links?add=1" → the route table's "website/links". */
const routeKey = (to: string) => to.split(/[?#]/)[0]!.replace(/^\//, '');

const screens = SCREENS as Record<string, ScreenSpec>;

describe('every route says what can be added on it', () => {
  it('every route of the app is in SCREENS, and SCREENS names no route that does not exist', async () => {
    const paths = (await appRoutes()).map(pathOf);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((p) => !(p in screens))).toEqual([]);
    expect(Object.keys(screens).filter((p) => !paths.includes(p))).toEqual([]);
  });

  it('a list screen has an Add or an explicit "nothing to add here" (with the reason) — never both, never neither', () => {
    const lists = Object.entries(screens).filter(([, s]) => s.kind === 'list');
    expect(lists.length).toBeGreaterThan(10);
    const bad = lists.filter(([, s]) => !!s.add === !!s.nothingToAdd?.trim()).map(([p]) => p);
    expect(bad).toEqual([]);
    // Only lists carry an Add or a reason.
    expect(Object.entries(screens).filter(([, s]) => s.kind !== 'list' && (s.add || s.nothingToAdd)).map(([p]) => p)).toEqual([]);
  });

  it('a record page lists its blocks (sub-lists) and each one’s "+ Add …"', () => {
    const records = Object.entries(screens).filter(([, s]) => s.kind === 'record');
    expect(records.filter(([, s]) => !Array.isArray(s.subLists)).map(([p]) => p)).toEqual([]);
    for (const [, s] of records) for (const b of s.subLists ?? []) expect(b.block && b.labelKey && b.who).toBeTruthy();
    // The blocks the school named: a workshop's sessions, students and photos & files; a casting's roles, submissions and files;
    // an enquiry's contact log and interviews; a talent's photos; a student's workshops.
    const blocks = (p: string) => (screens[p]!.subLists ?? []).map((b) => b.block);
    expect(blocks('classes/:id')).toEqual(['students', 'sessions', 'photos & files']);
    expect(blocks('castings/:id')).toEqual(['roles', 'a role’s submissions', 'files']);
    expect(blocks('admissions/:id')).toEqual(['contact log (timeline)', 'interviews']);
    expect(blocks('talent/:id')).toEqual(['photos']);
    expect(blocks('students/:id')).toEqual(['workshops (enrolments)']);
  });

  it('an Add that opens a page asks for exactly that page’s permission (so it never shows to someone who would be refused)', async () => {
    const routes = await appRoutes();
    const byPath = new Map(routes.map((r) => [pathOf(r), r]));
    for (const [screen, spec] of Object.entries(screens)) {
      const add = spec.add;
      if (!add) continue;
      if (add.permission) expect(PERMISSIONS, screen).toContain(add.permission);
      if (!add.to) continue;
      const target = byPath.get(routeKey(add.to));
      expect(target, `${screen} → ${add.to}`).toBeTruthy();
      expect(guardOf(target!), `${screen} → ${add.to}`).toBe(add.permission ?? null);
    }
  });

  it('the section homes’ quick actions: the ones the school asked for, each with the permission of the page it opens', async () => {
    const routes = await appRoutes();
    const byPath = new Map(routes.map((r) => [pathOf(r), r]));
    expect(HOME_QUICK_ACTIONS.school.map((a) => a.key)).toEqual(['newEnquiry', 'newStudent', 'newWorkshop', 'callToOffice']);
    expect(HOME_QUICK_ACTIONS.casting.map((a) => a.key)).toEqual(['addTalent', 'newCasting', 'addOpportunity', 'callToOffice']);
    expect(HOME_QUICK_ACTIONS.website.map((a) => a.key)).toEqual(['addCoach', 'addLink']);
    for (const a of Object.values(HOME_QUICK_ACTIONS).flat()) {
      const target = byPath.get(routeKey(a.to));
      expect(target, a.to).toBeTruthy();
      const guard = guardOf(target!);
      // A guarded page: the same permission. The Team page is everyone's (the call button there needs staff.summon).
      if (guard) expect(a.permission, a.to).toBe(guard);
      else expect(a.to).toBe('/team');
    }
  });

  it('the homes read their quick actions from addActions.ts (one list, not a copy)', () => {
    expect(read('features/dashboard/SchoolHomePage.tsx')).toContain('HOME_QUICK_ACTIONS.school');
    expect(read('features/dashboard/CastingHomePage.tsx')).toContain('HOME_QUICK_ACTIONS.casting');
    expect(read('features/website/WebsiteHomePage.tsx')).toContain('HOME_QUICK_ACTIONS.website');
  });

  it('every list screen with an Add really shows it: its page renders <ScreenAddAction screen="…"> (and nothing else does)', () => {
    const files = fs
      .readdirSync(path.join(SRC, 'features'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => read(path.join('features', f)));
    const used = new Set(files.flatMap((src) => [...src.matchAll(/<ScreenAddAction\s+screen="([^"]+)"/g)].map((m) => m[1]!)));
    const withAdd = Object.entries(screens)
      .filter(([, s]) => s.add)
      .map(([p]) => p);
    expect(withAdd.filter((p) => !used.has(p))).toEqual([]);
    expect([...used].filter((p) => !withAdd.includes(p))).toEqual([]);
  });

  it('canAdd follows the permission; an Add without one (a new message) is everyone’s', () => {
    const can = (held: Permission[]) => (p: Permission) => held.includes(p);
    expect(canAdd({ labelKey: 'x', permission: 'students.write' }, can(['students.read']))).toBe(false);
    expect(canAdd({ labelKey: 'x', permission: 'students.write' }, can(['students.write']))).toBe(true);
    expect(canAdd(SCREENS.messages.add, can([]))).toBe(true);
  });

  it('every Add label exists in English and Arabic', async () => {
    const { namespaces } = await import('../../src/web/i18n');
    const lookup = (lang: 'en' | 'ar', key: string) => {
      const [ns, rest] = key.split(':') as [keyof typeof namespaces, string];
      return rest.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], namespaces[ns][lang]);
    };
    const keys = [
      ...Object.values(screens).flatMap((s) => [s.add?.labelKey, ...(s.subLists ?? []).map((b) => b.labelKey)]),
      'common:add.first',
    ].filter((k): k is string => !!k);
    for (const k of keys) {
      expect(typeof lookup('en', k), k).toBe('string');
      expect(typeof lookup('ar', k), k).toBe('string');
    }
    for (const a of Object.values(HOME_QUICK_ACTIONS).flat()) expect(typeof lookup('ar', `dashboard:quick.${a.key}`), a.key).toBe('string');
  });
});

describe('the fixed "+ Add …" on phones keeps clear of everything', () => {
  const addAction = read('components/ui/AddAction.tsx');
  const css = read('styles.css');

  it('sits 0.75rem above the tab bar (4.25rem + its 1px border), at the bottom-end, phones only, below dialogs and the tab bar', () => {
    expect(read('layout/AppShell.tsx')).toContain('flex h-[4.25rem] max-w-lg');
    expect(addAction).toContain('bottom-[calc(4.25rem+1px+env(safe-area-inset-bottom)+0.75rem)]');
    expect(addAction).toMatch(/data-add-fab className="[^"]*\bz-30\b[^"]*\bjustify-end\b[^"]*\blg:hidden\b/);
    // At least 48 px (h-14 = 56 px), icon and words.
    expect(addAction).toContain('h-14');
    expect(addAction).toContain('icon={Plus}');
  });

  it('gives the page room so the last row scrolls clear of it, lifts toasts above it, and steps aside for a sticky bottom bar', () => {
    expect(css).toMatch(/@media \(width < 64rem\)\s*\{[\s\S]*body:has\(\[data-add-fab\]\) \[data-app-main\] \{\s*padding-bottom: calc\(10rem \+ env\(safe-area-inset-bottom\)\);/);
    expect(css).toContain('body:has([data-add-fab]) [data-toasts]');
    expect(css).toMatch(/body:has\(\[data-sticky-bottom\]\) \[data-add-fab\] \{\s*display: none;/);
    expect(read('layout/AppShell.tsx')).toContain('data-app-main');
    expect(read('components/ui/Toast.tsx')).toContain('data-toasts');
    // The sticky bars at the bottom: a form's Save row (the cafeteria's "Send order" and "Save places" are FormActions) and a chat's composer.
    expect(read('components/ui/Form.tsx')).toContain('data-sticky-bottom');
    expect(read('features/chat/components/Composer.tsx')).toContain('data-sticky-bottom');
    expect(read('features/cafe/CafeOrderPage.tsx')).toContain('<FormActions');
  });

  it('the call-to-the-office banner is in the sticky block at the top, so a button at the bottom can’t cover it', () => {
    const shell = read('layout/AppShell.tsx');
    const top = shell.slice(shell.indexOf('ref={stickyTop}'), shell.indexOf('Section tabs'));
    expect(top).toContain('<SummonsBanner />');
  });
});
