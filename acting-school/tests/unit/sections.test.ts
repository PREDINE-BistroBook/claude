import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_POSITIONS, PERMISSIONS, type Permission } from '../../src/shared/permissions';
import type { ScheduleEvent } from '../../src/shared/schemas/schedule';
import { NAV_ITEMS, TEAM_PATH, adminNavItems, landingAfterSignIn, mobileTabs, navItemActive, navItemOpen, sectionNavItems, teamMenuActive, teamMenuHint } from '../../src/web/layout/nav';
import {
  SECTIONS,
  currentSection,
  defaultSection,
  lastRoute,
  rememberRoute,
  rememberSection,
  rememberedSection,
  resetSectionMemoryForTests,
  sectionForPath,
  sectionTabTarget,
  startSection,
  visibleSections,
} from '../../src/web/layout/sections';
import { CASTING_SCHEDULE_KINDS, SCHOOL_SCHEDULE_KINDS, eventsOfKinds, visibleKinds } from '../../src/web/features/schedule/utils';

/** `can` for a set of permissions, as useAuth().can answers it. */
const canWith = (perms: readonly Permission[]) => (p: Permission) => perms.includes(p);
const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!.permissions as readonly Permission[];
const keys = (perms: readonly Permission[]) => visibleSections(canWith(perms)).map((s) => s.key);

describe('sectionForPath', () => {
  it('School: its home, the schedule, admissions, students, workshops and sessions', () => {
    for (const p of ['/school', '/schedule', '/admissions', '/admissions/7', '/admissions/new', '/students', '/students/12', '/classes', '/classes/3/edit', '/sessions/40'])
      expect(sectionForPath(p), p).toBe('school');
  });

  it('Casting: its home, talent, castings, its schedule and applications', () => {
    for (const p of ['/casting', '/casting/schedule', '/casting/applications', '/casting/applications/5', '/talent', '/talent/new', '/castings', '/castings/2'])
      expect(sectionForPath(p), p).toBe('casting');
  });

  it('Website: everything under /website', () => {
    for (const p of ['/website', '/website/pages', '/website/coaches/3', '/website/casting-call']) expect(sectionForPath(p), p).toBe('website');
  });

  it('pages outside every section answer null (they keep the last section)', () => {
    for (const p of ['/', '/profile', '/team', '/staff', '/staff/4', '/staff/new', '/messages', '/messages/3', '/positions', '/positions/new', '/settings', '/login', '/nope'])
      expect(sectionForPath(p), p).toBeNull();
  });

  it('matches whole path segments only', () => {
    expect(sectionForPath('/schoolyard')).toBeNull();
    expect(sectionForPath('/websites')).toBeNull();
    expect(sectionForPath('/studentsx')).toBeNull();
    // "/castings" is not under "/casting/…", but it is a Casting path of its own.
    expect(sectionForPath('/castingsx')).toBeNull();
  });

  it('ignores a trailing slash', () => {
    expect(sectionForPath('/students/')).toBe('school');
    expect(sectionForPath('/casting/')).toBe('casting');
  });

  it('every section home belongs to its own section, and every menu entry to the section it is filed under', () => {
    for (const s of SECTIONS) expect(sectionForPath(s.home)).toBe(s.key);
    for (const item of NAV_ITEMS) expect(sectionForPath(item.to), item.to).toBe(item.section === 'admin' ? null : item.section);
  });
});

describe('visibleSections', () => {
  it('owners (every permission) see all three, in tab order', () => {
    expect(keys(PERMISSIONS)).toEqual(['school', 'casting', 'website']);
    expect(keys(builtIn('ceo'))).toEqual(['school', 'casting', 'website']);
    expect(keys(builtIn('cfo'))).toEqual(['school', 'casting', 'website']);
  });

  it('the director sees all three (website.manage)', () => {
    expect(keys(builtIn('executive_director'))).toEqual(['school', 'casting', 'website']);
  });

  it('a coach sees School only (so no tabs)', () => {
    expect(keys(builtIn('acting_coach'))).toEqual(['school']);
  });

  it('the casting team and head of casting see School (students) and Casting, not Website', () => {
    expect(keys(builtIn('casting_team'))).toEqual(['school', 'casting']);
    expect(keys(builtIn('head_of_casting'))).toEqual(['school', 'casting']);
  });

  it('each section opens with any one of its permissions', () => {
    for (const p of ['courses.read', 'students.read', 'admissions.read'] as const) expect(keys([p])).toEqual(['school']);
    for (const p of ['talent.read', 'castings.read'] as const) expect(keys([p])).toEqual(['casting']);
    expect(keys(['website.manage'])).toEqual(['website']);
  });

  it('nothing, or only administration permissions: no section', () => {
    expect(keys([])).toEqual([]);
    expect(keys(['staff.manage', 'positions.manage', 'settings.manage', 'payments.status'])).toEqual([]);
    // Write permissions alone don't open a section: reading does.
    expect(keys(['students.write', 'talent.write', 'castings.write'])).toEqual([]);
  });
});

describe('mobileTabs(section, can)', () => {
  it('School, coach-like (attendance.write without classes.all): Schedule, Workshops, Students', () => {
    expect(mobileTabs('school', canWith(builtIn('acting_coach')))).toEqual(['/school', '/schedule', '/classes', '/students']);
    // Still class-first with admissions.read added.
    expect(mobileTabs('school', canWith([...builtIn('acting_coach'), 'admissions.read']))).toEqual(['/school', '/schedule', '/classes', '/students']);
  });

  it('School with admissions.read: Admissions, Students, Workshops (the director, owners)', () => {
    expect(mobileTabs('school', canWith(builtIn('executive_director')))).toEqual(['/school', '/admissions', '/students', '/classes']);
    expect(mobileTabs('school', canWith(PERMISSIONS))).toEqual(['/school', '/admissions', '/students', '/classes']);
  });

  it('School otherwise: Students, Workshops, Schedule (finance, the video editor)', () => {
    expect(mobileTabs('school', canWith(builtIn('finance')))).toEqual(['/school', '/students', '/classes', '/schedule']);
    expect(mobileTabs('school', canWith(builtIn('video_editor')))).toEqual(['/school', '/students', '/classes', '/schedule']);
  });

  it('School for the casting team: only Students is open to them', () => {
    expect(mobileTabs('school', canWith(builtIn('casting_team')))).toEqual(['/school', '/students']);
  });

  it('Casting: Talent, Castings, Applications; its Schedule goes in More', () => {
    expect(mobileTabs('casting', canWith(builtIn('casting_team')))).toEqual(['/casting', '/talent', '/castings', '/casting/applications']);
    expect(mobileTabs('casting', canWith(PERMISSIONS))).toEqual(['/casting', '/talent', '/castings', '/casting/applications']);
  });

  it('a closed priority entry lets the section’s next page in (castings.read only: Castings, then Schedule)', () => {
    expect(mobileTabs('casting', canWith(['castings.read']))).toEqual(['/casting', '/castings', '/casting/schedule']);
    // admissions.read alone: Admissions, then the schedule (interviews).
    expect(mobileTabs('school', canWith(['admissions.read']))).toEqual(['/school', '/admissions', '/schedule']);
  });

  it('Website: Pages, Workshops on site, Casting call; Coaches and Links go in More', () => {
    expect(mobileTabs('website', canWith(['website.manage']))).toEqual(['/website', '/website/pages', '/website/workshops', '/website/casting-call']);
    expect(mobileTabs('website', canWith(builtIn('executive_director')))).toEqual(['/website', '/website/pages', '/website/workshops', '/website/casting-call']);
    const more = sectionNavItems('website', canWith(['website.manage'])).map((i) => i.to).filter((to) => !mobileTabs('website', canWith(['website.manage'])).includes(to));
    expect(more).toEqual(['/website/coaches', '/website/links']);
  });

  it('a section the person can’t see gives no tabs; no section at all gives the plain Home', () => {
    expect(mobileTabs('website', canWith(builtIn('acting_coach')))).toEqual([]);
    expect(mobileTabs(null, canWith([]))).toEqual(['/']);
  });

  it('never more than Home + three, all open and all from that section', () => {
    for (const p of [...BUILT_IN_POSITIONS.map((b) => b.permissions as readonly Permission[]), PERMISSIONS]) {
      const can = canWith(p);
      for (const s of visibleSections(can)) {
        const tabs = mobileTabs(s.key, can);
        expect(tabs[0]).toBe(s.home);
        expect(tabs.length).toBeLessThanOrEqual(4);
        for (const to of tabs) {
          const item = NAV_ITEMS.find((i) => i.to === to)!;
          expect(item.section).toBe(s.key);
          expect(navItemOpen(item, can)).toBe(true);
        }
      }
    }
  });
});

describe('menus', () => {
  it('admin items (Positions, Settings) appear in every section, only when permitted', () => {
    expect(adminNavItems(canWith(PERMISSIONS)).map((i) => i.to)).toEqual(['/positions', '/settings']);
    expect(adminNavItems(canWith(builtIn('executive_director'))).map((i) => i.to)).toEqual(['/positions', '/settings']);
    expect(adminNavItems(canWith(builtIn('acting_coach')))).toEqual([]);
    // staff.manage alone opens no Administration entry: managing the team is on the Team page.
    expect(adminNavItems(canWith(['staff.manage']))).toEqual([]);
  });

  it('there is one Team entry, outside the menus: no Staff entry anywhere, nothing pointing at /staff', () => {
    expect(TEAM_PATH).toBe('/team');
    expect(NAV_ITEMS.filter((i) => i.to === '/staff' || i.to === TEAM_PATH || i.label === 'staff')).toEqual([]);
  });

  it('the Team entry is current on /team and on the member pages it opens (/staff/new, /staff/:id)', () => {
    for (const p of ['/team', '/team/', '/staff', '/staff/new', '/staff/12']) expect(teamMenuActive(p), p).toBe(true);
    for (const p of ['/', '/teams', '/staffing', '/profile', '/positions', '/messages', '/school']) expect(teamMenuActive(p), p).toBe(false);
  });

  it('the hint under Team says what the person can do there', () => {
    expect(teamMenuHint(canWith(builtIn('acting_coach')))).toBe('teamHint');
    expect(teamMenuHint(canWith(['staff.summon']))).toBe('teamHintSummon');
    expect(teamMenuHint(canWith(['staff.manage']))).toBe('teamHintManage');
    expect(teamMenuHint(canWith(builtIn('executive_director')))).toBe('teamHintManageSummon');
    expect(teamMenuHint(canWith(PERMISSIONS))).toBe('teamHintManageSummon');
  });

  it('a section home is active on itself only; other entries on their sub-pages', () => {
    const castingHome = NAV_ITEMS.find((i) => i.to === '/casting')!;
    expect(navItemActive(castingHome, '/casting')).toBe(true);
    expect(navItemActive(castingHome, '/casting/schedule')).toBe(false);
    const castings = NAV_ITEMS.find((i) => i.to === '/castings')!;
    expect(navItemActive(castings, '/castings/4')).toBe(true);
    expect(navItemActive(castings, '/casting')).toBe(false);
  });
});

describe('currentSection', () => {
  const all = visibleSections(canWith(PERMISSIONS));
  const schoolOnly = visibleSections(canWith(builtIn('acting_coach')));

  it('the path’s own section wins', () => {
    expect(currentSection('/talent/3', all, 'school')).toBe('casting');
  });
  it('pages outside every section keep the remembered one, else the first', () => {
    expect(currentSection('/staff', all, 'website')).toBe('website');
    expect(currentSection('/profile', all, null)).toBe('school');
  });
  it('a section the person can’t see is never current', () => {
    expect(currentSection('/castings', schoolOnly, 'casting')).toBe('school');
    expect(currentSection('/profile', [], 'school')).toBeNull();
  });
  it('with nothing remembered, profile and admin pages show the person’s default section (as "/" would)', () => {
    const team = canWith(builtIn('casting_team'));
    expect(currentSection('/profile', visibleSections(team), null, team)).toBe('casting');
    expect(currentSection('/profile', visibleSections(team), 'school', team)).toBe('school');
    expect(currentSection('/profile', all, null, canWith(PERMISSIONS))).toBe('school');
  });
});

describe('where "/" starts (defaultSection, startSection)', () => {
  const start = (perms: readonly Permission[], remembered: Parameters<typeof startSection>[2] = null) => startSection(visibleSections(canWith(perms)), canWith(perms), remembered);

  it('School → Casting → Website for everyone — except someone whose School is only the student list, who starts in Casting', () => {
    // The casting team: students.read without workshops or admissions. School would be one card.
    expect(start(builtIn('casting_team'))).toBe('casting');
    expect(start(['students.read', 'talent.read'])).toBe('casting');
    expect(start(['students.read', 'castings.read', 'website.manage'])).toBe('casting');
    // Everyone else keeps the tab order (the Heads of Casting: the next test).
    for (const key of ['ceo', 'cfo', 'executive_director', 'video_editor', 'acting_coach', 'finance']) expect(start(builtIn(key)), key).toBe('school');
    expect(start(['students.read', 'courses.read', 'talent.read'])).toBe('school');
    expect(start(['students.read', 'admissions.read', 'castings.read'])).toBe('school');
    // Only the student list and no Casting: School it is.
    expect(start(['students.read'])).toBe('school');
    expect(start(['students.read', 'website.manage'])).toBe('school');
    expect(start(['talent.read', 'website.manage'])).toBe('casting');
    expect(start(['website.manage'])).toBe('website');
    expect(start([])).toBeNull();
    expect(defaultSection([], canWith([]))).toBeNull();
  });

  it('someone who writes castings and has no admissions starts in Casting — the Heads of Casting, though they read the workshops (the operator’s decision)', () => {
    const head = builtIn('head_of_casting');
    expect(head).toEqual(expect.arrayContaining(['courses.read', 'castings.write']));
    expect(head).not.toContain('admissions.read');
    expect(keys(head)).toEqual(['school', 'casting']);
    expect(start(head)).toBe('casting');
    expect(defaultSection(visibleSections(canWith(head)), canWith(head))).toBe('casting');
    expect(currentSection('/profile', visibleSections(canWith(head)), null, canWith(head))).toBe('casting');
    // castings.write with workshops, the website too: still Casting.
    expect(start(['students.read', 'courses.read', 'castings.read', 'castings.write'])).toBe('casting');
    expect(start(['courses.read', 'castings.read', 'castings.write', 'website.manage'])).toBe('casting');
    // Admissions keeps someone in School, whatever else they hold: the director, the owners.
    expect(start(['courses.read', 'admissions.read', 'castings.read', 'castings.write'])).toBe('school');
    expect(start([...head, 'admissions.read'])).toBe('school');
    expect(start(builtIn('executive_director'))).toBe('school');
    expect(start(PERMISSIONS)).toBe('school');
    // Reading castings without writing them changes nothing (the video editor, a coach who reads talent).
    expect(start(['students.read', 'courses.read', 'castings.read'])).toBe('school');
    expect(start(['courses.read', 'talent.read'])).toBe('school');
    // castings.write without Casting showing (a hand-made position with no castings.read/talent.read) can't start there.
    expect(start(['courses.read', 'castings.write'])).toBe('school');
    // A Head of Casting who chose School last time goes back to School.
    expect(start(head, 'school')).toBe('school');
  });

  it('a remembered section the person still sees always wins; one they no longer see doesn’t', () => {
    expect(start(builtIn('casting_team'), 'school')).toBe('school');
    expect(start(PERMISSIONS, 'website')).toBe('website');
    expect(start(builtIn('acting_coach'), 'casting')).toBe('school');
    expect(start(builtIn('casting_team'), 'website')).toBe('casting');
  });
});

describe('landingAfterSignIn (the page the last person left the screen on)', () => {
  const coach = canWith(builtIn('acting_coach'));
  const director = canWith(builtIn('executive_director'));

  it('a section the person doesn’t see is replaced by their own start, never a "No access" screen', () => {
    expect(landingAfterSignIn('/casting', coach)).toBe('/');
    expect(landingAfterSignIn('/website/pages', coach)).toBe('/');
    expect(landingAfterSignIn('/talent/12?tab=photos', coach)).toBe('/');
    expect(landingAfterSignIn('/school', canWith(['talent.read']))).toBe('/');
    expect(landingAfterSignIn('/website', canWith(builtIn('casting_team')))).toBe('/');
  });

  it('a menu page their positions don’t open goes to their start too', () => {
    // A team member's account page is the Team page's management side (staff.manage).
    expect(landingAfterSignIn('/staff/4', coach)).toBe('/');
    expect(landingAfterSignIn('/staff/new', coach)).toBe('/');
    expect(landingAfterSignIn('/settings', coach)).toBe('/');
    expect(landingAfterSignIn('/admissions/7', coach)).toBe('/');
    expect(landingAfterSignIn('/casting/applications/3', canWith(['castings.read']))).toBe('/');
    expect(landingAfterSignIn('/schedule', canWith(builtIn('casting_team')))).toBe('/');
  });

  it('a page they can open is kept, query and all', () => {
    expect(landingAfterSignIn('/school', coach)).toBe('/school');
    expect(landingAfterSignIn('/students/3?x=1', coach)).toBe('/students/3?x=1');
    expect(landingAfterSignIn('/sessions/40', coach)).toBe('/sessions/40');
    expect(landingAfterSignIn('/profile', coach)).toBe('/profile');
    expect(landingAfterSignIn('/', coach)).toBe('/');
    expect(landingAfterSignIn('/casting', director)).toBe('/casting');
    expect(landingAfterSignIn('/website/pages', director)).toBe('/website/pages');
    expect(landingAfterSignIn('/staff/4', director)).toBe('/staff/4');
    expect(landingAfterSignIn('/staff/new', director)).toBe('/staff/new');
    // The Team page is everyone's (/staff, the old list, only forwards to it); so are messages.
    expect(landingAfterSignIn('/team', coach)).toBe('/team');
    expect(landingAfterSignIn('/staff', coach)).toBe('/staff');
    expect(landingAfterSignIn('/messages/3', coach)).toBe('/messages/3');
    expect(landingAfterSignIn('/casting/applications/3', canWith(builtIn('casting_team')))).toBe('/casting/applications/3');
  });
});

describe('remembering sections and pages', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    resetSectionMemoryForTests();
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSectionMemoryForTests();
  });

  it('remembers the section under the localStorage key "section"', () => {
    expect(rememberedSection()).toBeNull();
    rememberSection('casting');
    expect(store.get('section')).toBe('casting');
    expect(rememberedSection()).toBe('casting');
  });

  it('ignores a stored value that is not a section', () => {
    store.set('section', 'admin');
    expect(rememberedSection()).toBeNull();
  });

  it('is kept per person: the next one to sign in on a shared phone doesn’t inherit it', () => {
    rememberSection('school', 7);
    expect(store.get('section')).toBe('school');
    expect(rememberedSection(7)).toBe('school');
    expect(rememberedSection(8)).toBeNull();
    // Remembered for nobody in particular (an older version, or no account known): anyone's.
    rememberSection('casting');
    expect(rememberedSection(8)).toBe('casting');
    store.clear();
    resetSectionMemoryForTests();
    store.set('section', 'website');
    expect(rememberedSection(3)).toBe('website');
  });

  it('a tab goes back to the last page visited in that section, or its home; the current section’s tab goes home', () => {
    expect(sectionTabTarget('casting', '/students', 7)).toBe('/casting');
    rememberRoute('casting', '/talent/12?tab=photos', 7);
    expect(lastRoute('casting', 7)).toBe('/talent/12?tab=photos');
    expect(sectionTabTarget('casting', '/students', 7)).toBe('/talent/12?tab=photos');
    expect(sectionTabTarget('casting', '/castings/2', 7)).toBe('/casting');
    expect(sectionTabTarget('school', '/castings/2', 7)).toBe('/school');
  });

  it('keeps pages per person: someone else on the same phone starts from the homes', () => {
    rememberRoute('school', '/students/3', 7);
    expect(lastRoute('school', 8)).toBeNull();
    rememberRoute('casting', '/talent', 8);
    expect(lastRoute('casting', 8)).toBe('/talent');
    expect(lastRoute('school', 8)).toBeNull();
  });

  it('never keeps a path outside the section or off the site', () => {
    rememberRoute('school', '/talent/3', 1);
    rememberRoute('school', '//evil.example/students', 1);
    rememberRoute('school', 'https://evil.example/students', 1);
    expect(lastRoute('school', 1)).toBeNull();
    store.set('sectionRoutes', JSON.stringify({ user: 1, routes: { school: '//evil.example', casting: '/castings/1' } }));
    expect(lastRoute('school', 1)).toBeNull();
    expect(lastRoute('casting', 1)).toBe('/castings/1');
  });

  it('works without storage (private window, blocked site data): memory only, nothing throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => rememberSection('website')).not.toThrow();
    expect(rememberedSection()).toBe('website');
    rememberSection('casting', 5);
    expect(rememberedSection(5)).toBe('casting');
    expect(rememberedSection(6)).toBeNull();
    expect(() => rememberRoute('website', '/website/links', 2)).not.toThrow();
    expect(lastRoute('website', 2)).toBe('/website/links');
  });

  it('copes with unreadable stored JSON', () => {
    store.set('sectionRoutes', '{not json');
    expect(lastRoute('school', null)).toBeNull();
  });
});

describe('schedule per section', () => {
  const ev = (kind: ScheduleEvent['kind'], id: number) => ({ kind, id }) as unknown as ScheduleEvent;
  const events = [ev('class', 1), ev('audition', 2), ev('interview', 3)];

  it('School shows workshops + interviews, Casting auditions only', () => {
    expect(eventsOfKinds(events, SCHOOL_SCHEDULE_KINDS).map((e) => e.id)).toEqual([1, 3]);
    expect(eventsOfKinds(events, CASTING_SCHEDULE_KINDS).map((e) => e.id)).toEqual([2]);
  });

  it('filter chips offer only the section’s kinds the person can see', () => {
    expect(visibleKinds(SCHOOL_SCHEDULE_KINDS, canWith(PERMISSIONS))).toEqual({ classes: true, auditions: false, interviews: true });
    expect(visibleKinds(CASTING_SCHEDULE_KINDS, canWith(PERMISSIONS))).toEqual({ classes: false, auditions: true, interviews: false });
    expect(visibleKinds(SCHOOL_SCHEDULE_KINDS, canWith(builtIn('acting_coach')))).toEqual({ classes: true, auditions: false, interviews: false });
    expect(visibleKinds(SCHOOL_SCHEDULE_KINDS, canWith(builtIn('casting_team')))).toEqual({ classes: false, auditions: false, interviews: false });
  });
});
