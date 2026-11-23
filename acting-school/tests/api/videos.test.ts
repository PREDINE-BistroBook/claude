import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { initDb, type DB } from '../../src/server/db/database';
import { applyMigrations } from '../../src/server/db/migrate';
import bundle from '../../src/server/db/migrations/bundle';
import * as schema from '../../src/server/db/schema';
import { classSessions, notifications, positions, userPositions, users, videoEvents, videoStudents, videos } from '../../src/server/db/schema';
import { builtInGrantsVersion } from '../../src/server/lib/access';
import { epochAt } from '../../src/server/lib/clock';
import { generateVapidKeys } from '../../src/server/lib/push/keys';
import { durableObjectLimits } from '../../src/server/lib/sqlLimits';
import { addDays, startOfWeek, weekdayOf } from '../../src/shared/dates';
import {
  BUILT_IN_GRANTS,
  BUILT_IN_GRANTS_SETTING,
  BUILT_IN_POSITIONS,
  LATEST_BUILT_IN_GRANTS_VERSION,
  PERMISSIONS,
  PERMISSION_GROUPS,
  SECTION_PERMISSIONS,
  videosAreHome,
} from '../../src/shared/permissions';
import type { ChatUnreadResponse } from '../../src/shared/schemas/chat';
import type { CourseDetail } from '../../src/shared/schemas/courses';
import type { NotificationsResponse } from '../../src/shared/schemas/notifications';
import type { Position } from '../../src/shared/schemas/positions';
import type { Video, VideoDetail, VideoEvent, VideoStepResult } from '../../src/shared/schemas/videos';
import { makeTestContext, SCHOOL_TZ, todayISO, type Client } from '../helpers';
import { fakeBrowser, pushRecorder } from '../pushHelpers';

/**
 * Part L: the video pipeline — coach → editor → reviewer (/api/videos), the
 * four videos permissions, the Video reviewer position and BUILT_IN_GRANTS v5.
 */

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;
type Answer = VideoStepResult & { error: { code: string; details?: any; issues: any[] } };

/**
 * A school with one workshop of Layla's (a session today, three students), one
 * of another coach, an editor in Arabic, Moaty (coach + finance + Video
 * reviewer), the director and an owner.
 */
async function school(opts: Parameters<typeof makeTestContext>[0] = {}) {
  const t = await makeTestContext(opts);
  const owner = await t.as('owner', { name: 'Ahmed Tamam' });
  const coach = await t.as('acting_coach', { name: 'Layla Haddad' });
  const otherCoach = await t.as('acting_coach', { name: 'Omar Said' });
  const editor = await t.as('video_editor', { name: 'Ali El Gohary', locale: 'ar' });
  const reviewer = await t.as(['acting_coach', 'finance', 'video_reviewer'], { name: 'Moaty' });
  const director = await t.as('executive_director', { name: 'Salma' });
  const today = todayISO();
  const student = async (firstName: string) => (await owner.post<{ id: number }>('/api/students', { firstName, lastName: 'Test' })).body.id;
  const maya = await student('Maya');
  const chloe = await student('Chloe');
  const kareem = await student('Kareem');
  const stranger = await student('Stranger');
  const workshop = async (name: string, teacherId: number, enrol: number[]) => {
    const course = (
      await owner.post<CourseDetail>('/api/courses', {
        name,
        teacherId,
        startDate: addDays(today, -14),
        endDate: addDays(today, 14),
        schedule: [{ weekday: weekdayOf(today), startTime: '18:00', endTime: '20:00' }],
      })
    ).body;
    for (const studentId of enrol) expect((await owner.post(`/api/courses/${course.id}/enrollments`, { studentId })).status).toBe(201);
    return course;
  };
  const screen = await workshop('Screen Acting I', coach.user.id, [maya, chloe, kareem]);
  const improv = await workshop('Improvisation Lab', otherCoach.user.id, [stranger]);
  const session = screen.sessions.find((s) => s.date === today)!;
  const otherSession = improv.sessions.find((s) => s.date === today)!;
  expect(session && otherSession).toBeTruthy();
  return { t, owner, coach, otherCoach, editor, reviewer, director, today, maya, chloe, kareem, stranger, screen, improv, session, otherSession };
}
type School = Awaited<ReturnType<typeof school>>;

const RAW = 'https://drive.google.com/file/d/raw-1/view';
const EDIT = 'https://youtu.be/edit-1';

const add = (client: Client, body: Record<string, unknown>) => client.post<Answer>('/api/videos', { title: 'Screen Acting I — scene', rawLink: RAW, ...body });
const step = (client: Client, id: number, action: string, body?: unknown) => client.post<Answer>(`/api/videos/${id}/${action}`, body);
const bell = async (client: Client) => (await client.get<NotificationsResponse>('/api/notifications')).body;
const poll = async (client: Client) => (await client.get<ChatUnreadResponse>('/api/chat/unread')).body.videos;
const videoAlerts = (t: Ctx, videoId: number) => t.db.select().from(notifications).where(eq(notifications.link, `/videos/${videoId}`)).all();
const alertedIds = (t: Ctx, videoId: number, kind: string) =>
  videoAlerts(t, videoId)
    .filter((n) => n.kind === kind)
    .map((n) => n.userId)
    .sort((a, b) => a - b);

/** Give someone other positions (as an owner does on Team › their name), keeping the account. */
async function moveToPositions(s: School, userId: number, keys: Parameters<Ctx['positionId']>[0][]) {
  expect((await s.owner.patch(`/api/staff/${userId}`, { positionIds: keys.map((k) => s.t.positionId(k)) })).status).toBe(200);
}

/** A video of Layla's on today's session, with Maya and Chloe in it. */
async function newVideo(s: School, body: Record<string, unknown> = {}) {
  const res = await add(s.coach, { sessionId: s.session.id, studentIds: [s.maya, s.chloe], notesForEditor: 'Use take 2', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

// ── Positions and permissions ───────────────────────────────────────────────

describe('the videos permissions and the Video reviewer position', () => {
  const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!;

  it('four permissions in their own group; any of them opens School (where the queue is)', () => {
    expect(PERMISSIONS.filter((p) => p.startsWith('videos.'))).toEqual(['videos.read', 'videos.add', 'videos.edit', 'videos.review']);
    expect(PERMISSION_GROUPS.find((g) => g.id === 'videos')?.permissions).toEqual(['videos.read', 'videos.add', 'videos.edit', 'videos.review']);
    for (const p of ['videos.read', 'videos.add', 'videos.edit', 'videos.review'] as const) expect(SECTION_PERMISSIONS.school, p).toContain(p);
  });

  it('Video reviewer: a built-in with English and Arabic names, holding videos.review and videos.read', () => {
    expect(builtIn('video_reviewer')).toEqual({ key: 'video_reviewer', name: 'Video reviewer', nameAr: 'مراجع الفيديو', isOwner: false, permissions: ['videos.read', 'videos.review'] });
    expect(BUILT_IN_POSITIONS.at(-1)!.key).toBe('video_reviewer');
  });

  it('who holds what out of the box: coaches and the director add, the editor edits, the director reads, only the reviewer (and owners) review', () => {
    const holds = (key: string) => builtIn(key).permissions as readonly string[];
    for (const p of BUILT_IN_POSITIONS) {
      const held = p.permissions as readonly string[];
      expect(held.includes('videos.add'), p.key).toBe(p.isOwner || p.key === 'acting_coach' || p.key === 'executive_director');
      expect(held.includes('videos.edit'), p.key).toBe(p.isOwner || p.key === 'video_editor');
      expect(held.includes('videos.review'), p.key).toBe(p.isOwner || p.key === 'video_reviewer');
      expect(held.includes('videos.read'), p.key).toBe(p.isOwner || p.key === 'executive_director' || p.key === 'video_reviewer');
    }
    expect(holds('video_editor')).toEqual(['students.read', 'courses.read', 'classes.all', 'talent.read', 'videos.edit']);
  });

  it('BUILT_IN_GRANTS v5 gives the released positions their videos permissions; the earlier grants are untouched', () => {
    expect(LATEST_BUILT_IN_GRANTS_VERSION).toBe(5);
    expect(BUILT_IN_GRANTS.map((g) => g.version)).toEqual([1, 2, 3, 4, 5]);
    expect(BUILT_IN_GRANTS.at(-1)).toEqual({ version: 5, grants: { acting_coach: ['videos.add'], executive_director: ['videos.add', 'videos.read'], video_editor: ['videos.edit'] } });
    expect(BUILT_IN_GRANTS.slice(0, 4).flatMap((g) => Object.values(g.grants).flat()).filter((p) => p.startsWith('videos.'))).toEqual([]);
    // The Video reviewer is new: it comes whole, with no grant.
    expect(BUILT_IN_GRANTS.flatMap((g) => Object.values(g.grants).flat())).not.toContain('videos.review');
  });

  it('the queue is home for someone whose only work is editing videos; not for the Video editor position (it also sees workshops and actors)', () => {
    expect(videosAreHome(['videos.edit'])).toBe(true);
    expect(videosAreHome(['videos.edit', 'videos.read', 'staff.summon'])).toBe(true);
    expect(videosAreHome(builtIn('video_editor').permissions)).toBe(false);
    expect(videosAreHome(['videos.review', 'videos.read'])).toBe(false);
    expect(videosAreHome(['videos.edit', 'students.read'])).toBe(false);
    expect(videosAreHome(['videos.edit', 'talent.read'])).toBe(false);
    expect(videosAreHome([...PERMISSIONS])).toBe(false);
  });

  it('the migration is found by its tag, comes after the cafeteria’s, and only adds (three tables, their indexes — no rebuild)', () => {
    const tags = bundle.journal.entries.map((e) => e.tag);
    expect(tags.filter((tag) => tag.endsWith('_videos'))).toHaveLength(1);
    const at = tags.findIndex((tag) => tag.endsWith('_videos'));
    expect(tags.slice(0, at)).toEqual(['0000_init', '0001_positions', '0002_created_by', '0003_admissions', '0004_cloudflare', '0005_website', '0006_team', '0007_usernames', '0008_cafeteria']);
    const entry = bundle.journal.entries[at]!;
    expect(entry.when).toBeGreaterThan(bundle.journal.entries[at - 1]!.when);
    const text = bundle.migrations[`m${String(entry.idx).padStart(4, '0')}`]!;
    for (const table of ['videos', 'video_students', 'video_events']) expect(text).toContain(`CREATE TABLE \`${table}\``);
    expect(text).not.toMatch(/PRAGMA|DROP|__new_|RENAME|ALTER TABLE/i);
  });

  /** A database as the live one is today: every migration before this one, the ten positions, grants at v4, the real team holding them. */
  function liveDatabaseToday() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema, logger: durableObjectLimits }) as unknown as DB;
    const upTo = bundle.journal.entries.findIndex((e) => e.tag.endsWith('_videos'));
    applyMigrations(db, { ...bundle, journal: { ...bundle.journal, entries: bundle.journal.entries.slice(0, upTo) } });
    const old = BUILT_IN_POSITIONS.filter((p) => p.key !== 'video_reviewer');
    for (const [i, p] of old.entries()) {
      sqlite
        .prepare('insert into positions (key, name, name_ar, is_owner, permissions, sort_order, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 1, 1)')
        .run(p.key, p.name, p.nameAr, p.isOwner ? 1 : 0, JSON.stringify(p.permissions.filter((x) => !x.startsWith('videos.'))), i * 10);
    }
    sqlite.prepare(`insert into settings (key, value) values (?, '4')`).run(BUILT_IN_GRANTS_SETTING);
    const insertUser = sqlite.prepare(`insert into users (email, username, name, password_hash, created_at, updated_at) values (?, ?, ?, 'x', 1, 1)`);
    const hold = sqlite.prepare('insert into user_positions (user_id, position_id) select ?, id from positions where key = ?');
    for (const [username, name, keys] of [
      ['ceo', 'Ahmed Tamam', ['ceo']],
      ['salma', 'Salma', ['executive_director']],
      ['ali', 'Ali El Gohary', ['video_editor']],
      ['moaty', 'Moaty', ['acting_coach', 'finance']],
    ] as const) {
      const id = insertUser.run(`${username}@turquoisestudio.app`, username, name).lastInsertRowid;
      for (const key of keys) hold.run(id, key);
    }
    return { sqlite, db };
  }
  const allPositions = (db: DB) => db.select().from(positions).all();
  const byKey = (db: DB, key: string) => allPositions(db).find((p) => p.key === key);

  it('the live database at the next start: the three tables, the Video reviewer once, the v5 grants once — nobody’s positions change', () => {
    const { sqlite, db } = liveDatabaseToday();
    const tables = () => sqlite.prepare(`select count(*) as n from sqlite_master where type = 'table' and name in ('videos', 'video_students', 'video_events')`).get();
    expect(tables()).toEqual({ n: 0 });
    const before = allPositions(db);
    const holdersBefore = db.select().from(userPositions).all();
    expect(before).toHaveLength(10);

    initDb(db);
    expect(tables()).toEqual({ n: 3 });
    expect(allPositions(db).map((p) => p.key)).toEqual([...before.map((p) => p.key), 'video_reviewer']);
    expect(byKey(db, 'video_reviewer')).toMatchObject({ name: 'Video reviewer', nameAr: 'مراجع الفيديو', isOwner: false, permissions: ['videos.read', 'videos.review'], sortOrder: 100 });
    const gained: Record<string, string[]> = { executive_director: ['videos.add', 'videos.read'], acting_coach: ['videos.add'], video_editor: ['videos.edit'] };
    expect(allPositions(db).slice(0, 10)).toEqual(
      before.map((p) => (p.key && gained[p.key] ? { ...p, permissions: [...p.permissions, ...gained[p.key]!], updatedAt: expect.any(Number) } : p)),
    );
    expect(builtInGrantsVersion(db)).toBe(5);
    // Moaty keeps his two positions: the Video reviewer is given by an owner, on top (Team → Moaty).
    expect(db.select().from(userPositions).all()).toEqual(holdersBefore);

    // Later starts change nothing: the grant ran once — an owner who takes videos.add from the coaches keeps it that way —
    // and a renamed Video reviewer is neither created again nor reset.
    db.update(positions).set({ permissions: before.find((p) => p.key === 'acting_coach')!.permissions }).where(eq(positions.key, 'acting_coach')).run();
    db.update(positions).set({ name: 'Checks the edits', permissions: ['videos.review'] }).where(eq(positions.key, 'video_reviewer')).run();
    const edited = allPositions(db);
    initDb(db);
    initDb(db);
    expect(allPositions(db)).toEqual(edited);
    expect(byKey(db, 'acting_coach')!.permissions).not.toContain('videos.add');
  });

  it('a new school has the Video reviewer; an owner gives it to Moaty on top of his positions — the director can’t (she doesn’t review)', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const director = await t.as('executive_director');
    const moaty = await t.createUser(['acting_coach', 'finance'], { name: 'Moaty', username: 'moaty' });
    const list = (await owner.get<{ items: Position[] }>('/api/positions')).body.items;
    expect(list.at(-1)).toMatchObject({ key: 'video_reviewer', name: 'Video reviewer', nameAr: 'مراجع الفيديو', permissions: ['videos.read', 'videos.review'], editable: true, assignable: true });
    const reviewerPosition = t.positionId('video_reviewer');
    // The director holds neither videos.review nor videos.edit: the Video reviewer and the Video editor are out of her reach.
    const hers = (await director.get<{ items: Position[] }>('/api/positions')).body.items;
    expect(hers.find((p) => p.key === 'video_reviewer')).toMatchObject({ assignable: false, editable: false });
    expect(hers.find((p) => p.key === 'video_editor')).toMatchObject({ assignable: false, editable: false });
    const positionIds = [t.positionId('acting_coach'), t.positionId('finance'), reviewerPosition];
    expect((await director.patch(`/api/staff/${moaty.id}`, { positionIds })).status).toBe(403);
    expect((await owner.patch(`/api/staff/${moaty.id}`, { positionIds })).status).toBe(200);
    const me = (await (await t.login('moaty')).get('/api/auth/me')).body.user;
    expect(me.permissions).toEqual(expect.arrayContaining(['videos.add', 'videos.review', 'videos.read', 'payments.manage']));
    expect(me.permissions).not.toContain('videos.edit');
    const gone = await owner.delete(`/api/positions/${reviewerPosition}`);
    expect(gone.status).toBe(409);
  });
});

// ── Who may use the API ─────────────────────────────────────────────────────

describe('access to /api/videos', () => {
  it('signed out: 401; no videos permission (casting, reception, finance, the Office helper): 403 everywhere', async () => {
    const s = await school();
    const v = await newVideo(s);
    expect((await s.t.anon.get('/api/videos')).status).toBe(401);
    expect((await s.t.anon.post('/api/videos', {})).status).toBe(401);
    for (const spec of ['casting_team', 'head_of_casting', 'reception', 'finance', 'office_helper'] as const) {
      const someone = await s.t.as(spec);
      for (const [method, url] of [
        ['get', '/api/videos'],
        ['get', `/api/videos/${v.id}`],
        ['post', '/api/videos'],
        ['post', `/api/videos/${v.id}/take`],
        ['post', `/api/videos/${v.id}/comments`],
      ] as const) {
        expect((await someone[method](url, { note: 'x' })).status, `${spec} ${method} ${url}`).toBe(403);
      }
    }
  });

  it('each step needs its own permission: adding videos.add, taking and handing in videos.edit, deciding videos.review', async () => {
    const s = await school();
    const v = await newVideo(s);
    // The editor and the reviewer-only position don't add; the director does (grant v5).
    expect((await add(s.editor, { sessionId: s.session.id })).status).toBe(403);
    const readOnly = await s.t.as('video_reviewer');
    expect((await add(readOnly, { sessionId: s.session.id })).status).toBe(403);
    expect((await add(s.director, { sessionId: s.session.id })).status).toBe(201);
    // Coaches and the director neither edit nor decide.
    for (const c of [s.coach, s.director]) {
      expect((await step(c, v.id, 'take')).status).toBe(403);
      expect((await step(c, v.id, 'submit', { editedLink: EDIT })).status).toBe(403);
      expect((await step(c, v.id, 'approve')).status).toBe(403);
      expect((await step(c, v.id, 'request-changes', { note: 'x' })).status).toBe(403);
      expect((await step(c, v.id, 'reopen', { note: 'x' })).status).toBe(403);
    }
    // The editor doesn't decide; the reviewer doesn't edit.
    expect((await step(s.editor, v.id, 'approve')).status).toBe(403);
    expect((await step(s.reviewer, v.id, 'take')).status).toBe(403);
    // Unknown ids: 404.
    expect((await s.editor.get('/api/videos/9999')).status).toBe(404);
    expect((await step(s.editor, 9999, 'take')).status).toBe(404);
  });
});

// ── Class scope ─────────────────────────────────────────────────────────────

describe('class scope: a coach adds and sees videos of their own workshops only', () => {
  it('adding: only to a session or workshop the coach can see — anything else answers like a missing one', async () => {
    const s = await school();
    expect((await add(s.coach, { sessionId: s.otherSession.id })).status).toBe(404);
    expect((await add(s.coach, { courseId: s.improv.id })).status).toBe(404);
    expect((await add(s.coach, { sessionId: 99999 })).status).toBe(404);
    // From the workshop itself (no session), and from a session.
    const fromWorkshop = await add(s.coach, { courseId: s.screen.id });
    expect(fromWorkshop.status).toBe(201);
    expect(fromWorkshop.body).toMatchObject({ courseId: s.screen.id, courseName: 'Screen Acting I', sessionId: null, sessionDate: null });
    const fromSession = await add(s.coach, { sessionId: s.session.id });
    expect(fromSession.body).toMatchObject({ courseId: s.screen.id, sessionId: s.session.id, sessionDate: s.today, sessionStartTime: '18:00' });
    // The director (classes.all) adds to any workshop.
    expect((await add(s.director, { sessionId: s.otherSession.id })).status).toBe(201);
    // Someone who adds but sees no workshops (no courses.read) can't reach a session at all.
    const blind = await s.t.as({ permissions: ['videos.add'] });
    expect((await add(blind, { sessionId: s.session.id })).status).toBe(404);
  });

  it('reading: the coach sees their workshops’ videos and the ones they added; editors, reviewers, the director and owners see all', async () => {
    const s = await school();
    const mine = await newVideo(s);
    const theirs = (await add(s.otherCoach, { sessionId: s.otherSession.id, title: 'Improv' })).body;
    const ids = async (c: Client, q = '') => (await c.get<{ items: Video[] }>(`/api/videos${q}`)).body.items.map((v) => v.id).sort((a, b) => a - b);
    expect(await ids(s.coach)).toEqual([mine.id]);
    expect(await ids(s.otherCoach)).toEqual([theirs.id]);
    expect((await s.coach.get(`/api/videos/${theirs.id}`)).status).toBe(404);
    expect((await step(s.coach, theirs.id, 'comments', { note: 'Hi' })).status).toBe(404);
    for (const c of [s.editor, s.reviewer, s.director, s.owner, await s.t.as('video_reviewer')]) expect(await ids(c)).toEqual([mine.id, theirs.id]);
    // Filters: one session, one workshop.
    expect(await ids(s.editor, `?sessionId=${s.session.id}`)).toEqual([mine.id]);
    expect(await ids(s.editor, `?courseId=${s.improv.id}`)).toEqual([theirs.id]);
    expect((await s.editor.get('/api/videos?status=nope')).status).toBe(400);
  });

  it('students’ names follow the student rules: someone without students.read only gets a count', async () => {
    const s = await school();
    const v = await newVideo(s, { studentIds: [s.maya, s.chloe, s.kareem] });
    expect(v.students.map((x) => x.firstName)).toEqual(['Chloe', 'Kareem', 'Maya']);
    expect(v.studentsHidden).toBe(0);
    const readOnly = await s.t.as('video_reviewer');
    const seen = (await readOnly.get<VideoDetail>(`/api/videos/${v.id}`)).body;
    expect(seen.students).toEqual([]);
    expect(seen.studentsHidden).toBe(3);
    expect((await s.editor.get<VideoDetail>(`/api/videos/${v.id}`)).body.students).toHaveLength(3);
  });
});

// ── Adding: validation ──────────────────────────────────────────────────────

describe('adding a video', () => {
  it('stores the link, kind, notes and students; due tomorrow by the school’s clock unless chosen; the history starts with "added"', async () => {
    const s = await school();
    const v = await newVideo(s, { kind: 'scene', title: '  Screen Acting I — the two-hander  ' });
    expect(v).toMatchObject({
      title: 'Screen Acting I — the two-hander',
      kind: 'scene',
      rawLink: RAW,
      notesForEditor: 'Use take 2',
      dueOn: addDays(s.today, 1),
      status: 'new',
      addedBy: { id: s.coach.user.id, name: 'Layla Haddad' },
      editor: null,
      reviewer: null,
      editedLink: null,
      changesNote: null,
    });
    expect(v.events).toEqual([expect.objectContaining({ type: 'added', note: 'Use take 2', link: RAW, by: expect.objectContaining({ id: s.coach.user.id }) })]);
    const chosen = await add(s.coach, { sessionId: s.session.id, dueOn: addDays(s.today, 3) });
    expect(chosen.body).toMatchObject({ dueOn: addDays(s.today, 3), kind: 'other', notesForEditor: null, students: [] });
  });

  it('links: http or https only, at most 1000 characters; title required, at most 120; notes at most 1000', async () => {
    const s = await school();
    for (const rawLink of ['javascript:alert(1)', 'ftp://example.com/a.mp4', 'data:text/html,hi', 'drive.google.com/file/d/1', 'https://localhost/x', '', `https://drive.google.com/${'a'.repeat(1000)}`]) {
      const res = await add(s.coach, { sessionId: s.session.id, rawLink });
      expect(res.status, rawLink).toBe(400);
      expect(res.body.error.issues[0].path, rawLink).toEqual(['rawLink']);
    }
    expect((await add(s.coach, { sessionId: s.session.id, rawLink: 'javascript:alert(1)' })).body.error.issues[0].message).toBe('videos:errors.invalidLink');
    expect((await add(s.coach, { sessionId: s.session.id, rawLink: 'http://we.tl/t-abc' })).status).toBe(201);
    expect((await add(s.coach, { sessionId: s.session.id, title: '' })).status).toBe(400);
    expect((await add(s.coach, { sessionId: s.session.id, title: 'x'.repeat(121) })).status).toBe(400);
    expect((await add(s.coach, { sessionId: s.session.id, notesForEditor: 'x'.repeat(1001) })).status).toBe(400);
    expect((await add(s.coach, { sessionId: s.session.id, kind: 'blooper' })).status).toBe(400);
    expect((await add(s.coach, { sessionId: s.session.id, dueOn: '2026-02-30' })).status).toBe(400);
    // Neither a session nor a workshop; a session of another workshop than the one named.
    expect((await add(s.coach, {})).status).toBe(400);
    expect((await add(s.director, { sessionId: s.session.id, courseId: s.improv.id })).body.error.issues[0]).toMatchObject({ path: ['courseId'], message: 'videos:errors.sessionNotInWorkshop' });
    // The submitted edit's link too.
    const v = await newVideo(s);
    await step(s.editor, v.id, 'take');
    expect((await step(s.editor, v.id, 'submit', { editedLink: 'javascript:alert(1)' })).status).toBe(400);
    expect((await step(s.editor, v.id, 'submit', {})).status).toBe(400);
    // An empty field says what to put in it, not a bare "Required".
    expect((await add(s.coach, { sessionId: s.session.id, rawLink: '  ' })).body.error.issues[0].message).toBe('videos:errors.rawLinkRequired');
    expect((await step(s.editor, v.id, 'submit', { editedLink: '' })).body.error.issues[0].message).toBe('videos:errors.editedLinkRequired');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    for (const action of ['request-changes', 'reopen']) {
      const empty = await step(s.reviewer, v.id, action, { note: ' ' });
      expect(empty.status, action).toBe(400);
      expect(empty.body.error.issues[0], action).toMatchObject({ path: ['note'], message: 'videos:errors.changesNoteRequired' });
    }
  });

  it('students: only the workshop’s own (now or before); repeats are dropped', async () => {
    const s = await school();
    const res = await add(s.director, { sessionId: s.session.id, studentIds: [s.maya, s.stranger] });
    expect(res.status).toBe(400);
    expect(res.body.error.issues).toEqual([expect.objectContaining({ path: ['studentIds', 1], message: 'videos:errors.notInWorkshop' })]);
    const ok = await add(s.coach, { sessionId: s.session.id, studentIds: [s.maya, s.maya, s.kareem] });
    expect(ok.status).toBe(201);
    expect(ok.body.students.map((x) => x.id).sort()).toEqual([s.maya, s.kareem].sort());
    expect((await add(s.coach, { sessionId: s.session.id, studentIds: Array.from({ length: 61 }, (_, i) => i + 1) })).status).toBe(400);
  });
});

// ── The status machine ──────────────────────────────────────────────────────

describe('the status machine: every move is from the status it was read in', () => {
  it('the whole way: new → editing → in_review → changes_requested → editing → in_review → approved → (reopened) changes_requested', async () => {
    const s = await school();
    const v = await newVideo(s);

    const taken = await step(s.editor, v.id, 'take');
    expect(taken.status).toBe(200);
    expect(taken.body).toMatchObject({ status: 'editing', editor: { id: s.editor.user.id }, takenAt: expect.any(Number) });

    const done = await step(s.editor, v.id, 'submit', { editedLink: EDIT, notes: 'Colour fixed' });
    expect(done.body).toMatchObject({ status: 'in_review', editedLink: EDIT, editorNotes: 'Colour fixed', submittedAt: expect.any(Number) });

    const back = await step(s.reviewer, v.id, 'request-changes', { note: 'Music too loud at 0:42' });
    expect(back.body).toMatchObject({ status: 'changes_requested', reviewer: { id: s.reviewer.user.id }, changesNote: 'Music too loud at 0:42', decidedAt: expect.any(Number) });

    const fixing = await step(s.editor, v.id, 'take');
    expect(fixing.body).toMatchObject({ status: 'editing', changesNote: 'Music too loud at 0:42' });
    const again = await step(s.editor, v.id, 'submit', { editedLink: 'https://youtu.be/edit-2' });
    expect(again.body).toMatchObject({ status: 'in_review', editedLink: 'https://youtu.be/edit-2', editorNotes: null });

    const approved = await step(s.reviewer, v.id, 'approve');
    expect(approved.body).toMatchObject({ status: 'approved', reviewer: { id: s.reviewer.user.id } });

    const reopened = await step(s.reviewer, v.id, 'reopen', { note: 'The title card is misspelt' });
    expect(reopened.body).toMatchObject({ status: 'changes_requested', changesNote: 'The title card is misspelt' });

    // The history, in order, with the notes and links that came with each step.
    expect(reopened.body.events.map((e) => [e.type, e.by?.id, e.note, e.link])).toEqual([
      ['added', s.coach.user.id, 'Use take 2', RAW],
      ['taken', s.editor.user.id, null, null],
      ['submitted', s.editor.user.id, 'Colour fixed', EDIT],
      ['changes_requested', s.reviewer.user.id, 'Music too loud at 0:42', null],
      ['taken', s.editor.user.id, null, null],
      ['submitted', s.editor.user.id, null, 'https://youtu.be/edit-2'],
      ['approved', s.reviewer.user.id, null, null],
      ['reopened', s.reviewer.user.id, 'The title card is misspelt', null],
    ]);
  });

  it('every move that isn’t the next one is refused with 409 video_moved and the video as it is now', async () => {
    const s = await school();
    const v = await newVideo(s);
    const refused = async (client: Client, action: string, body?: unknown) => {
      const res = await step(client, v.id, action, body);
      expect(res.status, action).toBe(409);
      expect(res.body.error.code, action).toBe('video_moved');
      return res.body.error.details.video as VideoDetail;
    };
    // new: nothing to hand in or decide yet.
    expect((await refused(s.editor, 'submit', { editedLink: EDIT })).status).toBe('new');
    await refused(s.reviewer, 'approve');
    await refused(s.reviewer, 'request-changes', { note: 'x' });
    await refused(s.reviewer, 'reopen', { note: 'x' });
    // editing: not taken twice, not decided.
    await step(s.editor, v.id, 'take');
    const second = await s.t.as('video_editor', { name: 'Second editor' });
    expect((await refused(second, 'take')).editor?.id).toBe(s.editor.user.id);
    await refused(s.reviewer, 'approve');
    await refused(s.reviewer, 'reopen', { note: 'x' });
    // …and only the editor who took it hands it in.
    const notYours = await step(second, v.id, 'submit', { editedLink: EDIT });
    expect(notYours.status).toBe(403);
    expect(notYours.body.error.code).toBe('not_your_edit');
    // in_review: not taken or handed in again, not reopened.
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    await refused(s.editor, 'take');
    await refused(s.editor, 'submit', { editedLink: EDIT });
    await refused(s.reviewer, 'reopen', { note: 'x' });
    // A note is required to send it back.
    expect((await step(s.reviewer, v.id, 'request-changes', {})).status).toBe(400);
    expect((await step(s.reviewer, v.id, 'request-changes', { note: '   ' })).status).toBe(400);
    // changes_requested: not decided or handed in before it is taken again.
    await step(s.reviewer, v.id, 'request-changes', { note: 'Shorter please' });
    await refused(s.reviewer, 'approve');
    await refused(s.editor, 'submit', { editedLink: EDIT });
    // approved: nothing but reopening (with a note).
    await step(s.editor, v.id, 'take');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    await step(s.reviewer, v.id, 'approve');
    await refused(s.editor, 'take');
    await refused(s.reviewer, 'approve');
    await refused(s.reviewer, 'request-changes', { note: 'x' });
    expect((await step(s.reviewer, v.id, 'reopen', {})).status).toBe(400);
  });

  it('two taps at once: one wins, the other gets 409 — taking, handing in, deciding', async () => {
    const s = await school();
    const v = await newVideo(s);
    const second = await s.t.as('video_editor', { name: 'Second editor' });
    const takes = await Promise.all([step(s.editor, v.id, 'take'), step(second, v.id, 'take')]);
    expect(takes.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = takes[0]!.status === 200 ? s.editor : second;
    expect(t2(takes)).toBe(winner === s.editor ? s.editor.user.id : second.user.id);
    const submits = await Promise.all([step(winner, v.id, 'submit', { editedLink: EDIT }), step(winner, v.id, 'submit', { editedLink: EDIT })]);
    expect(submits.map((r) => r.status).sort()).toEqual([200, 409]);
    const otherReviewer = await s.t.as('video_reviewer');
    const decisions = await Promise.all([step(s.reviewer, v.id, 'approve'), step(otherReviewer, v.id, 'request-changes', { note: 'No' })]);
    expect(decisions.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(s.t.db.select().from(videoEvents).where(eq(videoEvents.videoId, v.id)).all().map((e) => e.type)).toEqual(['added', 'taken', 'submitted', decisions[0]!.status === 200 ? 'approved' : 'changes_requested']);
  });

  it('an editor who has left leaves the video to the others: it can be taken over while it is being edited', async () => {
    const s = await school();
    const v = await newVideo(s);
    await step(s.editor, v.id, 'take');
    const second = await s.t.as('video_editor', { name: 'Second editor' });
    expect((await step(second, v.id, 'take')).status).toBe(409);
    s.t.db.update(users).set({ active: false }).where(eq(users.id, s.editor.user.id)).run();
    const over = await step(second, v.id, 'take');
    expect(over.status).toBe(200);
    expect(over.body.editor?.id).toBe(second.user.id);
    expect((await step(second, v.id, 'submit', { editedLink: EDIT })).status).toBe(200);
  });

  it('while new, the coach who added it changes or deletes it (a reviewer and owners too); once taken it is locked', async () => {
    const s = await school();
    const v = await newVideo(s);
    const changed = await s.coach.patch<Answer>(`/api/videos/${v.id}`, { title: 'Renamed', rawLink: 'https://we.tl/t-new', studentIds: [s.kareem], dueOn: addDays(s.today, 2), notesForEditor: '' });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ title: 'Renamed', rawLink: 'https://we.tl/t-new', dueOn: addDays(s.today, 2), notesForEditor: null });
    expect(changed.body.students.map((x) => x.id)).toEqual([s.kareem]);
    expect((await s.coach.patch(`/api/videos/${v.id}`, { studentIds: [s.stranger] })).status).toBe(400);
    expect((await s.coach.patch(`/api/videos/${v.id}`, { rawLink: 'file:///etc/passwd' })).status).toBe(400);
    expect((await s.reviewer.patch(`/api/videos/${v.id}`, { title: 'By Moaty' })).status).toBe(200);
    expect((await s.owner.patch(`/api/videos/${v.id}`, { title: 'By the CEO' })).status).toBe(200);
    // Another coach who sees the workshop (classes.all), the director, the editor: not theirs to change.
    const seesAll = await s.t.as(['acting_coach', 'finance'], { name: 'Daniel' });
    expect((await seesAll.patch(`/api/videos/${v.id}`, { title: 'X' })).status).toBe(403);
    expect((await s.director.patch(`/api/videos/${v.id}`, { title: 'X' })).status).toBe(403);
    expect((await s.editor.patch(`/api/videos/${v.id}`, { title: 'X' })).status).toBe(403);
    expect((await seesAll.delete(`/api/videos/${v.id}`)).status).toBe(403);

    await step(s.editor, v.id, 'take');
    const locked = await s.coach.patch<Answer>(`/api/videos/${v.id}`, { title: 'Too late' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('video_locked');
    expect(locked.body.error.details.video.status).toBe('editing');
    expect((await s.coach.delete(`/api/videos/${v.id}`)).status).toBe(409);

    // Deleting a new one: the video, who was in it, its history and its alerts go.
    const other = await newVideo(s);
    expect(alertedIds(s.t, other.id, 'video_new')).toEqual([s.editor.user.id]);
    expect((await s.coach.delete(`/api/videos/${other.id}`)).status).toBe(204);
    expect(s.t.db.select().from(videos).where(eq(videos.id, other.id)).all()).toEqual([]);
    expect(s.t.db.select().from(videoStudents).where(eq(videoStudents.videoId, other.id)).all()).toEqual([]);
    expect(s.t.db.select().from(videoEvents).where(eq(videoEvents.videoId, other.id)).all()).toEqual([]);
    expect(videoAlerts(s.t, other.id)).toEqual([]);
    expect((await s.coach.get(`/api/videos/${other.id}`)).status).toBe(404);
  });
});

/** The editor id on the winning take. */
function t2(takes: { status: number; body: Answer }[]): number | undefined {
  return takes.find((r) => r.status === 200)?.body.editor?.id;
}

// ── Alerts ──────────────────────────────────────────────────────────────────

describe('who is alerted at each step (never the owners unless they act)', () => {
  it('a new video → every active editor who is not an owner, in their language; taken → it leaves every editor’s bell', async () => {
    const s = await school();
    const second = await s.t.as('video_editor', { name: 'Hany' });
    const gone = await s.t.as('video_editor', { name: 'Former editor' });
    s.t.db.update(users).set({ active: false }).where(eq(users.id, gone.user.id)).run();
    const v = await newVideo(s);
    expect(alertedIds(s.t, v.id, 'video_new')).toEqual([s.editor.user.id, second.user.id].sort((a, b) => a - b));
    expect(videoAlerts(s.t, v.id)).toHaveLength(2);
    const ar = (await bell(s.editor)).items[0]!;
    expect(ar).toMatchObject({ kind: 'video_new', title: 'فيديو جديد للمونتاج: Screen Acting I — scene', body: 'من Layla Haddad · Screen Acting I', link: `/videos/${v.id}`, readAt: null });
    expect((await bell(second)).items[0]).toMatchObject({ title: 'New video to edit: Screen Acting I — scene', body: 'Screen Acting I · from Layla Haddad' });
    // Nobody else: not the owner, the director, the reviewer, the coach who added it.
    for (const c of [s.owner, s.director, s.reviewer, s.coach]) expect((await bell(c)).items.filter((n) => n.kind.startsWith('video_')), c.user.name).toEqual([]);

    await step(second, v.id, 'take');
    expect((await bell(s.editor)).unread).toBe(0);
    expect((await bell(second)).unread).toBe(0);
  });

  it('a finished edit → every active reviewer who is not an owner (Moaty) — not the owners, the director, the coach or the editor', async () => {
    const s = await school();
    const another = await s.t.as('video_reviewer', { name: 'Second reviewer', locale: 'ar' });
    const v = await newVideo(s);
    await step(s.editor, v.id, 'take');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    expect(alertedIds(s.t, v.id, 'video_review')).toEqual([s.reviewer.user.id, another.user.id].sort((a, b) => a - b));
    expect((await bell(s.reviewer)).items[0]).toMatchObject({ kind: 'video_review', title: 'Edit ready to check: Screen Acting I — scene', body: 'Screen Acting I · edited by Ali El Gohary', link: `/videos/${v.id}` });
    expect((await bell(another)).items[0]).toMatchObject({ title: 'مونتاج جاهز للمراجعة: Screen Acting I — scene', body: 'المونتاج: Ali El Gohary · Screen Acting I' });
    for (const c of [s.owner, s.director, s.coach]) expect((await bell(c)).items.filter((n) => n.kind === 'video_review')).toEqual([]);
    // One reviewer decides: the alert leaves the other reviewer's bell too.
    await step(another, v.id, 'approve');
    expect((await bell(s.reviewer)).unread).toBe(0);
  });

  it('"needs changes" (and reopening) → the editor who did it; "approved" → the coach who added it', async () => {
    const s = await school();
    const second = await s.t.as('video_editor', { name: 'Hany' });
    const v = await newVideo(s);
    await step(s.editor, v.id, 'take');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    await step(s.reviewer, v.id, 'request-changes', { note: 'Music too loud at 0:42' });
    expect(alertedIds(s.t, v.id, 'video_changes')).toEqual([s.editor.user.id]);
    expect((await bell(s.editor)).items[0]).toMatchObject({ kind: 'video_changes', title: 'مطلوب تعديلات: Screen Acting I — scene', body: 'ملاحظة Moaty: Music too loud at 0:42', readAt: null });
    expect((await bell(second)).items.filter((n) => n.kind === 'video_changes')).toEqual([]);
    // Fixing it reads the alert; the resubmitted edit alerts the reviewer again (one alert per video, moved to the top, unread).
    await step(s.editor, v.id, 'take');
    expect((await bell(s.editor)).unread).toBe(0);
    const firstReview = (await bell(s.reviewer)).items.find((n) => n.kind === 'video_review')!;
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    const review = (await bell(s.reviewer)).items.filter((n) => n.kind === 'video_review');
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ id: firstReview.id, readAt: null });

    await step(s.reviewer, v.id, 'approve');
    expect(alertedIds(s.t, v.id, 'video_approved')).toEqual([s.coach.user.id]);
    expect((await bell(s.coach)).items[0]).toMatchObject({ kind: 'video_approved', title: 'Video approved: Screen Acting I — scene', body: 'Screen Acting I · checked by Moaty', link: `/videos/${v.id}` });

    await step(s.reviewer, v.id, 'reopen', { note: 'Title card misspelt' });
    expect((await bell(s.editor)).items[0]).toMatchObject({ kind: 'video_changes', title: 'أُعيد فتحه، مطلوب تعديلات: Screen Acting I — scene', body: 'ملاحظة Moaty: Title card misspelt', readAt: null });
    for (const c of [s.owner, s.director]) expect((await bell(c)).items.filter((n) => n.kind.startsWith('video_'))).toEqual([]);
  });

  it('owners are alerted only about what they did themselves; nobody is alerted about their own step', async () => {
    const s = await school();
    // The CEO adds a video and later hears it was approved; the editors hear of it as usual.
    const v = (await add(s.owner, { sessionId: s.session.id })).body;
    expect(alertedIds(s.t, v.id, 'video_new')).toEqual([s.editor.user.id]);
    await step(s.editor, v.id, 'take');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    expect(alertedIds(s.t, v.id, 'video_review')).toEqual([s.reviewer.user.id]);
    await step(s.reviewer, v.id, 'approve');
    expect(alertedIds(s.t, v.id, 'video_approved')).toEqual([s.owner.user.id]);
    // Moaty adds one of his own and approves it himself: nobody is told he approved it.
    const own = (await add(s.reviewer, { sessionId: s.session.id })).body;
    await step(s.editor, own.id, 'take');
    await step(s.editor, own.id, 'submit', { editedLink: EDIT });
    await step(s.reviewer, own.id, 'approve');
    expect(alertedIds(s.t, own.id, 'video_approved')).toEqual([]);
  });

  it('changes needed and the editor has left → every active editor who is not an owner', async () => {
    const s = await school();
    const second = await s.t.as('video_editor', { name: 'Hany' });
    const v = await newVideo(s);
    await step(s.editor, v.id, 'take');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    s.t.db.update(users).set({ active: false }).where(eq(users.id, s.editor.user.id)).run();
    await step(s.reviewer, v.id, 'request-changes', { note: 'Shorter' });
    expect(alertedIds(s.t, v.id, 'video_changes')).toEqual([second.user.id]);
  });

  it('pushes: to the same people, in their language, the finished edit waking the phone; never to an owner', async () => {
    const vapid = await generateVapidKeys();
    const push = pushRecorder();
    const s = await school({ config: { vapid }, outboundFetch: push.fetch });
    const phones = {
      editor: await fakeBrowser('https://fcm.googleapis.com/fcm/send/editor'),
      reviewer: await fakeBrowser('https://fcm.googleapis.com/fcm/send/moaty'),
      coach: await fakeBrowser('https://web.push.apple.com/QGrZ-coach'),
      owner: await fakeBrowser('https://fcm.googleapis.com/fcm/send/owner'),
    };
    await s.editor.post('/api/push/subscribe', phones.editor.subscription);
    await s.reviewer.post('/api/push/subscribe', phones.reviewer.subscription);
    await s.coach.post('/api/push/subscribe', phones.coach.subscription);
    await s.owner.post('/api/push/subscribe', phones.owner.subscription);
    const sentTo = () => push.sent.map((p) => p.url);

    const v = await newVideo(s);
    await s.t.settle();
    expect(sentTo()).toEqual([phones.editor.endpoint]);
    expect(await phones.editor.decrypt(push.sent[0]!.body)).toEqual({
      title: 'فيديو جديد للمونتاج: Screen Acting I — scene',
      body: 'من Layla Haddad · Screen Acting I',
      link: `/videos/${v.id}`,
      kind: 'video_new',
      tag: `video-${v.id}`,
    });

    await step(s.editor, v.id, 'take');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    await s.t.settle();
    expect(sentTo().slice(1)).toEqual([phones.reviewer.endpoint]);
    expect(push.sent[1]!.headers.urgency).toBe('high');
    expect(await phones.reviewer.decrypt(push.sent[1]!.body)).toMatchObject({ title: 'Edit ready to check: Screen Acting I — scene', kind: 'video_review', link: `/videos/${v.id}` });

    await step(s.reviewer, v.id, 'approve');
    await s.t.settle();
    expect(sentTo().slice(2)).toEqual([phones.coach.endpoint]);
    expect(await phones.coach.decrypt(push.sent[2]!.body)).toMatchObject({ title: 'Video approved: Screen Acting I — scene', kind: 'video_approved' });
    expect(sentTo()).not.toContain(phones.owner.endpoint);
  });
});

// ── People who change positions, people who hold both ──────────────────────

describe('when the editor no longer edits, or one person holds both positions', () => {
  it('the Video editor position taken away, the account kept: the video they were editing goes to the other editors', async () => {
    const s = await school();
    const hany = await s.t.as('video_editor', { name: 'Hany' });
    const moved = await s.t.as('video_editor', { name: 'Ed Three' });
    const v = await newVideo(s);
    expect((await step(moved, v.id, 'take')).status).toBe(200);
    expect((await step(hany, v.id, 'take')).status).toBe(409);
    await moveToPositions(s, moved.user.id, ['reception']);
    // He can't hand it in any more; nobody else was able to move it before — now any other editor takes it over.
    expect((await step(moved, v.id, 'submit', { editedLink: EDIT })).status).toBe(403);
    const seen = (await hany.get<VideoDetail>(`/api/videos/${v.id}`)).body;
    expect(seen).toMatchObject({ status: 'editing', editor: { id: moved.user.id, active: true }, editorCanEdit: false });
    const over = await step(hany, v.id, 'take');
    expect(over.status).toBe(200);
    expect(over.body).toMatchObject({ status: 'editing', editor: { id: hany.user.id }, editorCanEdit: true });
    expect((await step(s.editor, v.id, 'take')).status).toBe(409);
    expect((await step(hany, v.id, 'submit', { editedLink: EDIT })).status).toBe(200);
  });

  it('"needs changes" on an edit by someone who no longer edits → the editors who can act; his old video alerts leave his bell', async () => {
    const s = await school();
    const hany = await s.t.as('video_editor', { name: 'Hany' });
    const moved = await s.t.as('video_editor', { name: 'Ed Four' });
    const v = await newVideo(s);
    await step(moved, v.id, 'take');
    await step(moved, v.id, 'submit', { editedLink: EDIT });
    const waiting = await newVideo(s, { title: 'Still new' });
    expect(alertedIds(s.t, waiting.id, 'video_new')).toContain(moved.user.id);
    expect((await poll(moved))!.toEdit).toBe(1);
    await moveToPositions(s, moved.user.id, ['reception']);

    expect((await step(s.reviewer, v.id, 'request-changes', { note: 'Shorter please' })).body.told.map((p) => p.id).sort((a, b) => a - b)).toEqual(
      [s.editor.user.id, hany.user.id].sort((a, b) => a - b),
    );
    expect(alertedIds(s.t, v.id, 'video_changes')).toEqual([s.editor.user.id, hany.user.id].sort((a, b) => a - b));
    // Reception sees no videos: no alert that only opens "No access", and none counted on the bell.
    expect((await bell(moved)).items.filter((n) => n.kind.startsWith('video_'))).toEqual([]);
    expect((await moved.get<ChatUnreadResponse>('/api/chat/unread')).body).toMatchObject({ notifications: 0, videos: null });
    // Hany takes it ("Start fixing") and sends it again.
    expect((await step(hany, v.id, 'take')).status).toBe(200);
    expect((await step(hany, v.id, 'submit', { editedLink: EDIT })).status).toBe(200);
    // Reopening later goes to Hany, who can still edit.
    await step(s.reviewer, v.id, 'approve');
    await step(s.reviewer, v.id, 'reopen', { note: 'One more thing' });
    expect(
      videoAlerts(s.t, v.id)
        .filter((n) => n.kind === 'video_changes' && n.readAt === null)
        .map((n) => n.userId),
    ).toEqual([hany.user.id]);
  });

  it('each video alert shows only to someone still doing that part: a coach who stops adding keeps no "approved" alert', async () => {
    const s = await school();
    const v = await newVideo(s);
    await step(s.editor, v.id, 'take');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    await step(s.reviewer, v.id, 'approve');
    expect((await bell(s.coach)).items.map((n) => n.kind)).toContain('video_approved');
    await moveToPositions(s, s.coach.user.id, ['casting_team']);
    expect((await bell(s.coach)).items.filter((n) => n.kind.startsWith('video_'))).toEqual([]);
    // Moaty without the Video reviewer position: his "to check" alerts are hidden.
    const w = (await add(s.owner, { sessionId: s.session.id })).body;
    await step(s.editor, w.id, 'take');
    await step(s.editor, w.id, 'submit', { editedLink: EDIT });
    expect((await bell(s.reviewer)).items.map((n) => n.kind)).toContain('video_review');
    await moveToPositions(s, s.reviewer.user.id, ['acting_coach', 'finance']);
    expect((await bell(s.reviewer)).items.filter((n) => n.kind === 'video_review')).toEqual([]);
  });

  it('someone holding both Video editor and Video reviewer never checks their own edit: Moaty is asked, and his alert stays', async () => {
    const s = await school();
    const both = await s.t.as(['video_editor', 'video_reviewer'], { name: 'Both Roles' });
    const v = await newVideo(s);
    await step(both, v.id, 'take');
    const sent = await step(both, v.id, 'submit', { editedLink: EDIT });
    expect(sent.status).toBe(200);
    // Moaty is told; the editor himself is not.
    expect(sent.body.told.map((p) => p.id)).toEqual([s.reviewer.user.id]);
    expect(alertedIds(s.t, v.id, 'video_review')).toEqual([s.reviewer.user.id]);
    for (const action of ['approve', 'request-changes'] as const) {
      const refused = await step(both, v.id, action, action === 'approve' ? undefined : { note: 'Fine' });
      expect(refused.status, action).toBe(403);
      expect(refused.body.error.code).toBe('own_edit');
    }
    // Nothing moved, and Moaty's "Edit ready to check" is still waiting for him.
    expect((await both.get<VideoDetail>(`/api/videos/${v.id}`)).body.status).toBe('in_review');
    expect((await bell(s.reviewer)).items.find((n) => n.kind === 'video_review')).toMatchObject({ readAt: null });
    expect((await step(s.reviewer, v.id, 'approve')).status).toBe(200);
    // On a video someone else edited, he checks like any reviewer.
    const w = await newVideo(s);
    await step(s.editor, w.id, 'take');
    await step(s.editor, w.id, 'submit', { editedLink: EDIT });
    expect((await step(both, w.id, 'approve')).status).toBe(200);
    // An owner may finish what they edited themselves.
    const x = await newVideo(s);
    await step(s.owner, x.id, 'take');
    await step(s.owner, x.id, 'submit', { editedLink: EDIT });
    expect((await step(s.owner, x.id, 'approve')).status).toBe(200);
  });

  it('every step answers who was told — none when nobody checks edits yet (no Video reviewer), which the editors and the owners see in the poll', async () => {
    const s = await school();
    const v = await newVideo(s);
    const added = (await s.t.db.select().from(videos).where(eq(videos.id, v.id)).get())!;
    expect(added.status).toBe('new');
    expect((v as unknown as VideoStepResult).told).toEqual([expect.objectContaining({ id: s.editor.user.id, name: 'Ali El Gohary' })]);
    expect((await step(s.editor, v.id, 'take')).body.told).toEqual([]);
    expect((await step(s.editor, v.id, 'submit', { editedLink: EDIT })).body.told).toEqual([expect.objectContaining({ id: s.reviewer.user.id, name: 'Moaty' })]);
    expect((await step(s.reviewer, v.id, 'request-changes', { note: 'Again' })).body.told.map((p) => p.id)).toEqual([s.editor.user.id]);
    await step(s.editor, v.id, 'take');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    expect((await step(s.reviewer, v.id, 'approve')).body.told.map((p) => p.id)).toEqual([s.coach.user.id]);

    // The live school before an owner gives Moaty the Video reviewer position: nobody checks.
    await moveToPositions(s, s.reviewer.user.id, ['acting_coach', 'finance']);
    expect((await poll(s.editor))!.reviewers).toBe(0);
    expect((await poll(s.owner))!.reviewers).toBe(0);
    expect((await poll(s.coach))!.reviewers).toBeNull();
    const w = await newVideo(s);
    await step(s.editor, w.id, 'take');
    const unseen = await step(s.editor, w.id, 'submit', { editedLink: EDIT });
    expect(unseen.status).toBe(200);
    expect(unseen.body.told).toEqual([]);
    expect(alertedIds(s.t, w.id, 'video_review')).toEqual([]);
  });
});

// ── Comments ────────────────────────────────────────────────────────────────

describe('comments in the history', () => {
  it('the coach who added it, the editors, the reviewers and owners comment; others who only see the video don’t', async () => {
    const s = await school();
    const v = await newVideo(s);
    for (const [client, note] of [
      [s.editor, 'The link asks for access — can you share it?'],
      [s.coach, 'Shared now, sorry!'],
      [s.reviewer, 'Thanks both'],
      [s.owner, 'Nice scene'],
    ] as const) {
      const res = await step(client, v.id, 'comments', { note });
      expect(res.status, note).toBe(201);
      expect(res.body as unknown as VideoEvent).toMatchObject({ type: 'comment', note, link: null, by: { id: client.user.id } });
    }
    // The director (videos.read: seeing only) and another coach who sees every workshop are not part of this video.
    const seesAll = await s.t.as(['acting_coach', 'finance']);
    expect((await step(s.director, v.id, 'comments', { note: 'Hello' })).status).toBe(403);
    expect((await step(seesAll, v.id, 'comments', { note: 'Hello' })).status).toBe(403);
    expect((await step(s.coach, v.id, 'comments', { note: '' })).status).toBe(400);
    expect((await step(s.coach, v.id, 'comments', { note: 'x'.repeat(1001) })).status).toBe(400);
    const events = (await s.director.get<VideoDetail>(`/api/videos/${v.id}`)).body.events;
    expect(events.map((e) => e.type)).toEqual(['added', 'comment', 'comment', 'comment', 'comment']);
    // Comments don't alert anyone and don't move the video.
    expect(videoAlerts(s.t, v.id).filter((n) => n.kind !== 'video_new')).toEqual([]);
    expect((await s.coach.get<VideoDetail>(`/api/videos/${v.id}`)).body.status).toBe('new');
  });
});

// ── Lists and counts ────────────────────────────────────────────────────────

describe('the queue and the counts in the poll', () => {
  it('lists: by status (one or several), mine; open first by due date, approved after them, newest first', async () => {
    const s = await school();
    const later = await newVideo(s, { title: 'Later', dueOn: addDays(s.today, 3) });
    const sooner = await newVideo(s, { title: 'Sooner', dueOn: addDays(s.today, -1) });
    const a = await newVideo(s, { title: 'A' });
    const b = await newVideo(s, { title: 'B' });
    for (const v of [a, b]) {
      await step(s.editor, v.id, 'take');
      await step(s.editor, v.id, 'submit', { editedLink: EDIT });
      await step(s.reviewer, v.id, 'approve');
    }
    const titles = async (q: string, c: Client = s.editor) => (await c.get<{ items: Video[] }>(`/api/videos${q}`)).body.items.map((v) => v.title);
    expect(await titles('')).toEqual(['Sooner', 'Later', 'B', 'A']);
    expect(await titles('?status=approved')).toEqual(['B', 'A']);
    expect(await titles('?status=new,changes_requested')).toEqual(['Sooner', 'Later']);
    expect(await titles('?mine=1')).toEqual(['B', 'A']);
    expect(await titles('?mine=1', s.coach)).toEqual(['Sooner', 'Later', 'B', 'A']);
    expect(await titles('?mine=1', s.otherCoach)).toEqual([]);
    expect(later.id).toBeLessThan(sooner.id);
  });

  it('the poll: the editor’s to edit (due today, late), the reviewer’s to check, the coach’s approved this week; owners get no work counts; others null', async () => {
    const s = await school();
    const empty = { toEdit: null, dueToday: null, late: null, toCheck: null, addedByMe: 0, addedOpen: 0, approvedThisWeek: 0, reviewers: null };
    // How many check the edits (Moaty): for the editors and for whoever gives positions (owners, staff.manage) — not for coaches.
    expect(await poll(s.editor)).toEqual({ ...empty, toEdit: 0, dueToday: 0, late: 0, reviewers: 1 });
    expect(await poll(s.reviewer)).toEqual({ ...empty, toCheck: 0 });
    expect(await poll(s.coach)).toEqual(empty);
    expect(await poll(s.owner)).toEqual({ ...empty, reviewers: 1 });
    expect(await poll(s.director)).toEqual({ ...empty, reviewers: 1 });
    expect(await poll(await s.t.as('casting_team'))).toBeNull();

    await newVideo(s, { dueOn: s.today });
    await newVideo(s, { dueOn: addDays(s.today, -2) });
    const v = await newVideo(s);
    const sent = await newVideo(s);
    expect(await poll(s.editor)).toMatchObject({ toEdit: 4, dueToday: 1, late: 1 });
    await step(s.editor, v.id, 'take');
    await step(s.editor, v.id, 'submit', { editedLink: EDIT });
    await step(s.editor, sent.id, 'take');
    await step(s.editor, sent.id, 'submit', { editedLink: EDIT });
    await step(s.reviewer, sent.id, 'request-changes', { note: 'Again' });
    expect(await poll(s.editor)).toMatchObject({ toEdit: 3, toCheck: null });
    expect(await poll(s.reviewer)).toMatchObject({ toCheck: 1, toEdit: null });
    expect(await poll(s.coach)).toEqual({ ...empty, addedByMe: 4, addedOpen: 4, approvedThisWeek: 0 });
    await step(s.reviewer, v.id, 'approve');
    expect(await poll(s.coach)).toEqual({ ...empty, addedByMe: 4, addedOpen: 3, approvedThisWeek: 1 });
    expect(await poll(s.owner)).toEqual({ ...empty, reviewers: 1 });
    // "This week" is the school's week: approved before it began doesn't count.
    const weekStart = epochAt(SCHOOL_TZ, startOfWeek(s.today, 1));
    s.t.db.update(videos).set({ decidedAt: weekStart - 1 }).where(eq(videos.id, v.id)).run();
    expect((await poll(s.coach))!.approvedThisWeek).toBe(0);
  });
});

// ── Sessions and workshops ──────────────────────────────────────────────────

describe('videos and the sessions they come from', () => {
  it('a session with a video is kept when the schedule changes; a deleted session leaves the video on the workshop; a deleted workshop takes its videos', async () => {
    const s = await school();
    const tomorrowish = s.screen.sessions.find((x) => x.date > s.today)!;
    const v = await newVideo(s, { sessionId: tomorrowish.id });
    // Move the weekly slot to another time: generated upcoming sessions are replaced — not this one.
    expect((await s.owner.patch(`/api/courses/${s.screen.id}`, { schedule: [{ weekday: weekdayOf(s.today), startTime: '10:00', endTime: '12:00' }] })).status).toBe(200);
    expect(s.t.db.select().from(classSessions).where(eq(classSessions.id, tomorrowish.id)).get()).toBeTruthy();
    expect((await s.owner.delete(`/api/sessions/${tomorrowish.id}`)).status).toBe(204);
    expect((await s.coach.get<VideoDetail>(`/api/videos/${v.id}`)).body).toMatchObject({ sessionId: null, courseId: s.screen.id });
    // Its alerts go with it: nothing left in a bell that would open a page that is gone.
    const waiting = (await add(s.coach, { courseId: s.screen.id })).body;
    expect((await bell(s.editor)).items.map((n) => n.link)).toContain(`/videos/${waiting.id}`);
    expect((await s.owner.delete(`/api/courses/${s.screen.id}`)).status).toBe(204);
    expect(s.t.db.select().from(videos).all()).toEqual([]);
    expect(s.t.db.select().from(videoEvents).all()).toEqual([]);
    expect(s.t.db.select().from(notifications).all().filter((n) => n.link?.startsWith('/videos/'))).toEqual([]);
    expect((await bell(s.editor)).unread).toBe(0);
  });
});
