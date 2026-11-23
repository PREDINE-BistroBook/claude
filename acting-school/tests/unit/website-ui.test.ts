import { describe, expect, it, vi } from 'vitest';

// The route modules import the auth provider, which loads the app's i18n setup; it sets <html lang dir>.
vi.hoisted(() => {
  const g = globalThis as { document?: unknown };
  g.document ??= { documentElement: {} };
});

import fs from 'node:fs';
import { CASTING_APPLICATION_STATUSES } from '../../src/shared/enums';
import { DEFAULT_SITE_CONTENT, type SiteLink } from '../../src/shared/schemas/site';
import { buttonClasses } from '../../src/web/components/ui/Button';
import { STATUS_TONES } from '../../src/web/components/ui/StatusBadge';
import { applicationsRoutes } from '../../src/web/features/applications/routes';
import { applicationActions, parseApplicationStatus } from '../../src/web/features/applications/utils';
import { castingsRoutes } from '../../src/web/features/castings/routes';
import { dashboardRoutes } from '../../src/web/features/dashboard/routes';
import { scheduleRoutes } from '../../src/web/features/schedule/routes';
import { criterionName } from '../../src/web/features/settings/utils';
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

  it("a workshop's public title: that language's, else the course name (as the public site fills it)", () => {
    expect(workshopTitle({ titleEn: '', titleAr: '', courseName: 'Acting 101' }, 'ar')).toBe('Acting 101');
    expect(workshopTitle({ titleEn: 'On camera', titleAr: '', courseName: 'Acting 101' }, 'ar')).toBe('Acting 101');
    expect(workshopTitle({ titleEn: 'On camera', titleAr: 'أمام الكاميرا', courseName: 'Acting 101' }, 'ar')).toBe('أمام الكاميرا');
    expect(workshopTitle({ titleEn: ' ', titleAr: 'أمام الكاميرا', courseName: 'Acting 101' }, 'en')).toBe('Acting 101');
    expect(workshopTitle({ titleEn: 'On camera', titleAr: 'أمام الكاميرا', courseName: 'Acting 101' }, 'en')).toBe('On camera');
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

  it('an accepted application whose talent profile was deleted is open again: add once more, decline or delete', () => {
    expect(applicationActions('accepted', true, true)).toEqual(['accept', 'decline', 'delete']);
    expect(applicationActions('accepted', true, false)).toEqual(['delete']);
    expect(applicationActions('accepted', false, true)).toEqual([]);
    // The flag only matters for an accepted application.
    expect(applicationActions('new', true, true)).toEqual(applicationActions('new', true));
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

describe('made for older people: sizes and names the screens rely on', () => {
  const src = (file: string) => fs.readFileSync(new URL(`../../src/web/${file}`, import.meta.url), 'utf8');

  it('big buttons are 48 px; confirm dialogs use them, and a dialog is named by its title', () => {
    expect(buttonClasses('secondary', 'lg')).toContain('h-12');
    const modal = src('components/ui/Modal.tsx');
    expect(modal.match(/<Button size="lg"/g)).toHaveLength(2);
    expect(modal).toContain('aria-labelledby={open ? titleId : undefined}');
    expect(modal).toContain('<h2 id={titleId}');
    // The close button: 48 px.
    expect(modal).toMatch(/aria-label=\{t\('common:actions\.close'\)\}\s+className="[^"]*\bsize-12\b/);
  });

  it('no link or control on the new screens is shorter than 48 px by its own classes', () => {
    for (const file of ['features/website/WebsiteHomePage.tsx', 'features/applications/ApplicationDetailPage.tsx', 'features/dashboard/components/SectionCard.tsx', 'components/ui/PageHeader.tsx']) {
      expect(src(file), file).not.toMatch(/\bmin-h-1[01]\b/);
    }
    expect(src('components/ui/PageHeader.tsx')).toContain('min-h-12');
    expect(src('components/ui/PhotoInput.tsx')).not.toContain('size="sm"');
    // Text inputs, selects and the search box: 48 px on phones.
    expect(src('components/ui/Field.tsx').match(/'h-12 text-base sm:h-10/g)).toHaveLength(2);
    expect(src('components/ui/SearchInput.tsx')).toContain('h-12 w-full');
  });

  it('the sticky Save bar sits exactly on top of the phone bottom bar (4.25rem + its 1px border)', () => {
    expect(src('layout/AppShell.tsx')).toContain('flex h-[4.25rem] max-w-lg');
    expect(src('components/ui/Form.tsx')).toContain('bottom-[calc(4.25rem+1px+env(safe-area-inset-bottom))]');
  });

  it('Move up / Move down are two equal columns on phones, so the pair never pushes out of its card', () => {
    const move = src('features/website/components/MoveButtons.tsx');
    expect(move).toContain('grid grid-cols-2 gap-2 sm:flex');
    expect(move.match(/min-w-0 px-3! sm:flex-none/g)).toHaveLength(2);
    // …and a saved order says so.
    for (const page of ['CoachesPage', 'WorkshopsPage', 'LinksPage']) expect(src(`features/website/${page}.tsx`), page).toContain("t('move.saved')");
  });

  it('interview criteria are named in the screen’s language for the move / remove buttons', () => {
    const c = { label: 'Voice', labelAr: 'الصوت' };
    expect(criterionName(c, 'ar')).toBe('الصوت');
    expect(criterionName(c, 'ar-EG')).toBe('الصوت');
    expect(criterionName(c, 'en')).toBe('Voice');
    expect(criterionName({ label: 'Voice', labelAr: '  ' }, 'ar')).toBe('Voice');
    expect(criterionName({ label: '', labelAr: 'الصوت' }, 'en')).toBe('الصوت');
    expect(criterionName({ label: ' ', labelAr: '' }, undefined)).toBe('');
  });

  it('zod never probes for eval (the app’s CSP forbids it): jitless is set before anything validates', () => {
    const main = src('main.tsx');
    expect(main.indexOf("import './lib/zodSetup'")).toBeGreaterThan(-1);
    expect(main.indexOf("import './lib/zodSetup'")).toBeLessThan(main.indexOf('import {'));
    expect(src('lib/zodSetup.ts')).toContain('z.config({ jitless: true })');
  });
});
