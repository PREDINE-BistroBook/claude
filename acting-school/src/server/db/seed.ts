/**
 * Demo data for trying the app: `npm run seed` (add `-- --reset` to wipe and start over).
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
 * Logins (password demo1234 for all) — fictional people in the school's real positions:
 *   owner@demo.school     CEO                      (Karim Mansour)
 *   cfo@demo.school       CFO                      (Hisham Mansour)
 *   director@demo.school  Executive Director       (Dalia Fathy)
 *   head@demo.school      Head of Casting          (Sherif Adel)
 *   casting@demo.school   Casting team             (Tarek Samir)
 *   editor@demo.school    Video editor             (Hany Nabil)
 *   coach@demo.school     Acting coach             (Layla Haddad — teaches classes)
 *   coach2@demo.school    Acting coach + Finance   (Daniel Price — teaches classes)
 *   tom.wilkins@demo.school  former Acting coach, deactivated
 */
import { and, count, eq, gt, max } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { addDays, parseDate, todayISO, weekdayOf } from '../../shared/dates';
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
import type { CourseDetail, CourseEnrollment } from '../../shared/schemas/courses';
import type { Position } from '../../shared/schemas/positions';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { createDb } from './client';
import { enrollments, interviews, leadActivities, leads, users } from './schema';
import { lookFor, renderPortrait } from './seedPortraits';

const PASSWORD = 'demo1234';
const started = Date.now();
const args = new Set(process.argv.slice(2));
const config = loadConfig();
const dbPath = path.join(config.dataDir, 'app.db');

if (args.has('--reset')) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  fs.rmSync(config.uploadsDir, { recursive: true, force: true });
}

const db = createDb(dbPath);
const existing = db.select({ n: count() }).from(users).get()?.n ?? 0;
if (existing > 0) {
  console.error(
    `\nThe database at ${dbPath} already has ${existing} staff account(s), so nothing was changed.\n` +
      'To wipe it (app.db and uploads/) and load the demo data instead, run:\n\n  npm run seed -- --reset\n',
  );
  process.exit(1);
}

const app = createApp({ db, config });

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
  const res = await app.request(`/api${url}`, { method, headers, body: reqBody });
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

async function login(email: string) {
  const { cookie } = await call(null, 'POST', '/auth/login', { email, password: PASSWORD });
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

const today = todayISO();
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
  schoolName: 'Stage Left Academy',
  name: 'Karim Mansour',
  email: 'owner@demo.school',
  password: PASSWORD,
  locale: 'en',
});
const owner = as(setup.cookie!);
await owner.patch('/settings', { weekStartsOn: 1, defaultLocale: 'en' });

// The built-in positions exist from the start; staff are given them by key.
const positionIds = Object.fromEntries((await owner.get<{ items: Position[] }>('/positions')).items.map((p) => [p.key, p.id])) as Record<BuiltInPositionKey, number>;

const staffSpec: { key: string; name: string; email: string; positions: BuiltInPositionKey[]; phone: string | null; locale?: 'ar' | 'en' }[] = [
  { key: 'cfo', name: 'Hisham Mansour', email: 'cfo@demo.school', positions: ['cfo'], phone: '+20 100 555 0100' },
  { key: 'director', name: 'Dalia Fathy', email: 'director@demo.school', positions: ['executive_director'], phone: '+20 100 555 0101' },
  { key: 'head', name: 'Sherif Adel', email: 'head@demo.school', positions: ['head_of_casting'], phone: '+20 100 555 0104', locale: 'ar' },
  { key: 'casting', name: 'Tarek Samir', email: 'casting@demo.school', positions: ['casting_team'], phone: '+20 100 555 0105' },
  { key: 'editor', name: 'Hany Nabil', email: 'editor@demo.school', positions: ['video_editor'], phone: '+20 100 555 0106' },
  { key: 'layla', name: 'Layla Haddad', email: 'coach@demo.school', positions: ['acting_coach'], phone: '+20 100 555 0102' },
  // Coaches and also keeps the books (one person, two positions: their permissions add up).
  { key: 'daniel', name: 'Daniel Price', email: 'coach2@demo.school', positions: ['acting_coach', 'finance'], phone: '+20 100 555 0103' },
  // Taught the (now archived) Shakespeare course; deactivated at the end.
  { key: 'tom', name: 'Tom Wilkins', email: 'tom.wilkins@demo.school', positions: ['acting_coach'], phone: null },
];
const staff: Record<string, number> = {};
for (const s of staffSpec) {
  const { key, positions, ...input } = s;
  const created = await owner.post<{ id: number }>('/staff', { ...input, positionIds: positions.map((k) => positionIds[k]), password: PASSWORD });
  staff[key] = created.id;
}

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

const layla = await login('coach@demo.school');
const daniel = await login('coach2@demo.school');
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
const agent = await login('head@demo.school');

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
const director = await login('director@demo.school');

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
  { first: 'نور', last: 'خالد', phone: '0100 765 4321', gender: 'female', age: 24, md: '02-02', city: 'Cairo', source: 'whatsapp', interest: 'Evening classes after work — screen acting.', daysAgo: 0, followUp: 0 },
  { first: 'Omar', last: 'Farouk', phone: '+20 111 222 3344', email: 'omar.farouk@example.com', gender: 'male', age: 20, md: '06-15', source: 'instagram', sourceDetail: 'Reel: Screen Acting showcase', interest: 'Saw the showcase reel. Wants to try acting for the first time.', daysAgo: 1 },
  // Already a student (Tariq came to the open day): the form and the enrol step warn about the duplicate.
  { first: 'Tariq', last: 'Saleh', phone: '01223030318', email: 'tariq.saleh@example.com', gender: 'male', age: 23, md: '07-14', source: 'google_form', sourceDetail: 'Open-day sign-up form', interest: 'Screen Acting I next term.', daysAgo: 2, followUp: -1, byOwner: true },
  // Contacted
  {
    first: 'مريم', last: 'سامي', phone: '+20 106 555 1234', gender: 'female', age: 19, md: '09-09', city: 'Giza', source: 'phone_call', interest: 'Theatre and voice.', daysAgo: 6,
    steps: [{ do: 'contact', daysAgo: 6, type: 'call', body: 'Asked about prices and times. Sent the class schedule on WhatsApp.', followUp: -2 }],
  },
  {
    first: 'حسن', last: 'عبد الله', phone: '+20 109 444 2211', gender: 'male', age: 10, md: '03-03', city: 'Cairo', guardian: ['عبد الله حسن', '+20 109 444 2200'], source: 'facebook', sourceDetail: 'Ad: Kids Drama autumn', preferred: 'kids', daysAgo: 4,
    steps: [{ do: 'contact', daysAgo: 4, type: 'whatsapp', body: 'Spoke with his father. They want to visit a Saturday class first.', followUp: 0 }],
  },
  {
    first: 'Lucy', last: 'Hart', phone: '+44 7700 900555', email: 'lucy.hart@example.com', gender: 'female', age: 22, md: '05-21', city: 'Cairo', source: 'email', interest: 'Improvisation; has done some school theatre.', experience: 'School plays in London, two years of youth theatre.', daysAgo: 10,
    steps: [
      { do: 'contact', daysAgo: 9, type: 'email', body: 'Replied with the improv class details and invited her for an interview.' },
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
        outcome: { daysAgo: 12, status: 'done', scores: { presence: 2, voice: 2, body: 3, emotion: 2, imagination: 3, listening: 2, commitment: 2 }, notes: 'Looking for a weekend hobby class; not ready for the term commitment.', recommendation: 'decline' },
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
const stampAt = (daysAgo: number) => Math.min(parseDate(addDays(today, -daysAgo)).getTime() + 10 * 3_600_000 + tick++ * 60_000, Date.now() - 60_000);
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

// ── Done ────────────────────────────────────────────────────────────────────

db.$client.close();
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`
Stage Left Academy demo data is ready (${secs}s) in ${config.dataDir}

  ${studentSpec.length + 1} students · ${courseSpec.length} classes · ${talentSpec.length} talent · ${castingSpec.length} castings · ${leadSpec.length} enquiries

Sign in with any of these (password: ${PASSWORD}):
  owner@demo.school     CEO                     — Karim Mansour
  cfo@demo.school       CFO                     — Hisham Mansour
  director@demo.school  Executive Director      — Dalia Fathy
  head@demo.school      Head of Casting         — Sherif Adel
  casting@demo.school   Casting team            — Tarek Samir
  editor@demo.school    Video editor            — Hany Nabil
  coach@demo.school     Acting coach            — Layla Haddad
  coach2@demo.school    Acting coach + Finance  — Daniel Price
`);
