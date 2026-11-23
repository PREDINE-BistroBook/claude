/**
 * Demo data for trying the app, on either runtime: `npm run seed` on the Node
 * server (db/seed.ts, password demo1234), POST /api/admin/seed-demo on
 * Cloudflare (routes/admin.ts, with a password the operator chooses).
 *
 * Everything goes through the real API (createApp + app.request), signed in as
 * the people who would do it, so the data obeys the same rules as the app. The
 * exceptions are timestamps the API always sets to "now" and can't backdate:
 * after enrolling we set `enrolled_on` to when the student really joined
 * (otherwise the past sessions would have nobody on their roster), and the
 * admissions story's leads, timeline entries and interview records get the
 * date each step happened (otherwise every lead would be "new this week").
 *
 * Dates are relative to today, so the demo always looks current.
 *
 * Logins (usernames; one password for all) — fictional people in the school's real positions.
 * Each also has the address <username>@demo.school, which signs in just the same:
 *   owner     CEO                      (Karim Mansour)
 *   cfo       CFO                      (Hisham Mansour)
 *   director  Executive Director       (Dalia Fathy)
 *   head      Head of Casting          (Sherif Adel)
 *   casting   Casting team             (Tarek Samir)
 *   editor    Video editor             (Hany Nabil)
 *   coach     Acting coach             (Layla Haddad — teaches classes)
 *   coach2    Acting coach + Finance + Video reviewer (Daniel Price — teaches classes, checks the edits)
 *   reception Reception                (Nour Hassan — no section yet: Team, Messages, the cafeteria)
 *   helper    Office helper            (Sayed Ramadan — the cafeteria's orders board; his account is in Arabic)
 *   tom       former Acting coach, deactivated (tom.wilkins@demo.school)
 *
 * The demo accounts are not asked to choose their own password at the first
 * sign-in (the API marks every password a manager sets as temporary; the seed
 * clears that mark): a demo is signed into by many people with the one password.
 */
import { and, asc, eq, gt, gte, inArray, isNotNull, max } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { addDays, weekdayOf } from '../../shared/dates';
import type {
  AttendanceStatus,
  CourseLevel,
  Gender,
  InterviewRecommendation,
  LeadContactType,
  LeadLostReason,
  LeadSource,
  LeadStatus,
  SubmissionStatus,
} from '../../shared/enums';
import type { Interview, LeadDetail } from '../../shared/schemas/admissions';
import type { BuiltInPositionKey } from '../../shared/permissions';
import type { CafeItem } from '../../shared/schemas/cafe';
import type { CourseDetail, CourseEnrollment } from '../../shared/schemas/courses';
import type { Position } from '../../shared/schemas/positions';
import type { SeedDemoResult, SeedDemoWebsiteResult } from '../../shared/schemas/admin';
import { castingApplicationInput } from '../../shared/schemas/castingApplications';
import { siteApplyInput, type SiteContentParsed } from '../../shared/schemas/site';
import { createWebsiteLead } from '../lib/admissions';
import { createCastingApplication } from '../lib/castingApplications';
import { cafeBoardLink, cafeOrderLink } from '../lib/cafe';
import { epochAt, todayIn } from '../lib/clock';
import type { FileStore } from '../lib/fileStore';
import { summonsInboxLink, summonsLink } from '../lib/notifications';
import { findPublicWorkshop, saveSiteContent } from '../lib/siteContent';
import type { DB } from './database';
import {
  cafeOrders,
  castingApplications,
  castingOpportunities,
  conversations,
  courses,
  enrollments,
  files as filesTable,
  interviews,
  leadActivities,
  leads,
  messages,
  notifications,
  siteCoaches,
  siteWorkshops,
  summons,
  users,
  videoEvents,
  videos,
} from './schema';
import { renderPdf } from './seedDocuments';
import { lookFor, renderPortrait } from './seedPortraits';

/** The seeded sign-ins (active accounts), in the order the CLI prints them. */
export const DEMO_LOGINS: SeedDemoResult['logins'] = [
  { username: 'owner', email: 'owner@demo.school', position: 'CEO', name: 'Karim Mansour' },
  { username: 'cfo', email: 'cfo@demo.school', position: 'CFO', name: 'Hisham Mansour' },
  { username: 'director', email: 'director@demo.school', position: 'Executive Director', name: 'Dalia Fathy' },
  { username: 'head', email: 'head@demo.school', position: 'Head of Casting', name: 'Sherif Adel' },
  { username: 'casting', email: 'casting@demo.school', position: 'Casting team', name: 'Tarek Samir' },
  { username: 'editor', email: 'editor@demo.school', position: 'Video editor', name: 'Hany Nabil' },
  { username: 'coach', email: 'coach@demo.school', position: 'Acting coach', name: 'Layla Haddad' },
  { username: 'coach2', email: 'coach2@demo.school', position: 'Acting coach + Finance + Video reviewer', name: 'Daniel Price' },
  { username: 'reception', email: 'reception@demo.school', position: 'Reception', name: 'Nour Hassan' },
  { username: 'helper', email: 'helper@demo.school', position: 'Office helper', name: 'Sayed Ramadan' },
];

/**
 * A seeded moment that must fall on the school's today — the coffee "delivered
 * 68 minutes ago", a video "approved this morning", an enquiry from today:
 * `minutes` before `now`, unless the seed runs so soon after the school's
 * midnight (`dayStart`) that it would land on yesterday (between 00:00 and
 * about 01:16 Cairo time for "75 minutes ago" — which broke cf:smoke's "one
 * delivered today"). Then the moments of the group, up to `longest` minutes
 * ago, are squeezed in the same order between the school's midnight + 1 minute
 * (half the time since midnight in its first two minutes) and now: on today,
 * never in the future, in order.
 */
export function onSchoolToday(now: number, dayStart: number, minutes: number, longest = minutes): number {
  const lo = dayStart + Math.min(60_000, Math.max(0, now - dayStart) / 2);
  if (now - longest * 60_000 >= lo) return now - minutes * 60_000;
  return Math.round(now - (longest > 0 ? minutes / longest : 0) * (now - lo));
}

/** `minutes` ago, kept on the school's today in `timeZone` (onSchoolToday). */
export function schoolTodayAgo(timeZone: string, minutes: number, longest = minutes, now = Date.now()): number {
  return onSchoolToday(now, epochAt(timeZone, todayIn(timeZone, new Date(now))), minutes, longest);
}

export interface SeedDemoOptions {
  /** An empty database (no staff yet): the caller checks. */
  db: DB;
  /** The app's FileStore: the website demo stores its photos directly (seedDemoWebsite). */
  files: FileStore;
  /** The app itself (createApp(...).request): every step goes through the real API. */
  request: (path: string, init: RequestInit) => Response | Promise<Response>;
  /** Password of every seeded account. */
  password: string;
  /** The school's time zone: "today" for the relative dates and the backdated timestamps. */
  timeZone: string;
  /** "YYYY-MM-DD" to seed as if it were that day (tests); default today in timeZone. */
  today?: string;
  /** The setup code (ADMIN_TOKEN), where first-run setup asks for it (AppConfig.requireSetupCode — Cloudflare). */
  setupCode?: string;
}

/** Fill an empty database with the demo school. Dates are relative to today, so the demo always looks current. */
export async function seedDemo(opts: SeedDemoOptions): Promise<SeedDemoResult> {
  const { db, request, password: PASSWORD, timeZone } = opts;
  const started = Date.now();

  // ── A tiny API client ───────────────────────────────────────────────────────

  type Cookie = string;

  async function call<T = any>(cookie: Cookie | null, method: string, url: string, payload?: unknown): Promise<{ body: T; cookie: Cookie | null }> {
    const headers: Record<string, string> = { 'x-requested-with': 'seed' };
    if (cookie) headers.cookie = cookie;
    let reqBody: BodyInit | undefined;
    if (payload instanceof FormData) reqBody = payload;
    else if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      reqBody = JSON.stringify(payload);
    }
    const res = await request(`/api${url}`, { method, headers, body: reqBody });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`${method} ${url} → ${res.status} ${text}`);
    const setCookie = res.headers.get('set-cookie');
    return { body: (text ? JSON.parse(text) : null) as T, cookie: setCookie ? setCookie.split(';')[0]! : null };
  }

  function as(cookie: Cookie) {
    return {
      get: <T = any>(url: string) => call<T>(cookie, 'GET', url).then((r) => r.body),
      post: <T = any>(url: string, body?: unknown) => call<T>(cookie, 'POST', url, body).then((r) => r.body),
      patch: <T = any>(url: string, body?: unknown) => call<T>(cookie, 'PATCH', url, body).then((r) => r.body),
      put: <T = any>(url: string, body?: unknown) => call<T>(cookie, 'PUT', url, body).then((r) => r.body),
    };
  }

  async function login(username: string) {
    const { cookie } = await call(null, 'POST', '/auth/login', { username, password: PASSWORD });
    return as(cookie!);
  }

  /** Small deterministic PRNG so every seeded database looks the same. */
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = rng(20261122);

  const today = opts.today ?? todayIn(timeZone);
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  /** Date of birth for someone who is `age` today, born on month/day `md` ("MM-DD"). */
  function dob(age: number, md: string): string {
    const [m, d] = md.split('-').map(Number) as [number, number];
    const hadBirthday = m < tm || (m === tm && d <= td);
    return `${ty - age - (hadBirthday ? 0 : 1)}-${md}`;
  }
  /** The first date on or after `from` that falls on `weekday` (0 Sun … 6 Sat). */
  function nextWeekday(from: string, weekday: number): string {
    return addDays(from, (weekday - weekdayOf(from) + 7) % 7);
  }

  /** Each person gets their own look; `variant` is a second/third shot of the same person. */
  const people = new Map<string, number>();
  async function uploadPortrait(client: ReturnType<typeof as>, who: string, gender: Gender | null, hair: string | null, variant = 0): Promise<string> {
    if (!people.has(who)) people.set(who, people.size);
    const png = renderPortrait(lookFor(people.get(who)!, gender, { hair, variant }));
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), `${who}-${variant + 1}.png`);
    const res = await client.post<{ id: string }>('/files', form);
    return res.id;
  }

  // ── 1. The school and its staff ─────────────────────────────────────────────

  const setup = await call(null, 'POST', '/auth/setup', {
    schoolName: 'Turquoise Studio',
    schoolNameAr: 'استوديو تركواز',
    name: 'Karim Mansour',
    username: 'owner',
    email: 'owner@demo.school',
    password: PASSWORD,
    locale: 'en',
    ...(opts.setupCode ? { setupCode: opts.setupCode } : {}),
  });
  const owner = as(setup.cookie!);
  const setupOwnerId: number = setup.body.user.id;
  await owner.patch('/settings', { weekStartsOn: 1, defaultLocale: 'en' });

  // The built-in positions exist from the start; staff are given them by key.
  const positionIds = Object.fromEntries((await owner.get<{ items: Position[] }>('/positions')).items.map((p) => [p.key, p.id])) as Record<BuiltInPositionKey, number>;

  const staffSpec: { key: string; name: string; username: string; email: string; positions: BuiltInPositionKey[]; phone: string | null; locale?: 'ar' | 'en' }[] = [
    { key: 'cfo', name: 'Hisham Mansour', username: 'cfo', email: 'cfo@demo.school', positions: ['cfo'], phone: '+20 100 555 0100' },
    { key: 'director', name: 'Dalia Fathy', username: 'director', email: 'director@demo.school', positions: ['executive_director'], phone: '+20 100 555 0101' },
    { key: 'head', name: 'Sherif Adel', username: 'head', email: 'head@demo.school', positions: ['head_of_casting'], phone: '+20 100 555 0104', locale: 'ar' },
    { key: 'casting', name: 'Tarek Samir', username: 'casting', email: 'casting@demo.school', positions: ['casting_team'], phone: '+20 100 555 0105' },
    { key: 'editor', name: 'Hany Nabil', username: 'editor', email: 'editor@demo.school', positions: ['video_editor'], phone: '+20 100 555 0106' },
    { key: 'layla', name: 'Layla Haddad', username: 'coach', email: 'coach@demo.school', positions: ['acting_coach'], phone: '+20 100 555 0102' },
    // Coaches, keeps the books and checks every finished video edit (one person, three positions: their permissions add up — like Moaty).
    { key: 'daniel', name: 'Daniel Price', username: 'coach2', email: 'coach2@demo.school', positions: ['acting_coach', 'finance', 'video_reviewer'], phone: '+20 100 555 0103' },
    // Reception has no section yet (the school will say what it does); the Office helper runs the cafeteria, in Arabic.
    { key: 'reception', name: 'Nour Hassan', username: 'reception', email: 'reception@demo.school', positions: ['reception'], phone: '+20 100 555 0107' },
    { key: 'helper', name: 'Sayed Ramadan', username: 'helper', email: 'helper@demo.school', positions: ['office_helper'], phone: '+20 100 555 0108', locale: 'ar' },
    // Taught the (now archived) Shakespeare course; deactivated at the end.
    { key: 'tom', name: 'Tom Wilkins', username: 'tom', email: 'tom.wilkins@demo.school', positions: ['acting_coach'], phone: null },
  ];
  const staff: Record<string, number> = {};
  for (const s of staffSpec) {
    const { key, positions, ...input } = s;
    const created = await owner.post<{ id: number }>('/staff', { ...input, positionIds: positions.map((k) => positionIds[k]), password: PASSWORD });
    staff[key] = created.id;
  }
  // A password a manager sets is temporary: the API would have each of these people choose their own
  // at the first sign-in, and open nothing until they did. A demo is one shared password, so the mark
  // comes off (the one thing here the API has no way to say).
  db.update(users).set({ mustChangePassword: false }).run();

  // ── 2. Students ─────────────────────────────────────────────────────────────

  interface StudentSpec {
    key: string;
    first: string;
    last: string;
    gender: Gender;
    age: number;
    md: string;
    status?: 'prospect' | 'active' | 'paused' | 'alumni';
    email?: string;
    phone?: string;
    guardian?: [name: string, phone: string, email?: string];
    emergency?: [name: string, phone: string];
    consent?: boolean;
    photo?: boolean;
    notes?: string;
    joinedDaysAgo: number;
  }

  const studentSpec: StudentSpec[] = [
    { key: 'maya', first: 'Maya', last: 'Collins', gender: 'female', age: 24, md: '03-14', email: 'maya.collins@example.com', phone: '+20 101 234 5501', consent: true, photo: true, joinedDaysAgo: 400, emergency: ['James Collins', '+44 7700 900123'] },
    { key: 'youssef', first: 'يوسف', last: 'حسن', gender: 'male', age: 19, md: '07-02', email: 'youssef.hassan@example.com', phone: '+20 102 345 6602', joinedDaysAgo: 120 },
    { key: 'noor', first: 'Noor', last: 'Al-Masri', gender: 'female', age: 16, md: '01-21', phone: '+20 103 456 7703', guardian: ['Hala Al-Masri', '+20 100 777 1203', 'hala.almasri@example.com'], consent: true, photo: true, joinedDaysAgo: 300 },
    { key: 'ethan', first: 'Ethan', last: 'Brooks', gender: 'male', age: 27, md: '11-30', email: 'ethan.brooks@example.com', phone: '+20 104 567 8804', consent: true, photo: true, joinedDaysAgo: 520 },
    { key: 'salma', first: 'سلمى', last: 'إبراهيم', gender: 'female', age: 22, md: '05-09', email: 'salma.ibrahim@example.com', phone: '+20 105 678 9905', consent: true, photo: true, joinedDaysAgo: 210 },
    { key: 'adam', first: 'Adam', last: 'Mansour', gender: 'male', age: 11, md: '09-17', guardian: ['Karim Mansour', '+20 106 111 2206', 'karim.mansour@example.com'], emergency: ['Dalia Mansour', '+20 106 111 2207'], consent: true, joinedDaysAgo: 90 },
    { key: 'lina', first: 'Lina', last: 'Khoury', gender: 'female', age: 10, md: '04-03', guardian: ['Rana Khoury', '+20 107 222 3307'], joinedDaysAgo: 60, notes: 'Shy at first — warms up fast in pair work.\nAllergic to peanuts (snacks at the Saturday break).' },
    { key: 'oliver', first: 'Oliver', last: 'Grant', gender: 'male', age: 31, md: '12-08', email: 'oliver.grant@example.com', phone: '+44 7700 900456', joinedDaysAgo: 75 },
    { key: 'maryam', first: 'مريم', last: 'عادل', gender: 'female', age: 9, md: '06-25', guardian: ['عادل محمود', '+20 108 333 4409'], consent: true, joinedDaysAgo: 50 },
    { key: 'zain', first: 'Zain', last: 'Haddad', gender: 'male', age: 12, md: '02-11', guardian: ['Samir Haddad', '+20 109 444 5510', 'samir.haddad@example.com'], joinedDaysAgo: 100 },
    { key: 'chloe', first: 'Chloe', last: 'Bennett', gender: 'female', age: 20, md: '08-19', email: 'chloe.bennett@example.com', phone: '+20 110 555 6611', consent: true, photo: true, joinedDaysAgo: 160 },
    { key: 'kareem', first: 'كريم', last: 'سعيد', gender: 'male', age: 25, md: '10-05', email: 'kareem.saeed@example.com', phone: '+20 111 666 7712', consent: true, photo: true, joinedDaysAgo: 240 },
    { key: 'hana', first: 'Hana', last: 'Yousef', gender: 'female', age: 17, md: '12-27', phone: '+20 112 777 8813', guardian: ['Mona Yousef', '+20 112 777 8800'], joinedDaysAgo: 45 },
    { key: 'jack', first: 'Jack', last: 'Turner', gender: 'male', age: 34, md: '03-30', email: 'jack.turner@example.com', phone: '+20 114 888 9914', status: 'paused', joinedDaysAgo: 330, notes: 'On a three-month contract abroad; back in February.' },
    { key: 'farah', first: 'فرح', last: 'ناصر', gender: 'female', age: 21, md: '01-08', email: 'farah.nasser@example.com', phone: '+20 115 999 0015', joinedDaysAgo: 70 },
    { key: 'sami', first: 'Sami', last: 'Darwish', gender: 'male', age: 8, md: '05-30', guardian: ['Rasha Darwish', '+20 120 101 0116'], joinedDaysAgo: 42 },
    { key: 'grace', first: 'Grace', last: 'Miller', gender: 'female', age: 28, md: '09-01', email: 'grace.miller@example.com', phone: '+20 121 202 0217', consent: true, photo: true, joinedDaysAgo: 450 },
    { key: 'tariq', first: 'Tariq', last: 'Saleh', gender: 'male', age: 23, md: '07-14', email: 'tariq.saleh@example.com', phone: '+20 122 303 0318', status: 'prospect', joinedDaysAgo: 3, notes: 'Came to the open day. Interested in Screen Acting I next term.' },
    { key: 'layan', first: 'ليان', last: 'مصطفى', gender: 'female', age: 11, md: '11-11', guardian: ['مصطفى علي', '+20 123 404 0419'], consent: true, joinedDaysAgo: 42 },
    { key: 'isabella', first: 'Isabella', last: 'Reyes', gender: 'female', age: 26, md: '02-28', email: 'isabella.reyes@example.com', phone: '+20 124 505 0520', joinedDaysAgo: 140 },
    { key: 'ali', first: 'Ali', last: 'Hamdan', gender: 'male', age: 29, md: '04-22', email: 'ali.hamdan@example.com', phone: '+20 125 606 0621', status: 'alumni', joinedDaysAgo: 700 },
    { key: 'rami', first: 'Rami', last: 'Aziz', gender: 'male', age: 18, md: '06-06', email: 'rami.aziz@example.com', phone: '+20 127 707 0722', joinedDaysAgo: 80 },
    { key: 'sophie', first: 'Sophie', last: 'Clarke', gender: 'female', age: 15, md: '10-29', guardian: ['Helen Clarke', '+44 7700 900789', 'helen.clarke@example.com'], status: 'prospect', joinedDaysAgo: 5 },
    { key: 'nadine', first: 'نادين', last: 'فؤاد', gender: 'female', age: 30, md: '08-08', email: 'nadine.fouad@example.com', phone: '+20 128 808 0824', consent: true, joinedDaysAgo: 180 },
  ];

  /** Hair of the students who have a photo (the same as on their talent profile below). */
  const hairOf: Record<string, string> = { maya: 'Auburn', noor: 'Black', ethan: 'Brown', salma: 'Dark brown', chloe: 'Blonde', kareem: 'Black', grace: 'Red' };

  const studentIds: Record<string, number> = {};
  const studentPhotos: Record<string, string> = {};
  const studentInfo: Record<string, StudentSpec> = {};
  for (const s of studentSpec) {
    let photoFileId: string | null = null;
    if (s.photo) photoFileId = studentPhotos[s.key] = await uploadPortrait(owner, s.key, s.gender, hairOf[s.key] ?? null);
    const created = await owner.post<{ id: number }>('/students', {
      firstName: s.first,
      lastName: s.last,
      gender: s.gender,
      dateOfBirth: dob(s.age, s.md),
      status: s.status ?? 'active',
      joinedOn: addDays(today, -s.joinedDaysAgo),
      email: s.email ?? null,
      phone: s.phone ?? null,
      guardianName: s.guardian?.[0] ?? null,
      guardianPhone: s.guardian?.[1] ?? null,
      guardianEmail: s.guardian?.[2] ?? null,
      emergencyName: s.emergency?.[0] ?? null,
      emergencyPhone: s.emergency?.[1] ?? null,
      mediaConsent: s.consent ?? false,
      photoFileId,
      notes: s.notes ?? null,
    });
    studentIds[s.key] = created.id;
    studentInfo[s.key] = s;
  }

  // ── 3. Classes, enrolments, attendance ──────────────────────────────────────

  const layla = await login('coach');
  const daniel = await login('coach2');
  const teacherClient: Record<number, ReturnType<typeof as>> = { [staff.layla]: layla, [staff.daniel]: daniel };

  interface CourseSpec {
    key: string;
    name: string;
    description: string;
    level: 'beginner' | 'intermediate' | 'advanced' | 'all_levels';
    teacher: keyof typeof staff;
    room: string;
    capacity: number | null;
    color: string;
    schedule: { weekday: number; startTime: string; endTime: string }[];
    start: string;
    end: string;
    status?: 'archived';
    /** Student keys; `[key, daysAfterStart]` for someone who joined later. */
    students: (string | [string, number])[];
  }

  const termStart = addDays(today, -42);
  const termEnd = addDays(today, 56);
  const courseSpec: CourseSpec[] = [
    {
      key: 'screen',
      name: 'Screen Acting I',
      description: 'Acting for the camera: eyelines, continuity, playing small, hitting marks. Every student leaves with two filmed scenes.',
      level: 'beginner',
      teacher: 'layla',
      room: 'Studio A',
      capacity: 14,
      color: 'crimson',
      schedule: [
        { weekday: 2, startTime: '18:00', endTime: '20:00' },
        { weekday: 4, startTime: '18:00', endTime: '20:00' },
      ],
      start: termStart,
      end: termEnd,
      students: ['maya', 'youssef', 'chloe', 'kareem', 'farah', 'isabella', 'rami', 'nadine', ['oliver', 14], ['hana', 21]],
    },
    {
      key: 'kids',
      name: 'Kids Drama (8–12)',
      description: 'Games, storytelling and a short end-of-term play. Parents are welcome at the last session.',
      level: 'all_levels',
      teacher: 'daniel',
      room: 'Studio B',
      capacity: 12,
      color: 'amber',
      schedule: [{ weekday: 6, startTime: '10:00', endTime: '12:00' }],
      start: termStart,
      end: termEnd,
      students: ['adam', 'lina', 'maryam', 'zain', ['sami', 0], ['layan', 0]],
    },
    {
      key: 'voice',
      name: 'Voice & Speech',
      description: 'Breath, resonance, articulation and projection, in English and Arabic texts.',
      level: 'intermediate',
      teacher: 'layla',
      room: 'Room 3',
      capacity: 10,
      color: 'violet',
      schedule: [{ weekday: 1, startTime: '19:00', endTime: '20:30' }],
      start: termStart,
      end: termEnd,
      students: ['salma', 'ethan', 'grace', 'noor', 'kareem', 'nadine', 'youssef', ['farah', 7]],
    },
    {
      key: 'improv',
      name: 'Improvisation Lab',
      description: 'Short and long form improvisation. Yes-and, status work, and building scenes from nothing.',
      level: 'all_levels',
      teacher: 'daniel',
      room: 'Studio B',
      capacity: 16,
      color: 'emerald',
      schedule: [{ weekday: 3, startTime: '18:30', endTime: '20:30' }],
      start: termStart,
      end: termEnd,
      students: ['ethan', 'chloe', 'rami', 'hana', 'oliver', 'maya', 'isabella', 'youssef', ['salma', 14]],
    },
    {
      key: 'audition',
      name: 'Audition Technique',
      description: 'Self-tapes, cold reads, slating and choosing monologues. For students getting ready for castings.',
      level: 'advanced',
      teacher: 'layla',
      room: 'Studio A',
      capacity: 10,
      color: 'sky',
      schedule: [{ weekday: 0, startTime: '17:00', endTime: '19:00' }],
      start: termStart,
      end: termEnd,
      students: ['maya', 'ethan', 'salma', 'grace', 'kareem', 'chloe', 'noor', 'nadine'],
    },
    {
      key: 'shakespeare',
      name: 'Shakespeare Intensive',
      description: 'Verse speaking and scene study from the comedies. Ran last term.',
      level: 'advanced',
      teacher: 'tom',
      room: 'Main Stage',
      capacity: 12,
      color: 'teal',
      schedule: [{ weekday: 5, startTime: '18:00', endTime: '21:00' }],
      start: addDays(today, -150),
      end: addDays(today, -95),
      status: 'archived',
      students: ['ali', 'grace', 'ethan', 'jack', 'maya', 'salma'],
    },
  ];

  /** How reliably each student turns up (0.6–1), so attendance rates differ. */
  const reliability: Record<string, number> = {};
  for (const s of studentSpec) reliability[s.key] = 0.6 + rand() * 0.4;
  reliability.jack = 0.55;

  function pickMark(key: string): { status: AttendanceStatus; note: string | null } {
    const r = rand();
    const p = reliability[key] ?? 0.9;
    if (r < p) return rand() < 0.1 ? { status: 'late', note: rand() < 0.5 ? 'Traffic on the ring road' : null } : { status: 'present', note: null };
    const other = rand();
    if (other < 0.45) return { status: 'excused', note: ['Exam week', 'Doctor’s appointment', 'Filming a commercial', 'Family event'][Math.floor(rand() * 4)]! };
    if (other < 0.75) return { status: 'late', note: null };
    return { status: 'absent', note: null };
  }

  const topics: Record<string, string[]> = {
    screen: ['Eyelines and the frame', 'Continuity drills', 'Close-up vs wide', 'Scene: two-hander', 'Hitting marks', 'Playback and notes'],
    voice: ['Breath and support', 'Resonators', 'Consonants workout', 'Projection in the big room', 'Text: Mahmoud Darwish'],
    improv: ['Yes, and', 'Status games', 'Long form: the Harold', 'Character from a walk', 'Object work'],
    audition: ['Slating and framing a self-tape', 'Cold reads', 'Choosing a monologue', 'Mock audition'],
    kids: ['Name games and warm-ups', 'Freeze frames', 'Story circle', 'Masks', 'Rehearsal: the play'],
  };

  const courseIds: Record<string, number> = {};
  const unmarkedRecent = new Set(['screen', 'voice', 'improv']);
  for (const spec of courseSpec) {
    const teacherId = staff[spec.teacher];
    const course = await owner.post<CourseDetail>('/courses', {
      name: spec.name,
      description: spec.description,
      level: spec.level,
      teacherId,
      room: spec.room,
      capacity: spec.capacity,
      startDate: spec.start,
      endDate: spec.end,
      color: spec.color,
      status: spec.status ?? 'active',
      schedule: spec.schedule,
    });
    courseIds[spec.key] = course.id;

    // Enrol, then date each enrolment to when the student really joined (see the note at the top).
    const joined: { key: string; studentId: number; enrolmentId: number; on: string }[] = [];
    for (const entry of spec.students) {
      const [key, after] = typeof entry === 'string' ? [entry, 0] : entry;
      const studentId = studentIds[key]!;
      const enrolment = await owner.post<CourseEnrollment>(`/courses/${course.id}/enrollments`, { studentId });
      const on = addDays(spec.start, after);
      db.update(enrollments).set({ enrolledOn: on }).where(eq(enrollments.id, enrolment.id)).run();
      joined.push({ key, studentId, enrolmentId: enrolment.id, on });
    }

    // Attendance on past sessions — except the most recent one of a few classes, so "Attendance to take" has work in it.
    const past = course.sessions.filter((s) => s.date < today);
    const skip = unmarkedRecent.has(spec.key) ? past[past.length - 1]?.id : undefined;
    const marker = teacherClient[teacherId] ?? owner;
    const courseTopics = topics[spec.key] ?? [];
    for (const [i, session] of past.entries()) {
      if (courseTopics.length && i < courseTopics.length * 2) {
        await owner.patch(`/sessions/${session.id}`, { topic: courseTopics[i % courseTopics.length] });
      }
      if (session.id === skip) continue;
      const records = joined.filter((j) => j.on <= session.date).map((j) => ({ studentId: j.studentId, ...pickMark(j.key) }));
      if (records.length) await marker.put(`/sessions/${session.id}/attendance`, { records });
    }
    // A topic on the next couple of sessions too.
    const upcoming = course.sessions.filter((s) => s.date >= today);
    for (const [i, session] of upcoming.slice(0, 2).entries()) {
      if (courseTopics.length) await owner.patch(`/sessions/${session.id}`, { topic: courseTopics[(past.length + i) % courseTopics.length] });
    }

    if (spec.status === 'archived') {
      for (const j of joined) await owner.patch(`/courses/${course.id}/enrollments/${j.enrolmentId}`, { status: j.key === 'jack' ? 'withdrawn' : 'completed' });
    }
  }

  // A cancelled session, a substitute, and an extra rehearsal.
  {
    const voice = await owner.get<CourseDetail>(`/courses/${courseIds.voice}`);
    const cancelled = voice.sessions.filter((s) => s.date > today)[1];
    if (cancelled) {
      await owner.patch(`/sessions/${cancelled.id}`, { status: 'cancelled', notes: 'Room 3 is booked for the end-of-term showcase. Make-up session to be announced.' });
    }
    const screen = await owner.get<CourseDetail>(`/courses/${courseIds.screen}`);
    const covered = screen.sessions.find((s) => s.date > addDays(today, 2));
    if (covered) await owner.patch(`/sessions/${covered.id}`, { teacherId: staff.daniel, notes: 'Daniel covers — Layla is on a shoot.' });

    await owner.post(`/courses/${courseIds.improv}/sessions`, {
      date: nextWeekday(addDays(today, 1), 6),
      startTime: '14:00',
      endTime: '17:00',
      room: 'Main Stage',
      topic: 'Showcase rehearsal',
    });
  }

  // ── 4. Talent roster ────────────────────────────────────────────────────────

  // Heads of casting build the roster and send talent to clients.
  const agent = await login('head');

  interface TalentSpec {
    key: string;
    student?: string;
    first?: string;
    last?: string;
    stageName?: string;
    gender: Gender;
    age?: number;
    md?: string;
    playing?: [number | null, number | null];
    height: number;
    eyes: string;
    hair: string;
    city: string;
    skills: string[];
    languages: string[];
    instagram?: string;
    showreel?: string;
    status?: 'active' | 'on_hold' | 'former';
    photos: number;
    email?: string;
    phone?: string;
    notes?: string;
    sinceDaysAgo: number;
  }

  const talentSpec: TalentSpec[] = [
    { key: 'maya', student: 'maya', gender: 'female', playing: [19, 27], height: 168, eyes: 'Green', hair: 'Auburn', city: 'Cairo', skills: ['Singing', 'Dance', 'Dialects'], languages: ['English', 'French'], instagram: 'maya.collins.actor', showreel: 'https://vimeo.com/stageleft/maya-collins', photos: 3, sinceDaysAgo: 200 },
    { key: 'ethan', student: 'ethan', gender: 'male', playing: [22, 30], height: 183, eyes: 'Blue', hair: 'Brown', city: 'Cairo', skills: ['Stage combat', 'Horse riding', 'Improvisation'], languages: ['English', 'German'], showreel: 'https://vimeo.com/stageleft/ethan-brooks', photos: 2, sinceDaysAgo: 380 },
    { key: 'noor', student: 'noor', gender: 'female', playing: [14, 18], height: 160, eyes: 'Brown', hair: 'Black', city: 'Giza', skills: ['Dance', 'Swimming'], languages: ['Arabic', 'English'], photos: 2, sinceDaysAgo: 90, notes: 'Minor — every booking goes through her mother, Hala.' },
    { key: 'chloe', student: 'chloe', gender: 'female', playing: [17, 24], height: 165, eyes: 'Hazel', hair: 'Blonde', city: 'Cairo', skills: ['Singing', 'Piano', 'Improvisation'], languages: ['English', 'Spanish'], instagram: 'chloebennett', photos: 1, sinceDaysAgo: 60 },
    { key: 'kareem', student: 'kareem', gender: 'male', playing: [22, 30], height: 178, eyes: 'Brown', hair: 'Black', city: 'Alexandria', skills: ['Martial arts', 'Stage combat', 'Dialects'], languages: ['Arabic', 'English'], photos: 2, sinceDaysAgo: 150 },
    { key: 'salma', student: 'salma', gender: 'female', playing: [18, 25], height: 163, eyes: 'Brown', hair: 'Dark brown', city: 'Cairo', skills: ['Singing', 'Dance', 'Voice-over'], languages: ['Arabic', 'English', 'French'], instagram: 'salma.ibrahim', photos: 2, sinceDaysAgo: 120 },
    { key: 'grace', student: 'grace', gender: 'female', playing: [24, 32], height: 171, eyes: 'Blue', hair: 'Red', city: 'Cairo', skills: ['Horse riding', 'Dialects', 'Clowning'], languages: ['English'], photos: 1, sinceDaysAgo: 400 },
    { key: 'yasmin', first: 'Yasmin', last: 'Fawzy', gender: 'female', age: 32, md: '02-17', playing: [27, 36], height: 166, eyes: 'Brown', hair: 'Black', city: 'Cairo', skills: ['Dance', 'Singing'], languages: ['Arabic', 'English', 'Italian'], email: 'yasmin.fawzy@example.com', phone: '+20 100 300 4001', photos: 2, sinceDaysAgo: 600 },
    { key: 'marcus', first: 'Marcus', last: 'Hale', gender: 'male', age: 45, md: '06-12', playing: [40, 52], height: 186, eyes: 'Grey', hair: 'Grey', city: 'London', skills: ['Stage combat', 'Horse riding', 'Voice-over'], languages: ['English', 'French'], email: 'marcus.hale@example.com', phone: '+44 7700 900321', showreel: 'https://vimeo.com/stageleft/marcus-hale', photos: 1, sinceDaysAgo: 900 },
    { key: 'hisham', first: 'هشام', last: 'رضا', gender: 'male', age: 38, md: '09-23', playing: [32, 45], height: 175, eyes: 'Brown', hair: 'Black', city: 'Alexandria', skills: ['Dialects', 'Improvisation', 'Singing'], languages: ['Arabic'], phone: '+20 100 300 4003', photos: 0, sinceDaysAgo: 300 },
    { key: 'dina', first: 'Dina', last: 'El-Sayed', stageName: 'Dina Starr', gender: 'female', age: 27, md: '04-30', playing: [22, 30], height: 170, eyes: 'Hazel', hair: 'Brown', city: 'Dubai', skills: ['Dance', 'Swimming', 'Martial arts'], languages: ['Arabic', 'English'], instagram: 'dinastarr', email: 'dina.starr@example.com', photos: 2, sinceDaysAgo: 250 },
    { key: 'leo', first: 'Leo', last: 'Fischer', gender: 'male', age: 22, md: '01-05', playing: [18, 25], height: 180, eyes: 'Blue', hair: 'Blonde', city: 'Cairo', skills: ['Clowning', 'Improvisation', 'Dance'], languages: ['German', 'English'], email: 'leo.fischer@example.com', photos: 1, sinceDaysAgo: 40 },
    { key: 'rana', first: 'رنا', last: 'جمال', gender: 'female', age: 58, md: '12-02', playing: [52, 65], height: 158, eyes: 'Brown', hair: 'Grey', city: 'Cairo', skills: ['Singing'], languages: ['Arabic', 'French'], phone: '+20 100 300 4006', status: 'on_hold', photos: 0, sinceDaysAgo: 1200, notes: 'On hold until January — recovering from knee surgery. Happy to do voice work.' },
    { key: 'peter', first: 'Peter', last: 'Okafor', gender: 'male', age: 30, md: '08-14', height: 188, eyes: 'Brown', hair: 'Black', city: 'Giza', skills: ['Martial arts', 'Swimming', 'Horse riding'], languages: ['English', 'French', 'Arabic'], phone: '+20 100 300 4007', photos: 0, sinceDaysAgo: 30 },
  ];

  const talentIds: Record<string, number> = {};
  for (const t of talentSpec) {
    const s = t.student ? studentInfo[t.student]! : null;
    const created = await agent.post<{ id: number }>('/talent', {
      studentId: s ? studentIds[t.student!] : null,
      firstName: s ? s.first : t.first,
      lastName: s ? s.last : t.last,
      stageName: t.stageName ?? null,
      email: s ? (s.email ?? null) : (t.email ?? null),
      phone: s ? (s.phone ?? null) : (t.phone ?? null),
      dateOfBirth: s ? dob(s.age, s.md) : dob(t.age!, t.md!),
      gender: t.gender,
      playingAgeMin: t.playing?.[0] ?? null,
      playingAgeMax: t.playing?.[1] ?? null,
      heightCm: t.height,
      eyeColor: t.eyes,
      hairColor: t.hair,
      city: t.city,
      skills: t.skills,
      languages: t.languages,
      instagram: t.instagram ?? null,
      showreelUrl: t.showreel ?? null,
      status: t.status ?? 'active',
      representedSince: addDays(today, -t.sinceDaysAgo),
      notes: t.notes ?? null,
    });
    talentIds[t.key] = created.id;
    // Student photo first (it becomes the headshot), then extra shots.
    const captions = ['Headshot', 'Commercial look', 'Character look'];
    let added = 0;
    if (t.student && studentPhotos[t.student]) {
      await agent.post(`/talent/${created.id}/photos`, { fileId: studentPhotos[t.student], caption: captions[0] });
      added++;
    }
    while (added < t.photos) {
      const fileId = await uploadPortrait(agent, t.student ?? t.key, t.gender, t.hair, added);
      await agent.post(`/talent/${created.id}/photos`, { fileId, caption: captions[added] ?? null });
      added++;
    }
  }

  // ── 5. Castings, roles, submissions ─────────────────────────────────────────

  interface SubmissionSpec {
    talent: string;
    status: SubmissionStatus;
    audition?: [days: number, time: string, where: string];
    notes?: string;
  }
  interface CastingSpec {
    title: string;
    production: string;
    director: string;
    email: string;
    phone?: string;
    type: 'film' | 'tv' | 'commercial' | 'theatre';
    location: string;
    description: string;
    deadline: number;
    shoot: [number, number];
    rate: string;
    roles: { name: string; description: string; gender: Gender | null; ageMin: number | null; ageMax: number | null; requirements?: string; submissions: SubmissionSpec[] }[];
  }

  const castingSpec: CastingSpec[] = [
    {
      title: 'The Last Ferry',
      production: 'Nile Light Pictures',
      director: 'Mona Adel',
      email: 'casting@nilelight.example',
      phone: '+20 3 555 0199',
      type: 'film',
      location: 'Alexandria',
      description: 'Feature drama set on the last night of the Alexandria–Bari ferry. Shooting on location in the port and on board.',
      deadline: 9,
      shoot: [40, 62],
      rate: 'EGP 4,000/day, 12 shoot days',
      roles: [
        {
          name: 'Hana (lead)',
          description: 'A young nurse leaving Egypt for good. Warm, stubborn, funny under pressure.',
          gender: 'female',
          ageMin: 22,
          ageMax: 28,
          requirements: 'Fluent English and Arabic. Some scenes in French.',
          submissions: [
            { talent: 'maya', status: 'audition', audition: [3, '11:00', 'Nile Light offices, Smouha'], notes: 'Prepare scene 14 and a short Arabic monologue.' },
            { talent: 'salma', status: 'callback', audition: [5, '15:30', 'Nile Light offices, Smouha'], notes: 'Director loved the first read. Chemistry read with the lead actor.' },
            { talent: 'chloe', status: 'submitted' },
            { talent: 'dina', status: 'rejected', audition: [-3, '12:00', 'Nile Light offices, Smouha'], notes: 'They went younger.' },
          ],
        },
        {
          name: 'Officer Karim',
          description: 'Port police officer with a soft spot for the passengers.',
          gender: 'male',
          ageMin: 25,
          ageMax: 40,
          submissions: [
            { talent: 'kareem', status: 'shortlisted' },
            { talent: 'peter', status: 'audition', audition: [4, '10:30', 'Nile Light offices, Smouha'] },
          ],
        },
        {
          name: 'Ship’s captain',
          description: 'Gruff, few lines, big presence.',
          gender: null,
          ageMin: 40,
          ageMax: 60,
          submissions: [{ talent: 'marcus', status: 'submitted' }],
        },
      ],
    },
    {
      title: 'Fresh Squeeze juice — TV spot',
      production: 'Orchard & Co.',
      director: 'Sam Whitfield',
      email: 'sam@orchard.example',
      type: 'commercial',
      location: 'Cairo — Zamalek studio',
      description: '30-second spot: a family breakfast that turns into a dance number.',
      deadline: 2,
      shoot: [12, 12],
      rate: '$600 + 1-year MENA buyout',
      roles: [
        {
          name: 'Young mother',
          description: 'Bright and energetic; leads the dance.',
          gender: 'female',
          ageMin: 28,
          ageMax: 36,
          requirements: 'Must be comfortable dancing on camera.',
          submissions: [
            { talent: 'yasmin', status: 'booked', audition: [-5, '16:00', 'Orchard & Co., Zamalek'], notes: 'Booked! Wardrobe fitting the day before the shoot.' },
            { talent: 'grace', status: 'withdrawn', notes: 'Clashes with a theatre run.' },
          ],
        },
        {
          name: 'Kid (8–10)',
          description: 'Steals the last sip of juice.',
          gender: null,
          ageMin: 8,
          ageMax: 10,
          submissions: [],
        },
      ],
    },
    {
      title: 'A Midsummer Night’s Dream',
      production: 'Falaki Theatre',
      director: 'Hassan Lotfy',
      email: 'hassan.lotfy@falaki.example',
      type: 'theatre',
      location: 'Downtown Cairo',
      description: 'Bilingual production (English verse, Arabic prose) for the spring season. Six weeks of rehearsal, four weeks of performances.',
      deadline: 13,
      shoot: [50, 80],
      rate: 'Weekly fee, rehearsals paid',
      roles: [
        {
          name: 'Puck',
          description: 'Quick, physical, mischievous.',
          gender: null,
          ageMin: 18,
          ageMax: 30,
          requirements: 'Movement or circus skills a plus.',
          submissions: [
            { talent: 'leo', status: 'audition', audition: [8, '18:00', 'Falaki Theatre, rehearsal room'] },
            { talent: 'ethan', status: 'shortlisted' },
          ],
        },
        {
          name: 'Helena',
          description: 'Lovesick and determined.',
          gender: 'female',
          ageMin: 20,
          ageMax: 30,
          submissions: [{ talent: 'chloe', status: 'audition', audition: [8, '18:30', 'Falaki Theatre, rehearsal room'] }],
        },
        {
          name: 'Bottom',
          description: 'The weaver who becomes a donkey. Comic timing essential.',
          gender: 'male',
          ageMin: 30,
          ageMax: 50,
          submissions: [{ talent: 'hisham', status: 'callback', audition: [9, '17:00', 'Falaki Theatre, main stage'] }],
        },
      ],
    },
    {
      title: 'بيت العائلة — الموسم الثاني',
      production: 'Cairo Screens',
      director: 'Rasha Nabil',
      email: 'casting@cairoscreens.example',
      phone: '+20 2 555 0177',
      type: 'tv',
      location: 'Media Production City, 6th of October',
      description: 'Second season of the Ramadan family drama. 30 episodes.',
      deadline: 6,
      shoot: [30, 120],
      rate: 'Per episode, by role',
      roles: [
        {
          name: 'Teenage daughter',
          description: 'The youngest of the family, secretly applying to a drama school.',
          gender: 'female',
          ageMin: 15,
          ageMax: 18,
          requirements: 'Guardian consent needed for minors.',
          submissions: [{ talent: 'noor', status: 'submitted', notes: 'Self-tape sent. Guardian consent on file.' }],
        },
        {
          name: 'Grandmother',
          description: 'The head of the household. Sharp tongue, big heart.',
          gender: 'female',
          ageMin: 55,
          ageMax: 70,
          submissions: [{ talent: 'rana', status: 'audition', audition: [1, '13:00', 'Cairo Screens, Studio 4'] }],
        },
      ],
    },
  ];

  const castingIds: Record<string, number> = {};
  for (const c of castingSpec) {
    const casting = await agent.post<{ id: number }>('/castings', {
      title: c.title,
      production: c.production,
      castingDirector: c.director,
      contactEmail: c.email,
      contactPhone: c.phone ?? null,
      type: c.type,
      location: c.location,
      description: c.description,
      status: 'open',
      submissionDeadline: addDays(today, c.deadline),
      shootStart: addDays(today, c.shoot[0]),
      shootEnd: addDays(today, c.shoot[1]),
      rate: c.rate,
    });
    castingIds[c.title] = casting.id;
    for (const r of c.roles) {
      const { submissions, ...roleInput } = r;
      const role = await agent.post<{ id: number }>(`/castings/${casting.id}/roles`, roleInput);
      for (const s of submissions) {
        await agent.post('/submissions', {
          roleId: role.id,
          talentId: talentIds[s.talent],
          status: s.status,
          auditionAt: s.audition ? `${addDays(today, s.audition[0])}T${s.audition[1]}` : null,
          auditionLocation: s.audition?.[2] ?? null,
          notes: s.notes ?? null,
        });
      }
    }
  }

  // ── 6. Admissions ───────────────────────────────────────────────────────────

  // The director runs admissions: she takes the enquiries, interviews and enrols.
  const director = await login('director');

  type LeadStep =
    | { do: 'contact'; daysAgo: number; type: LeadContactType; body?: string; followUp?: number | null; status?: LeadStatus; lostReason?: LeadLostReason }
    | {
        do: 'interview';
        daysAgo: number;
        at: [days: number, time: string];
        room?: string;
        outcome?: {
          daysAgo: number;
          status: 'done' | 'no_show';
          scores?: Record<string, number>;
          strengths?: string;
          areasToWork?: string;
          notes?: string;
          recommendation?: InterviewRecommendation;
          level?: CourseLevel;
          course?: string;
        };
      }
    | { do: 'status'; daysAgo: number; status: LeadStatus; lostReason?: LeadLostReason; followUp?: number | null }
    | { do: 'enrol'; daysAgo: number; course: string };

  interface LeadSpec {
    first: string;
    last: string;
    phone: string;
    email?: string;
    gender?: Gender;
    age?: number;
    md?: string;
    city?: string;
    guardian?: [name: string, phone: string];
    source: LeadSource;
    sourceDetail?: string;
    interest?: string;
    experience?: string;
    preferred?: string;
    /** Taken by the owner instead of the director (so assigned to him). */
    byOwner?: boolean;
    daysAgo: number;
    followUp?: number;
    notes?: string;
    steps?: LeadStep[];
  }

  const leadSpec: LeadSpec[] = [
    // New
    { first: 'نور', last: 'خالد', phone: '0100 765 4321', gender: 'female', age: 24, md: '02-02', city: 'Cairo', source: 'whatsapp', interest: 'Evening workshops after work — screen acting.', daysAgo: 0, followUp: 0 },
    { first: 'Omar', last: 'Farouk', phone: '+20 111 222 3344', email: 'omar.farouk@example.com', gender: 'male', age: 20, md: '06-15', source: 'instagram', sourceDetail: 'Reel: Screen Acting showcase', interest: 'Saw the showcase reel. Wants to try acting for the first time.', daysAgo: 1 },
    // Already a student (Tariq came to the open day): the form and the enrol step warn about the duplicate.
    { first: 'Tariq', last: 'Saleh', phone: '01223030318', email: 'tariq.saleh@example.com', gender: 'male', age: 23, md: '07-14', source: 'google_form', sourceDetail: 'Open-day sign-up form', interest: 'Screen Acting I next term.', daysAgo: 2, followUp: -1, byOwner: true },
    // Contacted
    {
      first: 'مريم', last: 'سامي', phone: '+20 106 555 1234', gender: 'female', age: 19, md: '09-09', city: 'Giza', source: 'phone_call', interest: 'Theatre and voice.', daysAgo: 6,
      steps: [{ do: 'contact', daysAgo: 6, type: 'call', body: 'Asked about fees and times. Sent the workshop schedule on WhatsApp.', followUp: -2 }],
    },
    {
      first: 'حسن', last: 'عبد الله', phone: '+20 109 444 2211', gender: 'male', age: 10, md: '03-03', city: 'Cairo', guardian: ['عبد الله حسن', '+20 109 444 2200'], source: 'facebook', sourceDetail: 'Ad: Kids Drama autumn', preferred: 'kids', daysAgo: 4,
      steps: [{ do: 'contact', daysAgo: 4, type: 'whatsapp', body: 'Spoke with his father. They want to visit a Saturday workshop first.', followUp: 0 }],
    },
    {
      first: 'Lucy', last: 'Hart', phone: '+44 7700 900555', email: 'lucy.hart@example.com', gender: 'female', age: 22, md: '05-21', city: 'Cairo', source: 'email', interest: 'Improvisation; has done some school theatre.', experience: 'School plays in London, two years of youth theatre.', daysAgo: 10,
      steps: [
        { do: 'contact', daysAgo: 9, type: 'email', body: 'Replied with the improv workshop details and invited her for an interview.' },
        { do: 'interview', daysAgo: 8, at: [-5, '18:00'], room: 'Studio B', outcome: { daysAgo: 5, status: 'no_show' } },
        { do: 'contact', daysAgo: 4, type: 'whatsapp', body: 'Apologised — exam week. Wants a new date after her exams.', followUp: 2 },
      ],
    },
    // Interview scheduled
    {
      first: 'يوسف', last: 'مجدي', phone: '01001234567', gender: 'male', age: 27, md: '11-01', city: 'Cairo', source: 'walk_in', interest: 'Wants to move from modelling into acting.', experience: 'Fashion modelling, two commercials.', preferred: 'screen', daysAgo: 5,
      steps: [
        { do: 'contact', daysAgo: 5, type: 'meeting', body: 'Walked in on Thursday; showed him the studios.' },
        { do: 'interview', daysAgo: 5, at: [1, '17:00'], room: 'Studio A' },
      ],
    },
    {
      first: 'Sara', last: 'Nabil', phone: '+20 112 909 8080', email: 'sara.nabil@example.com', gender: 'female', age: 18, md: '12-12', source: 'tiktok', sourceDetail: 'Comment on the monologue challenge video', daysAgo: 3,
      steps: [
        { do: 'contact', daysAgo: 3, type: 'whatsapp', body: 'Sent the interview invitation.' },
        { do: 'interview', daysAgo: 3, at: [3, '16:30'], room: 'Room 3' },
      ],
    },
    // Interviewed
    {
      first: 'كريم', last: 'عادل', phone: '+20 114 321 6543', gender: 'male', age: 21, md: '08-30', city: 'Alexandria', source: 'referral', sourceDetail: 'Referred by Kareem Saeed (student)', daysAgo: 14,
      steps: [
        { do: 'contact', daysAgo: 13, type: 'call', body: 'Booked an interview.' },
        {
          do: 'interview', daysAgo: 13, at: [-3, '15:00'], room: 'Studio A',
          outcome: { daysAgo: 3, status: 'done', scores: { presence: 3, voice: 4, body: 2, emotion: 3, imagination: 4, listening: 3, commitment: 4 }, strengths: 'Good voice, thoughtful.', areasToWork: 'Stiff physically; needs movement work.', recommendation: 'maybe', level: 'beginner' },
        },
        { do: 'status', daysAgo: 3, status: 'interviewed', followUp: 1 },
      ],
    },
    {
      first: 'Emma', last: 'Lewis', phone: '+20 127 111 9090', email: 'emma.lewis@example.com', gender: 'female', age: 25, md: '01-30', source: 'website', interest: 'Camera work for commercials.', experience: 'Short films at university.', preferred: 'screen', daysAgo: 12,
      steps: [
        {
          do: 'interview', daysAgo: 10, at: [-2, '18:30'], room: 'Studio A',
          outcome: { daysAgo: 2, status: 'done', scores: { presence: 5, voice: 4, body: 4, emotion: 4, imagination: 5, listening: 4, commitment: 5 }, strengths: 'Natural on camera, takes notes fast.', areasToWork: 'Projection in a big room.', recommendation: 'accept', level: 'beginner', course: 'screen' },
        },
        { do: 'status', daysAgo: 2, status: 'interviewed', followUp: 0 },
      ],
    },
    // Accepted
    {
      first: 'أحمد', last: 'طارق', phone: '+20 155 600 7788', gender: 'male', age: 29, md: '04-04', city: 'Cairo', source: 'google_form', sourceDetail: 'Autumn intake form', daysAgo: 20,
      steps: [
        {
          do: 'interview', daysAgo: 15, at: [-8, '19:00'], room: 'Studio B',
          outcome: { daysAgo: 8, status: 'done', scores: { presence: 4, voice: 3, body: 5, emotion: 4, imagination: 5, listening: 4, commitment: 4 }, strengths: 'Fearless, very physical.', areasToWork: 'Listening to partners.', recommendation: 'accept', level: 'all_levels', course: 'improv' },
        },
        { do: 'status', daysAgo: 7, status: 'accepted' },
        { do: 'contact', daysAgo: 6, type: 'whatsapp', body: 'Sent the acceptance and the fees. Waiting for him to confirm.', followUp: -3 },
      ],
    },
    {
      first: 'Lina', last: 'Fares', phone: '+20 128 777 1212', gender: 'female', age: 16, md: '10-10', city: 'Giza', guardian: ['Rania Fares', '+20 128 777 1200'], source: 'whatsapp', preferred: 'voice', daysAgo: 15,
      steps: [
        {
          do: 'interview', daysAgo: 12, at: [-6, '17:30'], room: 'Room 3',
          outcome: { daysAgo: 6, status: 'done', scores: { presence: 4, voice: 5, body: 3, emotion: 4, imagination: 4, listening: 5, commitment: 4 }, strengths: 'Beautiful voice, mature for her age.', areasToWork: 'Confidence.', recommendation: 'accept', level: 'intermediate', course: 'voice' },
        },
        { do: 'status', daysAgo: 5, status: 'accepted', followUp: 3 },
      ],
    },
    // Enrolled
    {
      first: 'محمد', last: 'إسماعيل', phone: '+20 100 888 4545', email: 'mohamed.ismail@example.com', gender: 'male', age: 26, md: '07-07', city: 'Cairo', source: 'instagram', preferred: 'screen', daysAgo: 25,
      steps: [
        { do: 'contact', daysAgo: 24, type: 'whatsapp', body: 'Invited him for an interview.' },
        {
          do: 'interview', daysAgo: 24, at: [-18, '16:00'], room: 'Studio A',
          outcome: { daysAgo: 18, status: 'done', scores: { presence: 4, voice: 4, body: 4, emotion: 5, imagination: 4, listening: 4, commitment: 5 }, strengths: 'Real emotional range.', areasToWork: 'Camera technique.', recommendation: 'accept', level: 'beginner', course: 'screen' },
        },
        { do: 'status', daysAgo: 17, status: 'accepted' },
        { do: 'enrol', daysAgo: 1, course: 'screen' },
      ],
    },
    // Declined
    {
      first: 'دينا', last: 'حمدي', phone: '+20 122 456 0001', gender: 'female', age: 31, md: '03-25', source: 'phone_call', daysAgo: 18,
      steps: [
        {
          do: 'interview', daysAgo: 16, at: [-12, '18:00'], room: 'Studio B',
          outcome: { daysAgo: 12, status: 'done', scores: { presence: 2, voice: 2, body: 3, emotion: 2, imagination: 3, listening: 2, commitment: 2 }, notes: 'Looking for a weekend hobby workshop; not ready for the term commitment.', recommendation: 'decline' },
        },
        { do: 'status', daysAgo: 11, status: 'declined' },
      ],
    },
    // Lost
    {
      first: 'Jake', last: 'Morris', phone: '+20 101 300 2020', email: 'jake.morris@example.com', gender: 'male', age: 33, md: '09-19', source: 'email', daysAgo: 30, byOwner: true,
      steps: [
        { do: 'contact', daysAgo: 29, type: 'email', body: 'Sent the brochure.' },
        { do: 'contact', daysAgo: 22, type: 'call', body: 'No answer.' },
        { do: 'status', daysAgo: 15, status: 'lost', lostReason: 'no_response' },
      ],
    },
    {
      first: 'رنا', last: 'شريف', phone: '+20 115 222 7070', gender: 'female', age: 20, md: '12-01', source: 'facebook', daysAgo: 21,
      steps: [
        { do: 'contact', daysAgo: 20, type: 'whatsapp', body: 'Sent the fees.' },
        { do: 'status', daysAgo: 14, status: 'lost', lostReason: 'too_expensive' },
      ],
    },
  ];

  /** When a step happened: that day at 10:00 (never in the future), plus a minute per entry so the timeline keeps its order. */
  let tick = 0;
  const stampAt = (daysAgo: number) =>
    Math.min(epochAt(timeZone, addDays(today, -daysAgo), '10:00') + tick++ * 60_000, daysAgo === 0 ? schoolTodayAgo(timeZone, 1) : Date.now() - 60_000);
  const lastActivityId = (leadId: number) =>
    db.select({ id: max(leadActivities.id) }).from(leadActivities).where(eq(leadActivities.leadId, leadId)).get()?.id ?? 0;
  /** Run one step of a lead's story, then date the timeline entries it wrote. */
  async function step<T>(leadId: number, daysAgo: number, run: () => Promise<T>): Promise<T> {
    const before = lastActivityId(leadId);
    const out = await run();
    const ts = stampAt(daysAgo);
    db.update(leadActivities)
      .set({ createdAt: ts })
      .where(and(eq(leadActivities.leadId, leadId), gt(leadActivities.id, before)))
      .run();
    db.update(leads).set({ updatedAt: ts }).where(eq(leads.id, leadId)).run();
    return out;
  }

  for (const l of leadSpec) {
    const client = l.byOwner ? owner : director;
    const lead = await client.post<LeadDetail>('/leads', {
      firstName: l.first,
      lastName: l.last,
      phone: l.phone,
      email: l.email ?? null,
      gender: l.gender ?? null,
      dateOfBirth: l.age ? dob(l.age, l.md!) : null,
      city: l.city ?? null,
      guardianName: l.guardian?.[0] ?? null,
      guardianPhone: l.guardian?.[1] ?? null,
      source: l.source,
      sourceDetail: l.sourceDetail ?? null,
      interest: l.interest ?? null,
      experience: l.experience ?? null,
      preferredCourseId: l.preferred ? courseIds[l.preferred] : null,
      nextFollowUpOn: l.followUp !== undefined ? addDays(today, l.followUp) : null,
      notes: l.notes ?? null,
    });
    db.update(leads).set({ createdAt: stampAt(l.daysAgo) }).where(eq(leads.id, lead.id)).run();

    for (const s of l.steps ?? []) {
      if (s.do === 'contact') {
        await step(lead.id, s.daysAgo, () =>
          director.post(`/leads/${lead.id}/activities`, {
            type: s.type,
            body: s.body ?? null,
            ...(s.followUp !== undefined ? { nextFollowUpOn: s.followUp === null ? null : addDays(today, s.followUp) } : {}),
            ...(s.status ? { status: s.status, lostReason: s.lostReason ?? null } : {}),
          }),
        );
      } else if (s.do === 'interview') {
        const iv = await step(lead.id, s.daysAgo, () =>
          director.post<Interview>(`/leads/${lead.id}/interviews`, {
            scheduledAt: `${addDays(today, s.at[0])}T${s.at[1]}`,
            durationMinutes: 30,
            room: s.room ?? null,
            interviewerId: staff.director,
          }),
        );
        const o = s.outcome;
        if (o) {
          await step(lead.id, o.daysAgo, () =>
            director.patch(`/leads/${lead.id}/interviews/${iv.id}`, {
              status: o.status,
              ...(o.status === 'done'
                ? {
                    scores: o.scores ?? {},
                    strengths: o.strengths ?? null,
                    areasToWork: o.areasToWork ?? null,
                    notes: o.notes ?? null,
                    recommendation: o.recommendation ?? null,
                    recommendedLevel: o.level ?? null,
                    recommendedCourseId: o.course ? courseIds[o.course] : null,
                  }
                : {}),
            }),
          );
          db.update(interviews).set({ recordedAt: stampAt(o.daysAgo) }).where(eq(interviews.id, iv.id)).run();
        }
      } else if (s.do === 'status') {
        await step(lead.id, s.daysAgo, () =>
          director.patch(`/leads/${lead.id}`, {
            status: s.status,
            ...(s.lostReason ? { lostReason: s.lostReason } : {}),
            ...(s.followUp !== undefined ? { nextFollowUpOn: s.followUp === null ? null : addDays(today, s.followUp) } : {}),
          }),
        );
      } else {
        // Enrolling creates the student and the enrollment, both joining on the step's day (as its timeline entry says).
        await step(lead.id, s.daysAgo, () => director.post(`/leads/${lead.id}/enrol`, { courseId: courseIds[s.course], joinedOn: addDays(today, -s.daysAgo) }));
      }
    }
  }

  // Tom left at the end of last term.
  await owner.patch(`/staff/${staff.tom}`, { active: false });

  // ── 7. The team: profile photos, workshop and casting files, chat, a call to the office ──

  await seedTeam();

  // ── 8. The cafeteria: the usual menu, a few days of delivered orders, one order delivered this morning, one waiting on the board ──

  await seedCafe();

  // ── 9. Class videos: the coaches' footage on its way through the editor to the reviewer, in every state ──

  await seedVideos();

  // ── 10. Casting opportunities the team saw this week (one asks the actors for money) ──

  await seedOpportunities();

  // ── 11. The public website ─────────────────────────────────────────────────

  await seedDemoWebsite({ db, files: opts.files, timeZone, today });

  /**
   * Casting › Opportunities (Part K1): five posts the casting team saw on
   * Instagram, Facebook, a WhatsApp group and a theatre's website, in English
   * and Arabic — three still new (one of them asks the actors for money, so it
   * carries the red warning), one the team is interested in (its deadline has
   * passed) and one they applied to. Two have screenshots. No amounts anywhere
   * (no prices in the demo).
   */
  async function seedOpportunities() {
    const tarek = await login('casting');
    async function screenshot(person: number, gender: Gender, hair: string, name: string, variant: number): Promise<string> {
      const form = new FormData();
      form.append('file', new Blob([renderPortrait(lookFor(person, gender, { hair, variant }))], { type: 'image/png' }), name);
      return (await tarek.post<{ id: string }>('/files', form)).id;
    }
    const spec: { hoursAgo: number; input: Record<string, unknown>; shots?: [number, Gender, string][] }[] = [
      {
        hoursAgo: 3,
        input: {
          title: 'Feature film — lead actress, 25 to 35',
          projectType: 'film',
          roles: 'Lead actress (25–35), her younger brother (18–22)',
          location: 'Cairo',
          deadline: addDays(today, 2),
          contact: 'WhatsApp +20 100 123 4567',
          link: 'https://www.instagram.com/p/demo-frame-casting/',
          source: 'Instagram — Frame Casting',
          details: 'Independent feature, shooting in the spring. Send a self-tape and two photos.',
        },
        shots: [[420, 'female', 'Black']],
      },
      {
        hoursAgo: 20,
        input: {
          title: 'إعلان تلفزيوني لشركة عصائر',
          projectType: 'ad',
          roles: 'عائلة: أب وأم وطفلان (من 8 إلى 12 سنة)',
          location: 'الشيخ زايد',
          deadline: addDays(today, 9),
          contact: 'casting@juice-ad.example',
          link: 'https://www.facebook.com/groups/demo-casting-masr/posts/1',
          source: 'فيسبوك — مجموعة كاستينج مصر',
          involvesMinors: true,
          details: 'تصوير يوم واحد في استوديو. يرجى إرسال صور حديثة للعائلة كاملة.',
        },
        shots: [
          [421, 'male', 'Black'],
          [422, 'female', 'Dark brown'],
        ],
      },
      {
        hoursAgo: 30,
        input: {
          title: 'Web series: “new faces wanted”',
          projectType: 'online',
          roles: 'All ages, no experience needed',
          contact: 'A WhatsApp number only, no company name',
          source: 'WhatsApp group — Actors Egypt',
          asksForPayment: true,
          details: 'They ask every actor to pay a “registration fee” before the audition. Probably not a real casting.',
        },
      },
      {
        hoursAgo: 96,
        input: {
          title: 'مسرحية «الليلة الكبيرة» — تجارب أداء',
          projectType: 'theatre',
          roles: 'مغنون وممثلون (من 18 إلى 40 سنة)',
          location: 'مسرح الجمهورية، وسط البلد',
          deadline: addDays(today, -3),
          link: 'https://example.org/demo-theatre/auditions',
          source: 'موقع مسرح الجمهورية',
          status: 'interested',
        },
      },
      {
        hoursAgo: 72,
        input: {
          title: 'Music video — dancers and extras',
          projectType: 'music_video',
          roles: 'Dancers (18–30), 20 extras',
          location: 'Downtown Cairo',
          deadline: addDays(today, 5),
          contact: '@mv.casting.cairo',
          link: 'https://www.instagram.com/p/demo-mv-casting/',
          source: 'Instagram — @mv.casting.cairo',
          status: 'applied',
        },
      },
    ];
    let shot = 0;
    for (const o of spec) {
      const fileIds: string[] = [];
      for (const [person, gender, hair] of o.shots ?? []) fileIds.push(await screenshot(person, gender, hair, `screenshot-${++shot}.png`, shot));
      const created = await tarek.post<{ id: number }>('/opportunities', { ...o.input, fileIds });
      const at = Date.now() - o.hoursAgo * 3_600_000;
      db.update(castingOpportunities).set({ createdAt: at, updatedAt: at }).where(eq(castingOpportunities.id, created.id)).run();
    }
  }

  /**
   * The cafeteria as a working morning: the usual menu ("Add the usual
   * items"; the places are the defaults), a few orders delivered on the days
   * before (so the owners' monthly page has something to show) and one turned
   * down, the director's coffee delivered to the office an hour ago, and
   * Layla's teas for Studio 1 still waiting on the Office helper's board —
   * through the API, then backdated.
   */
  async function seedCafe() {
    const { items } = await owner.post<{ items: CafeItem[] }>('/cafe/menu/defaults');
    const item = (nameEn: string) => items.find((i) => i.nameEn === nameEn)!.id;
    const helper = await login('helper');
    const reception = await login('reception');
    const tarek = await login('casting');
    const ago = (minutes: number) => Date.now() - minutes * 60_000;
    const DAY = 24 * 60;

    // The days before: delivered (or turned down) and long read — nothing of it in anyone's bell as new.
    const past: { client: ReturnType<typeof as>; daysAgo: number; place: string; items: { itemId: number; qty: number; options?: string }[]; turnDown?: string }[] = [
      { client: reception, daysAgo: 1, place: 'Reception', items: [{ itemId: item('Tea'), qty: 1, options: 'Medium sugar' }] },
      { client: tarek, daysAgo: 1, place: 'Studio 2', items: [{ itemId: item('Coffee'), qty: 2 }, { itemId: item('Water'), qty: 2 }] },
      { client: layla, daysAgo: 2, place: 'Studio 1', items: [{ itemId: item('Tea'), qty: 3 }, { itemId: item('Biscuits'), qty: 1 }] },
      { client: director, daysAgo: 2, place: 'Office', items: [{ itemId: item('Turkish coffee'), qty: 1, options: 'مضبوط' }] },
      { client: tarek, daysAgo: 3, place: 'Studio 2', items: [{ itemId: item('Sandwich'), qty: 1 }], turnDown: 'Sorry, it is not available now' },
    ];
    for (const p of past) {
      const o = await p.client.post<{ id: number }>('/cafe/orders', { place: p.place, items: p.items });
      if (p.turnDown) await helper.post(`/cafe/orders/${o.id}/status`, { status: 'cancelled', reason: p.turnDown });
      else {
        await helper.post(`/cafe/orders/${o.id}/status`, { status: 'on_the_way' });
        await helper.post(`/cafe/orders/${o.id}/status`, { status: 'delivered' });
      }
      const at = ago(p.daysAgo * DAY + 120);
      db.update(cafeOrders)
        .set(p.turnDown ? { createdAt: at, cancelledAt: at + 3 * 60_000 } : { createdAt: at, onTheWayAt: at + 3 * 60_000, deliveredAt: at + 8 * 60_000 })
        .where(eq(cafeOrders.id, o.id))
        .run();
      for (const link of [cafeBoardLink(o.id), cafeOrderLink(o.id)]) {
        db.update(notifications).set({ createdAt: at, readAt: at + 10 * 60_000 }).where(eq(notifications.link, link)).run();
      }
    }

    const coffee = await director.post<{ id: number }>('/cafe/orders', {
      place: 'Office',
      items: [
        { itemId: item('Turkish coffee'), qty: 1, options: 'مضبوط' },
        { itemId: item('Water'), qty: 1 },
      ],
    });
    await helper.post(`/cafe/orders/${coffee.id}/status`, { status: 'on_the_way' });
    await helper.post(`/cafe/orders/${coffee.id}/status`, { status: 'delivered' });

    const teas = await layla.post<{ id: number }>('/cafe/orders', {
      place: 'Studio 1',
      note: 'For the break, around 11',
      items: [
        { itemId: item('Tea'), qty: 2 },
        { itemId: item('Tea'), qty: 1, options: 'no sugar' },
      ],
    });

    // This morning's: always on the school's today, even when the seed runs just after midnight (schoolTodayAgo) —
    // the board's "delivered today" and cf:smoke count on it.
    const coffeeAt = (minutes: number) => schoolTodayAgo(timeZone, minutes, 75);
    const [ordered, onTheWay, broughtAt] = [coffeeAt(75), coffeeAt(72), coffeeAt(68)];
    db.update(cafeOrders).set({ createdAt: ordered, onTheWayAt: onTheWay, deliveredAt: broughtAt }).where(eq(cafeOrders.id, coffee.id)).run();
    db.update(notifications).set({ createdAt: ordered, readAt: onTheWay }).where(and(eq(notifications.kind, 'cafe_order'), eq(notifications.link, cafeBoardLink(coffee.id)))).run();
    db.update(notifications).set({ createdAt: broughtAt }).where(and(eq(notifications.kind, 'cafe_status'), eq(notifications.link, cafeOrderLink(coffee.id)))).run();
    const teasAt = schoolTodayAgo(timeZone, 4);
    db.update(cafeOrders).set({ createdAt: teasAt }).where(eq(cafeOrders.id, teas.id)).run();
    db.update(notifications).set({ createdAt: teasAt }).where(and(eq(notifications.kind, 'cafe_order'), eq(notifications.link, cafeBoardLink(teas.id)))).run();
  }

  /**
   * The video pipeline as a working week (Part L): the coaches add the links
   * after class, Hany (the editor) works through them, Daniel (coach + finance
   * + Video reviewer, like Moaty) checks every edit. Three new videos (one due
   * today, one tomorrow, one late), one being edited, two waiting for a check,
   * one sent back with changes, and three approved (two this week) — through
   * the API, as the people who would do it, then backdated. The links are
   * made-up demo links.
   */
  async function seedVideos() {
    const hany = await login('editor');
    const ago = (minutes: number) => Date.now() - minutes * 60_000;
    const DAY = 24 * 60;
    const lastSessions = async (course: string, n: number) => {
      const detail = await owner.get<CourseDetail>(`/courses/${courseIds[course]}`);
      return detail.sessions.filter((x) => x.date < today && x.status === 'scheduled').slice(-n);
    };
    const [screenPrev, screenLast] = await lastSessions('screen', 2);
    const [voiceLast] = await lastSessions('voice', 1);
    const [improvPrev, improvLast] = await lastSessions('improv', 2);
    const [auditionLast] = await lastSessions('audition', 1);
    const [kidsLast] = await lastSessions('kids', 1);
    const s = (key: string) => studentIds[key]!;
    const drive = (code: string) => `https://drive.google.com/file/d/demo-${code}/view`;

    interface Step {
      by: ReturnType<typeof as>;
      path: string;
      body?: unknown;
      /** Minutes ago, to backdate the step and its history entry. */
      at: number;
      /** It happened today ("approved this morning"): kept on the school's today even just after midnight (schoolTodayAgo). */
      today?: boolean;
    }
    interface VideoSpec {
      by: ReturnType<typeof as>;
      session: { id: number; date: string } | undefined;
      title: string;
      kind: string;
      raw: string;
      notes?: string;
      students: string[];
      /** Days from today; default tomorrow from when it was added (left to the API when the video is added today). */
      dueIn?: number;
      addedAgo: number;
      /** Added today ("this morning"): kept on the school's today even just after midnight (schoolTodayAgo). */
      addedToday?: boolean;
      steps: Step[];
      /** Alerts still unread in the bell (the newest step's), the rest long read. */
      unread?: boolean;
    }
    const specs: VideoSpec[] = [
      // New — added yesterday evening after class, due today.
      {
        by: layla,
        session: screenLast,
        title: 'Screen Acting I — the two-hander',
        kind: 'scene',
        raw: drive('raw-screen-two-hander'),
        notes: 'Two takes of the two-hander: use take 2 for the wide shot, take 1 for Chloe’s close-up. Keep it under 3 minutes.',
        students: ['maya', 'chloe'],
        dueIn: 0,
        addedAgo: 14 * 60,
        steps: [],
        unread: true,
      },
      // New — added this morning, due tomorrow (the API's default).
      {
        by: daniel,
        session: improvLast,
        title: 'Improvisation Lab — status games',
        kind: 'exercise',
        raw: 'https://we.tl/t-demo-improv-status',
        notes: 'Just the second half (from 0:35:00). Light cut, no music.',
        students: ['ethan', 'rami', 'hana', 'oliver'],
        addedAgo: 50,
        addedToday: true,
        steps: [],
        unread: true,
      },
      // New — and late: due two days ago, nobody has taken it yet.
      {
        by: layla,
        session: voiceLast,
        title: 'Voice & Speech — Darwish monologue',
        kind: 'monologue',
        raw: drive('raw-voice-darwish'),
        notes: 'Salma’s monologue, in Arabic. Subtitles in English please.',
        students: ['salma'],
        dueIn: -2,
        addedAgo: 3 * DAY,
        steps: [],
        unread: true,
      },
      // Being edited.
      {
        by: layla,
        session: auditionLast,
        title: 'Audition Technique — self-tape practice',
        kind: 'showreel',
        raw: drive('raw-audition-selftapes'),
        notes: 'One clip per student, slate first.',
        students: ['maya', 'ethan', 'grace', 'kareem'],
        dueIn: 1,
        addedAgo: DAY + 120,
        steps: [{ by: hany, path: 'take', at: 5 * 60 }],
      },
      // Waiting for the reviewer's check.
      {
        by: layla,
        session: screenPrev,
        title: 'Screen Acting I — close-up practice',
        kind: 'exercise',
        raw: drive('raw-screen-closeups'),
        students: ['kareem', 'farah', 'isabella'],
        dueIn: -1,
        addedAgo: 2 * DAY + 180,
        steps: [
          { by: hany, path: 'take', at: DAY + 300 },
          { by: hany, path: 'submit', body: { editedLink: 'https://youtu.be/demo-closeups', notes: 'Colour fixed on the second camera. Three clips, one per student.' }, at: 95 },
        ],
        unread: true,
      },
      {
        by: daniel,
        session: improvPrev,
        title: 'Improvisation Lab — the Harold',
        kind: 'performance',
        raw: drive('raw-improv-harold'),
        students: ['maya', 'chloe', 'youssef', 'isabella'],
        dueIn: -2,
        addedAgo: 7 * DAY + 60,
        steps: [
          { by: hany, path: 'take', at: 3 * DAY },
          { by: hany, path: 'submit', body: { editedLink: drive('edit-improv-harold'), notes: null }, at: 30 },
        ],
        unread: true,
      },
      // Sent back with changes.
      {
        by: daniel,
        session: kidsLast,
        title: 'Kids Drama — freeze frames',
        kind: 'exercise',
        raw: drive('raw-kids-freeze'),
        notes: 'For the parents’ group. Only children with photo consent.',
        students: ['adam', 'maryam', 'layan'],
        dueIn: 0,
        addedAgo: 3 * DAY,
        steps: [
          { by: hany, path: 'take', at: 2 * DAY },
          { by: hany, path: 'submit', body: { editedLink: 'https://youtu.be/demo-kids-freeze-v1', notes: 'Added music under the games.' }, at: DAY + 200 },
          { by: daniel, path: 'request-changes', body: { note: 'The music is too loud at 0:42, and please cut the ending before the bows.' }, at: 180 },
        ],
        unread: true,
      },
      // Approved this week — one this morning (Layla's alert still unread), one two days ago with a comment.
      {
        by: layla,
        session: screenPrev,
        title: 'Screen Acting I — eyelines drill',
        kind: 'exercise',
        raw: drive('raw-screen-eyelines'),
        students: ['youssef', 'rami', 'nadine'],
        dueIn: -2,
        addedAgo: 3 * DAY,
        steps: [
          { by: hany, path: 'take', at: 2 * DAY + 60 },
          { by: hany, path: 'submit', body: { editedLink: 'https://youtu.be/demo-eyelines', notes: null }, at: DAY },
          // This morning: the coach's "approved this week" counts on it whatever the hour the seed runs.
          { by: daniel, path: 'approve', at: 70, today: true },
        ],
        unread: true,
      },
      {
        by: daniel,
        session: kidsLast,
        title: 'Kids Drama — story circle',
        kind: 'exercise',
        raw: drive('raw-kids-story'),
        students: ['lina', 'zain', 'sami'],
        dueIn: -2,
        addedAgo: 3 * DAY + 30,
        steps: [
          { by: hany, path: 'take', at: 3 * DAY - 120 },
          { by: hany, path: 'comments', body: { note: 'Sami is cut off on the left in the first minute — I’ll crop to the middle.' }, at: 3 * DAY - 150 },
          { by: daniel, path: 'comments', body: { note: 'Fine, go ahead.' }, at: 3 * DAY - 160 },
          { by: hany, path: 'submit', body: { editedLink: drive('edit-kids-story'), notes: 'Cropped to the middle.' }, at: 2 * DAY + 60 },
          { by: daniel, path: 'approve', at: 2 * DAY },
        ],
      },
      // Approved last term-week: Maya's showreel, already on her actor profile.
      {
        by: layla,
        session: undefined,
        title: 'Maya Collins — showreel 2026',
        kind: 'showreel',
        raw: drive('raw-maya-showreel'),
        notes: 'Best of her scenes this term, 90 seconds.',
        students: ['maya'],
        dueIn: -12,
        addedAgo: 15 * DAY,
        steps: [
          { by: hany, path: 'take', at: 14 * DAY },
          { by: hany, path: 'submit', body: { editedLink: 'https://youtu.be/demo-maya-showreel', notes: '92 seconds, music cleared.' }, at: 11 * DAY },
          { by: daniel, path: 'approve', at: 10 * DAY },
        ],
      },
    ];

    for (const v of specs) {
      const created = await v.by.post<{ id: number }>('/videos', {
        ...(v.session ? { sessionId: v.session.id } : { courseId: courseIds.screen }),
        title: v.title,
        kind: v.kind,
        rawLink: v.raw,
        notesForEditor: v.notes ?? null,
        studentIds: v.students.map(s),
        ...(v.dueIn !== undefined ? { dueOn: addDays(today, v.dueIn) } : {}),
      });
      for (const step of v.steps) await step.by.post(`/videos/${created.id}/${step.path}`, step.body);
      // Backdate: the video, each history entry (in the order they were written), and the alerts.
      const at = (minutes: number, onToday?: boolean) => (onToday ? schoolTodayAgo(timeZone, minutes) : ago(minutes));
      const stamps = [at(v.addedAgo, v.addedToday), ...v.steps.map((st) => at(st.at, st.today))];
      const events = db.select({ id: videoEvents.id }).from(videoEvents).where(eq(videoEvents.videoId, created.id)).orderBy(asc(videoEvents.id)).all();
      events.forEach((e, i) => db.update(videoEvents).set({ createdAt: stamps[i] ?? Date.now() }).where(eq(videoEvents.id, e.id)).run());
      const stampOf = (path: string) => {
        const i = v.steps.map((st) => st.path).lastIndexOf(path);
        return i < 0 ? null : stamps[i + 1]!;
      };
      const last = stamps[stamps.length - 1]!;
      db.update(videos)
        .set({
          createdAt: stamps[0],
          updatedAt: last,
          takenAt: stampOf('take'),
          submittedAt: stampOf('submit'),
          decidedAt: stampOf('approve') ?? stampOf('request-changes'),
        })
        .where(eq(videos.id, created.id))
        .run();
      const alerts = eq(notifications.link, `/videos/${created.id}`);
      db.update(notifications).set({ createdAt: last }).where(alerts).run();
      // Alerts done with along the way (taken, decided) were read then; without `unread`, the newest too.
      db.update(notifications)
        .set({ readAt: last + 5 * 60_000 })
        .where(v.unread ? and(alerts, isNotNull(notifications.readAt)) : alerts)
        .run();
    }
  }

  /**
   * Everyone's profile photo (generated portraits, like the talent's; the two
   * coaches look as they do on the website), a few photos and documents on
   * workshops and castings, three conversations and one answered call to the
   * office — all through the API, then backdated so the morning looks lived in.
   */
  async function seedTeam() {
    async function upload(client: ReturnType<typeof as>, bytes: Uint8Array, name: string, type: string): Promise<string> {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
      return (await client.post<{ id: string }>('/files', form)).id;
    }
    const portrait = (client: ReturnType<typeof as>, person: number, gender: Gender, hair: string | null, name: string, variant = 0) =>
      upload(client, renderPortrait(lookFor(person, gender, { hair, variant })), name, 'image/png');

    // Profile photos: the CEO sets his own, and everyone else's from the staff page.
    // (Layla and Daniel use the same looks as their website coach photos: 300 and 301.)
    const looks: { key: keyof typeof staff | 'karim'; person: number; gender: Gender; hair: string | null }[] = [
      { key: 'karim', person: 410, gender: 'male', hair: 'Grey' },
      { key: 'cfo', person: 411, gender: 'male', hair: 'Black' },
      { key: 'director', person: 412, gender: 'female', hair: 'Dark brown' },
      { key: 'head', person: 413, gender: 'male', hair: 'Black' },
      { key: 'casting', person: 414, gender: 'male', hair: 'Brown' },
      { key: 'editor', person: 415, gender: 'male', hair: 'Black' },
      { key: 'layla', person: 300, gender: 'female', hair: 'Black' },
      { key: 'daniel', person: 301, gender: 'male', hair: 'Brown' },
      { key: 'reception', person: 417, gender: 'female', hair: 'Dark brown' },
      { key: 'helper', person: 418, gender: 'male', hair: 'Black' },
    ];
    for (const l of looks) {
      const fileId = await portrait(owner, l.person, l.gender, l.hair, `${l.key}.png`);
      if (l.key === 'karim') await owner.put('/auth/photo', { fileId });
      else await owner.put(`/staff/${staff[l.key]}/photo`, { fileId });
    }

    // Workshop photos & files: the coaches add rehearsal photos; the director adds the term plan.
    const reh1 = await portrait(layla, people.get('maya') ?? 0, 'female', 'Auburn', 'rehearsal-scene-two-hander.png', 2);
    await layla.post(`/courses/${courseIds.screen}/files`, { fileId: reh1, caption: 'Scene work: the two-hander, last Thursday' });
    const reh2 = await portrait(layla, people.get('kareem') ?? 1, 'male', 'Black', 'rehearsal-close-up.png', 3);
    await layla.post(`/courses/${courseIds.screen}/files`, { fileId: reh2, caption: 'Close-up practice' });
    const running = await upload(
      daniel,
      renderPdf('Showcase running order', ['1. Warm-up games (all)', '2. Freeze frames: "The Market"', '3. Story circle', '4. Masks', '5. Bows and photos with parents']),
      'Showcase running order.pdf',
      'application/pdf',
    );
    await daniel.post(`/courses/${courseIds.kids}/files`, { fileId: running, caption: 'For the last Saturday' });
    const plan = await upload(
      director,
      renderPdf('Voice & Speech - term plan', ['Weeks 1-3: breath and support', 'Weeks 4-6: resonance and articulation', 'Weeks 7-9: projection in the big room', 'Week 10: text work (English and Arabic)']),
      'Voice and Speech term plan.pdf',
      'application/pdf',
    );
    await director.post(`/courses/${courseIds.voice}/files`, { fileId: plan, caption: 'Term plan' });

    // Casting files: the breakdown for the theatre casting, a reference photo for the series.
    const falaki = castingIds['A Midsummer Night’s Dream'];
    if (falaki) {
      const breakdown = await upload(
        agent,
        renderPdf('A Midsummer Night\'s Dream - breakdown', ['Falaki Theatre, spring season', 'Puck: 18-30, quick and physical', 'Helena: 20-30, lovesick and determined', 'Bottom: 30-50, comic timing essential', 'Rehearsals: six weeks, paid']),
        'Midsummer breakdown.pdf',
        'application/pdf',
      );
      await agent.post(`/castings/${falaki}/files`, { fileId: breakdown, caption: 'Breakdown from the director' });
    }
    const series = castingIds['بيت العائلة — الموسم الثاني'];
    if (series) {
      const ref = await portrait(agent, 416, 'female', 'Grey', 'grandmother-reference.png');
      await agent.post(`/castings/${series}/files`, { fileId: ref, caption: 'Look reference for the grandmother' });
    }

    // Chat: three conversations (one in Arabic, one with a photo, one with a document).
    const tarek = await login('casting');
    const sent: { id: number; minutesAgo: number }[] = [];
    async function say(client: ReturnType<typeof as>, conversationId: number, minutesAgo: number, body: string | null, fileIds?: string[]) {
      const m = await client.post<{ id: number }>(`/chat/conversations/${conversationId}/messages`, { body, ...(fileIds ? { fileIds } : {}) });
      sent.push({ id: m.id, minutesAgo });
      return m.id;
    }
    const withLayla = (await director.post<{ id: number }>('/chat/conversations', { userId: staff.layla })).id;
    await say(director, withLayla, 185, 'Good morning Layla! Could you send me a photo from last night’s Screen Acting class? For Instagram.');
    const shot = await portrait(layla, people.get('chloe') ?? 2, 'female', 'Blonde', 'class-photo.png', 4);
    const laylaLast = await say(layla, withLayla, 170, 'Of course — Chloe in the two-hander. She was wonderful.', [shot]);
    await say(director, withLayla, 160, 'Perfect, thank you! Posting it at lunchtime.');
    await layla.post(`/chat/conversations/${withLayla}/read`, { messageId: laylaLast });

    const withKarim = (await director.post<{ id: number }>('/chat/conversations', { userId: setupOwnerId })).id;
    await say(director, withKarim, 95, 'صباح الخير أستاذ كريم، ورشة الأطفال اكتمل عددها هذا الأسبوع.');
    await say(owner, withKarim, 80, 'ممتاز يا داليا، شكرًا. هل نفتح مجموعة ثانية يوم الجمعة؟');

    const withTarek = (await agent.post<{ id: number }>('/chat/conversations', { userId: staff.casting })).id;
    const sides = await upload(agent, renderPdf('Puck - audition sides', ['Act 2, Scene 1: "Thou speak\'st aright"', 'Act 3, Scene 2: "Captain of our fairy band"', 'Please learn both; readers will be provided.']), 'Puck sides.pdf', 'application/pdf');
    await say(agent, withTarek, 60, 'طارق، دي مشاهد تجربة الأداء لدور باك. ابعتها للممثلين المرشحين النهارده.', [sides]);
    await say(tarek, withTarek, 52, 'تمام، هبعتها لليو وإيثان دلوقتي.');

    // A call to the office: the director called Tarek, who's on his way.
    const call = await director.post<{ id: number }>('/summons', { userId: staff.casting, note: 'Please bring the Falaki shortlist.' });
    await tarek.post(`/summons/${call.id}/answer`, { status: 'on_my_way' });

    // Backdate (the API stamps everything "now"): each message, its conversation, the notifications.
    const ago = (minutes: number) => Date.now() - minutes * 60_000;
    for (const m of sent) db.update(messages).set({ createdAt: ago(m.minutesAgo) }).where(eq(messages.id, m.id)).run();
    for (const conv of [withLayla, withKarim, withTarek]) {
      const newest = db.select({ at: max(messages.createdAt) }).from(messages).where(eq(messages.conversationId, conv)).get()?.at ?? Date.now();
      db.update(conversations).set({ lastMessageAt: newest }).where(eq(conversations.id, conv)).run();
      db.update(notifications).set({ createdAt: newest }).where(and(eq(notifications.kind, 'message'), eq(notifications.link, `/messages/${conv}`))).run();
    }
    db.update(summons).set({ createdAt: ago(40), answeredAt: ago(38) }).where(eq(summons.id, call.id)).run();
    db.update(notifications).set({ createdAt: ago(40) }).where(and(eq(notifications.kind, 'summon'), eq(notifications.link, summonsInboxLink(call.id, staff.director)))).run();
    db.update(notifications).set({ createdAt: ago(38) }).where(and(eq(notifications.kind, 'summon_answer'), eq(notifications.link, summonsLink(call.id)))).run();
  }

  return {
    ok: true,
    logins: DEMO_LOGINS,
    counts: {
      students: studentSpec.length + 1,
      classes: courseSpec.length,
      talent: talentSpec.length,
      castings: castingSpec.length,
      enquiries: leadSpec.length,
    },
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

// ── The website demo ────────────────────────────────────────────────────────

export interface SeedDemoWebsiteOptions {
  db: DB;
  /** Where the coach photos and the applicants' photos go (the app's FileStore). */
  files: FileStore;
  /** The school's time zone ("today" for ages, workshops on the site, backdated timestamps). */
  timeZone: string;
  /** "YYYY-MM-DD" to seed as if it were that day; default today in timeZone. */
  today?: string;
}

/** The demo workshops' public texts, by course name (the demo school's courses). */
const DEMO_WORKSHOP_TEXTS: Record<
  string,
  { titleAr: string; descriptionEn: string; descriptionAr: string; visible: boolean; accepting: boolean }
> = {
  'Screen Acting I': {
    titleAr: 'التمثيل أمام الكاميرا 1',
    descriptionEn: 'Acting for the camera from the first day: eyelines, continuity and playing small.\n\nEvery student leaves with two filmed scenes for their showreel.',
    descriptionAr: 'التمثيل أمام الكاميرا من أول يوم: اتجاه النظر، والراكور، والأداء الهادئ.\n\nكل طالب يخرج بمشهدين مصوَّرين لملف أعماله.',
    visible: true,
    accepting: true,
  },
  'Kids Drama (8–12)': {
    titleAr: 'دراما الأطفال (8–12)',
    descriptionEn: 'Games, storytelling and a short play at the end of the term. Parents are welcome at the last session.',
    descriptionAr: 'ألعاب وحكايات ومسرحية قصيرة في نهاية الدورة. أولياء الأمور مدعوون لحضور الحصة الأخيرة.',
    visible: true,
    accepting: true,
  },
  'Voice & Speech': {
    titleAr: 'الصوت والإلقاء',
    descriptionEn: 'Breath, resonance, clear speech and projection, with texts in Arabic and English.',
    descriptionAr: 'التنفس والرنين ووضوح النطق وقوة الصوت، بنصوص عربية وإنجليزية.',
    visible: true,
    // Nearly full: shown, without the apply form.
    accepting: false,
  },
  'Improvisation Lab': {
    titleAr: 'معمل الارتجال',
    descriptionEn: 'Short and long improvisation: saying "yes, and", playing status, and building scenes from nothing.',
    descriptionAr: 'ارتجال قصير وطويل: قول «نعم، و»، ولعب المكانة، وبناء المشاهد من لا شيء.',
    visible: true,
    accepting: true,
  },
  'Audition Technique': {
    titleAr: 'تقنيات تجارب الأداء',
    descriptionEn: 'Self-tapes, cold reads and choosing monologues, for students getting ready for castings.',
    descriptionAr: 'التسجيل الذاتي والقراءة الأولى واختيار المونولوج، للطلاب المستعدين لتجارب الأداء.',
    // Prepared, not shown yet.
    visible: false,
    accepting: true,
  },
};

/**
 * The website part of the demo: studio texts and contact lines (the studio's
 * real public WhatsApp lines from its Instagram; the rest invented and meant to
 * be edited), coach profiles for the demo coach accounts, the demo workshops
 * shown (no prices: the school's decision), an open casting call, three custom links, four casting
 * applications with generated portraits (one a minor with guardian consent) and
 * two website enquiries. Written straight to the database with the same
 * library functions the API and the public forms use. Only adds rows: the
 * caller checks the website is still empty (POST /api/admin/seed-demo-website:
 * no 'site' key and no coaches).
 */
export async function seedDemoWebsite(opts: SeedDemoWebsiteOptions): Promise<SeedDemoWebsiteResult> {
  const { db, files, timeZone } = opts;
  const today = opts.today ?? todayIn(timeZone);
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const dobFor = (age: number, md: string) => {
    const [m, d] = md.split('-').map(Number) as [number, number];
    const hadBirthday = m < tm || (m === tm && d <= td);
    return `${ty - age - (hadBirthday ? 0 : 1)}-${md}`;
  };
  /** "That day at 11:00" (never in the future; today's never on yesterday, even just after midnight: schoolTodayAgo). */
  const stamp = (daysAgo: number, time = '11:00') =>
    Math.min(epochAt(timeZone, addDays(today, -daysAgo), time), daysAgo === 0 ? schoolTodayAgo(timeZone, 1) : Date.now() - 60_000);

  // ── Studio info, casting call, links ──
  const content: SiteContentParsed = {
    // The demo is made up: it never goes public by itself. Someone with website.manage switches the
    // website on ("Website is public") once the texts, coaches and workshops are the studio's own.
    published: false,
    tagline: { en: 'Acting workshops and casting in Giza', ar: 'ورش تمثيل وكاستينج في الجيزة' },
    about: {
      en:
        'Turquoise Studio is an acting school and casting studio in Mohandessin, Giza. We run small, practical workshops for beginners, teenagers and working actors: acting for the camera, voice, improvisation and audition technique, led by coaches who work in film, TV and theatre.\n\n' +
        'Our casting team puts actors forward for films, series and commercials, so students can take what they learn straight to real auditions. Come and visit, watch a session, and find the workshop that fits you.',
      ar:
        'استوديو تركواز مدرسة تمثيل واستوديو كاستينج في المهندسين بالجيزة. نقدّم ورشًا عملية بمجموعات صغيرة للمبتدئين والمراهقين والممثلين المحترفين: التمثيل أمام الكاميرا، والصوت والإلقاء، والارتجال، وتقنيات تجارب الأداء، مع مدربين يعملون في السينما والتلفزيون والمسرح.\n\n' +
        'يرشّح فريق الكاستينج لدينا الممثلين لأفلام ومسلسلات وإعلانات، فينقل الطلاب ما يتعلمونه مباشرة إلى تجارب أداء حقيقية. زورونا، واحضروا حصة، واختاروا الورشة التي تناسبكم.',
    },
    address: { en: 'Mohandessin, Giza', ar: 'المهندسين، الجيزة' },
    mapUrl: 'https://maps.google.com/?q=Mohandessin%2C%20Giza',
    instagram: 'turquoisecastingstudio',
    whatsappWorkshops: '01094635959',
    whatsappCasting: '01119003100',
    phone: '01094635959',
    email: null,
    heroFileId: null,
    castingCall: {
      open: true,
      intro: {
        en: 'We are building our roster for new films, series and commercials this season. Send us your details and a few recent photos. Some roles need no experience at all.',
        ar: 'نبني قائمة الممثلين لدينا لأفلام ومسلسلات وإعلانات جديدة هذا الموسم. أرسل بياناتك وبعض الصور الحديثة. بعض الأدوار لا تحتاج إلى أي خبرة.',
      },
      lookingFor: {
        en: 'Men and women of all ages, especially 18 to 35.\n\nChildren aged 8 to 14, with a parent’s consent.\n\nPeople who speak English or French as well as Arabic.',
        ar: 'رجال وسيدات من كل الأعمار، خاصة من 18 إلى 35 سنة.\n\nأطفال من 8 إلى 14 سنة، بموافقة وليّ الأمر.\n\nمن يتحدثون الإنجليزية أو الفرنسية إلى جانب العربية.',
      },
    },
    links: [
      { id: null, label: { en: 'Find us on Google Maps', ar: 'موقعنا على خرائط جوجل' }, url: 'https://maps.google.com/?q=Mohandessin%2C%20Giza', visible: true },
      { id: null, label: { en: 'Student showreel 2026', ar: 'فيديو أعمال الطلاب 2026' }, url: 'https://vimeo.com/stageleft/turquoise-showreel', visible: true },
      { id: null, label: { en: 'Parents: kids workshop questions', ar: 'لأولياء الأمور: أسئلة ورشة الأطفال' }, url: 'https://example.com/turquoise/kids-faq', visible: false },
    ],
  };
  saveSiteContent(db, content);

  // ── Coaches (photos stored like uploads, uploadedBy null) ──
  async function storePortrait(person: number, gender: Gender, hair: string | null, name: string): Promise<string> {
    const png = renderPortrait(lookFor(person, gender, { hair }));
    const id = randomUUID();
    const storageKey = `${id}.png`;
    await files.put(storageKey, png, 'image/png');
    db.insert(filesTable).values({ id, originalName: name, mime: 'image/png', size: png.byteLength, storageKey, uploadedBy: null }).run();
    return id;
  }
  const accounts = new Map(
    db
      .select({ id: users.id, email: users.email, active: users.active })
      .from(users)
      .where(inArray(users.email, ['coach@demo.school', 'coach2@demo.school', 'director@demo.school']))
      .all()
      .map((u) => [u.email, u]),
  );
  const activeAccount = (email: string) => {
    const u = accounts.get(email);
    return u?.active ? u.id : null;
  };
  const coachSpec = [
    {
      email: 'coach@demo.school',
      nameEn: 'Layla Haddad',
      nameAr: 'ليلى حداد',
      titleEn: 'Screen acting and audition coach',
      titleAr: 'مدربة التمثيل أمام الكاميرا وتجارب الأداء',
      bioEn: 'Layla has acted in Egyptian and Lebanese series for fifteen years. She teaches acting for the camera and helps students prepare self-tapes for real castings.',
      bioAr: 'مثّلت ليلى في مسلسلات مصرية ولبنانية على مدى خمسة عشر عامًا. تدرّس التمثيل أمام الكاميرا وتساعد الطلاب على تحضير تسجيلاتهم لتجارب أداء حقيقية.',
      gender: 'female' as Gender,
      hair: 'Black',
      visible: true,
    },
    {
      email: 'coach2@demo.school',
      nameEn: 'Daniel Price',
      nameAr: 'دانيال برايس',
      titleEn: 'Improvisation and kids drama coach',
      titleAr: 'مدرب الارتجال ودراما الأطفال',
      bioEn: 'Daniel trained in London and has led improvisation groups in Cairo since 2018. Children love his Saturday drama workshop.',
      bioAr: 'تدرّب دانيال في لندن ويقود مجموعات الارتجال في القاهرة منذ 2018. الأطفال يحبون حصة الدراما التي يقدّمها يوم السبت.',
      gender: 'male' as Gender,
      hair: 'Brown',
      visible: true,
    },
    {
      email: null,
      nameEn: 'Hassan Lotfy',
      nameAr: 'حسن لطفي',
      titleEn: 'Guest theatre director',
      titleAr: 'مخرج مسرحي ضيف',
      bioEn: 'Theatre director at Falaki Theatre. Leads a two-day masterclass each spring.',
      bioAr: 'مخرج مسرحي في مسرح الفلكي. يقدّم ورشة مكثفة لمدة يومين كل ربيع.',
      gender: 'male' as Gender,
      hair: 'Grey',
      // Prepared, not shown yet.
      visible: false,
    },
  ];
  for (const [i, spec] of coachSpec.entries()) {
    const photoFileId = await storePortrait(300 + i, spec.gender, spec.hair, `coach-${i + 1}.png`);
    db.insert(siteCoaches)
      .values({
        userId: spec.email ? activeAccount(spec.email) : null,
        nameEn: spec.nameEn,
        nameAr: spec.nameAr,
        titleEn: spec.titleEn,
        titleAr: spec.titleAr,
        bioEn: spec.bioEn,
        bioAr: spec.bioAr,
        photoFileId,
        visible: spec.visible,
        sortOrder: i,
      })
      .run();
  }

  // ── Workshops on the site: the demo courses by name, else the first four active ones ──
  const active = db
    .select({ id: courses.id, name: courses.name })
    .from(courses)
    .where(and(eq(courses.status, 'active'), gte(courses.endDate, today)))
    .orderBy(asc(courses.startDate), asc(courses.name), asc(courses.id))
    .all();
  const known = active.filter((c) => DEMO_WORKSHOP_TEXTS[c.name]);
  const chosen = known.length ? known : active.slice(0, 4);
  for (const [i, course] of chosen.entries()) {
    const t = DEMO_WORKSHOP_TEXTS[course.name];
    db.insert(siteWorkshops)
      .values({
        courseId: course.id,
        visible: t?.visible ?? true,
        titleAr: t?.titleAr ?? '',
        descriptionEn: t?.descriptionEn ?? '',
        descriptionAr: t?.descriptionAr ?? '',
        acceptingApplications: t?.accepting ?? true,
        sortOrder: i,
      })
      .onConflictDoNothing()
      .run();
  }

  // ── Casting applications (as if sent from the public form) ──
  const applicationSpec = [
    {
      form: { firstName: 'Mariam', lastName: 'Hosny', gender: 'female', dateOfBirth: dobFor(22, '04-12'), phone: '+20 101 555 7001', email: 'mariam.hosny@example.com', city: 'Cairo', heightCm: '165', languages: 'Arabic, English', skills: 'Dance, Singing', experience: 'Two short films at university and three years in a theatre club.', links: 'https://www.instagram.com/mariam.hosny.acts/', message: 'I would love to audition for TV series.', locale: 'en' },
      hair: 'Dark brown',
      photos: 2,
      daysAgo: 1,
    },
    {
      form: { firstName: 'أحمد', lastName: 'سامي', gender: 'male', dateOfBirth: dobFor(27, '09-03'), phone: '0112 555 7002', city: 'الجيزة', heightCm: '180', languages: 'العربية، الإنجليزية', skills: 'كرة القدم، ركوب الخيل', experience: 'إعلانان تلفزيونيان ودور صغير في مسلسل رمضاني.', links: 'https://vimeo.com/stageleft/ahmed-samy', message: 'متاح للتصوير خارج القاهرة.', locale: 'ar' },
      hair: 'Black',
      photos: 1,
      daysAgo: 2,
    },
    {
      // A minor: her father's details and consent.
      form: { firstName: 'جنى', lastName: 'وائل', gender: 'female', dateOfBirth: dobFor(14, '06-20'), phone: '0100 555 7003', city: 'القاهرة', heightCm: '152', languages: 'العربية، الفرنسية', skills: 'باليه، غناء', guardianName: 'وائل محمود', guardianPhone: '0100 555 7099', guardianConsent: 'on', message: 'تحب التمثيل وشاركت في مسرحية المدرسة.', locale: 'ar' },
      hair: 'Brown',
      photos: 2,
      daysAgo: 3,
    },
    {
      form: { firstName: 'Omar', lastName: 'Khalil', gender: 'male', dateOfBirth: dobFor(34, '11-28'), phone: '+20 122 555 7004', email: 'omar.khalil@example.com', city: 'Alexandria', heightCm: '178', languages: 'Arabic, English, French', skills: 'Stage combat, Driving', experience: 'Ten years of theatre in Alexandria and one feature film.', locale: 'en' },
      hair: 'Grey',
      photos: 1,
      daysAgo: 6,
      reviewing: true,
    },
  ];
  const director = activeAccount('director@demo.school');
  const castingForm = castingApplicationInput(today);
  for (const [i, spec] of applicationSpec.entries()) {
    const input = castingForm.parse({ ...spec.form, privacyConsent: 'on' });
    const photos = Array.from({ length: spec.photos }, (_, v) => ({
      data: renderPortrait(lookFor(320 + i, input.gender, { hair: spec.hair, variant: v })),
      name: `photo-${v + 1}.png`,
    }));
    const { id } = await createCastingApplication(db, files, input, photos);
    const at = stamp(spec.daysAgo, `1${i}:30`);
    db.update(castingApplications)
      .set({
        createdAt: at,
        updatedAt: at,
        ...(spec.reviewing ? { status: 'reviewing' as const, reviewedById: director, reviewedAt: stamp(spec.daysAgo - 2) } : {}),
      })
      .where(eq(castingApplications.id, id))
      .run();
  }

  // ── Website enquiries (as if sent from the apply forms) ──
  const screen = chosen.find((c) => c.name === 'Screen Acting I') ?? chosen[0];
  const screenOnSite = screen ? findPublicWorkshop(db, screen.id, today) : null;
  const enquirySpec = [
    {
      form: { firstName: 'Laila', lastName: 'Mostafa', phone: '+20 106 555 7010', email: 'laila.mostafa@example.com', dateOfBirth: dobFor(24, '02-14'), experience: 'some', heardFrom: 'instagram', message: 'Do you have evening times? I work until 5.', locale: 'en' },
      courseId: screenOnSite?.acceptingApplications ? screenOnSite.courseId : null,
      daysAgo: 0,
    },
    {
      form: { firstName: 'يوسف', lastName: 'عمرو', phone: '0111 555 7011', dateOfBirth: dobFor(16, '08-01'), experience: 'none', heardFrom: 'friend', message: 'ابني عنده 16 سنة ويحب التمثيل. أي ورشة تناسبه؟', guardianName: 'عمرو حسين', guardianPhone: '0111 555 7012', guardianConsent: 'on', locale: 'ar' },
      courseId: null,
      daysAgo: 1,
    },
  ];
  const applyForm = siteApplyInput(today);
  let enquiries = 0;
  for (const spec of enquirySpec) {
    const { leadId, created } = createWebsiteLead(db, applyForm.parse({ ...spec.form, privacyConsent: 'on' }), { courseId: spec.courseId, today });
    if (!created) continue;
    enquiries++;
    const at = stamp(spec.daysAgo, '09:15');
    db.update(leads).set({ createdAt: at, updatedAt: at }).where(eq(leads.id, leadId)).run();
    db.update(leadActivities).set({ createdAt: at }).where(eq(leadActivities.leadId, leadId)).run();
  }

  return {
    ok: true,
    coaches: coachSpec.length,
    workshops: chosen.length,
    applications: applicationSpec.length,
    enquiries,
  };
}
