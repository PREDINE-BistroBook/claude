import { describe, expect, it } from 'vitest';
import admissions from '../../src/web/features/admissions/i18n';
import applications from '../../src/web/features/applications/i18n';
import castings from '../../src/web/features/castings/i18n';
import chat from '../../src/web/features/chat/i18n';
import classes from '../../src/web/features/classes/i18n';
import dashboard from '../../src/web/features/dashboard/i18n';
import positions from '../../src/web/features/positions/i18n';
import schedule from '../../src/web/features/schedule/i18n';
import settings from '../../src/web/features/settings/i18n';
import staff from '../../src/web/features/staff/i18n';
import students from '../../src/web/features/students/i18n';
import talent from '../../src/web/features/talent/i18n';
import team from '../../src/web/features/team/i18n';
import website from '../../src/web/features/website/i18n';
import common from '../../src/web/i18n/common';
import { SITE_STRINGS } from '../../src/server/site/i18n';

const namespaces = { common, students, classes, talent, castings, schedule, dashboard, staff, positions, settings, admissions, applications, website, team, chat };
const PLURAL = /_(zero|one|two|few|many|other)$/;
const AR_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
  }
  return out;
}
const base = (k: string) => k.replace(PLURAL, '');
const interpolations = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe.each(Object.entries(namespaces))('i18n namespace "%s"', (_name, ns) => {
  const en = flatten(ns.en as Record<string, unknown>);
  const ar = flatten(ns.ar as Record<string, unknown>);

  it('Arabic has every English key', () => {
    const arBases = new Set(Object.keys(ar).map(base));
    const missing = Object.keys(en).filter((k) => !(k in ar) && !arBases.has(base(k)));
    expect(missing).toEqual([]);
  });

  it('Arabic has no keys English lacks', () => {
    const enBases = new Set(Object.keys(en).map(base));
    const extra = Object.keys(ar).filter((k) => !enBases.has(base(k)));
    expect(extra).toEqual([]);
  });

  it('Arabic plurals have all six forms', () => {
    const pluralBases = new Set(Object.keys(en).filter((k) => PLURAL.test(k)).map(base));
    const incomplete = [...pluralBases].filter((b) => AR_FORMS.some((f) => !(`${b}_${f}` in ar)));
    expect(incomplete).toEqual([]);
  });

  it('no empty strings or untranslated placeholders', () => {
    const bad = Object.entries({ ...en, ...Object.fromEntries(Object.entries(ar).map(([k, v]) => [`ar:${k}`, v])) }).filter(
      ([, v]) => !v.trim() || /TODO|TITLE_AR|^TITLE$/.test(v),
    );
    expect(bad).toEqual([]);
  });

  it('interpolation variables match between languages', () => {
    const mismatched = Object.keys(en)
      .filter((k) => !PLURAL.test(k) && k in ar)
      .filter((k) => JSON.stringify(interpolations(en[k]!)) !== JSON.stringify(interpolations(ar[k]!)));
    expect(mismatched).toEqual([]);
  });
});

describe('permission labels', () => {
  it('every permission has an English and Arabic label and description', async () => {
    const { PERMISSIONS, PERMISSION_GROUPS } = await import('../../src/shared/permissions');
    const en = flatten(positions.en as Record<string, unknown>);
    const ar = flatten(positions.ar as Record<string, unknown>);
    const missing = PERMISSIONS.flatMap((p) =>
      ['label', 'description'].flatMap((f) => [`perm.${p}.${f}`].filter((k) => !en[k] || !ar[k])),
    );
    expect(missing).toEqual([]);
    // No stale labels for permissions that no longer exist.
    const labelled = Object.keys(en).filter((k) => k.startsWith('perm.') && k.endsWith('.label')).map((k) => k.slice(5, -6));
    expect(labelled.sort()).toEqual([...PERMISSIONS].sort());
    // Every permission is in exactly one group, and every group has a label.
    expect(PERMISSION_GROUPS.flatMap((g) => g.permissions).sort()).toEqual([...PERMISSIONS].sort());
    for (const g of PERMISSION_GROUPS) expect([en[`groups.${g.id}`], ar[`groups.${g.id}`]].every(Boolean)).toBe(true);
  });
});

describe('Arabic text that carries Latin fragments and numbers', () => {
  const sets: [string, Record<string, string>][] = [
    ...Object.entries(namespaces).map(([name, ns]) => [name, flatten(ns.ar as Record<string, unknown>)] as [string, Record<string, string>]),
    ['the public site', flatten(SITE_STRINGS.ar as unknown as Record<string, unknown>)],
  ];

  it('"https://" inside an Arabic sentence is isolated (U+2066 … U+2069), or it is drawn as "//:https"', () => {
    const scrambled = sets.flatMap(([name, strings]) =>
      Object.entries(strings)
        // A string that is only a link (a placeholder) has no Arabic around it to reorder it.
        .filter(([, v]) => /https?:\/\//.test(v) && /[\u0600-\u06FF]/.test(v) && !/\u2066https?:\/\/[^\u2069]*\u2069/.test(v))
        .map(([k]) => `${name}: ${k}`),
    );
    expect(scrambled).toEqual([]);
    // The strings this was found in do carry the isolates.
    expect(website.ar.studio.mapUrlHint).toContain('\u2066https://\u2069');
    expect(common.ar.errors.invalidUrl).toContain('\u2066https://\u2069');
  });

  it('digits are Western everywhere (as dates, times and phone numbers are): no ١٢٣ next to 123', () => {
    const mixed = sets.flatMap(([name, strings]) => Object.entries(strings).filter(([, v]) => /[٠-٩۰-۹]/.test(v)).map(([k]) => `${name}: ${k}`));
    expect(mixed).toEqual([]);
  });
});
