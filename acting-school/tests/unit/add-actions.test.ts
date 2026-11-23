import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import type { RouteObject } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_POSITIONS, PERMISSIONS, type Permission } from '../../src/shared/permissions';
import { canAddVideoHere } from '../../src/web/features/videos/utils';
import { HOME_QUICK_ACTIONS, PHONE_FLOATING_CORNERS, SCREENS, canAdd, wholeListEmpty, type ScreenSpec } from '../../src/web/layout/addActions';

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

/** Source without its comments (block, JSX and line comments; "https://" in a string stays): a commented-out element doesn't count. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Every .tsx under features/, by its path relative to src/web. */
const featureFiles = () =>
  fs
    .readdirSync(path.join(SRC, 'features'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join('features', f));

/**
 * The page file a route renders, read from its feature's routes.tsx: the
 * component in the route's element (past its guard) and the file its
 * lazy(() => import('./File')) names — or, for a small wrapper in routes.tsx
 * itself (the School schedule's), the page that wrapper renders.
 */
function pageFileOf(routePath: string): string {
  const skip = new Set(['Guard', 'RequireSection', 'Navigate', 'MenuGuard', 'NoAccess']);
  for (const file of featureFiles().filter((f) => f.endsWith('routes.tsx'))) {
    const src = read(file);
    const at = src.indexOf(`path: '${routePath}'`);
    if (at < 0) continue;
    const lazyFile = (name: string) => src.match(new RegExp(`const ${name} = lazy\\(\\(\\) => import\\('\\./(\\w+)'\\)\\)`))?.[1];
    const comp = [...src.slice(at).matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]!).find((n) => !skip.has(n))!;
    let page = lazyFile(comp);
    if (!page) {
      const body = src.slice(src.indexOf(`function ${comp}(`));
      page = lazyFile([...body.matchAll(/<([A-Z]\w*Page)\b/g)].map((m) => m[1]!)[0]!);
    }
    expect(page, `${routePath}: its page in ${file}`).toBeTruthy();
    return path.join(path.dirname(file), `${page}.tsx`);
  }
  throw new Error(`no route file has path '${routePath}'`);
}

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
/** The second permission a <Guard … also="…"> asks for (the API behind the page needs both); null when none. */
const guardAlsoOf = (r: RouteObject): Permission | null => {
  const el = r.element as ReactElement<{ permission?: Permission; also?: Permission }> | undefined;
  return el?.props && typeof el.props.also === 'string' ? el.props.also : null;
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
    expect(blocks('classes/:id')).toEqual(['students', 'sessions', 'photos & files', 'videos']);
    expect(blocks('castings/:id')).toEqual(['roles', 'a role’s submissions', 'files']);
    expect(blocks('admissions/:id')).toEqual(['contact log (timeline)', 'interviews']);
    expect(blocks('talent/:id')).toEqual(['photos']);
    expect(blocks('students/:id')).toEqual(['workshops (enrolments)']);
    // An enquiry's contact log takes entries whatever its status (the page and POST /api/leads/:id/activities); interviews only while open.
    expect(screens['admissions/:id']!.subLists![0]!.who).not.toMatch(/while the enquiry is open/);
    expect(screens['admissions/:id']!.subLists![1]!.who).toMatch(/while the enquiry is open/);
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
      expect(guardAlsoOf(target!), `${screen} → ${add.to}`).toBe(add.also ?? null);
    }
  });

  it('the section homes’ quick actions: the ones the school asked for, each with the permission of the page it opens', async () => {
    const routes = await appRoutes();
    const byPath = new Map(routes.map((r) => [pathOf(r), r]));
    expect(HOME_QUICK_ACTIONS.school.map((a) => a.key)).toEqual(['addEnquiry', 'addStudent', 'addWorkshop', 'callToOffice']);
    expect(HOME_QUICK_ACTIONS.casting.map((a) => a.key)).toEqual(['addTalent', 'addCasting', 'addOpportunity', 'callToOffice']);
    expect(HOME_QUICK_ACTIONS.website.map((a) => a.key)).toEqual(['addCoach', 'addLink']);
    for (const a of Object.values(HOME_QUICK_ACTIONS).flat()) {
      const target = byPath.get(routeKey(a.to));
      expect(target, a.to).toBeTruthy();
      const guard = guardOf(target!);
      // A guarded page: the same permission(s). The Team page is everyone's (the call button there needs staff.summon).
      if (guard) {
        expect(a.permission, a.to).toBe(guard);
        expect('also' in a ? a.also : null, a.to).toBe(guardAlsoOf(target!));
      } else expect(a.to).toBe('/team');
    }
  });

  it('a home tile says exactly what the list’s own button says ("Add student" on the School home and on Students)', () => {
    const lists = Object.entries(screens).filter(([, s]) => s.add);
    for (const a of Object.values(HOME_QUICK_ACTIONS).flat()) {
      if (a.to === '/team') continue; // "Call someone to the office": not an Add.
      const target = routeKey(a.to);
      // The list whose Add opens that page — or the list itself, when its Add is a dialog there ("/website/links?add=1").
      const list = lists.find(([p, s]) => (s.add!.to ? routeKey(s.add!.to) === target : p === target));
      expect(list, a.to).toBeTruthy();
      expect(a.labelKey, a.to).toBe(list![1].add!.labelKey);
      expect(a.permission, a.to).toBe(list![1].add!.permission);
      expect('also' in a ? a.also : undefined, a.to).toBe(list![1].add!.also);
    }
    // The tiles take their words from there: no "New …" copies left in the dashboard's strings.
    expect(read('features/dashboard/components/HomeParts.tsx')).toContain('{t(a.labelKey)}');
  });

  it('a Button meant to wrap its words really wraps: whitespace-normal! (the Button\'s own whitespace-nowrap comes later in the CSS)', () => {
    // Found in the final phone walkthrough: «أعدها إلى «جديدة»» ran out of its third of the row. Only a <Button>/<ButtonLink> class needs the "!".
    const files = ['features/opportunities/components/OpportunityParts.tsx', 'features/dashboard/components/HomeParts.tsx'];
    for (const f of files) {
      const src = read(f);
      expect(src, f).toContain('whitespace-normal!');
      expect(src.match(/whitespace-normal(?!!)/g), f).toBeNull();
    }
    expect(read('components/ui/Button.tsx')).toContain('whitespace-nowrap');
  });

  it('the homes read their quick actions from addActions.ts (one list, not a copy)', () => {
    expect(read('features/dashboard/SchoolHomePage.tsx')).toContain('HOME_QUICK_ACTIONS.school');
    expect(read('features/dashboard/CastingHomePage.tsx')).toContain('HOME_QUICK_ACTIONS.casting');
    expect(read('features/website/WebsiteHomePage.tsx')).toContain('HOME_QUICK_ACTIONS.website');
  });

  it('every list screen with an Add really shows it: its own page renders <ScreenAddAction screen="…"> as a header’s actions (not commented out), and no other file does', () => {
    const withAdd = Object.entries(screens)
      .filter(([, s]) => s.add)
      .map(([p]) => p);
    expect(withAdd.length).toBeGreaterThan(8);
    const sources = new Map(featureFiles().map((f) => [f, stripComments(read(f))]));
    for (const screen of withAdd) {
      const page = pageFileOf(screen);
      const element = `<ScreenAddAction screen="${screen}"`;
      // In its own page, as the actions of a PageHeader (or of the page's own Card): the header button on desktop, the fixed one on phones.
      expect(sources.get(page), `${screen}: ${element} in ${page}`).toMatch(new RegExp(`actions=\\{<ScreenAddAction\\s+screen="${screen}"`));
      // Nowhere else: an Add rendered from another screen would show there, under the wrong page.
      expect([...sources].filter(([f, src]) => f !== page && src.includes(element)).map(([f]) => f), screen).toEqual([]);
    }
    // And nothing renders an Add for a screen that has none.
    const used = new Set([...sources.values()].flatMap((src) => [...src.matchAll(/<Screen(?:Add|EmptyAdd)\w*\s+screen="([^"]+)"/g)].map((m) => m[1]!)));
    expect([...used].filter((p) => !withAdd.includes(p))).toEqual([]);
  });

  it('a list whose empty state shows "Add the first one" has its own words for it (Arabic names the thing), in its own page', () => {
    const sources = new Map(featureFiles().map((f) => [f, stripComments(read(f))]));
    const withEmpty = new Set([...sources.values()].flatMap((src) => [...src.matchAll(/<ScreenEmptyAdd\s+screen="([^"]+)"/g)].map((m) => m[1]!)));
    expect(withEmpty.size).toBeGreaterThan(6);
    for (const screen of withEmpty) {
      expect(screens[screen]?.add?.firstKey, screen).toMatch(/^common:add\.firstOf\./);
      expect(sources.get(pageFileOf(screen)), screen).toContain(`<ScreenEmptyAdd screen="${screen}"`);
    }
  });

  it('"Add the first one" only while the list has nothing at all — not on an empty tab next to full ones', () => {
    expect(wholeListEmpty([0, 0, 0, 0])).toBe(true);
    expect(wholeListEmpty([0, 3, 0, 0])).toBe(false);
    // Not known yet: no button rather than a wrong one.
    expect(wholeListEmpty(undefined)).toBe(false);
    expect(wholeListEmpty(false)).toBe(false);
    expect(wholeListEmpty([])).toBe(false);
    expect(wholeListEmpty([0, undefined])).toBe(false);
    // The three lists with tabs ask it with every tab's count (or, for castings, the whole list).
    expect(read('features/opportunities/OpportunitiesPage.tsx')).toMatch(/wholeListEmpty\(counts\.data && Object\.values\(counts\.data\)\)/);
    expect(read('features/admissions/LeadsPage.tsx')).toMatch(/wholeListEmpty\(counts\.data && \[counts\.data\.open, counts\.data\.closed\]\)/);
    expect(read('features/castings/CastingsPage.tsx')).toMatch(/noCastingsAtAll \? <ScreenEmptyAdd screen="castings"/);
  });

  it('the School schedule is a calendar: no fixed button over its days; "+ Add a session on <day>" in the page, for courses.write (the API’s permission)', () => {
    expect(screens.schedule!.kind).toBe('page');
    expect(screens.schedule!.add).toBeUndefined();
    const src = stripComments(read('features/schedule/SchedulePage.tsx'));
    expect(src).not.toContain('ScreenAddAction');
    expect(src).toContain("const canAddSession = showsClasses && can('courses.write');");
    expect(src).toMatch(/canAddSession && \(\s*<AddButton label=\{t\('addSessionOn'/);
  });

  it('canAdd follows the permission; an Add without one (a new message) is everyone’s', () => {
    const can = (held: Permission[]) => (p: Permission) => held.includes(p);
    expect(canAdd({ permission: 'students.write' }, can(['students.read']))).toBe(false);
    expect(canAdd({ permission: 'students.write' }, can(['students.write']))).toBe(true);
    expect(canAdd(SCREENS.messages.add, can([]))).toBe(true);
    // An enquiry needs admissions.read as well (the enquiries API is behind it).
    expect(canAdd(SCREENS.admissions.add, can(['admissions.write']))).toBe(false);
    expect(canAdd(SCREENS.admissions.add, can(['admissions.write', 'admissions.read']))).toBe(true);
  });

  it('every Add label exists in English and Arabic', async () => {
    const { namespaces } = await import('../../src/web/i18n');
    const lookup = (lang: 'en' | 'ar', key: string) => {
      const [ns, rest] = key.split(':') as [keyof typeof namespaces, string];
      return rest.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], namespaces[ns][lang]);
    };
    const keys = [
      ...Object.values(screens).flatMap((s) => [s.add?.labelKey, s.add?.firstKey, ...(s.subLists ?? []).map((b) => b.labelKey)]),
      ...Object.values(HOME_QUICK_ACTIONS)
        .flat()
        .map((a) => a.labelKey),
    ].filter((k): k is string => !!k);
    for (const k of keys) {
      expect(typeof lookup('en', k), k).toBe('string');
      expect(typeof lookup('ar', k), k).toBe('string');
    }
    // "Add the first one" in Arabic names the thing («أضف أول طالب»), never the masculine «واحد» that read badly with فرصة / ورشة / موهبة.
    for (const [key, ar] of Object.entries(namespaces.common.ar.add.firstOf)) {
      expect(ar, key).toMatch(/^أضف أول \S/);
      expect(ar, key).not.toContain('واحد');
    }
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

  it('keeps the bottom-end corner; the AI pack’s Secretary (Part F2) is held to the bottom-start, so the two never sit on top of each other', () => {
    expect(PHONE_FLOATING_CORNERS).toEqual({ add: 'bottom-end', secretary: 'bottom-start' });
    // The component: bottom, end side (logical: right in English, left in Arabic).
    expect(addAction).toMatch(/data-add-fab className="[^"]*\bbottom-\[[^"]*\bjustify-end\b/);
    // The spec says the same in both parts: F2's phone placement is bottom-start, K2 keeps bottom-end and names the Secretary's corner.
    const spec = fs.readFileSync(path.resolve(__dirname, '../../docs/SECTIONS_AND_WEBSITE.md'), 'utf8');
    const f2 = spec.slice(spec.indexOf('### F2.'), spec.indexOf('### F3.'));
    expect(f2).toMatch(/On phones: \*\*bottom-start\*\*/);
    expect(f2).not.toMatch(/On phones: bottom-end/);
    const k2 = spec.slice(spec.indexOf('### K2.'), spec.indexOf('### Tests and checks', spec.indexOf('### K2.')));
    expect(k2).toMatch(/bottom-start[^\n]*Secretary/);
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

describe('the Add pattern meets the video screens (Part L)', () => {
  const can = (held: readonly Permission[]) => (p: Permission) => held.includes(p);
  const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!.permissions as readonly Permission[];

  it('the queue says why it has no Add (videos come from the class they were filmed in); a video page and a session name their blocks', () => {
    expect(screens.videos).toMatchObject({ kind: 'list' });
    expect(screens.videos!.add).toBeUndefined();
    expect(screens.videos!.nothingToAdd).toMatch(/session/);
    expect(screens['videos/:id']).toEqual({ kind: 'record', subLists: [] });
    for (const record of ['sessions/:id', 'classes/:id']) {
      const block = screens[record]!.subLists!.find((b) => b.block === 'videos');
      expect(block, record).toMatchObject({ labelKey: 'videos:actions.add' });
      expect(block!.who, record).toMatch(/videos\.add \+ courses\.read/);
    }
  });

  it('"+ Add video" shows exactly as the API takes it: videos.add and courses.read (the class scope is the page’s own)', () => {
    // POST /api/videos needs videos.add, and a session or workshop the person can see (courses.read + courseScope).
    expect(canAddVideoHere(can(['videos.add', 'courses.read']))).toBe(true);
    expect(canAddVideoHere(can(['videos.add']))).toBe(false);
    expect(canAddVideoHere(can(['courses.read', 'videos.edit', 'videos.review', 'videos.read']))).toBe(false);
    expect(canAddVideoHere(can(builtIn('acting_coach')))).toBe(true);
    expect(canAddVideoHere(can(builtIn('executive_director')))).toBe(true);
    expect(canAddVideoHere(can(builtIn('video_editor')))).toBe(false);
    expect(canAddVideoHere(can(builtIn('video_reviewer')))).toBe(false);
    expect(canAddVideoHere(can([...PERMISSIONS]))).toBe(true);
  });

  it('the session’s and the workshop’s Videos block use the shared AddButton at the top of the block, behind that rule', () => {
    const block = stripComments(read('features/videos/components/VideosBlock.tsx'));
    expect(block).toContain('const canAdd = canAddVideoHere(can);');
    expect(block).toMatch(/actions=\{canAdd && <AddButton label=\{t\('actions\.add'\)\}/);
    // No home-made "+" button left in the block.
    expect(block).not.toMatch(/icon=\{Plus\}/);
    expect(block).not.toMatch(/<Button\b/);
    // The session page brings the same Add to its top (the same sheet), with the same rule and the same component.
    const session = stripComments(read('features/classes/SessionPage.tsx'));
    expect(session).toContain('const canAddVideo = canAddVideoHere(can);');
    expect(session).toMatch(/canAddVideo && <AddButton variant="primary" label=\{tv\('actions\.add'\)\}/);
    expect(session).not.toMatch(/can\('videos\.add'\)/);
    // The workshop's Videos tab is the same block.
    expect(stripComments(read('features/classes/CourseDetailPage.tsx'))).toMatch(/<VideosBlock\s/);
    // 48 px: AddButton is size="lg" with min-h-12.
    const addAction = read('components/ui/AddAction.tsx');
    expect(addAction).toMatch(/const cls = clsx\('min-h-12'/);
    expect(addAction).toContain('size="lg"');
  });

  it('no fixed "+ Add …" on the queue, the video page, a session or a workshop: nothing floats over the step buttons or the cards', () => {
    for (const file of ['features/videos/VideosPage.tsx', 'features/videos/VideoPage.tsx', 'features/classes/SessionPage.tsx', 'features/classes/CourseDetailPage.tsx']) {
      const src = stripComments(read(file));
      expect(src, file).not.toMatch(/ScreenAddAction|ListAddAction|data-add-fab/);
    }
    for (const file of featureFiles().filter((f) => f.startsWith(path.join('features', 'videos')))) {
      expect(stripComments(read(file)), file).not.toMatch(/ScreenAddAction|ListAddAction|ScreenEmptyAdd|data-add-fab/);
    }
    // The coach's empty list says where videos are added, with the way there (the schedule), only for whoever can add.
    const queue = stripComments(read('features/videos/VideosPage.tsx'));
    expect(queue).toMatch(/tab === 'mine' &&\s*canAddVideoHere\(can\) && \(\s*<ButtonLink to="\/schedule" size="lg">/);
  });
});
