/**
 * End-to-end check of the Cloudflare build in real workerd:
 *
 *   npm run cf:smoke                 (port 8790; `-- --port N`, `-- --no-build`)
 *
 * Builds the web app, starts `wrangler dev --local` on a fresh, throwaway
 * state folder, seeds the demo through POST /api/admin/seed-demo, then drives
 * every module through the Worker → Durable Object: each demo role signs in,
 * students / classes (a long schedule regenerated: hundreds of sessions, well
 * past the 100-parameter limit) / sessions and attendance / talent with photo
 * uploads (one bigger than a FileStore chunk) / castings, roles, submissions
 * (a duplicate is a 409) / admissions (Arabic digits, duplicates, interview,
 * enrolment) / positions / staff / settings / schedule / dashboard, long Arabic
 * searches, and every delete twice (204, then 404). It then restarts the
 * Worker on the same state (sessions, the sign-in brake and files survive),
 * checks the static assets and headers, finishes with the demo reset and
 * checks first-run setup then needs the setup code. Bodies over 1 MB are
 * refused (413) and the session cookie is __Host- prefixed. The public
 * website (/site): every page in both languages with its headers, one
 * enquiry and one casting application with a photo through the real forms,
 * accept → talent, and /site/media serving only public images. The team pack:
 * the Team page, a chat round trip with a photo, a workshop document, a call
 * to the office answered, notifications, push off without VAPID keys.
 * Exit code 1 on the first failure. Local only (scripts/cf-local.ts).
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { todayIn } from '../src/server/lib/clock';
import { addDays } from '../src/shared/dates';
import { ensureDevVars, ensureWebBuild, startWranglerDev } from './cf-local';

// ── A tiny HTTP client with a cookie ────────────────────────────────────────

interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
  bytes: Uint8Array;
}

class Client {
  lastSetCookie: string | null = null;
  constructor(
    readonly base: string,
    public cookie: string | null = null,
  ) {}

  async req<T = any>(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { 'x-requested-with': 'fetch', ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.base + url, { method, headers, body: payload, redirect: 'manual' });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let parsed: any = text;
    if ((res.headers.get('content-type') ?? '').includes('json')) parsed = text ? JSON.parse(text) : null;
    const setCookie = res.headers.get('set-cookie');
    // __Host-as_session over HTTPS (always on Cloudflare: cookieSecure), as_session on plain http.
    if (/^(__Host-)?as_session=/.test(setCookie ?? '')) {
      this.lastSetCookie = setCookie;
      this.cookie = setCookie!.split(';')[0]!;
      if (this.cookie.endsWith('=')) this.cookie = null; // deleted on sign-out
    }
    return { status: res.status, body: parsed as T, headers: res.headers, bytes };
  }
  get = <T = any>(url: string, h?: Record<string, string>) => this.req<T>('GET', url, undefined, h);
  post = <T = any>(url: string, body?: unknown, h?: Record<string, string>) => this.req<T>('POST', url, body, h);
  put = <T = any>(url: string, body?: unknown) => this.req<T>('PUT', url, body);
  patch = <T = any>(url: string, body?: unknown) => this.req<T>('PATCH', url, body);
  delete = <T = any>(url: string) => this.req<T>('DELETE', url);
}

let checks = 0;
function expectStatus<T>(res: Res<T>, status: number, what: string): Res<T> {
  checks++;
  if (res.status !== status) {
    const body = typeof res.body === 'string' ? res.body.slice(0, 500) : JSON.stringify(res.body)?.slice(0, 500);
    throw new Error(`${what}: expected ${status}, got ${res.status} ${body}`);
  }
  return res;
}
function check(ok: unknown, what: string) {
  checks++;
  if (!ok) throw new Error(`Check failed: ${what}`);
}
const step = (s: string) => console.log(`• ${s}`);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** A real PNG of noise (incompressible): `size`×`size` pixels, RGB. */
function noisePng(size: number): Uint8Array<ArrayBuffer> {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const noise = randomBytes(size * size * 3);
  for (let y = 0; y < size; y++) noise.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

async function upload(client: Client, bytes: Uint8Array<ArrayBuffer>, name: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), name);
  return expectStatus(await client.post('/api/files', form), 201, `upload ${name}`).body.id as string;
}

const DEMO_ROLES = [
  'owner@demo.school',
  'cfo@demo.school',
  'director@demo.school',
  'head@demo.school',
  'casting@demo.school',
  'editor@demo.school',
  'coach@demo.school',
  'coach2@demo.school',
];

/** Everything that runs against a freshly seeded Worker. Returns what the restart phase re-checks. */
export async function runApiSmoke(base: string, opts: { adminToken: string; password: string; timeZone?: string }) {
  const tz = opts.timeZone ?? 'Africa/Cairo';
  const today = todayIn(tz);
  const anon = new Client(base);
  const bearer = { authorization: `Bearer ${opts.adminToken}` };

  step('health, signed-out guards');
  expectStatus(await anon.get('/api/health'), 200, 'health');
  expectStatus(await anon.get('/api/students'), 401, 'students signed out');
  expectStatus(await anon.req('POST', '/api/auth/logout', undefined, { 'x-requested-with': '' }), 403, 'POST without X-Requested-With');
  expectStatus(await anon.get('/api/nope'), 404, 'unknown API route');

  step('request size: a body over 1 MB is refused by the Worker (Content-Length) or the API (streamed)');
  const huge = JSON.stringify({ email: 'nobody@demo.school', password: 'A'.repeat(2 * 1024 * 1024) });
  const declared = expectStatus(await anon.post('/api/auth/login', JSON.parse(huge)), 413, 'login with a 2 MB body');
  check(declared.body.error.code === 'payload_too_large', 'payload_too_large');
  const streamed = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
    body: new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(huge);
        for (let i = 0; i < bytes.length; i += 65536) controller.enqueue(bytes.slice(i, i + 65536));
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit);
  checks++;
  if (streamed.status !== 413) throw new Error(`streamed 2 MB body: expected 413, got ${streamed.status} ${(await streamed.text()).slice(0, 200)}`);
  await streamed.arrayBuffer();

  step('admin endpoints: token required, seed refuses a second run');
  expectStatus(await anon.post('/api/admin/seed-demo', { password: opts.password }), 401, 'seed without token');
  expectStatus(await anon.post('/api/admin/seed-demo', { password: opts.password }, { authorization: 'Bearer wrong-token-wrong-token-wrong' }), 401, 'seed with a wrong token');
  expectStatus(await anon.post('/api/admin/seed-demo', { password: 'short' }, bearer), 400, 'seed with a short password');
  expectStatus(await anon.post('/api/admin/seed-demo', { password: opts.password }, bearer), 409, 'seed again');
  expectStatus(await anon.post('/api/admin/what', {}, bearer), 404, 'unknown admin action');

  step('every demo role signs in; dashboards use the school date');
  const clients: Record<string, Client> = {};
  for (const email of DEMO_ROLES) {
    const c = new Client(base);
    const login = expectStatus(await c.post('/api/auth/login', { email, password: opts.password }), 200, `login ${email}`);
    check(login.body.user.email === email && c.cookie, `cookie for ${email}`);
    check(/^__Host-as_session=[^;]+;.*Path=\/;.*Secure/.test(c.lastSetCookie ?? '') && !/Domain=/i.test(c.lastSetCookie ?? ''), `__Host- session cookie (${c.lastSetCookie?.replace(/=[^;]+/, '=…')})`);
    const me = expectStatus(await c.get('/api/auth/me'), 200, `me ${email}`);
    check(me.body.user?.email === email, `me is ${email}`);
    const dash = expectStatus(await c.get('/api/dashboard'), 200, `dashboard ${email}`);
    check(dash.body.today === today, `dashboard today ${dash.body.today} = school today ${today}`);
    clients[email] = c;
  }
  expectStatus(await new Client(base).post('/api/auth/login', { email: 'tom.wilkins@demo.school', password: opts.password }), 401, 'deactivated account');
  expectStatus(await clients['editor@demo.school']!.get('/api/students'), 200, 'video editor reads students');
  expectStatus(await clients['editor@demo.school']!.get('/api/leads'), 403, 'video editor has no admissions');
  const owner = clients['owner@demo.school']!;
  const director = clients['director@demo.school']!;
  const coach = clients['coach@demo.school']!;

  step('students: list, create (Arabic digits), search, patch, long Arabic search, delete twice');
  const studentsBefore = expectStatus(await owner.get('/api/students'), 200, 'students list').body.items.length;
  check(studentsBefore >= 20, 'seeded students');
  const sara = expectStatus(
    await owner.post('/api/students', { firstName: 'سارة', lastName: 'محمود', phone: '٠١٢٣٤٥٦٧٨٩٠', email: 'sara.smoke@example.com' }),
    201,
    'create student',
  ).body;
  check(sara.phone === '01234567890', `phone stored with Western digits (${sara.phone})`);
  check(!('phoneDigits' in sara), 'phone_digits stays internal');
  const byDigits = expectStatus(await owner.get(`/api/students?q=${encodeURIComponent('+20 123 456 7890')}`), 200, 'student phone search').body.items;
  check(byDigits.some((s: any) => s.id === sara.id), 'found by international phone');
  const byArabic = expectStatus(await owner.get(`/api/students?q=${encodeURIComponent('سارة محمود')}`), 200, 'student Arabic name search').body.items;
  check(byArabic.some((s: any) => s.id === sara.id), 'found by Arabic name');
  expectStatus(await owner.patch(`/api/students/${sara.id}`, { notes: 'Smoke test', phone: '0123 456 7891' }), 200, 'patch student');
  const byNewDigits = expectStatus(await owner.get('/api/students?q=01234567891'), 200, 'search new phone').body.items;
  check(byNewDigits.some((s: any) => s.id === sara.id), 'phone_digits follows a patch');
  const longArabic = 'تجربة البحث الطويل باللغة العربية عن طالب غير موجود في المدرسة اليوم';
  check(Buffer.byteLength(longArabic) > 50, 'search term longer than 50 bytes');
  for (const list of ['students', 'talent', 'castings', 'leads']) {
    const res = expectStatus(await owner.get(`/api/${list}?q=${encodeURIComponent(longArabic)}`), 200, `long Arabic search in ${list}`);
    check(Array.isArray(res.body.items) && res.body.items.length === 0, `no ${list} match the long search`);
  }
  expectStatus(await owner.get(`/api/students/${sara.id}`), 200, 'student detail');

  step('classes: long schedule (>100-parameter statements), regenerate, enrol, extra session');
  const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '10:00', endTime: '11:00' }));
  const course = expectStatus(
    await owner.post('/api/courses', { name: 'Smoke: daily lab', startDate: today, endDate: addDays(today, 200), schedule: everyDay, capacity: 30 }),
    201,
    'create long course',
  ).body;
  check(course.sessions.length > 150, `generated ${course.sessions.length} sessions`);
  const regenerated = expectStatus(
    await owner.patch(`/api/courses/${course.id}`, { schedule: everyDay.map((s) => ({ ...s, startTime: '11:00', endTime: '12:30' })) }),
    200,
    'regenerate schedule',
  ).body;
  check(regenerated.sessions.length === course.sessions.length, `regenerated ${regenerated.sessions.length} sessions`);
  check(regenerated.sessions.every((s: any) => s.startTime === '11:00'), 'every session moved to 11:00');
  const shortened = expectStatus(await owner.patch(`/api/courses/${course.id}`, { endDate: addDays(today, 30) }), 200, 'shorten course').body;
  check(shortened.sessions.length <= 31 && shortened.sessions.length >= 30, `shortened to ${shortened.sessions.length} sessions`);
  const enrolment = expectStatus(await owner.post(`/api/courses/${course.id}/enrollments`, { studentId: sara.id }), 201, 'enrol student').body;
  expectStatus(await owner.patch(`/api/courses/${course.id}/enrollments/${enrolment.id}`, { status: 'withdrawn' }), 200, 'withdraw enrolment');
  expectStatus(await owner.patch(`/api/courses/${course.id}/enrollments/${enrolment.id}`, { status: 'enrolled' }), 200, 're-enrol');
  const extra = expectStatus(
    await owner.post(`/api/courses/${course.id}/sessions`, { date: addDays(today, 3), startTime: '18:00', endTime: '19:00', topic: 'Extra rehearsal' }),
    201,
    'extra session',
  ).body;
  expectStatus(await owner.get(`/api/courses/${course.id}`), 200, 'course detail');
  expectStatus(await owner.get('/api/courses'), 200, 'courses list');

  step('sessions and attendance');
  const firstSession = shortened.sessions[0];
  expectStatus(await owner.get(`/api/sessions?from=${today}&to=${addDays(today, 6)}`), 200, 'sessions in a week');
  expectStatus(await owner.get(`/api/sessions/${firstSession.id}`), 200, 'session detail');
  expectStatus(await owner.patch(`/api/sessions/${firstSession.id}`, { topic: 'Smoke topic' }), 200, 'patch session');
  const marked = expectStatus(await owner.put(`/api/sessions/${firstSession.id}/attendance`, { records: [{ studentId: sara.id, status: 'present' }] }), 200, 'mark attendance').body;
  check(marked.roster.some((r: any) => r.studentId === sara.id && r.status === 'present'), 'attendance stored');
  expectStatus(await owner.delete(`/api/sessions/${extra.id}`), 204, 'delete session');
  expectStatus(await owner.delete(`/api/sessions/${extra.id}`), 404, 'delete session again');
  expectStatus(await owner.delete(`/api/courses/${course.id}/enrollments/${enrolment.id}`), 204, 'delete enrolment');
  expectStatus(await owner.delete(`/api/courses/${course.id}/enrollments/${enrolment.id}`), 404, 'delete enrolment again');
  expectStatus(await coach.get(`/api/courses/${course.id}`), 404, "a coach doesn't see someone else's class");

  step('talent: photos through the FileStore (one bigger than a chunk), search, delete twice');
  const head = clients['head@demo.school']!;
  const talentList = expectStatus(await head.get('/api/talent'), 200, 'talent list').body.items;
  check(talentList.length >= 12, 'seeded talent');
  const actor = expectStatus(await head.post('/api/talent', { firstName: 'Smoke', lastName: 'Actor', languages: ['Arabic'], skills: ['Dance'] }), 201, 'create talent').body;
  const small = noisePng(64);
  const smallId = await upload(head, small, 'small.png');
  const big = noisePng(1000);
  check(big.byteLength > 2 * 1024 * 1024, `big upload is ${(big.byteLength / 1048576).toFixed(1)} MB`);
  const bigId = await upload(head, big, 'big.png');
  const photo = expectStatus(await head.post(`/api/talent/${actor.id}/photos`, { fileId: smallId, caption: 'Smoke' }), 201, 'add photo').body;
  expectStatus(await head.post(`/api/talent/${actor.id}/photos`, { fileId: bigId }), 201, 'add big photo');
  const downloadedBig = expectStatus(await head.get(`/api/files/${bigId}`), 200, 'download big file');
  check(sha(downloadedBig.bytes) === sha(big), 'big file round-trips byte for byte');
  check(downloadedBig.headers.get('content-type') === 'image/png', 'file content type');
  check((downloadedBig.headers.get('cache-control') ?? '').includes('private'), 'file is private to the browser');
  const downloadedSmall = expectStatus(await coach.get(`/api/files/${smallId}`), 200, 'any signed-in staff downloads a file');
  check(sha(downloadedSmall.bytes) === sha(small), 'small file round-trips');
  expectStatus(await anon.get(`/api/files/${smallId}`), 401, 'files are private');
  expectStatus(await head.get(`/api/talent?q=${encodeURIComponent('Smoke Actor')}`), 200, 'talent search');
  expectStatus(await head.patch(`/api/talent/${actor.id}/photos/${photo.id}`, { caption: 'Renamed' }), 200, 'patch photo');
  expectStatus(await head.delete(`/api/talent/${actor.id}/photos/${photo.id}`), 204, 'delete photo');

  step('castings: roles, submissions (duplicate → 409), deletes');
  const casting = expectStatus(await head.post('/api/castings', { title: 'Smoke commercial', production: 'Smoke Films' }), 201, 'create casting').body;
  const role = expectStatus(await head.post(`/api/castings/${casting.id}/roles`, { name: 'Lead' }), 201, 'add role').body;
  const submission = expectStatus(await head.post('/api/submissions', { roleId: role.id, talentId: actor.id }), 201, 'submit talent').body;
  const dup = expectStatus(await head.post('/api/submissions', { roleId: role.id, talentId: actor.id }), 409, 'duplicate submission');
  check(dup.body.error.code === 'already_submitted', 'duplicate code');
  expectStatus(await head.patch(`/api/submissions/${submission.id}`, { status: 'submitted' }), 200, 'send submission');
  expectStatus(await head.get(`/api/castings/${casting.id}`), 200, 'casting detail');
  expectStatus(await head.get('/api/castings'), 200, 'castings list');
  const castingPhoto = await upload(head, noisePng(48), 'mood-board.png');
  const castingFile = expectStatus(await head.post(`/api/castings/${casting.id}/files`, { fileId: castingPhoto, caption: 'Mood board' }), 201, 'casting file').body;
  check(castingFile.kind === 'photo' && castingFile.canDelete === true, 'casting file is a photo the head of casting can delete');
  check(expectStatus(await head.get(`/api/castings/${casting.id}/files`), 200, 'casting files').body.items.some((f: { fileId: string }) => f.fileId === castingPhoto), 'casting files list');
  expectStatus(await coach.get(`/api/castings/${casting.id}/files`), 403, 'a coach can’t see casting files');
  expectStatus(await head.delete(`/api/submissions/${submission.id}`), 204, 'delete submission');
  expectStatus(await head.delete(`/api/submissions/${submission.id}`), 404, 'delete submission again');
  expectStatus(await head.delete(`/api/castings/${casting.id}/roles/${role.id}`), 204, 'delete role');
  expectStatus(await head.delete(`/api/castings/${casting.id}`), 204, 'delete casting');
  expectStatus(await head.get(`/api/files/${castingPhoto}`), 404, 'deleting the casting freed its file');
  expectStatus(await head.delete(`/api/castings/${casting.id}`), 404, 'delete casting again');
  expectStatus(await head.delete(`/api/talent/${actor.id}`), 204, 'delete talent');
  expectStatus(await head.delete(`/api/talent/${actor.id}`), 404, 'delete talent again');

  step('admissions: Arabic digits, duplicates, interview, enrol');
  const lead = expectStatus(
    await director.post('/api/leads', { firstName: 'Smoke', lastName: 'Lead', phone: '٠١٠٩٨٧٦٥٤٣٢', source: 'whatsapp' }),
    201,
    'create lead (Arabic digits)',
  ).body;
  check(lead.phone === '01098765432', `lead phone normalised (${lead.phone})`);
  check(!('phoneDigits' in lead), 'lead phone_digits stays internal');
  const found = expectStatus(await director.get(`/api/leads?q=${encodeURIComponent('+20 109 876 5432')}`), 200, 'lead phone search').body.items;
  check(found.some((l: any) => l.id === lead.id), 'lead found by international phone');
  const dupes = expectStatus(await director.get(`/api/leads/duplicates?phone=${encodeURIComponent('+201098765432')}`), 200, 'duplicates').body.items;
  check(dupes.some((d: any) => d.kind === 'lead' && d.id === lead.id), 'duplicate check finds the lead');
  const second = expectStatus(await director.post('/api/leads', { firstName: 'Smoke', lastName: 'Twin', phone: '+20 109 876 5432' }), 201, 'second lead, same number').body;
  const both = expectStatus(await director.get(`/api/leads/duplicates?phone=01098765432&excludeLeadId=${second.id}`), 200, 'duplicates excluding one').body.items;
  check(both.some((d: any) => d.id === lead.id) && !both.some((d: any) => d.id === second.id), 'excludeLeadId');
  const interview = expectStatus(
    await director.post(`/api/leads/${lead.id}/interviews`, { scheduledAt: `${addDays(today, 1)}T10:00`, durationMinutes: 30 }),
    201,
    'schedule interview',
  ).body;
  expectStatus(await director.patch(`/api/leads/${lead.id}/interviews/${interview.id}`, { status: 'done', recommendation: 'accept' }), 200, 'record interview');
  const options = expectStatus(await director.get('/api/leads/course-options'), 200, 'course options').body.items;
  check(options.length > 0, 'open classes to enrol in');
  let enrol = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: options[0].id });
  if (enrol.status === 409 && enrol.body.error.code === 'possible_duplicate') enrol = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: options[0].id, createNew: true });
  expectStatus(enrol, 201, 'enrol lead');
  check(enrol.body.lead.status === 'enrolled', 'lead enrolled');
  const counts = expectStatus(await director.get('/api/leads/counts'), 200, 'lead counts').body;
  check(counts.open >= 1, 'open leads counted');
  expectStatus(await director.post(`/api/leads/${second.id}/activities`, { type: 'call', body: 'Called back' }), 201, 'log a call');
  expectStatus(await director.delete(`/api/leads/${second.id}`), 204, 'delete lead');
  expectStatus(await owner.delete(`/api/students/${enrol.body.studentId}`), 204, 'delete the enrolled student');
  expectStatus(await director.get(`/api/leads/${lead.id}`), 200, 'lead detail after its student is deleted');

  step('positions, staff, settings, schedule, profile');
  const position = expectStatus(await owner.post('/api/positions', { name: 'Smoke reader', permissions: ['students.read'] }), 201, 'create position').body;
  expectStatus(await owner.patch(`/api/positions/${position.id}`, { nameAr: 'قارئ' }), 200, 'patch position');
  const staffEmail = `smoke.${Date.now()}@example.com`;
  const member = expectStatus(
    await owner.post('/api/staff', { name: 'Smoke Staff', email: staffEmail, positionIds: [position.id], password: opts.password }),
    201,
    'create staff',
  ).body;
  expectStatus(await owner.post('/api/staff', { name: 'Again', email: staffEmail, positionIds: [position.id], password: opts.password }), 409, 'duplicate staff email');
  const staffClient = new Client(base);
  expectStatus(await staffClient.post('/api/auth/login', { email: staffEmail, password: opts.password }), 200, 'new staff signs in');
  expectStatus(await staffClient.get('/api/students'), 200, 'new staff reads students');
  expectStatus(await staffClient.get('/api/castings'), 403, 'new staff has no castings');
  expectStatus(await owner.get('/api/staff'), 200, 'staff list');
  expectStatus(await owner.get('/api/staff/directory'), 200, 'staff directory');
  expectStatus(await owner.patch(`/api/staff/${member.id}`, { active: false }), 200, 'deactivate staff');
  expectStatus(await staffClient.get('/api/students'), 401, 'deactivated staff is signed out');
  const settings = expectStatus(await owner.get('/api/settings'), 200, 'settings').body;
  expectStatus(await owner.patch('/api/settings', { weekStartsOn: 6 }), 200, 'patch settings');
  expectStatus(await owner.patch('/api/settings', { weekStartsOn: settings.weekStartsOn }), 200, 'restore settings');
  const schedule = expectStatus(await owner.get(`/api/schedule?from=${addDays(today, -7)}&to=${addDays(today, 21)}`), 200, 'schedule').body.items;
  check(schedule.length > 0, 'schedule has events');
  expectStatus(await coach.get(`/api/schedule?from=${today}&to=${addDays(today, 7)}`), 200, 'coach schedule');
  expectStatus(await coach.patch('/api/auth/profile', { locale: 'ar' }), 200, 'profile locale');
  // A small body sent without a Content-Length (streamed) is read normally through the Worker → DO.
  const streamedPatch = await fetch(`${base}/api/auth/profile`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', cookie: coach.cookie! },
    body: new ReadableStream({
      start(controller) {
        for (const part of ['{"loc', 'ale":', '"ar"}']) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
    duplex: 'half',
  } as RequestInit);
  checks++;
  if (streamedPatch.status !== 200) throw new Error(`streamed small body: expected 200, got ${streamedPatch.status} ${(await streamedPatch.text()).slice(0, 200)}`);
  check((await streamedPatch.json()).user.locale === 'ar', 'streamed body applied');
  expectStatus(await coach.patch('/api/auth/profile', { locale: 'en' }), 200, 'profile locale back');

  step('team pack: directory, chat with a photo, workshop document, call to the office, notifications, push off');
  const team = expectStatus(await coach.get('/api/team'), 200, 'team directory').body.items as { id: number; name: string; positions: unknown[]; photoFileId: string | null }[];
  const karim = team.find((m) => m.name === 'Karim Mansour');
  check(karim && karim.positions.length === 0 && karim.photoFileId, 'owners listed to a coach as name and photo, no positions');
  check(team.every((m) => m.photoFileId), 'every demo worker has a profile photo');
  const daniel = clients['coach2@demo.school']!;
  const danielId = expectStatus(await daniel.get('/api/auth/me'), 200, 'coach2 me').body.user.id as number;
  const danielOldPhoto = team.find((m) => m.id === danielId)!.photoFileId!;
  const danielPhoto = await upload(daniel, noisePng(40), 'me.png');
  check(expectStatus(await daniel.put('/api/auth/photo', { fileId: danielPhoto }), 200, 'a coach changes their profile photo').body.user.photoFileId === danielPhoto, 'new profile photo');
  check(expectStatus(await coach.get('/api/team'), 200, 'team again').body.items.find((m: { id: number }) => m.id === danielId).photoFileId === danielPhoto, 'colleagues see the new photo');
  expectStatus(await daniel.get(`/api/files/${danielOldPhoto}`), 404, 'the old profile photo is freed');
  const conv = expectStatus(await coach.post('/api/chat/conversations', { userId: karim!.id }), 201, 'coach opens a chat with the CEO').body;
  const chatPhoto = await upload(coach, noisePng(64), 'chat.png');
  const message = expectStatus(await coach.post(`/api/chat/conversations/${conv.id}/messages`, { body: 'Photo from tonight', fileIds: [chatPhoto] }), 201, 'send a photo').body;
  check(message.attachments[0]?.kind === 'photo', 'attachment is a photo');
  check(expectStatus(await owner.get('/api/chat/unread'), 200, 'unread').body.total >= 1, 'the CEO has unread messages');
  const ownerView = expectStatus(await owner.get(`/api/chat/conversations/${conv.id}/messages`), 200, 'the CEO reads the chat').body;
  check(ownerView.items.at(-1).attachments[0].fileId === chatPhoto, 'the CEO sees the photo');
  check((expectStatus(await owner.get(`/api/files/${chatPhoto}`), 200, 'the CEO opens the photo').headers.get('content-disposition') ?? '').startsWith('inline'), 'photo inline');
  expectStatus(await owner.post(`/api/chat/conversations/${conv.id}/read`, { messageId: message.id }), 204, 'mark read');
  check(expectStatus(await coach.get(`/api/chat/conversations/${conv.id}/messages?after=${message.id}`), 200, 'poll').body.otherLastReadMessageId === message.id, 'Seen');
  expectStatus(await director.get(`/api/chat/conversations/${conv.id}/messages`), 404, 'outsiders get a 404');
  const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const pdfForm = new FormData();
  pdfForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'خطة الورشة.pdf');
  const pdfId = expectStatus(await director.post('/api/files', pdfForm), 201, 'upload a PDF').body.id;
  expectStatus(await director.post(`/api/courses/${course.id}/files`, { fileId: pdfId, caption: 'Plan' }), 201, 'workshop document');
  const download = expectStatus(await director.get(`/api/files/${pdfId}`), 200, 'download the PDF');
  check((download.headers.get('content-disposition') ?? '').startsWith('attachment;'), 'documents download as attachments');
  check(download.headers.get('x-content-type-options') === 'nosniff', 'nosniff on files');
  const svg = new FormData();
  svg.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }), 'x.svg');
  expectStatus(await director.post('/api/files', svg), 415, 'SVG refused');
  const wrongForm = new FormData();
  wrongForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'wrong-file.pdf');
  const wrongId = expectStatus(await director.post('/api/files', wrongForm), 201, 'upload the wrong file').body.id;
  expectStatus(await coach.delete(`/api/files/${wrongId}`), 404, 'someone else can’t delete an upload');
  expectStatus(await director.delete(`/api/files/${wrongId}`), 204, 'the uploader takes back an unused upload');
  expectStatus(await director.delete(`/api/files/${pdfId}`), 409, 'an attached file can’t be deleted that way');
  const coachMe = expectStatus(await coach.get('/api/auth/me'), 200, 'coach me').body.user;
  const call = expectStatus(await director.post('/api/summons', { userId: coachMe.id, note: 'Smoke test' }), 201, 'director calls the coach to the office').body;
  expectStatus(await director.post('/api/summons', { userId: coachMe.id }), 409, 'one pending call per person');
  expectStatus(await coach.post('/api/summons', { userId: karim!.id }), 403, 'a coach can’t call people');
  check(expectStatus(await coach.get('/api/chat/unread'), 200, 'coach poll').body.summons.some((x: { id: number }) => x.id === call.id), 'the banner shows the call');
  expectStatus(await coach.post(`/api/summons/${call.id}/answer`, { status: 'on_my_way' }), 200, 'on my way');
  check(expectStatus(await coach.get(`/api/summons/${call.id}`), 200, 'the person called sees the call').body.status === 'on_my_way', 'what became of the call');
  const answers = expectStatus(await director.get('/api/notifications'), 200, 'director notifications').body.items;
  check(answers.some((n: { kind: string; link: string }) => n.kind === 'summon_answer' && n.link === `/team?summons=${call.id}`), 'the director sees the answer');
  check(expectStatus(await director.get('/api/summons/sent?status=on_my_way'), 200, 'sent').body.items.some((x: { id: number }) => x.id === call.id), 'sent list');
  expectStatus(await coach.post('/api/notifications/read', { all: true }), 200, 'mark notifications read');
  check(expectStatus(await coach.get('/api/push/config'), 200, 'push config').body.publicKey === null, 'push is off without VAPID keys');

  step('the last deletes: student, class');
  expectStatus(await owner.delete(`/api/students/${sara.id}`), 204, 'delete student');
  expectStatus(await owner.delete(`/api/students/${sara.id}`), 404, 'delete student again');
  expectStatus(await owner.delete(`/api/courses/${course.id}`), 204, 'delete course');
  expectStatus(await owner.delete(`/api/courses/${course.id}`), 404, 'delete course again');

  step('sign-in brake: 10 failures, then 429');
  const stranger = new Client(base);
  for (let i = 0; i < 10; i++) expectStatus(await stranger.post('/api/auth/login', { email: 'nobody@demo.school', password: 'wrong-password' }), 401, `failed login ${i + 1}`);
  expectStatus(await stranger.post('/api/auth/login', { email: 'nobody@demo.school', password: 'wrong-password' }), 429, 'brake engaged');

  step('lockout recovery through the admin endpoint');
  const granted = expectStatus(await anon.post('/api/admin/grant-owner', { email: staffEmail }, bearer), 200, 'grant owner').body;
  check(granted.reactivated === true && granted.position === 'CEO', 'grant-owner reactivated the account as CEO');
  expectStatus(await anon.post('/api/admin/grant-owner', { email: 'nobody@example.com' }, bearer), 404, 'grant-owner unknown email');

  return { ownerCookie: owner.cookie!, bigId, bigSha: sha(big), studentCount: studentsBefore };
}

/** After a restart on the same state: data, sessions, the brake and files are all still there. */
async function afterRestart(base: string, before: Awaited<ReturnType<typeof runApiSmoke>>) {
  step('restart: session, data, sign-in brake and files survived');
  const owner = new Client(base, before.ownerCookie);
  const me = expectStatus(await owner.get('/api/auth/me'), 200, 'me after restart');
  check(me.body.user?.email === 'owner@demo.school', 'still signed in');
  const students = expectStatus(await owner.get('/api/students'), 200, 'students after restart').body.items;
  check(students.length === before.studentCount, `students kept (${students.length})`);
  const file = expectStatus(await owner.get(`/api/files/${before.bigId}`), 200, 'big file after restart');
  check(sha(file.bytes) === before.bigSha, 'big file intact');
  expectStatus(await new Client(base).post('/api/auth/login', { email: 'nobody@demo.school', password: 'wrong-password' }), 429, 'brake survived the restart');
}

/** Static assets: the SPA shell on deep links, the PWA files, and the _headers rules. */
async function staticChecks(base: string) {
  step('static assets: SPA deep link, service worker, manifest, headers');
  const anon = new Client(base);
  const shell = expectStatus(await anon.get('/students/1', { 'sec-fetch-mode': 'navigate', accept: 'text/html' }), 200, 'deep link');
  check((shell.headers.get('content-type') ?? '').includes('text/html'), 'deep link is HTML');
  const html = new TextDecoder().decode(shell.bytes);
  check(html.includes('<div id="root">'), 'deep link serves the app shell');
  check((shell.headers.get('content-security-policy') ?? '').includes("default-src 'self'"), 'CSP on the shell');
  check(shell.headers.get('x-content-type-options') === 'nosniff', 'nosniff on the shell');
  check(shell.headers.get('referrer-policy') === 'same-origin', 'Referrer-Policy on the shell');
  const sw = expectStatus(await anon.get('/sw.js'), 200, 'service worker');
  check((sw.headers.get('content-type') ?? '').includes('javascript'), 'sw.js is JavaScript');
  check(!(sw.headers.get('cache-control') ?? '').includes('immutable'), 'sw.js is revalidated');
  const manifest = expectStatus(await anon.get('/manifest.webmanifest'), 200, 'manifest');
  check(JSON.parse(new TextDecoder().decode(manifest.bytes)).short_name === 'Turquoise', 'manifest content');
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  check(asset, 'shell references a hashed script');
  const js = expectStatus(await anon.get(asset!), 200, 'hashed asset');
  check((js.headers.get('cache-control') ?? '').includes('immutable'), `hashed asset cached for good (${js.headers.get('cache-control')})`);
  const missing = await anon.get('/assets/does-not-exist.js', { 'sec-fetch-dest': 'script' });
  console.log(`  (a missing hashed asset answers ${missing.status} ${missing.headers.get('content-type')})`);
  const apiHeaders = expectStatus(await anon.get('/api/auth/me'), 200, 'me signed out').headers;
  check(apiHeaders.get('cache-control') === 'no-store', 'API responses are not cached');
}

/** The public website (/site) through the Worker → Durable Object: pages in both languages, one enquiry, one casting application with a photo, /site/media, accept → talent, and the headers. */
async function siteChecks(base: string, opts: { password: string }) {
  step('public site: /site redirect, every page in both languages, headers');
  const SITE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
  const page = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(base + path, { redirect: 'manual', ...init });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  };
  const siteHeaders = (h: Headers, what: string, cache: string) => {
    check(h.get('content-security-policy') === SITE_CSP, `CSP on ${what}`);
    check(h.get('x-content-type-options') === 'nosniff', `nosniff on ${what}`);
    check(h.get('referrer-policy') === 'strict-origin-when-cross-origin', `Referrer-Policy on ${what}`);
    check(h.get('cache-control') === cache, `Cache-Control ${cache} on ${what} (${h.get('cache-control')})`);
  };
  const root = await page('/site', { headers: { 'accept-language': 'ar-EG,ar;q=0.9' } });
  checks++;
  if (root.status !== 302 || root.headers.get('location') !== '/site/ar') throw new Error(`/site with Arabic: ${root.status} ${root.headers.get('location')}`);
  siteHeaders(root.headers, '/site redirect', 'no-store');
  const workshopsEn = await page('/site/en/workshops');
  const workshopHref = /href="(\/site\/en\/workshops\/\d+)#apply"/.exec(workshopsEn.text)?.[1];
  check(workshopHref, 'the demo has a workshop taking applications on the site');
  const workshopPath = workshopHref!.replace('/site/en', '');
  for (const lang of ['en', 'ar']) {
    for (const p of ['', '/workshops', workshopPath, '/apply', '/casting-call', '/links']) {
      const res = await page(`/site/${lang}${p}`);
      checks++;
      if (res.status !== 200) throw new Error(`/site/${lang}${p}: expected 200, got ${res.status} ${res.text.slice(0, 200)}`);
      check(res.text.includes(`<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`), `lang/dir on /site/${lang}${p}`);
      check(!/<script/i.test(res.text), `no script on /site/${lang}${p}`);
      siteHeaders(res.headers, `/site/${lang}${p}`, 'public, max-age=60');
    }
  }
  const home = await page('/site/en');
  // No amounts anywhere (a coach may well be called Price, so look for money, not the word).
  check(!/\bEGP\b|\bL\.?E\.?\s*\d|\d\s*(EGP|LE)\b|جنيه|ج\.م/i.test(home.text) && home.text.includes('Ask about fees on WhatsApp'), 'no prices; fees are asked on WhatsApp');
  const missing = await page('/site/ar/no-such-page');
  check(missing.status === 404 && missing.text.includes('<html lang="ar" dir="rtl">'), `friendly Arabic 404 (${missing.status})`);
  siteHeaders(missing.headers, 'the 404 page', 'no-store');
  // The staff app's service worker and shell never answer /site.
  check(!missing.text.includes('<div id="root">'), 'the 404 is the site’s, not the staff app shell');

  step('public site: one enquiry (token, Origin, 303 → thanks) lands in Admissions');
  const token = (html: string) => /name="formToken" value="([^"]+)"/.exec(html)?.[1] ?? '';
  const workshopPage = await page(`/site/en${workshopPath}`);
  const applyToken = token(workshopPage.text);
  check(applyToken, 'the workshop page carries a form token');
  await new Promise((r) => setTimeout(r, 3200));
  const stamp = String(Date.now()).slice(-6);
  const applyBody = new URLSearchParams({
    formToken: applyToken,
    website: '',
    firstName: 'Smoke',
    lastName: `Visitor${stamp}`,
    phone: `0100 77${stamp.slice(0, 1)} ${stamp.slice(1)}`,
    dateOfBirth: addDays(todayIn('Africa/Cairo'), -25 * 366),
    experience: 'none',
    heardFrom: 'instagram',
    message: 'Smoke test enquiry',
    privacyConsent: 'on',
  }).toString();
  const applied = await page(`${workshopHref}/apply`, { method: 'POST', body: applyBody, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base } });
  checks++;
  if (applied.status !== 303 || applied.headers.get('location') !== '/site/en/thanks?k=apply') throw new Error(`enquiry: ${applied.status} ${applied.headers.get('location')} ${applied.text.slice(0, 300)}`);
  siteHeaders(applied.headers, 'the form redirect', 'no-store');
  const forged = await page('/site/en/apply', { method: 'POST', body: applyBody.replace(/formToken=[^&]+/, 'formToken=1.abc'), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  check(forged.status === 400 && forged.text.includes('id="errors"'), `a forged token re-renders the form (${forged.status})`);
  const foreign = await page('/site/en/apply', { method: 'POST', body: applyBody, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' } });
  check(foreign.status === 403, `another site's Origin is refused (${foreign.status})`);
  const bigForm = await page('/site/en/apply', { method: 'POST', body: `message=${'x'.repeat(70 * 1024)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  check(bigForm.status === 413 && bigForm.text.includes('<html lang="en"'), `a 70 KB enquiry is refused by the Worker with the site's page (${bigForm.status})`);
  const director = new Client(base);
  expectStatus(await director.post('/api/auth/login', { email: 'director@demo.school', password: opts.password }), 200, 'director signs in');
  const webLeads = expectStatus(await director.get('/api/leads?source=website'), 200, 'website leads').body.items;
  check(webLeads.some((l: any) => l.lastName === `Visitor${stamp}`), 'the enquiry is a website lead in Admissions');

  step('public site: one casting application with a photo, then accept → talent through the staff API');
  const castingPage = await page('/site/ar/casting-call');
  const castingToken = token(castingPage.text);
  check(castingToken && castingPage.text.includes('enctype="multipart/form-data"'), 'the casting call is open with its form (demo)');
  await new Promise((r) => setTimeout(r, 3200));
  const form = new FormData();
  const fields: Record<string, string> = {
    formToken: castingToken,
    website: '',
    firstName: 'Smoke',
    lastName: `Actor${stamp}`,
    gender: 'female',
    dateOfBirth: addDays(todayIn('Africa/Cairo'), -23 * 366),
    phone: `0112 66${stamp.slice(0, 1)} ${stamp.slice(1)}`,
    city: 'Giza',
    heightCm: '170',
    languages: 'Arabic, English',
    skills: 'Dance',
    links: 'https://www.instagram.com/smoke.actor/',
    privacyConsent: 'on',
  };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const headshot = noisePng(48);
  form.append('photo1', new Blob([headshot], { type: 'image/png' }), 'headshot.png');
  const cast = await page('/site/ar/casting-call', { method: 'POST', body: form, headers: { origin: base } });
  checks++;
  if (cast.status !== 303 || cast.headers.get('location') !== '/site/ar/thanks?k=casting') throw new Error(`casting application: ${cast.status} ${cast.headers.get('location')} ${cast.text.slice(0, 300)}`);
  const head = new Client(base);
  expectStatus(await head.post('/api/auth/login', { email: 'head@demo.school', password: opts.password }), 200, 'head of casting signs in');
  const apps = expectStatus(await head.get(`/api/casting-applications?q=${encodeURIComponent(`Actor${stamp}`)}`), 200, 'applications search').body.items;
  check(apps.length === 1, 'the application reached the staff list');
  const detail = expectStatus(await head.get(`/api/casting-applications/${apps[0].id}`), 200, 'application detail').body;
  check(detail.photos.length === 1 && detail.locale === 'ar', 'one photo, sent from the Arabic page');
  const photo = expectStatus(await head.get(`/api/files/${detail.photos[0].fileId}`), 200, 'staff download the photo');
  check(sha(photo.bytes) === sha(headshot), 'the photo round-trips byte for byte');
  const appMedia = await page(`/site/media/${detail.photos[0].fileId}`);
  check(appMedia.status === 404, `an application photo is never public (${appMedia.status})`);
  const accepted = expectStatus(await head.post(`/api/casting-applications/${apps[0].id}/accept`), 201, 'accept → talent').body;
  const talent = expectStatus(await head.get(`/api/talent/${accepted.talentId}`), 200, 'the new talent profile').body;
  check(talent.lastName === `Actor${stamp}`, 'talent made from the application');
  expectStatus(await head.post(`/api/casting-applications/${apps[0].id}/accept`), 409, 'accept again');

  step('public site: /site/media serves public images only');
  const owner = new Client(base);
  expectStatus(await owner.post('/api/auth/login', { email: 'owner@demo.school', password: opts.password }), 200, 'owner signs in');
  const coaches = expectStatus(await owner.get('/api/site/coaches'), 200, 'site coaches').body.items;
  const shown = coaches.find((c: any) => c.visible && c.photoFileId);
  const hidden = coaches.find((c: any) => !c.visible && c.photoFileId);
  check(shown, 'a shown coach with a photo (demo)');
  const media = await fetch(`${base}/site/media/${shown.photoFileId}`);
  const mediaBytes = new Uint8Array(await media.arrayBuffer());
  check(media.status === 200 && media.headers.get('content-type') === 'image/png' && mediaBytes.byteLength > 100, `a shown coach's photo is public (${media.status})`);
  check(media.headers.get('cache-control') === 'public, max-age=3600', 'media cached for an hour');
  check(media.headers.get('x-content-type-options') === 'nosniff' && media.headers.get('content-disposition') === 'inline', 'media nosniff + inline');
  if (hidden) check((await page(`/site/media/${hidden.photoFileId}`)).status === 404, "a hidden coach's photo is not public");
  check((await page('/site/media/00000000-0000-4000-8000-000000000000')).status === 404, 'an unknown id is a 404');
}

/**
 * The studio's own domain (PUBLIC_SITE_HOSTS in wrangler.jsonc): wrangler dev passes the Host header
 * through, so the Worker's host routing (src/worker/routing.ts) runs for real here. On a public host
 * the site answers at the root with bare links and nothing of the staff app does; www → the apex.
 */
async function publicHostChecks(base: string) {
  step('studio domain: turquoisestudio.app serves the site at the root, www → apex, no staff app there');
  const { hostname, port } = new URL(base);
  const get = (p: string, host: string) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request({ host: hostname, port, path: p, headers: { host, 'accept-language': 'ar' } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });
  const root = await get('/', 'turquoisestudio.app');
  check(root.status === 302 && root.headers.location === '/ar', `apex / → /ar (${root.status} ${root.headers.location})`);
  const home = await get('/en/workshops', 'turquoisestudio.app');
  check(home.status === 200 && home.body.includes('href="/en/casting-call"') && !home.body.includes('href="/site/'), `bare links on the public host (${home.status})`);
  check(home.headers['content-security-policy']?.includes("default-src 'none'"), 'site CSP on the public host');
  for (const p of ['/api/health', '/login', '/sw.js', '/students/1']) {
    const res = await get(p, 'turquoisestudio.app');
    check(res.status === 404 && !res.body.includes('<div id="root">') && String(res.headers['content-type']).startsWith('text/html'), `${p} on the public host is the site's 404 (${res.status})`);
  }
  const www = await get('/ar/links?from=ig', 'www.turquoisestudio.app');
  check(www.status === 301 && /^https?:\/\/turquoisestudio\.app\/ar\/links\?from=ig$/.test(String(www.headers.location)), `www → apex (${www.status} ${www.headers.location})`);
  const staff = await get('/students/1', `${hostname}:${port}`);
  check(staff.status === 200 && staff.body.includes('<div id="root">'), 'the staff host still serves the staff app');
}

async function main() {
  const argv = process.argv.slice(2);
  const portArg = argv.indexOf('--port');
  const port = Number(portArg >= 0 ? argv[portArg + 1] : (process.env.PORT ?? 8790));
  const vars = ensureDevVars();
  if (!vars.ADMIN_TOKEN || vars.ALLOW_DEMO_RESET !== 'true') throw new Error('.dev.vars needs ADMIN_TOKEN and ALLOW_DEMO_RESET=true (delete it to have it recreated)');
  if (!argv.includes('--no-build')) ensureWebBuild(true);
  // --embedded: the same checks against the bundled-assets Worker (wrangler.embedded.jsonc).
  const embedded = argv.includes('--embedded');
  const config = embedded ? 'wrangler.embedded.jsonc' : undefined;
  if (embedded && spawnSync('npx', ['tsx', 'scripts/embed-assets.ts'], { stdio: 'inherit' }).status !== 0) throw new Error('embed-assets failed');
  const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-school-cf-smoke-'));
  const password = `smoke-${randomBytes(9).toString('base64url')}`;
  let dev = await startWranglerDev({ port, persistTo, quiet: !argv.includes('--verbose'), config });
  try {
    console.log(`wrangler dev on ${dev.url} (state in ${persistTo})`);
    const started = Date.now();
    const seeded = expectStatus(
      await new Client(dev.url).post('/api/admin/seed-demo', { password }, { authorization: `Bearer ${vars.ADMIN_TOKEN}` }),
      201,
      'seed the demo',
    ).body;
    console.log(`• seeded through POST /api/admin/seed-demo in ${((Date.now() - started) / 1000).toFixed(1)}s (${JSON.stringify(seeded.counts)})`);
    const state = await runApiSmoke(dev.url, { adminToken: vars.ADMIN_TOKEN, password });
    await staticChecks(dev.url);
    await siteChecks(dev.url, { password });
    await publicHostChecks(dev.url);

    await dev.stop();
    dev = await startWranglerDev({ port, persistTo, quiet: !argv.includes('--verbose'), config });
    await afterRestart(dev.url, state);

    step('demo reset');
    const reset = expectStatus(await new Client(dev.url).post('/api/admin/reset', {}, { authorization: `Bearer ${vars.ADMIN_TOKEN}` }), 200, 'reset').body;
    check(reset.deletedFiles > 0, `reset deleted ${reset.deletedFiles} files`);
    const me = expectStatus(await new Client(dev.url).get('/api/auth/me'), 200, 'me after reset').body;
    check(me.needsSetup === true && me.setupCodeRequired === true, 'an empty school asks for setup, with the setup code');
    expectStatus(await new Client(dev.url, state.ownerCookie).get('/api/students'), 401, 'old sessions are gone');

    step('first-run setup is closed to the public: it needs the setup code (ADMIN_TOKEN)');
    const setup = { schoolName: 'Smoke school', name: 'Smoke Owner', email: 'owner@smoke.example', password: password };
    const mallory = new Client(dev.url);
    const noCode = expectStatus(await mallory.post('/api/auth/setup', { ...setup, email: 'mallory@x.co' }), 403, 'setup without the code');
    check(noCode.body.error.code === 'setup_code_required' && mallory.cookie === null, 'no session for an anonymous setup');
    expectStatus(await mallory.post('/api/auth/setup', { ...setup, email: 'mallory@x.co', setupCode: 'guess-guess-guess-guess-guess' }), 403, 'setup with a wrong code');
    const realOwner = new Client(dev.url);
    const created = expectStatus(await realOwner.post('/api/auth/setup', { ...setup, setupCode: vars.ADMIN_TOKEN }), 201, 'setup with the code');
    check(created.body.user.isOwner === true && realOwner.cookie, 'the operator owns the school');
    check(expectStatus(await new Client(dev.url).get('/api/auth/me'), 200, 'me after setup').body.needsSetup === false, 'set up');
    expectStatus(await realOwner.get('/api/students'), 200, 'the new owner works');
    console.log(`\nCloudflare smoke passed: ${checks} checks.`);
  } finally {
    await dev.stop();
    fs.rmSync(persistTo, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    console.error(`\nCloudflare smoke FAILED after ${checks} checks:\n${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
