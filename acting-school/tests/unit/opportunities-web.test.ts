import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OPPORTUNITY_STATUSES } from '../../src/shared/enums';
import { STATUS_TONES } from '../../src/web/components/ui/StatusBadge';
import { deadlineLook, daysUntil, linkHost, parseOpportunityStatus, screenshotRoom, statusMoves, OPPORTUNITY_TABS } from '../../src/web/features/opportunities/utils';
import { NAV_ITEMS, mobileTabs, sectionNavItems } from '../../src/web/layout/nav';
import type { Permission } from '../../src/shared/permissions';
import { BUILT_IN_POSITIONS } from '../../src/shared/permissions';

/** Part K1 on screen: Casting › Opportunities — the tabs, the deadline colours, the buttons, the menu entry and its badge. */

const canWith = (held: readonly Permission[]) => (p: Permission) => held.includes(p);
const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!.permissions as readonly Permission[];

describe('the opportunities screen', () => {
  it('tabs New / Interested / Applied / Not for us; ?status= picks one, New by default', () => {
    expect(OPPORTUNITY_TABS).toEqual(['new', 'interested', 'applied', 'dismissed']);
    expect(parseOpportunityStatus(null)).toBe('new');
    expect(parseOpportunityStatus('applied')).toBe('applied');
    expect(parseOpportunityStatus('booked')).toBe('new');
  });

  it('the deadline: red from today to three days away, "Closed" once passed, plain further out', () => {
    const today = '2026-11-23';
    expect(deadlineLook(null, today)).toEqual({ kind: 'none' });
    expect(deadlineLook('2026-11-22', today)).toEqual({ kind: 'closed' });
    expect(deadlineLook('2026-11-23', today)).toEqual({ kind: 'soon', days: 0 });
    expect(deadlineLook('2026-11-26', today)).toEqual({ kind: 'soon', days: 3 });
    expect(deadlineLook('2026-11-27', today)).toEqual({ kind: 'open', days: 4 });
    // Across a month end and a daylight-saving change, still whole days.
    expect(daysUntil('2026-12-01', '2026-11-28')).toBe(3);
    expect(daysUntil('2026-03-30', '2026-03-27')).toBe(3);
  });

  it('the status buttons are the three moves except the one it is in', () => {
    expect(statusMoves('new')).toEqual(['interested', 'applied', 'dismissed']);
    expect(statusMoves('interested')).toEqual(['applied', 'dismissed']);
    expect(statusMoves('applied')).toEqual(['interested', 'dismissed']);
    expect(statusMoves('dismissed')).toEqual(['interested', 'applied']);
  });

  it('"Open the post" shows the post’s site; anything that is not a web address shows no button', () => {
    expect(linkHost('https://www.instagram.com/p/abc/')).toBe('instagram.com');
    expect(linkHost('http://example.org/casting')).toBe('example.org');
    expect(linkHost('javascript:alert(1)')).toBeNull();
    expect(linkHost('not a link')).toBeNull();
    expect(linkHost(null)).toBeNull();
  });

  it('at most three screenshots', () => {
    expect(screenshotRoom(0)).toBe(3);
    expect(screenshotRoom(2)).toBe(1);
    expect(screenshotRoom(3)).toBe(0);
    expect(screenshotRoom(5)).toBe(0);
  });

  it('every status has a badge colour', () => {
    expect(Object.keys(STATUS_TONES.opportunityStatus).sort()).toEqual([...OPPORTUNITY_STATUSES].sort());
  });
});

describe('the Casting menu', () => {
  it('has Opportunities with the count of new ones, for castings.read', () => {
    const item = NAV_ITEMS.find((i) => i.to === '/casting/opportunities')!;
    expect(item).toMatchObject({ section: 'casting', permission: 'castings.read', badge: 'newOpportunities', label: 'opportunities' });
    expect(sectionNavItems('casting', canWith(builtIn('casting_team'))).map((i) => i.to)).toContain('/casting/opportunities');
    expect(sectionNavItems('casting', canWith(builtIn('video_editor'))).map((i) => i.to)).not.toContain('/casting/opportunities');
  });

  it('the casting team keeps Talent, Castings, Applications in the bottom bar; Opportunities is in More', () => {
    expect(mobileTabs('casting', canWith(builtIn('casting_team')))).toEqual(['/casting', '/talent', '/castings', '/casting/applications']);
  });
});

describe('the words', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { documentElement: {} });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('the red flag, the buttons and the menu entry, in English and Arabic', async () => {
    const { namespaces } = await import('../../src/web/i18n');
    const { opportunities, common } = namespaces;
    expect(opportunities.en.card.asksForMoney).toBe('Asks for money — be careful');
    expect(opportunities.ar.card.asksForMoney).toContain('مال');
    expect(Object.values(opportunities.en.actions)).toEqual(expect.arrayContaining(['Open the post', 'Interested', 'Applied', 'Not for us', 'Turn into a casting']));
    expect(common.en.nav.opportunities).toBe('Opportunities');
    expect(common.ar.nav.opportunities).toBe('الفرص');
    expect(common.en.add.opportunity).toBe('Add opportunity');
    expect(common.en.add.first).toBe('Add the first one');
  });
});
