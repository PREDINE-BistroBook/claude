import { describe, expect, it } from 'vitest';
import { BUILT_IN_POSITIONS, PERMISSIONS, type Permission } from '../../src/shared/permissions';
import { NAV_ITEMS, mobileTabs, navItemOpen } from '../../src/web/layout/nav';
import { heldByOthersBeyondReach } from '../../src/web/features/positions/utils';
import { parseFilterParam } from '../../src/web/features/schedule/utils';

/** `can` for a set of permissions, as useAuth().can answers it. */
const canWith = (perms: readonly Permission[]) => (p: Permission) => perms.includes(p);
const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!.permissions as readonly Permission[];

describe('schedule filter follows what the person can see', () => {
  const both = { classes: true, auditions: true, interviews: false };
  it('someone who sees classes and auditions can pick', () => {
    expect(parseFilterParam('auditions', both)).toBe('auditions');
    expect(parseFilterParam('classes', both)).toBe('classes');
    expect(parseFilterParam('bogus', both)).toBe('all');
    expect(parseFilterParam(null, both)).toBe('all');
  });
  it('a kind the person can’t see is never picked', () => {
    expect(parseFilterParam('interviews', both)).toBe('all');
    expect(parseFilterParam('auditions', { classes: true, auditions: false, interviews: true })).toBe('all');
  });
  it('someone who sees all three (the director) can pick interviews', () => {
    expect(parseFilterParam('interviews', { classes: true, auditions: true, interviews: true })).toBe('interviews');
  });
  it('classes only (coaches) always get classes', () => {
    expect(parseFilterParam('auditions', { classes: true, auditions: false, interviews: false })).toBe('classes');
  });
  it('auditions only (casting team: no courses.read) always get auditions', () => {
    expect(parseFilterParam(null, { classes: false, auditions: true, interviews: false })).toBe('auditions');
    expect(parseFilterParam('classes', { classes: false, auditions: true, interviews: false })).toBe('auditions');
  });
  it('interviews only (an admissions-only position) always get interviews', () => {
    expect(parseFilterParam(null, { classes: false, auditions: false, interviews: true })).toBe('interviews');
  });
  it('neither', () => {
    expect(parseFilterParam('classes', { classes: false, auditions: false, interviews: false })).toBe('all');
  });
});

describe('navigation', () => {
  const schoolSchedule = NAV_ITEMS.find((i) => i.to === '/schedule')!;
  const castingSchedule = NAV_ITEMS.find((i) => i.to === '/casting/schedule')!;

  it('the School schedule is offered to people who can see classes or interviews; the Casting one to people who see castings', () => {
    expect(schoolSchedule.section).toBe('school');
    expect(navItemOpen(schoolSchedule, canWith([]))).toBe(false);
    expect(navItemOpen(schoolSchedule, canWith(['staff.manage', 'students.read']))).toBe(false);
    expect(navItemOpen(schoolSchedule, canWith(['courses.read']))).toBe(true);
    expect(navItemOpen(schoolSchedule, canWith(['admissions.read']))).toBe(true);
    // The casting team sees no classes or interviews, so no School schedule…
    expect(navItemOpen(schoolSchedule, canWith(builtIn('casting_team')))).toBe(false);
    // …but has the Casting one.
    expect(castingSchedule.section).toBe('casting');
    expect(navItemOpen(castingSchedule, canWith(builtIn('casting_team')))).toBe(true);
    expect(navItemOpen(castingSchedule, canWith(builtIn('acting_coach')))).toBe(false);
  });

  it('Admissions is offered only with admissions.read (the director, not coaches or the agency)', () => {
    const admissions = NAV_ITEMS.find((i) => i.to === '/admissions')!;
    expect(admissions.section).toBe('school');
    expect(navItemOpen(admissions, canWith(builtIn('executive_director')))).toBe(true);
    for (const key of ['acting_coach', 'casting_team', 'head_of_casting', 'video_editor', 'finance']) {
      expect(navItemOpen(admissions, canWith(builtIn(key)))).toBe(false);
    }
  });

  it('phone tabs never include a page the person cannot open, or one from another section', () => {
    for (const p of BUILT_IN_POSITIONS) {
      const can = canWith(p.permissions as readonly Permission[]);
      for (const section of ['school', 'casting', 'website'] as const) {
        for (const to of mobileTabs(section, can)) {
          const item = NAV_ITEMS.find((i) => i.to === to)!;
          expect(item.section).toBe(section);
          expect(navItemOpen(item, can)).toBe(true);
        }
      }
    }
  });
});

describe('why a position is read-only', () => {
  const director = builtIn('executive_director');
  const coach = { isOwner: false, permissions: [...builtIn('acting_coach')] };

  it('editable positions are not locked', () => {
    expect(heldByOthersBeyondReach({ ...coach, editable: true }, director)).toBe(false);
  });
  it('locked although you hold everything it allows: someone holding it can do more than you', () => {
    expect(heldByOthersBeyondReach({ ...coach, editable: false }, director)).toBe(true);
  });
  it('locked because it allows something you lack', () => {
    expect(heldByOthersBeyondReach({ isOwner: false, permissions: [...builtIn('finance')], editable: false }, director)).toBe(false);
  });
  it('owner positions are locked for being owner positions', () => {
    expect(heldByOthersBeyondReach({ isOwner: true, permissions: [...PERMISSIONS], editable: false }, director)).toBe(false);
  });
});
