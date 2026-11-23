import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { addDays } from '../../src/shared/dates';
import { todayISO } from '../helpers';

/**
 * The demo seed goes through the real API, so it breaks whenever a route's rules
 * change under it. Run it for real into a throwaway data folder.
 */
const root = path.resolve(__dirname, '../..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-school-seed-'));
const tsx = path.join(root, 'node_modules/.bin/tsx');

function seed(...args: string[]) {
  return spawnSync(tsx, ['src/server/db/seed.ts', ...args], {
    cwd: root,
    // ACTING_SCHOOL_DO_LIMITS=1 (vitest.config.ts) carries over: the seed's own database fails
    // any query over the Durable Object limits too.
    env: { ...process.env, ACTING_SCHOOL_DO_LIMITS: '1', DATA_DIR: dataDir, NODE_ENV: 'test' },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('npm run seed', () => {
  it('fills an empty database, refuses a second run, and starts over with --reset', () => {
    const first = seed();
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('owner@demo.school');

    const count = (sql: string) => {
      const db = new Database(path.join(dataDir, 'app.db'), { readonly: true });
      try {
        return (db.prepare(sql).get() as { n: number }).n;
      } finally {
        db.close();
      }
    };
    expect(count('select count(*) as n from users')).toBe(11);
    expect(count('select count(*) as n from positions')).toBe(10);
    // Everyone holds a position; coach2 holds two (acting coach + finance).
    expect(count('select count(*) as n from users where id not in (select user_id from user_positions)')).toBe(0);
    expect(count(`select count(*) as n from user_positions up join users u on u.id = up.user_id where u.email = 'coach2@demo.school'`)).toBe(2);
    expect(count(`select count(*) as n from user_positions up join users u on u.id = up.user_id join positions p on p.id = up.position_id where p.is_owner = 1`)).toBe(2);
    expect(count('select count(*) as n from users where active = 0')).toBe(1);
    expect(count('select count(*) as n from students')).toBeGreaterThanOrEqual(20);
    expect(count('select count(*) as n from courses')).toBeGreaterThanOrEqual(4);
    expect(count('select count(*) as n from attendance')).toBeGreaterThan(100);
    expect(count('select count(*) as n from talent')).toBeGreaterThanOrEqual(12);
    expect(count('select count(*) as n from talent_photos')).toBeGreaterThan(5);
    expect(count('select count(distinct status) as n from submissions')).toBe(7);
    // Admissions: 16 leads in every status, most sources, interviews in three states, one enrolled lead linked to its new student
    // — plus the website demo's two new enquiries.
    expect(count('select count(*) as n from leads')).toBe(18);
    expect(count('select count(distinct status) as n from leads')).toBe(8);
    expect(count('select count(distinct source) as n from leads')).toBeGreaterThanOrEqual(8);
    expect(count(`select count(distinct status) as n from interviews where status in ('scheduled', 'done', 'no_show')`)).toBe(3);
    expect(count(`select count(*) as n from leads l join students s on s.id = l.student_id where l.status = 'enrolled'`)).toBe(1);
    expect(count(`select count(*) as n from leads where status = 'lost' and lost_reason is not null`)).toBe(2);
    // The enrolled lead joined yesterday (at the school: Africa/Cairo) everywhere: timeline, student profile and class roster.
    expect(
      count(`select count(*) as n from leads l join students s on s.id = l.student_id join enrollments e on e.student_id = s.id
             where l.status = 'enrolled' and s.joined_on = '${addDays(todayISO(), -1)}' and e.enrolled_on = s.joined_on`),
    ).toBe(1);

    expect(count(`select count(*) as n from leads where status in ('enrolled', 'declined', 'lost') and next_follow_up_on is not null`)).toBe(0);
    expect(count(`select count(*) as n from leads where next_follow_up_on < '${todayISO()}'`)).toBeGreaterThan(0);
    expect(count('select count(*) as n from lead_activities')).toBeGreaterThan(30);
    // The director's stored position has the admissions permissions (built in), and the grants version is recorded.
    expect(count(`select count(*) as n from positions where key = 'executive_director' and permissions like '%admissions.decide%'`)).toBe(1);
    expect(count(`select count(*) as n from settings where key = 'builtInGrantsVersion'`)).toBe(1);
    expect(fs.readdirSync(path.join(dataDir, 'uploads')).length).toBeGreaterThan(5);
    // The website demo: content with the casting call open, coaches linked to the demo coaches, workshops shown,
    // four applications (one a minor with consent) with photos, two new website enquiries.
    expect(count(`select count(*) as n from settings where key = 'site' and json_extract(value, '$.castingCall.open') = 1`)).toBe(1);
    expect(count(`select count(*) as n from settings where key = 'siteFormSecret' and length(json_extract(value, '$')) = 64`)).toBe(1);
    expect(count('select count(*) as n from site_coaches where user_id is not null and visible = 1')).toBe(2);
    expect(count('select count(*) as n from site_workshops where visible = 1')).toBeGreaterThanOrEqual(3);
    expect(count('select count(*) as n from casting_applications')).toBe(4);
    expect(count(`select count(*) as n from casting_applications where status = 'new'`)).toBe(3);
    expect(count('select count(*) as n from casting_applications where guardian_consent = 1 and guardian_name is not null')).toBe(1);
    expect(count('select count(distinct application_id) as n from casting_application_photos')).toBe(4);
    expect(count(`select count(*) as n from leads where source = 'website' and status = 'new' and created_by_id is null`)).toBe(2);
    expect(count(`select count(*) as n from positions where key = 'executive_director' and permissions like '%website.manage%'`)).toBe(1);

    // The team pack: everyone active has a profile photo; workshop and casting files (photos and PDFs);
    // three conversations (photo and document attachments, unread messages); one answered call to the office.
    expect(count('select count(*) as n from users where active = 1 and photo_file_id is null')).toBe(0);
    expect(count(`select count(*) as n from course_files where kind = 'photo'`)).toBeGreaterThanOrEqual(2);
    expect(count(`select count(*) as n from course_files cf join files f on f.id = cf.file_id where cf.kind = 'document' and f.mime = 'application/pdf'`)).toBeGreaterThanOrEqual(2);
    expect(count('select count(distinct kind) as n from casting_files')).toBe(2);
    expect(count('select count(*) as n from conversations where last_message_at is not null')).toBe(3);
    expect(count('select count(distinct kind) as n from message_attachments')).toBe(2);
    expect(count('select count(*) as n from messages')).toBeGreaterThanOrEqual(7);
    expect(count(`select count(*) as n from summons where status = 'on_my_way' and answered_at is not null`)).toBe(1);
    // … plus the cafeteria's two kinds (a new order, what became of an order).
    expect(count(`select count(distinct kind) as n from notifications`)).toBe(5);
    expect(count(`select count(*) as n from positions where key = 'executive_director' and permissions like '%staff.summon%'`)).toBe(1);

    // Reception and Office helper: one account each, holding the built-in position (Reception allows nothing yet;
    // the Office helper serves the cafeteria, in Arabic). The Executive Director was not given cafeteria.serve.
    const holds = (email: string, key: string) =>
      count(`select count(*) as n from user_positions up join users u on u.id = up.user_id join positions p on p.id = up.position_id where u.email = '${email}' and p.key = '${key}'`);
    expect(holds('reception@demo.school', 'reception')).toBe(1);
    expect(holds('helper@demo.school', 'office_helper')).toBe(1);
    expect(count(`select count(*) as n from positions where key = 'reception' and permissions = '[]' and name_ar = 'الاستقبال'`)).toBe(1);
    expect(count(`select count(*) as n from positions where key = 'office_helper' and permissions = '["cafeteria.serve"]' and name_ar = 'عامل المكتب'`)).toBe(1);
    expect(count(`select count(*) as n from users where email = 'helper@demo.school' and locale = 'ar'`)).toBe(1);
    expect(count(`select count(*) as n from positions where key = 'executive_director' and permissions like '%cafeteria.serve%'`)).toBe(0);
    expect(first.stdout).toContain('helper@demo.school');
    expect(first.stdout).toContain('reception@demo.school');
    // The cafeteria: the usual menu (no prices anywhere), one order delivered by the helper, one waiting on his board
    // with an alert for everyone who serves (the helper and the two owners).
    expect(count('select count(*) as n from cafe_items where available = 1')).toBe(10);
    expect(count('select count(distinct category) as n from cafe_items')).toBe(3);
    expect(count('select count(*) as n from cafe_orders')).toBe(2);
    expect(
      count(`select count(*) as n from cafe_orders o join users u on u.id = o.handled_by_id
             where o.status = 'delivered' and u.email = 'helper@demo.school' and o.on_the_way_at < o.delivered_at and o.created_at < o.on_the_way_at`),
    ).toBe(1);
    expect(count(`select count(*) as n from cafe_orders o join users u on u.id = o.user_id where o.status = 'new' and o.place = 'Studio 1' and u.email = 'coach@demo.school'`)).toBe(1);
    expect(count('select count(*) as n from cafe_order_items')).toBe(4);
    expect(count(`select count(*) as n from cafe_order_items where options = 'no sugar' and name_en = 'Tea' and name_ar = 'شاي'`)).toBe(1);
    expect(count(`select count(*) as n from notifications where kind = 'cafe_order' and read_at is null`)).toBe(3);
    expect(count(`select count(*) as n from notifications n join users u on u.id = n.user_id where n.kind = 'cafe_status' and u.email = 'director@demo.school'`)).toBe(1);
    expect(count(`select count(*) as n from settings where key in ('cafeteriaEnabled', 'cafePlaces')`)).toBe(0);

    const again = seed();
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('--reset');
    expect(count('select count(*) as n from users')).toBe(11);

    const reset = seed('--reset');
    expect(reset.status).toBe(0);
    expect(count('select count(*) as n from users')).toBe(11);
    expect(count('select count(*) as n from cafe_orders')).toBe(2);
  }, 90_000);
});
