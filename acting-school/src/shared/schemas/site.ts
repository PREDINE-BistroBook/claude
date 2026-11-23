import { z } from 'zod';
import { ageOn, isValidDate } from '../dates';
import { LOCALES, type CourseLevel, type Locale } from '../enums';
import { MAX_PHONE_DIGITS, MIN_PHONE_DIGITS, phoneDigits } from '../phone';
import type { ScheduleSlot } from './courses';
import { dateStr, id, optEmail, optFileId, optId, optPhoneText, optText, reqPhoneText, reqText } from './common';

/**
 * The public website (served at /site by the API app, src/server/site/) and
 * what staff with website.manage edit for it (API under /api/site).
 *
 * - Studio texts, contact lines, the casting call and the link-in-bio links are
 *   one JSON object, `SiteContent`, stored in the settings table under the key
 *   'site' (src/server/lib/siteContent.ts). A missing key means DEFAULT_SITE_CONTENT.
 * - Coaches shown on the site: site_coaches (API /api/site/coaches).
 * - Which workshops (courses) the site shows, with a public title, description
 *   and cover: site_workshops, one row per course (API /api/site/workshops). A workshop
 *   appears on the site only when visible, its course is active and its end
 *   date is on or after the school's today.
 * - No prices anywhere (the school's decision, 2026-11-23): not in the data,
 *   the staff screens or the public pages, which offer "Ask about fees on
 *   WhatsApp" (the workshops WhatsApp, a message naming the workshop) instead.
 *
 * Every bilingual text is `{ en, ar }`; either may be empty (the site then
 * shows the other language, or leaves the block out).
 *
 * Validation messages: 'errors.<key>' (common namespace) where the meaning
 * matches; the public forms' own wording is 'site:errors.<key>' with the keys in
 * SITE_FORM_ERROR_KEYS (the public site's i18n, src/server/site/i18n.ts, has them).
 */

// ── Building blocks ─────────────────────────────────────────────────────────

export interface Bilingual {
  en: string;
  ar: string;
}

/** A bilingual half inside a whole object (PUT): missing or null → ''. */
const biString = (max: number) => z.preprocess((v) => (v == null ? '' : v), z.string().trim().max(max));
/** A bilingual half in a partial input (PATCH/PUT of one row): null → '', undefined stays "unchanged". */
const biText = (max: number) => z.preprocess((v) => (v === null ? '' : v), z.string().trim().max(max));

/** `{ en, ar }`, both trimmed, each at most `max` characters; missing halves are ''. */
export const bilingual = (max: number) => z.preprocess((v) => (v == null ? {} : v), z.object({ en: biString(max), ar: biString(max) }));

/** True when both halves are empty. */
export const isBlankBilingual = (b: Bilingual) => !b.en.trim() && !b.ar.trim();

/**
 * An https link only (javascript:, data:, http: and the rest are refused), with a
 * real domain name; stored normalised (new URL().href: spaces and quotes encoded).
 */
export const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .pipe(z.url({ protocol: /^https$/i, hostname: z.regexes.domain, message: 'errors.invalidUrl' }))
  .transform((v) => new URL(v).href);

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
/** An optional https link: '' / null / missing → null. */
export const optHttpsUrl = z.preprocess(blankToNull, httpsUrl.nullable().optional()).transform((v) => v ?? null);

/** A staff-side phone line (admissions wording): at least 7 digits, at most 15; '' → null. */
const optStaffPhone = optPhoneText(50)
  .refine((v) => v == null || (phoneDigits(v).length >= MIN_PHONE_DIGITS && phoneDigits(v).length <= MAX_PHONE_DIGITS), {
    message: 'admissions:errors.invalidPhone',
  })
  .transform((v) => v ?? null);

/** "@handle", "instagram.com/handle/" or "handle" → "handle"; '' → null. */
export function normalizeInstagramHandle(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const handle = v
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '')
    .replace(/^@+/, '')
    .replace(/[/?#].*$/, '')
    .trim();
  return handle || null;
}
export const INSTAGRAM_HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const optInstagram = z
  .preprocess(normalizeInstagramHandle, z.string().regex(INSTAGRAM_HANDLE_RE, { message: 'errors.invalid' }).nullable().optional())
  .transform((v) => v ?? null);

const nullable = <T extends z.ZodType>(schema: T) => schema.transform((v) => (v ?? null) as Exclude<z.output<T>, undefined> | null);

/** HTML checkboxes send "on" (or nothing); JSON sends booleans. */
export const formBool = z.preprocess((v) => v === true || v === 'on' || v === 'true' || v === '1' || v === 'yes', z.boolean());

// ── Site content (settings key 'site') ──────────────────────────────────────

export const SITE_LINK_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_SITE_LINKS = 20;

/** One custom button on the link-in-bio page. `id` is given by the server when missing (new link). */
export const siteLinkInput = z
  .object({
    id: z.preprocess(blankToNull, z.string().trim().regex(SITE_LINK_ID_RE).nullable().optional()),
    label: bilingual(60),
    url: httpsUrl,
    /** Missing → shown. */
    visible: z.boolean().optional(),
  })
  .refine((l) => !isBlankBilingual(l.label), { path: ['label', 'en'], message: 'errors.required' })
  .transform((l) => ({ id: l.id ?? null, label: l.label, url: l.url, visible: l.visible ?? true }));

/**
 * PUT /api/site/content (website.manage) — the whole object; a missing part is
 * stored empty (texts ''), null (lines) or closed (casting call). Limits: about
 * ≤ 4000 characters per language, tagline ≤ 160, address ≤ 300, casting-call
 * texts ≤ 2000, link labels ≤ 60, at most 20 links (in order). Phones are
 * normalised; links and the map link must be https. `heroFileId` must be an
 * uploaded image (POST /api/files) that isn't a casting application's photo
 * or a student's or talent's photo.
 */
export const siteContent = z.object({
  tagline: bilingual(160),
  about: bilingual(4000),
  address: bilingual(300),
  mapUrl: optHttpsUrl,
  /** Instagram handle without "@" (a pasted profile link is reduced to the handle). */
  instagram: optInstagram,
  whatsappWorkshops: optStaffPhone,
  whatsappCasting: optStaffPhone,
  phone: optStaffPhone,
  email: nullable(optEmail),
  heroFileId: nullable(optFileId),
  castingCall: z.preprocess(
    (v) => (v == null ? {} : v),
    z
      .object({
        open: z.boolean().optional(),
        intro: bilingual(2000),
        lookingFor: bilingual(2000),
      })
      .transform((cc) => ({ open: cc.open ?? false, intro: cc.intro, lookingFor: cc.lookingFor })),
  ),
  links: z.preprocess((v) => (v == null ? [] : v), z.array(siteLinkInput).max(MAX_SITE_LINKS)),
});
/** What the client sends. */
export type SiteContentInput = z.input<typeof siteContent>;
/** After validation (link ids may still be null: the server gives new links one). */
export type SiteContentParsed = z.output<typeof siteContent>;

export interface SiteLink {
  id: string;
  label: Bilingual;
  /** https only. */
  url: string;
  visible: boolean;
}

/** GET/PUT /api/site/content answer (and what the public site reads). */
export interface SiteContent {
  tagline: Bilingual;
  about: Bilingual;
  address: Bilingual;
  mapUrl: string | null;
  /** Handle without "@". */
  instagram: string | null;
  whatsappWorkshops: string | null;
  whatsappCasting: string | null;
  phone: string | null;
  email: string | null;
  /** The home page's main photo (public via /site/media/:id). */
  heroFileId: string | null;
  castingCall: { open: boolean; intro: Bilingual; lookingFor: Bilingual };
  /** Custom link-in-bio buttons, in order. */
  links: SiteLink[];
}

const emptyBi = (): Bilingual => ({ en: '', ar: '' });

/** No 'site' settings key yet: empty texts, no contact lines, the casting call closed, no links. */
export const DEFAULT_SITE_CONTENT: SiteContent = {
  tagline: emptyBi(),
  about: emptyBi(),
  address: emptyBi(),
  mapUrl: null,
  instagram: null,
  whatsappWorkshops: null,
  whatsappCasting: null,
  phone: null,
  email: null,
  heroFileId: null,
  castingCall: { open: false, intro: emptyBi(), lookingFor: emptyBi() },
  links: [],
};

// ── Coaches (site_coaches) ──────────────────────────────────────────────────

const siteCoachFields = z
  .object({
    /** Optional link to a staff account: an active one the caller may see (hidden owners answer like missing ids). */
    userId: optId,
    nameEn: biText(100),
    nameAr: biText(100),
    titleEn: biText(100),
    titleAr: biText(100),
    bioEn: biText(2000),
    bioAr: biText(2000),
    /** An uploaded image (POST /api/files); public on the site while the coach is shown. */
    photoFileId: optFileId,
    /** Shown on the website. Defaults to true on create. */
    visible: z.boolean(),
  })
  .partial();

/** POST /api/site/coaches — a name in at least one language. Missing texts are ''. */
export const siteCoachInput = siteCoachFields.refine((c) => !!(c.nameEn || c.nameAr), { path: ['nameEn'], message: 'errors.required' });
export type SiteCoachInput = z.infer<typeof siteCoachInput>;
/** PATCH /api/site/coaches/:id — only what is sent changes; the coach must keep a name in one language. */
export const siteCoachUpdateInput = siteCoachFields;
export type SiteCoachUpdateInput = z.infer<typeof siteCoachUpdateInput>;

/** GET /api/site/coaches → { items: SiteCoach[] } in sort order; also POST (201), GET/PATCH /:id. */
export interface SiteCoach {
  id: number;
  /** null when not linked — or linked to an owner account the caller can't see. */
  userId: number | null;
  userName: string | null;
  nameEn: string;
  nameAr: string;
  titleEn: string;
  titleAr: string;
  bioEn: string;
  bioAr: string;
  photoFileId: string | null;
  visible: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** POST /api/site/coaches/order and /api/site/workshops/order: ids in the new order (coach ids / course ids). Answers { items } like the list. */
export const siteOrderInput = z.object({
  ids: z
    .array(id)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'errors.invalid' }),
});
export type SiteOrderInput = z.infer<typeof siteOrderInput>;

// ── Workshops on the site (site_workshops) ──────────────────────────────────

/**
 * PUT /api/site/workshops/:courseId — creates the course's row (with the
 * defaults: hidden, accepting applications, empty texts) or updates it; only
 * what is sent changes. Empty titles mean "use the course name".
 */
export const siteWorkshopInput = z
  .object({
    /** Show on the website (the course must also be active and not over). */
    visible: z.boolean(),
    titleEn: biText(120),
    titleAr: biText(120),
    descriptionEn: biText(4000),
    descriptionAr: biText(4000),
    /** An uploaded image; public on the site while the workshop appears there. */
    coverFileId: optFileId,
    /** Show the apply form on the workshop's page. */
    acceptingApplications: z.boolean(),
  })
  .partial();
export type SiteWorkshopInput = z.infer<typeof siteWorkshopInput>;

/**
 * GET /api/site/workshops → { items: SiteWorkshop[] }: every active course that
 * hasn't ended (ongoing and upcoming), with its site row or the defaults
 * (`saved: false`), site order first (then start date, name). Also the answer
 * of GET/PUT /api/site/workshops/:courseId (any existing course).
 */
export interface SiteWorkshop {
  courseId: number;
  courseName: string;
  courseStatus: 'active' | 'archived';
  level: CourseLevel | null;
  startDate: string;
  endDate: string;
  teacherId: number | null;
  teacherName: string | null;
  /** The weekly slots (weekday 0 = Sunday), for the "days and times" preview. */
  schedule: ScheduleSlot[];
  /** A site_workshops row exists (false: these are the defaults). */
  saved: boolean;
  visible: boolean;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  coverFileId: string | null;
  acceptingApplications: boolean;
  sortOrder: number;
  /** Appears on the public site right now: visible, course active, end date ≥ today. */
  onSite: boolean;
}

// ── Website home (summary) ──────────────────────────────────────────────────

/** Absolute public URLs of the site's pages in one language. */
export interface SiteUrls {
  home: string;
  workshops: string;
  castingCall: string;
  links: string;
}

/** GET /api/site/summary (website.manage). */
export interface SiteSummary {
  /** Leads with source 'website' still 'new' (null without admissions.read). */
  newWebsiteLeads: number | null;
  /** Casting applications still 'new' (null without talent.read). */
  newCastingApplications: number | null;
  castingCallOpen: boolean;
  /** Workshops appearing on the site now. */
  visibleWorkshops: number;
  visibleCoaches: number;
  /** On the studio's own domain when PUBLIC_SITE_HOSTS is set (https://turquoisestudio.app/en/workshops), else the request's origin + /site/…. */
  urls: Record<Locale, SiteUrls>;
}

// ── Public forms (the public site's POST handlers validate with these) ─────

/**
 * Message keys the public forms use beyond common's 'errors.*' (each as
 * 'site:errors.<key>'), so the public site's i18n can be typed against them.
 */
export const SITE_FORM_ERROR_KEYS = [
  'invalidPhone',
  'ageRange',
  'guardianConsent',
  'privacyConsent',
  'tooManyLinks',
  'photoRequired',
  'tooManyPhotos',
  'photoTooLarge',
  'photoType',
] as const;
export type SiteFormErrorKey = (typeof SITE_FORM_ERROR_KEYS)[number];

/** Youngest and oldest applicant (age on the school's today). */
export const SITE_MIN_AGE = 5;
export const SITE_MAX_AGE = 100;
/** Under this age the guardian's name, phone and consent are required. */
export const SITE_ADULT_AGE = 18;

/** Body caps of the public forms (the Worker refuses a larger Content-Length before the Durable Object; the app enforces the same on bodies without one). */
export const SITE_APPLY_MAX_BYTES = 64 * 1024;
export const SITE_CASTING_MAX_BYTES = 20 * 1024 * 1024;
export const CASTING_PHOTO_MAX_BYTES = 6 * 1024 * 1024;
export const CASTING_PHOTOS_MAX = 3;
export const CASTING_LINKS_MAX = 3;

/** A public-form phone: Western digits stored (normalizePhone), 7–15 digits. */
export const sitePhone = reqPhoneText(50).refine((v) => phoneDigits(v).length >= MIN_PHONE_DIGITS && phoneDigits(v).length <= MAX_PHONE_DIGITS, {
  message: 'site:errors.invalidPhone',
});
export const optSitePhone = optPhoneText(50).refine((v) => v == null || (phoneDigits(v).length >= MIN_PHONE_DIGITS && phoneDigits(v).length <= MAX_PHONE_DIGITS), {
  message: 'site:errors.invalidPhone',
});

/** What the guardian rules look at. */
export interface GuardianFields {
  dateOfBirth: string;
  guardianName?: string | null;
  guardianPhone?: string | null;
  guardianConsent: boolean;
}

/**
 * Both public forms' age rules as issues: age 5–100 on `today`; under 18 → the
 * guardian's name, phone and consent. Nothing for a date that isn't one (the
 * date check says so).
 */
export function guardianProblems(v: GuardianFields, today: string): { path: string[]; message: string }[] {
  const age = ageOn(v.dateOfBirth, today);
  if (age === null) return [];
  if (age < SITE_MIN_AGE || age > SITE_MAX_AGE) return [{ path: ['dateOfBirth'], message: 'site:errors.ageRange' }];
  if (age >= SITE_ADULT_AGE) return [];
  const out: { path: string[]; message: string }[] = [];
  if (!v.guardianName) out.push({ path: ['guardianName'], message: 'errors.required' });
  if (!v.guardianPhone) out.push({ path: ['guardianPhone'], message: 'errors.required' });
  if (!v.guardianConsent) out.push({ path: ['guardianConsent'], message: 'site:errors.guardianConsent' });
  return out;
}

/** The same rules as a zod refinement (it only runs once every field is valid on its own). */
export function guardianRules(today: string) {
  return (v: GuardianFields, ctx: z.RefinementCtx) => {
    for (const p of guardianProblems(v, today)) ctx.addIssue({ code: 'custom', path: p.path, message: p.message });
  };
}

/**
 * The guardian rules on a form's raw values, for the answer to a form that has
 * other mistakes too: zod skips them while any field is invalid, and a parent
 * should hear about the missing guardian block in the same round, not the next.
 */
export function guardianProblemsInForm(values: Record<string, string | undefined>, today: string): { path: string[]; message: string }[] {
  const dob = (values.dateOfBirth ?? '').trim();
  if (!isValidDate(dob)) return [];
  return guardianProblems(
    {
      dateOfBirth: dob,
      guardianName: values.guardianName?.trim() || null,
      guardianPhone: values.guardianPhone?.trim() || null,
      guardianConsent: formBool.parse(values.guardianConsent),
    },
    today,
  );
}

/** Is someone born on `dob` under 18 on `today`? */
export const isMinor = (dob: string | null | undefined, today: string) => {
  const age = ageOn(dob, today);
  return age !== null && age < SITE_ADULT_AGE;
};

export const SITE_EXPERIENCE_LEVELS = ['none', 'some', 'a_lot'] as const;
export type SiteExperienceLevel = (typeof SITE_EXPERIENCE_LEVELS)[number];
export const SITE_HEARD_FROM = ['instagram', 'friend', 'other'] as const;
export type SiteHeardFrom = (typeof SITE_HEARD_FROM)[number];

/**
 * POST /site/:lang/apply and /site/:lang/workshops/:id/apply — the enquiry form.
 * A factory: the age rules need the school's today (schoolToday(c)). Form
 * values as an HTML form sends them (checkboxes "on" or missing); `locale` is
 * the page language (set by the route from :lang, not a form field).
 * Becomes a lead (createWebsiteLead in src/server/lib/admissions.ts).
 */
export function siteApplyInput(today: string) {
  return z
    .object({
      firstName: reqText(100),
      lastName: reqText(100),
      /** WhatsApp number. */
      phone: sitePhone,
      email: optEmail,
      dateOfBirth: dateStr,
      experience: z.enum(SITE_EXPERIENCE_LEVELS),
      heardFrom: z.enum(SITE_HEARD_FROM),
      message: optText(2000),
      guardianName: optText(200),
      guardianPhone: optSitePhone,
      guardianConsent: formBool,
      privacyConsent: formBool.refine((v) => v, { message: 'site:errors.privacyConsent' }),
      locale: z.enum(LOCALES),
    })
    .superRefine(guardianRules(today))
    .transform((v) => ({ ...v, email: v.email ?? null, message: v.message ?? null, guardianName: v.guardianName ?? null, guardianPhone: v.guardianPhone ?? null, minor: isMinor(v.dateOfBirth, today) }));
}
export type SiteApplyInput = z.output<ReturnType<typeof siteApplyInput>>;
