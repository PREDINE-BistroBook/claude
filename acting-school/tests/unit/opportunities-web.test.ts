import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OPPORTUNITY_STATUSES } from '../../src/shared/enums';
import { STATUS_TONES } from '../../src/web/components/ui/StatusBadge';
import {
  addedByArgs,
  cardCastingButton,
  castingRolesPath,
  deadlineLook,
  daysUntil,
  detailStatusMoves,
  linkHost,
  normalizeLink,
  parseOpportunityStatus,
  screenshotRoom,
  statusMoves,
  turnMovesToInterested,
  OPPORTUNITY_TABS,
} from '../../src/web/features/opportunities/utils';
import { NAV_ITEMS, moreBadgeCount, mobileTabs, sectionNavItems } from '../../src/web/layout/nav';
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

  it('on its own page a wrong tap can be undone: "Back to New" for anything not new', () => {
    expect(detailStatusMoves('new')).toEqual(['interested', 'applied', 'dismissed']);
    expect(detailStatusMoves('interested')).toEqual(['new', 'applied', 'dismissed']);
    expect(detailStatusMoves('applied')).toEqual(['new', 'interested', 'dismissed']);
    expect(detailStatusMoves('dismissed')).toEqual(['new', 'interested', 'applied']);
  });

  it('a card stays short: "Turn into a casting" only under Interested and Applied, "Open the casting" once it has one', () => {
    expect(cardCastingButton({ status: 'new', castingId: null })).toBeNull();
    expect(cardCastingButton({ status: 'interested', castingId: null })).toBe('turn');
    expect(cardCastingButton({ status: 'applied', castingId: null })).toBe('turn');
    expect(cardCastingButton({ status: 'dismissed', castingId: null })).toBeNull();
    for (const status of OPPORTUNITY_TABS) expect(cardCastingButton({ status, castingId: 7 })).toBe('open');
    // The card's buttons: Open the post, one row of status moves, at most that one more.
    const parts = fs.readFileSync(path.resolve(__dirname, '../../src/web/features/opportunities/components/OpportunityParts.tsx'), 'utf8');
    expect(parts).toContain("statusButtons.length === 3 ? 'grid-cols-3' : 'grid-cols-2'");
    expect(parts).toContain("const casting = place === 'card' ? cardCastingButton(o) : o.castingId !== null ? 'open' : 'turn';");
  });

  it('turning one into a casting: the confirm says a New one moves to Interested, and it lands on the casting’s Roles', () => {
    expect(turnMovesToInterested('new')).toBe(true);
    expect(turnMovesToInterested('interested')).toBe(false);
    expect(turnMovesToInterested('applied')).toBe(false);
    expect(castingRolesPath(12)).toBe('/castings/12#roles');
    const page = fs.readFileSync(path.resolve(__dirname, '../../src/web/features/castings/CastingDetailPage.tsx'), 'utf8');
    expect(page).toContain('<section id="roles" ref={rolesRef}');
    expect(page).toContain("if (hash !== '#roles') return;");
  });

  it('a link pasted without "https://" gets it; anything else is left for the form to judge', () => {
    expect(normalizeLink('instagram.com/p/abc123')).toBe('https://instagram.com/p/abc123');
    expect(normalizeLink('  www.facebook.com/groups/castingegypt  ')).toBe('https://www.facebook.com/groups/castingegypt');
    expect(normalizeLink('wa.me/201001234567')).toBe('https://wa.me/201001234567');
    expect(normalizeLink('//instagram.com/p/x')).toBe('https://instagram.com/p/x');
    expect(normalizeLink('https://instagram.com/p/x')).toBe('https://instagram.com/p/x');
    expect(normalizeLink('http://example.org')).toBe('http://example.org');
    expect(normalizeLink('')).toBe('');
    // Not an address: left alone, so the form (and the server: http/https only) refuse it as before.
    expect(normalizeLink('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(normalizeLink('JAVASCRIPT:alert(1)')).toBe('JAVASCRIPT:alert(1)');
    expect(normalizeLink('data:text/html,hi')).toBe('data:text/html,hi');
    expect(normalizeLink('call Mona')).toBe('call Mona');
    expect(normalizeLink('instagram')).toBe('instagram');
    expect(normalizeLink('instagram.com/p/a b')).toBe('instagram.com/p/a b');
  });

  it('"Added by" isolates the name, so a Latin name in an Arabic line keeps the date’s day number with the date', () => {
    expect(addedByArgs('Tarek Samir', '23 نوفمبر 2026')).toEqual({ name: '\u2068Tarek Samir\u2069', date: '23 نوفمبر 2026' });
    const page = fs.readFileSync(path.resolve(__dirname, '../../src/web/features/opportunities/OpportunityPage.tsx'), 'utf8');
    expect(page).toContain("t('card.addedBy', addedByArgs(o.createdBy.name, f.timestamp(o.createdAt)))");
  });

  it('the form starts with the title, then the screenshots — before where it was seen and the link', () => {
    const form = fs.readFileSync(path.resolve(__dirname, '../../src/web/features/opportunities/OpportunityFormPage.tsx'), 'utf8');
    const at = (key: string) => form.indexOf(`label={t('${key}')}`);
    const order = ['form.title', 'form.screenshots', 'form.source', 'form.link', 'form.deadline'].map(at);
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The link is normalised on leaving the field and before saving.
    expect(form.match(/normalizeLink\(v\.link\)/g)).toHaveLength(2);
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

  it('…and the More button carries the count of what is inside it, so 3 new opportunities show from every screen', () => {
    const can = canWith(builtIn('casting_team'));
    const tabs = mobileTabs('casting', can);
    const more = sectionNavItems('casting', can).filter((i) => !tabs.includes(i.to));
    expect(more.map((i) => i.to)).toContain('/casting/opportunities');
    const counts: Record<string, number> = { newOpportunities: 3, newCastingApplications: 5 };
    // Applications are in the bar (their own badge there); only what is in More adds up.
    expect(moreBadgeCount(more, (i) => (i.badge ? (counts[i.badge] ?? 0) : 0))).toBe(3);
    expect(moreBadgeCount([], () => 1)).toBe(0);
    expect(moreBadgeCount(more, () => 0)).toBe(0);
    const shell = fs.readFileSync(path.resolve(__dirname, '../../src/web/layout/AppShell.tsx'), 'utf8');
    expect(shell).toContain('const moreBadge = moreBadgeCount(moreSection, badgeOf);');
    expect(shell).toContain('<CountBadge count={moreBadge} className="absolute -top-1.5 -end-1" />');
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
    expect(common.en.add.firstOf.opportunity).toBe('Add the first one');
    expect(common.ar.add.firstOf.opportunity).toBe('أضف أول فرصة');
    expect(opportunities.en.empty.new.title).toBe('No new opportunities');
    expect(opportunities.ar.empty.new.title).toBe('لا فرص جديدة');
    expect(opportunities.en.search).toBe('Search opportunities');
    expect(opportunities.ar.search).toBe('ابحث في الفرص');
    expect(opportunities.en.confirmCasting.movesToInterested).toContain('Interested');
    expect(opportunities.ar.confirmCasting.movesToInterested).toContain('«مهتمون»');
    // "Back to New" is used now; the unused "See everything" is gone.
    expect('details' in opportunities.en.actions).toBe(false);
  });

  it('Arabic: an opportunity is a casting call seen elsewhere («إعلان كاستينج»), not one of the app’s castings («تجارب الأداء»); the post is «المنشور», the advert type «إعلان تجاري»', async () => {
    const { namespaces } = await import('../../src/web/i18n');
    const { opportunities, common } = namespaces;
    expect(opportunities.en.subtitle).toMatch(/^Casting calls the team saw/);
    expect(opportunities.ar.subtitle).toMatch(/^إعلانات كاستينج/);
    expect(opportunities.ar.empty.new.hint).toContain('إعلان كاستينج');
    for (const s of [opportunities.ar.subtitle, opportunities.ar.empty.new.hint]) expect(s).not.toMatch(/تجارب أداء|تجربة أداء/);
    // "Turn it into a casting" keeps the Castings menu's word.
    expect(opportunities.ar.actions.toCasting).toBe('حوّلها إلى تجربة أداء');
    // The post: one word everywhere, never the advert's.
    const post = [opportunities.ar.actions.openPost, opportunities.ar.card.screenshot, opportunities.ar.detail.link, opportunities.ar.form.link, opportunities.ar.form.screenshots];
    for (const s of post) {
      expect(s).toContain('المنشور');
      expect(s).not.toContain('إعلان');
    }
    expect(common.ar.enums.opportunityProjectType.ad).toBe('إعلان تجاري');
  });
});
