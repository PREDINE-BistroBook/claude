/**
 * The public forms' POST handling, in this order:
 *  1. Origin header, when present, must be this host (else 403 page);
 *  2. the body cap by Content-Length (413 page) — and, for the casting form,
 *     room among the uploads being received right now (else the "busy" page);
 *  3. rate limits (lib/siteForms.ts), **before a byte of the body is read**,
 *     with or without a Content-Length: one attempt of this address is counted,
 *     and an address or a school that has used up what may be stored is
 *     refused (429 page);
 *  4. read the body (capped, with a deadline) and parse the form (a bounded
 *     number of parts, text fields of bounded length); the honeypot filled →
 *     pretend success (303 to thanks), store nothing;
 *  5. the signed form token (too fast / old / forged → the form again with
 *     "please try again", nothing stored);
 *  6. validation — zod, the guardian rules and the photos together, so one
 *     answer names every problem (the form again with messages, the values kept);
 *  7. count what is about to be stored (per address, school-wide, photo bytes:
 *     429 page when over), then the write (createWebsiteLead /
 *     createCastingApplication), then 303 → thanks (PRG).
 */
import type { Context } from 'hono';
import { Buffer } from 'node:buffer';
import { isValidDate } from '../../shared/dates';
import { CASTING_PHOTOS_MAX, SITE_APPLY_MAX_BYTES, SITE_CASTING_MAX_BYTES, guardianProblemsInForm, siteApplyInput } from '../../shared/schemas/site';
import { castingApplicationInput } from '../../shared/schemas/castingApplications';
import type { AppEnv } from '../env';
import { createWebsiteLead } from '../lib/admissions';
import { checkCastingPhotos, createCastingApplication, type CastingPhotoUpload } from '../lib/castingApplications';
import { ApiError } from '../lib/errors';
import { checkFormToken, countSiteFormSubmission, countSiteFormTrap, issueFormToken, siteFormRateLimited, type SiteFormKind } from '../lib/siteForms';
import { findPublicWorkshop } from '../lib/siteContent';
import type { SiteCtx } from './context';
import { backToForm } from './paths';
import { DOB_PART_FIELDS, HONEYPOT_FIELD, TOKEN_FIELD, formValues, issuesToErrors, zodIssues, type FormState } from './forms';
import { CASTING_PHOTO_FIELDS, CASTING_TEXT_FIELDS, applyPage, castingClosedPage, castingPage, errorPage, workshopPage, type ErrorPageKind } from './pages';
import { htmlString, type Html } from './render';

/** The apply form's text fields. */
export const APPLY_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'email',
  'dateOfBirth',
  ...DOB_PART_FIELDS,
  'experience',
  'heardFrom',
  'message',
  'guardianName',
  'guardianPhone',
  'guardianConsent',
  'privacyConsent',
] as const;

/** Every page a POST answers is a form response: never cached. */
function send(c: Context<AppEnv>, page: Html, status: 200 | 400 | 403 | 404 | 410 | 413 | 429) {
  c.header('Cache-Control', 'no-store');
  return c.html(htmlString(page), status);
}

export function sendError(c: Context<AppEnv>, ctx: SiteCtx, kind: ErrorPageKind, status: 403 | 404 | 413 | 429 | 500, back?: string) {
  c.header('Cache-Control', 'no-store');
  return c.html(htmlString(errorPage(ctx, kind, back)), status);
}

/** 303 See Other to the thank-you page (PRG); "#thanks" replaces the form's "#apply" so the page opens on its message. */
function thanks(c: Context<AppEnv>, ctx: SiteCtx, kind: 'apply' | 'casting') {
  c.header('Cache-Control', 'no-store');
  return c.redirect(`${ctx.paths.thanks(ctx.lang, kind)}#thanks`, 303);
}

/** An Origin header, when the browser sends one, must name this host. */
export function originAllowed(c: Context<AppEnv>): boolean {
  const origin = c.req.header('origin');
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

// ── Reading the body ────────────────────────────────────────────────────────

/** How long a body may take to arrive in all, before the connection is given up (a stalled upload must not hold its place for ever). */
export const SITE_READ_DEADLINE_MS = { apply: 30_000, casting: 120_000 } as const;

type BodyResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' | 'timeout' | 'aborted' };

/**
 * The body, at most `max` bytes (refused by its Content-Length before reading,
 * or as soon as it passes `max`) and within `deadlineMs`. With a Content-Length
 * the bytes go straight into one buffer of that size; a client that hangs up or
 * stalls is an 'aborted' / 'timeout' result, not an exception.
 */
async function readBody(req: Request, max: number, deadlineMs: number): Promise<BodyResult> {
  const header = req.headers.get('content-length');
  const declared = header === null ? null : Number(header);
  if (declared !== null && !(declared >= 0 && declared <= max)) return { ok: false, reason: 'too_large' };
  if (!req.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deadlineMs);
  });
  const limit = declared ?? max;
  // One buffer of the declared size, made when the first bytes arrive (a client that only
  // announces a length costs nothing); a list of chunks when no length was given.
  let whole: Uint8Array | null = null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next === 'timeout') {
        void reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'timeout' };
      }
      if (next.done) break;
      const value = next.value;
      if (size + value.byteLength > limit) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'too_large' };
      }
      if (declared !== null) (whole ??= new Uint8Array(declared)).set(value, size);
      else chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    return { ok: false, reason: 'aborted' };
  } finally {
    clearTimeout(timer);
  }
  if (whole) return { ok: true, bytes: size === whole.byteLength ? whole : whole.subarray(0, size) };
  if (declared !== null) return { ok: true, bytes: new Uint8Array(0) };
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { ok: true, bytes };
}

/** The most parts a multipart form of ours can have is about 25 (fields, token, honeypot, photos). */
const MAX_FORM_PARTS = 64;

/** More multipart parts than any form of ours sends? Counted in the bytes, before anything parses them (20 MB of tiny parts is hundreds of thousands of objects). */
function tooManyParts(bytes: Uint8Array, contentType: string | undefined): boolean {
  const m = /^multipart\/form-data\b.*?\bboundary=(?:"([^"]{1,200})"|([^;\s]{1,200}))/i.exec(contentType ?? '');
  const boundary = m?.[1] ?? m?.[2];
  if (!boundary) return false;
  const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const needle = Buffer.from(`--${boundary}`, 'latin1');
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    // One boundary line per part, plus the closing one.
    if (++count > MAX_FORM_PARTS + 1) return true;
  }
  return false;
}

/** Form bytes → FormData (urlencoded or multipart); null when it isn't a form. */
async function parseForm(bytes: Uint8Array, contentType: string | undefined): Promise<FormData | null> {
  const ct = (contentType ?? '').toLowerCase();
  if (!ct.startsWith('application/x-www-form-urlencoded') && !ct.startsWith('multipart/form-data')) return null;
  if (tooManyParts(bytes, contentType)) return null;
  try {
    return await new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': contentType! } }).formData();
  } catch {
    return null;
  }
}

/** The longest text field of ours is 2,000 characters; all of a form's text together is far under 64 KB. */
const FORM_FIELD_MAX_CHARS = 4000;
const FORM_TEXT_MAX_CHARS = SITE_APPLY_MAX_BYTES;

/**
 * A text field far longer than any of ours, or more text than a form holds?
 * The casting form's 20 MB are for its photos: megabytes of "phone" must never
 * reach validation (which would chew through them) or be echoed back.
 */
function textTooLong(fd: FormData): boolean {
  let total = 0;
  for (const [, value] of fd.entries()) {
    if (typeof value !== 'string') continue;
    total += value.length;
    if (value.length > FORM_FIELD_MAX_CHARS || total > FORM_TEXT_MAX_CHARS) return true;
  }
  return false;
}

/**
 * Steps 1–5, shared by both forms. Returns the parsed form, or the response
 * to give instead (403, 413, 429, the thanks redirect for a bot, or `retry`
 * when the body or the token was refused).
 */
async function guard(
  c: Context<AppEnv>,
  ctx: SiteCtx,
  kind: SiteFormKind,
  formPath: string,
): Promise<{ fd: FormData } | { response: Response } | { retry: Record<string, string>; fd: FormData }> {
  if (!originAllowed(c)) return { response: sendError(c, ctx, 'forbidden', 403, formPath) };
  const max = kind === 'casting' ? SITE_CASTING_MAX_BYTES : SITE_APPLY_MAX_BYTES;
  const db = c.get('db');
  const clientIp = c.get('clientIp');
  const declared = c.req.header('content-length');
  const tooLarge = () => ({ response: sendError(c, ctx, 'tooLarge', 413, formPath) });
  if (declared !== undefined && !(Number(declared) <= max)) return tooLarge();
  // Before reading at all — a body without a Content-Length included: an address over its limit
  // must not make the server take 20 MB first.
  if (siteFormRateLimited(db, kind, clientIp, Date.now())) return { response: sendError(c, ctx, 'tooMany', 429, formPath) };
  const body = await readBody(c.req.raw, max, SITE_READ_DEADLINE_MS[kind]);
  if (!body.ok) return body.reason === 'too_large' ? tooLarge() : { retry: {}, fd: new FormData() };
  const fd = await parseForm(body.bytes, c.req.header('content-type'));
  if (!fd) return { retry: {}, fd: new FormData() };
  if (textTooLong(fd)) return tooLarge();
  const trap = fd.get(HONEYPOT_FIELD);
  if (typeof trap === 'string' && trap.trim() !== '') {
    countSiteFormTrap(db, kind, clientIp, Date.now());
    return { response: thanks(c, ctx, kind) };
  }
  if (checkFormToken(db, fd.get(TOKEN_FIELD), kind) !== 'ok') return { retry: {}, fd };
  return { fd };
}

const retryState = (ctx: SiteCtx, values: Record<string, string>, extra: Partial<FormState> = {}): FormState => ({
  values,
  errors: {},
  formError: ctx.t.errors.tryAgain,
  ...extra,
});

/**
 * The date of birth comes as three choices (day, month, year: easier than a
 * calendar for a birth date on a phone) → `dateOfBirth` as YYYY-MM-DD. A plain
 * `dateOfBirth` field is still accepted, and then fills the three for the form
 * shown again. Nothing chosen stays '' ("please fill this in"); a half-chosen
 * or impossible date becomes a value the date check refuses.
 */
export function withDateOfBirth(values: Record<string, string>): Record<string, string> {
  const [day = '', month = '', year = ''] = DOB_PART_FIELDS.map((name) => (values[name] ?? '').trim());
  const out = { ...values };
  if (day || month || year) {
    const ok = /^\d{1,2}$/.test(day) && /^\d{1,2}$/.test(month) && /^\d{4}$/.test(year);
    out.dateOfBirth = ok ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : `${year}-${month}-${day}`;
    return out;
  }
  const plain = (values.dateOfBirth ?? '').trim();
  if (isValidDate(plain)) {
    out.dobYear = plain.slice(0, 4);
    out.dobMonth = String(Number(plain.slice(5, 7)));
    out.dobDay = String(Number(plain.slice(8, 10)));
  }
  return out;
}

// ── The enquiry form ────────────────────────────────────────────────────────

/** POST /site/:lang/apply (courseId null) and /site/:lang/workshops/:id/apply. */
export async function submitApply(c: Context<AppEnv>, ctx: SiteCtx, courseId: number | null): Promise<Response> {
  const db = c.get('db');
  const workshop = courseId !== null ? findPublicWorkshop(db, courseId, ctx.today) : null;
  if (courseId !== null && (!workshop || !workshop.acceptingApplications)) return sendError(c, ctx, 'notFound', 404);
  // A workshop's form posts to …/apply, so its page is another address already; the general form posts to itself.
  const formPath = courseId !== null ? `${ctx.paths.workshop(ctx.lang, courseId)}#apply` : backToForm(ctx.paths.apply(ctx.lang));
  const render = (state: FormState, status: 200 | 400) => {
    const form = { state, token: issueFormToken(db, 'apply') };
    return send(c, workshop ? workshopPage(ctx, workshop, form) : applyPage(ctx, form), status);
  };

  const g = await guard(c, ctx, 'apply', formPath);
  if ('response' in g) return g.response;
  const values = withDateOfBirth(formValues(g.fd, APPLY_FIELDS));
  if ('retry' in g) return render(retryState(ctx, values), 400);

  const parsed = siteApplyInput(ctx.today).safeParse({ ...values, locale: ctx.lang });
  if (!parsed.success) {
    const issues = [...zodIssues(parsed.error), ...guardianProblemsInForm(values, ctx.today)];
    return render({ values, errors: issuesToErrors(ctx.t, issues, values) }, 400);
  }
  // Counted here, where something is stored — and nothing awaits between the count and the write.
  if (countSiteFormSubmission(db, 'apply', c.get('clientIp'), Date.now())) return sendError(c, ctx, 'tooMany', 429, formPath);
  try {
    createWebsiteLead(db, parsed.data, { courseId, today: ctx.today });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return sendError(c, ctx, 'notFound', 404);
    throw err;
  }
  return thanks(c, ctx, 'apply');
}

// ── The casting-call form ───────────────────────────────────────────────────

/**
 * The casting form is the one anonymous route that may hold megabytes, and the
 * Durable Object has 128 MB for the whole school: the bodies being received or
 * handled at one moment may add up to this much at most (two full-size
 * applications, or several ordinary ones). Beyond it the visitor is asked to
 * try again in a moment, before anything is read or counted. Module state is
 * per isolate / process — exactly the memory being protected.
 */
export const CASTING_IN_FLIGHT_MAX_BYTES = 2 * SITE_CASTING_MAX_BYTES;
let castingBytesInFlight = 0;

/** Tests: how many bytes of casting bodies are reserved right now. */
export const castingBytesReserved = () => castingBytesInFlight;

/** What a casting POST reserves: its declared length, or the full cap when it declares none. */
function castingReservation(c: Context<AppEnv>): number {
  const declared = Number(c.req.header('content-length') ?? NaN);
  return declared >= 0 && declared <= SITE_CASTING_MAX_BYTES ? declared : SITE_CASTING_MAX_BYTES;
}

/** Where a photo error at index i of the uploaded list belongs. */
function photoField(sources: readonly string[], path: readonly PropertyKey[]): string {
  const i = typeof path[1] === 'number' ? path[1] : 0;
  return sources[i] ?? CASTING_PHOTO_FIELDS[0];
}

/** The chosen photos in order (photo1…photo3, then a multi-file "photos" input), empty inputs skipped. */
function collectPhotos(fd: FormData): { sources: string[]; files: File[] } {
  const files: File[] = [];
  const sources: string[] = [];
  for (const name of [...CASTING_PHOTO_FIELDS, 'photos']) {
    for (const v of fd.getAll(name)) {
      if (typeof v === 'string' || (v.size === 0 && !v.name)) continue;
      files.push(v);
      sources.push(name === 'photos' ? (CASTING_PHOTO_FIELDS[sources.length] ?? 'photo3') : name);
    }
  }
  return { sources, files };
}

/** POST /site/:lang/casting-call. */
export async function submitCasting(c: Context<AppEnv>, ctx: SiteCtx): Promise<Response> {
  // Closed: the friendly page with 410, before reading anything.
  if (!ctx.content.castingCall.open) return send(c, castingClosedPage(ctx), 410);
  const formPath = backToForm(ctx.paths.castingCall(ctx.lang));
  if (!originAllowed(c)) return sendError(c, ctx, 'forbidden', 403, formPath);
  const reserved = castingReservation(c);
  if (castingBytesInFlight + reserved > CASTING_IN_FLIGHT_MAX_BYTES) {
    c.header('Retry-After', '30');
    return sendError(c, ctx, 'busy', 429, formPath);
  }
  castingBytesInFlight += reserved;
  try {
    return await handleCasting(c, ctx, formPath);
  } finally {
    castingBytesInFlight -= reserved;
  }
}

async function handleCasting(c: Context<AppEnv>, ctx: SiteCtx, formPath: string): Promise<Response> {
  const db = c.get('db');
  const render = (state: FormState) => send(c, castingPage(ctx, { state: { ...state, photosAgain: true }, token: issueFormToken(db, 'casting') }), 400);

  const g = await guard(c, ctx, 'casting', formPath);
  if ('response' in g) return g.response;
  const values = withDateOfBirth(formValues(g.fd, CASTING_TEXT_FIELDS));
  if ('retry' in g) return render(retryState(ctx, values));

  const { sources, files } = collectPhotos(g.fd);
  // The form's own File objects: each photo's bytes are read only when it is stored.
  const photos: CastingPhotoUpload[] = files.map((f) => ({ blob: f, name: f.name || null }));
  const parsed = castingApplicationInput(ctx.today).safeParse({ ...values, locale: ctx.lang });
  // Everything is checked in this one round — the fields, the guardian block, the photos — because
  // each form that comes back costs the applicant their chosen photos.
  const issues = parsed.success ? [] : [...zodIssues(parsed.error), ...guardianProblemsInForm(values, ctx.today)];
  const errors = issuesToErrors(ctx.t, issues, values);
  const inPhotoField = (p: readonly PropertyKey[]) => (p[0] === 'photos' ? photoField(sources, p) : String(p[0] ?? ''));
  if (files.length > CASTING_PHOTOS_MAX) errors.photo1 ??= ctx.t.formErrors.tooManyPhotos;
  else Object.assign(errors, issuesToErrors(ctx.t, (await checkCastingPhotos(photos)).issues, values, inPhotoField));
  if (!parsed.success || Object.keys(errors).length) return render({ values, errors });

  try {
    await createCastingApplication(db, c.get('files'), parsed.data, photos, {
      // Counted where the photos are about to be kept, by their real size: a declared length, a
      // refused form or a dropped connection uses up nothing of the school's day.
      beforeStore: (photoBytes) => {
        if (countSiteFormSubmission(db, 'casting', c.get('clientIp'), Date.now(), photoBytes)) throw new ApiError(429, 'rate_limited');
      },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return send(c, castingClosedPage(ctx), 410);
    if (err instanceof ApiError && err.status === 429) return sendError(c, ctx, 'tooMany', 429, formPath);
    if (err instanceof ApiError && err.status === 400 && err.issues) return render({ values, errors: issuesToErrors(ctx.t, err.issues, values, inPhotoField) });
    throw err;
  }
  return thanks(c, ctx, 'casting');
}
