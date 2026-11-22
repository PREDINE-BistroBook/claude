import { describe, expect, it } from 'vitest';
import { BUILT_IN_POSITIONS, PERMISSIONS, type Permission } from '../../src/shared/permissions';
import { NAV_ITEMS, mobileTabs, navItemOpen } from '../../src/web/layout/nav';
import { heldByOthersBeyondReach } from '../../src/web/features/positions/utils';
import { parseFilterParam } from '../../src/web/features/schedule/utils';

/** `can` for a set of permissions, as useAuth().can answers it. */
const canWith = (perms: readonly Permission[]) => (p: Permission) => perms.includes(p);
const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!.permissions as readonly Permission[];

describe('schedule filter follows what the person can see', () => {
  const both = { classes: true, auditions: true };
  it('someone who sees classes and auditions can pick', () => {
    expect(parseFilterParam('auditions', both)).toBe('auditions');
    expect(parseFilterParam('classes', both)).toBe('classes');
    expect(parseFilterParam('bogus', both)).toBe('all');
    expect(parseFilterParam(null, both)).toBe('all');
  });
  it('classes only (coaches) always get classes', () => {
    expect(parseFilterParam('auditions', { classes: true, auditions: false })).toBe('classes');
  });
  it('auditions only (casting team: no courses.read) always get auditions', () => {
    expect(parseFilterParam(null, { classes: false, auditions: true })).toBe('auditions');
    expect(parseFilterParam('classes', { classes: false, auditions: true })).toBe('auditions');
  });
  it('neither', () => {
    expect(parseFilterParam('classes', { classes: false, auditions: false })).toBe('all');
  });
});

describe('navigation', () => {
  const schedule = NAV_ITEMS.find((i) => i.to === '/schedule')!;

  it('Schedule is offered only to people who can see classes or auditions', () => {
    expect(navItemOpen(schedule, canWith([]))).toBe(false);
    expect(navItemOpen(schedule, canWith(['staff.manage', 'students.read']))).toBe(false);
    expect(navItemOpen(schedule, canWith(['courses.read']))).toBe(true);
    expect(navItemOpen(schedule, canWith(builtIn('casting_team')))).toBe(true);
  });

  it('an account whose positions allow nothing gets Home only', () => {
    expect(mobileTabs(canWith([]))).toEqual(['/']);
  });

  it('phone tabs never include a section the person cannot open', () => {
    for (const p of BUILT_IN_POSITIONS) {
      const can = canWith(p.permissions as readonly Permission[]);
      for (const to of mobileTabs(can)) expect(navItemOpen(NAV_ITEMS.find((i) => i.to === to)!, can)).toBe(true);
    }
    expect(mobileTabs(canWith(builtIn('casting_team')))).toEqual(['/', '/schedule', '/talent', '/castings']);
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
