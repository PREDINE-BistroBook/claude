import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb, type DB } from '../../src/server/db/client';
import { positions, settings } from '../../src/server/db/schema';
import { builtInGrantsVersion, upgradeBuiltInPositions } from '../../src/server/lib/access';
import { BUILT_IN_GRANTS, BUILT_IN_GRANTS_SETTING, BUILT_IN_POSITIONS, LATEST_BUILT_IN_GRANTS_VERSION } from '../../src/shared/permissions';
import { internationalPhone, phoneDigits, samePhone, telLink, westernDigits, whatsAppLink } from '../../src/shared/phone';

const ADMISSIONS = ['admissions.read', 'admissions.write', 'admissions.decide'];
const perms = (db: DB, key: string) => db.select().from(positions).where(eq(positions.key, key)).get()!.permissions as string[];
const setPerms = (db: DB, key: string, list: string[]) => db.update(positions).set({ permissions: list as any }).where(eq(positions.key, key)).run();
/** Make a database look like one created before admissions: the director without the new permissions and no grants version stored. */
function makeOld(db: DB) {
  setPerms(
    db,
    'executive_director',
    perms(db, 'executive_director').filter((p) => !p.startsWith('admissions.')),
  );
  db.delete(settings).where(eq(settings.key, BUILT_IN_GRANTS_SETTING)).run();
}

describe('built-in permission upgrades (BUILT_IN_GRANTS)', () => {
  it('the changelog grants admissions to the Executive Director only, and the built-in list already includes it', () => {
    expect(BUILT_IN_GRANTS[0]).toEqual({ version: 1, grants: { executive_director: ADMISSIONS } });
    expect(LATEST_BUILT_IN_GRANTS_VERSION).toBeGreaterThanOrEqual(1);
    for (const p of BUILT_IN_POSITIONS) {
      const has = ADMISSIONS.filter((a) => (p.permissions as readonly string[]).includes(a));
      expect(has).toEqual(p.isOwner || p.key === 'executive_director' ? ADMISSIONS : []);
    }
  });

  it('a fresh database gets the full current lists and records the latest version (grants not re-applied)', () => {
    const db = createDb(':memory:');
    expect(builtInGrantsVersion(db)).toBe(LATEST_BUILT_IN_GRANTS_VERSION);
    const director = perms(db, 'executive_director');
    expect(director).toEqual(expect.arrayContaining(ADMISSIONS));
    // Exactly the built-in list: nothing appended twice.
    expect(director).toEqual([...BUILT_IN_POSITIONS.find((p) => p.key === 'executive_director')!.permissions]);
  });

  it('an older database without the version gets each grant once; a second start is a no-op', () => {
    const db = createDb(':memory:');
    makeOld(db);
    const coachBefore = perms(db, 'acting_coach');
    expect(builtInGrantsVersion(db)).toBe(0);

    upgradeBuiltInPositions(db);
    const after = perms(db, 'executive_director');
    expect(after.slice(-3)).toEqual(ADMISSIONS);
    expect(after.filter((p) => p.startsWith('admissions.'))).toHaveLength(3);
    expect(builtInGrantsVersion(db)).toBe(LATEST_BUILT_IN_GRANTS_VERSION);
    // Only the position named in the grant changes.
    expect(perms(db, 'acting_coach')).toEqual(coachBefore);

    upgradeBuiltInPositions(db);
    expect(perms(db, 'executive_director')).toEqual(after);
  });

  it('a permission an owner removes after the upgrade stays removed', () => {
    const db = createDb(':memory:');
    makeOld(db);
    upgradeBuiltInPositions(db);
    setPerms(
      db,
      'executive_director',
      perms(db, 'executive_director').filter((p) => p !== 'admissions.decide'),
    );
    upgradeBuiltInPositions(db);
    upgradeBuiltInPositions(db);
    expect(perms(db, 'executive_director')).not.toContain('admissions.decide');
    expect(perms(db, 'executive_director')).toContain('admissions.write');
  });

  it('a grant adds only what is missing; later versions apply in order; positions created in the same run are skipped', () => {
    const db = createDb(':memory:');
    db.delete(positions).where(eq(positions.key, 'video_editor')).run();
    setPerms(db, 'acting_coach', ['students.read', 'admissions.read']);
    const grants = [
      ...BUILT_IN_GRANTS,
      { version: 2, grants: { acting_coach: ['admissions.read', 'admissions.write'] as const, video_editor: ['admissions.read'] as const } },
    ];
    upgradeBuiltInPositions(db, grants as any);
    expect(perms(db, 'acting_coach')).toEqual(['students.read', 'admissions.read', 'admissions.write']);
    // Re-created with today's list, so the grant didn't touch it.
    expect(perms(db, 'video_editor')).toEqual([...BUILT_IN_POSITIONS.find((p) => p.key === 'video_editor')!.permissions]);
    expect(builtInGrantsVersion(db)).toBe(2);
  });

  it('survives restarts of a real database file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-school-grants-'));
    const file = path.join(dir, 'app.db');
    try {
      let db = createDb(file);
      makeOld(db);
      db.$client.close();

      db = createDb(file); // the upgrade runs at startup
      expect(perms(db, 'executive_director')).toEqual(expect.arrayContaining(ADMISSIONS));
      setPerms(
        db,
        'executive_director',
        perms(db, 'executive_director').filter((p) => p !== 'admissions.write'),
      );
      db.$client.close();

      db = createDb(file);
      expect(perms(db, 'executive_director')).not.toContain('admissions.write');
      expect(builtInGrantsVersion(db)).toBe(LATEST_BUILT_IN_GRANTS_VERSION);
      db.$client.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('phone numbers → WhatsApp (shared helper)', () => {
  it('turns local Egyptian numbers into international digits with the default country code', () => {
    expect(internationalPhone('01012345678', '20')).toBe('201012345678');
    expect(internationalPhone('010 1234 5678', '20')).toBe('201012345678');
    expect(internationalPhone('(010) 1234-5678', '20')).toBe('201012345678');
    // Without the trunk 0, and already with the country code.
    expect(internationalPhone('1012345678', '20')).toBe('201012345678');
    expect(internationalPhone('201012345678', '20')).toBe('201012345678');
  });

  it('keeps numbers that are already international (+ or 00)', () => {
    expect(internationalPhone('+20 101 234 5678', '20')).toBe('201012345678');
    expect(internationalPhone('+44 7700 900123', '20')).toBe('447700900123');
    expect(internationalPhone('0044 7700 900123', '20')).toBe('447700900123');
    expect(internationalPhone('050 123 4567', '971')).toBe('971501234567');
  });

  it('reads Arabic-Indic digits', () => {
    expect(westernDigits('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678');
    expect(phoneDigits('۰۱۰ ۱۲۳')).toBe('010123');
    expect(internationalPhone('٠١٠١٢٣٤٥٦٧٨', '20')).toBe('201012345678');
  });

  it('refuses what cannot be a phone number', () => {
    expect(internationalPhone('', '20')).toBeNull();
    expect(internationalPhone(null, '20')).toBeNull();
    expect(internationalPhone('abc', '20')).toBeNull();
    expect(internationalPhone('12', '20')).toBeNull();
    expect(internationalPhone('+1234567890123456', '20')).toBeNull();
  });

  it('builds wa.me links with an encoded message, and tel: links', () => {
    expect(whatsAppLink('01012345678', '20')).toBe('https://wa.me/201012345678');
    expect(whatsAppLink('01012345678', '20', 'Hi Nour! See you at 17:00 & bring a monologue')).toBe(
      'https://wa.me/201012345678?text=Hi%20Nour!%20See%20you%20at%2017%3A00%20%26%20bring%20a%20monologue',
    );
    expect(whatsAppLink('010 123', '20', 'x')).toBeNull();
    expect(decodeURIComponent(whatsAppLink('01012345678', '20', 'مرحبًا نور')!.split('text=')[1]!)).toBe('مرحبًا نور');
    expect(telLink('+20 101 234 5678')).toBe('tel:+201012345678');
    expect(telLink('010 1234 5678')).toBe('tel:01012345678');
    expect(telLink('')).toBeNull();
  });

  it('compares numbers as international digits', () => {
    expect(samePhone('01012345678', '+20 101 234 5678', '20')).toBe(true);
    expect(samePhone('01012345678', '+971 101 234 5678', '20')).toBe(false);
    expect(samePhone(null, null, '20')).toBe(false);
  });
});
