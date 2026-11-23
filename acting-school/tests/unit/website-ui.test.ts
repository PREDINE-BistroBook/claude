import { describe, expect, it, vi } from 'vitest';

// The route modules import the auth provider, which loads the app's i18n setup; it sets <html lang dir>.
vi.hoisted(() => {
  const g = globalThis as { document?: unknown };
  g.document ??= { documentElement: {} };
});

import { CASTING_APPLICATION_STATUSES } from '../../src/shared/enums';
import { DEFAULT_SITE_CONTENT, type SiteLink } from '../../src/shared/schemas/site';
import { STATUS_TONES } from '../../src/web/components/ui/StatusBadge';
import { applicationsRoutes } from '../../src/web/features/applications/routes';
import { applicationActions, parseApplicationStatus } from '../../src/web/features/applications/utils';
import { castingsRoutes } from '../../src/web/features/castings/routes';
import { dashboardRoutes } from '../../src/web/features/dashboard/routes';
import { scheduleRoutes } from '../../src/web/features/schedule/routes';
import { talentRoutes } from '../../src/web/features/talent/routes';
import { websiteRoutes } from '../../src/web/features/website/routes';
import {
  coachName,
  linkLabel,
  linkLocale,
  moveItem,
  pickBilingual,
  replaceLink,
  shortUrl,
  withContentChange,
  workshopTitle,
} from '../../src/web/features/website/utils';
import { NAV_ITEMS } from '../../src/web/layout/nav';

describe('moveItem (Move up / Move down)', () => {
  const list = ['a', 'b', 'c'];

  it('swaps the item with its neighbour', () => {
    expect(moveItem(list, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(list, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(list, 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('leaves the order alone at either end or for a missing index, and never changes the original', () => {
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(moveItem(list, 2, 1)).toEqual(list);
    expect(moveItem(list, 5, -1)).toEqual(list);
    expect(moveItem(list, -1, 1)).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c']);
    expect(moveItem(list, 0, -1)).not.toBe(list);
  });
});

describe('bilingual texts on staff screens', () => {
  it('uses the screen language, then the other half', () => {
    expect(pickBilingual({ en: 'Hello', ar: 'أهلًا' }, 'ar')).toBe('أهلًا');
    expect(pickBilingual({ en: 'Hello', ar: 'أهلًا' }, 'en')).toBe('Hello');
    expect(pickBilingual({ en: 'Hello', ar: '  ' }, 'ar')).toBe('Hello');
    expect(pickBilingual({ en: '', ar: 'أهلًا' }, 'en')).toBe('أهلًا');
    expect(pickBilingual({ en: '', ar: '' }, 'en')).toBe('');
  });

  it("a workshop's public title: that language's, else the other language's, else the course name (as the public site fills it)", () => {
    expect(workshopTitle({ titleEn: '', titleAr: '', courseName: 'Acting 101' }, 'ar')).toBe('Acting 101');
    expect(workshopTitle({ titleEn: 'On camera', titleAr: '', courseName: 'Acting 101' }, 'ar')).toBe('On camera');
    expect(workshopTitle({ titleEn: 'On camera', titleAr: 'أمام الكاميرا', courseName: 'Acting 101' }, 'ar')).toBe('أمام الكاميرا');
    expect(workshopTitle({ titleEn: ' ', titleAr: 'أمام الكاميرا', courseName: 'Acting 101' }, 'en')).toBe('أمام الكاميرا');
  });

  it('coach names and link labels follow the same rule', () => {
    expect(coachName({ nameEn: 'Mona', nameAr: '' }, 'ar')).toBe('Mona');
    expect(linkLabel({ label: { en: 'YouTube', ar: 'يوتيوب' } }, 'en')).toBe('YouTube');
    expect(linkLocale('ar')).toBe('ar');
    expect(linkLocale('fr')).toBe('en');
  });

  it('shortUrl drops the scheme, www and a trailing slash', () => {
    expect(shortUrl('https://www.example.com/a/')).toBe('example.com/a');
    expect(shortUrl('https://studio.example/site/en/links')).toBe('studio.example/site/en/links');
  });
});

describe('site content changes', () => {
  const link = (id: string, visible = true): SiteLink => ({ id, label: { en: id, ar: '' }, url: `https://example.com/${id}`, visible });

  it('a partial change keeps everything else from the copy just read', () => {
    const current = { ...DEFAULT_SITE_CONTENT, links: [link('a')], instagram: 'studio' };
    const next = withContentChange(current, { castingCall: { ...current.castingCall, open: true } });
    expect(next.castingCall.open).toBe(true);
    expect(next.links).toEqual(current.links);
    expect(next.instagram).toBe('studio');
    expect(current.castingCall.open).toBe(false);
  });

  it('replaceLink edits one link in place', () => {
    const links = [link('a'), link('b'), link('c')];
    expect(replaceLink(links, { ...link('b'), visible: false }).map((l) => [l.id, l.visible])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
  });
});

describe('casting applications', () => {
  it('the list tab comes from ?status=, New by default', () => {
    expect(parseApplicationStatus(null)).toBe('new');
    expect(parseApplicationStatus('declined')).toBe('declined');
    expect(parseApplicationStatus('bogus')).toBe('new');
  });

  it('offers only what the API allows: nothing without talent.write, only delete once on the roster', () => {
    for (const s of CASTING_APPLICATION_STATUSES) expect(applicationActions(s, false)).toEqual([]);
    expect(applicationActions('new', true)).toEqual(['accept', 'reviewing', 'decline', 'delete']);
    expect(applicationActions('reviewing', true)).toEqual(['accept', 'decline', 'new', 'delete']);
    expect(applicationActions('declined', true)).toEqual(['accept', 'reviewing', 'delete']);
    expect(applicationActions('accepted', true)).toEqual(['delete']);
  });

  it('every status has a badge colour', () => {
    expect(Object.keys(STATUS_TONES.castingApplicationStatus).sort()).toEqual([...CASTING_APPLICATION_STATUSES].sort());
  });

  it('the Applications menu entry carries the new-applications count', () => {
    expect(NAV_ITEMS.find((i) => i.to === '/casting/applications')?.badge).toBe('newCastingApplications');
  });
});

describe('menus lead to real pages', () => {
  const paths = [...dashboardRoutes, ...scheduleRoutes, ...talentRoutes, ...castingsRoutes, ...applicationsRoutes, ...websiteRoutes].map((r) => `/${r.path ?? ''}`);

  it('every Casting and Website menu entry has a route (no "Not found" from the menu)', () => {
    const missing = NAV_ITEMS.filter((i) => i.section === 'website' || i.section === 'casting')
      .map((i) => i.to)
      .filter((to) => !paths.includes(to));
    expect(missing).toEqual([]);
  });

  it('the Website section has its home, pages, coaches (list, new, edit), workshops (list, edit), casting call and links', () => {
    expect(websiteRoutes.map((r) => r.path)).toEqual([
      'website',
      'website/pages',
      'website/coaches',
      'website/coaches/new',
      'website/coaches/:id',
      'website/workshops',
      'website/workshops/:courseId',
      'website/casting-call',
      'website/links',
    ]);
    expect(applicationsRoutes.map((r) => r.path)).toEqual(['casting/applications', 'casting/applications/:id']);
  });
});
