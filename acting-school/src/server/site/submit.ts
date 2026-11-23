/**
 * The public forms' POST handling, in the order the spec asks for:
 *  1. Origin header, when present, must be this host (else 403 page);
 *  2. the body cap: by Content-Length before reading, else while reading (413 page);
 *  3. rate limits (lib/siteForms.ts) — before any photo is parsed and before any
 *     write (429 page); a casting's body size counts against the daily photo bytes;
 *  4. parse the form; the honeypot filled → pretend success (303 to thanks), store nothing;
 *  5. the signed form token (too fast / old / forged → the form again with
 *     "please try again", nothing stored);
 *  6. zod validation (the form again with messages, the values kept);
 *  7. the write (createWebsiteLead / createCastingApplication), then 303 → thanks (PRG).
 */
import type { Context } from 'hono';
import { CASTING_PHOTOS_MAX, SITE_APPLY_MAX_BYTES, SITE_CASTING_MAX_BYTES, siteApplyInput } from '../../shared/schemas/site';
import { castingApplicationInput } from '../../shared/schemas/castingApplications';
import type { AppEnv } from '../env';
import { createWebsiteLead } from '../lib/admissions';
import { createCastingApplication, type CastingPhotoUpload } from '../lib/castingApplications';
import { ApiError } from '../lib/errors';
import { checkFormToken, issueFormToken, siteFormRateLimited, type SiteFormKind } from '../lib/siteForms';
import { findPublicWorkshop } from '../lib/siteContent';
import type { SiteCtx } from './context';
import { HONEYPOT_FIELD, TOKEN_FIELD, formValues, issuesToErrors, zodIssues, type FormState } from './forms';
import { CASTING_PHOTO_FIELDS, CASTING_TEXT_FIELDS, applyPage, castingClosedPage, castingPage, errorPage, workshopPage, type ErrorPageKind } from './pages';
import { htmlString, type Html } from './render';

/** The apply form's text fields. */
export const APPLY_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'email',
  'dateOfBirth',
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

/** 303 See Other to the thank-you page (PRG). */
function thanks(c: Context<AppEnv>, ctx: SiteCtx, kind: 'apply' | 'casting') {
  c.header('Cache-Control', 'no-store');
  return c.redirect(ctx.paths.thanks(ctx.lang, kind), 303);
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

type BodyResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' };

/** The body, at most `max` bytes (refused by its Content-Length before reading, or as soon as it passes `max`). */
async function readBody(req: Request, max: number): Promise<BodyResult> {
  const declared = req.headers.get('content-length');
  if (declared !== null && !(Number(declared) <= max)) return { ok: false, reason: 'too_large' };
  if (!req.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { ok: true, bytes };
}

/** Form bytes → FormData (urlencoded or multipart); null when it isn't a form. */
async function parseForm(bytes: Uint8Array, contentType: string | undefined): Promise<FormData | null> {
  const ct = (contentType ?? '').toLowerCase();
  if (!ct.startsWith('application/x-www-form-urlencoded') && !ct.startsWith('multipart/form-data')) return null;
  try {
    return await new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': contentType! } }).formData();
  } catch {
    return null;
  }
}

/**
 * Steps 1–5, shared by both forms. Returns the parsed form, or the response
 * to give instead (403, 413, 429, the thanks redirect for a bot, or `retry`
 * when the token was refused).
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
  const declared = c.req.header('content-length');
  const tooLarge = () => ({ response: sendError(c, ctx, 'tooLarge', 413, formPath) });
  if (declared !== undefined && !(Number(declared) <= max)) return tooLarge();
  // With a Content-Length the limits are checked before reading at all; without one, after
  // reading (capped) — either way before the photos are parsed and before anything is written.
  let limited = false;
  if (declared !== undefined) limited = siteFormRateLimited(db, kind, c.get('clientIp'), Date.now(), Number(declared));
  if (limited) return { response: sendError(c, ctx, 'tooMany', 429, formPath) };
  const body = await readBody(c.req.raw, max);
  if (!body.ok) return tooLarge();
  if (declared === undefined && siteFormRateLimited(db, kind, c.get('clientIp'), Date.now(), body.bytes.byteLength)) {
    return { response: sendError(c, ctx, 'tooMany', 429, formPath) };
  }
  const fd = await parseForm(body.bytes, c.req.header('content-type'));
  if (!fd) return { retry: {}, fd: new FormData() };
  const trap = fd.get(HONEYPOT_FIELD);
  if (typeof trap === 'string' && trap.trim() !== '') return { response: thanks(c, ctx, kind) };
  if (checkFormToken(db, fd.get(TOKEN_FIELD), kind) !== 'ok') return { retry: {}, fd };
  return { fd };
}

const retryState = (ctx: SiteCtx, values: Record<string, string>, extra: Partial<FormState> = {}): FormState => ({
  values,
  errors: {},
  formError: ctx.t.errors.tryAgain,
  ...extra,
});

// ── The enquiry form ────────────────────────────────────────────────────────

/** POST /site/:lang/apply (courseId null) and /site/:lang/workshops/:id/apply. */
export async function submitApply(c: Context<AppEnv>, ctx: SiteCtx, courseId: number | null): Promise<Response> {
  const db = c.get('db');
  const workshop = courseId !== null ? findPublicWorkshop(db, courseId, ctx.today) : null;
  if (courseId !== null && (!workshop || !workshop.acceptingApplications)) return sendError(c, ctx, 'notFound', 404);
  const formPath = courseId !== null ? `${ctx.paths.workshop(ctx.lang, courseId)}#apply` : `${ctx.paths.apply(ctx.lang)}#apply`;
  const render = (state: FormState, status: 200 | 400) => {
    const form = { state, token: issueFormToken(db, 'apply') };
    return send(c, workshop ? workshopPage(ctx, workshop, form) : applyPage(ctx, form), status);
  };

  const g = await guard(c, ctx, 'apply', formPath);
  if ('response' in g) return g.response;
  const values = formValues(g.fd, APPLY_FIELDS);
  if ('retry' in g) return render(retryState(ctx, values), 400);

  const parsed = siteApplyInput(ctx.today).safeParse({ ...values, locale: ctx.lang });
  if (!parsed.success) return render({ values, errors: issuesToErrors(ctx.t, zodIssues(parsed.error), values) }, 400);
  try {
    createWebsiteLead(db, parsed.data, { courseId, today: ctx.today });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return sendError(c, ctx, 'notFound', 404);
    throw err;
  }
  return thanks(c, ctx, 'apply');
}

// ── The casting-call form ───────────────────────────────────────────────────

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
  const db = c.get('db');
  // Closed: the friendly page with 410, before reading anything.
  if (!ctx.content.castingCall.open) return send(c, castingClosedPage(ctx), 410);
  const formPath = `${ctx.paths.castingCall(ctx.lang)}#apply`;
  const render = (state: FormState) => send(c, castingPage(ctx, { state: { ...state, photosAgain: true }, token: issueFormToken(db, 'casting') }), 400);

  const g = await guard(c, ctx, 'casting', formPath);
  if ('response' in g) return g.response;
  const values = formValues(g.fd, CASTING_TEXT_FIELDS);
  if ('retry' in g) return render(retryState(ctx, values));

  const { sources, files } = collectPhotos(g.fd);
  const parsed = castingApplicationInput(ctx.today).safeParse({ ...values, locale: ctx.lang });
  const errors = parsed.success ? {} : issuesToErrors(ctx.t, zodIssues(parsed.error), values);
  // Photo count is checked here too, so one round trip reports every problem.
  if (!files.length) errors.photo1 ??= ctx.t.formErrors.photoRequired;
  else if (files.length > CASTING_PHOTOS_MAX) errors.photo1 ??= ctx.t.formErrors.tooManyPhotos;
  if (!parsed.success || Object.keys(errors).length) return render({ values, errors });

  const photos: CastingPhotoUpload[] = [];
  for (const f of files) photos.push({ data: new Uint8Array(await f.arrayBuffer()), name: f.name || null });
  try {
    await createCastingApplication(db, c.get('files'), parsed.data, photos);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return send(c, castingClosedPage(ctx), 410);
    if (err instanceof ApiError && err.status === 400 && err.issues) {
      return render({ values, errors: issuesToErrors(ctx.t, err.issues, values, (p) => (p[0] === 'photos' ? photoField(sources, p) : String(p[0] ?? ''))) });
    }
    throw err;
  }
  return thanks(c, ctx, 'casting');
}
