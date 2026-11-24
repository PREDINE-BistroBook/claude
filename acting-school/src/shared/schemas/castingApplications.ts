import { z } from 'zod';
import { CASTING_APPLICATION_STATUSES, GENDERS, LOCALES, type CastingApplicationStatus, type Gender, type Locale } from '../enums';
import { dateStr, optEmail, optInt, optText, reqText } from './common';
import { CASTING_LINKS_MAX, formBool, guardianRules, httpsUrl, isMinor, optSitePhone, sitePhone } from './site';

/**
 * Casting applications: people answering the casting call on the public
 * website (POST /site/:lang/casting-call). Staff API under
 * /api/casting-applications:
 * - list and details: talent.read;
 * - contact fields (phone, email, guardian phone, links): talent.contact —
 *   without it they come back null with contactHidden: true;
 * - accept ("Add to roster": creates the talent profile), decline, mark
 *   reviewing / new, delete: talent.write.
 * Their photos are never public (only GET /api/files/:id for signed-in staff).
 */

// ── The public form ─────────────────────────────────────────────────────────

/**
 * The longest text the list and link fields look into. The public form accepts
 * megabytes before validation: anything longer is left whole, so it fails as
 * "not a list" without being split into millions of pieces.
 */
const FORM_LIST_TEXT_MAX = 4000;

/** "Arabic, English" or one per line (Arabic comma too) → a list without blanks or repeats. */
const formList = (maxItems: number, maxLength = 60) =>
  z.preprocess(
    (v) => {
      if (typeof v === 'string' && v.length > FORM_LIST_TEXT_MAX) return v;
      const raw = typeof v === 'string' ? v.split(/[,،;\n]/) : v == null ? [] : v;
      if (!Array.isArray(raw)) return raw;
      const seen = new Set<string>();
      const out: unknown[] = [];
      for (const item of raw) {
        if (typeof item !== 'string') {
          out.push(item);
          continue;
        }
        const t = item.trim();
        if (!t || seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        out.push(t);
      }
      return out;
    },
    z.array(z.string().max(maxLength)).max(maxItems),
  );

/**
 * One link as people write it → a full https link where the meaning is plain:
 * "@nour.acts" is an Instagram name; "instagram.com/nour.acts" and
 * "www.youtube.com/watch?v=…" only lack the "https://". Anything else is left
 * for the https check (http:, javascript:, data: and "//host" stay refused).
 */
export function normalizeFormLink(raw: string): string {
  const t = raw.trim().replace(/[,،;]+$/, '');
  const handle = /^@([A-Za-z0-9._]{1,30})$/.exec(t);
  if (handle) return `https://www.instagram.com/${handle[1]}/`;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(t)) return `https://${t}`;
  return t;
}

/** Up to 3 links (Instagram, showreel…), stored as https: blanks dropped; a text with several links is split on spaces/new lines. */
const formLinks = z.preprocess(
  (v) => {
    if (typeof v === 'string' && v.length > FORM_LIST_TEXT_MAX) return v;
    const raw = typeof v === 'string' ? v.split(/\s+/) : v == null ? [] : v;
    if (!Array.isArray(raw)) return raw;
    return raw.filter((x) => !(typeof x === 'string' && x.trim() === '')).map((x) => (typeof x === 'string' ? normalizeFormLink(x) : x));
  },
  z.array(httpsUrl).max(CASTING_LINKS_MAX, { message: 'site:errors.tooManyLinks' }),
);

/**
 * POST /site/:lang/casting-call — the casting-call form (multipart; the photos
 * travel separately to createCastingApplication in
 * src/server/lib/castingApplications.ts: 1–3 JPEG/PNG/WebP, the first is the
 * headshot). A factory: the age rules need the school's today. `locale` is the
 * page language (set by the route from :lang).
 */
export function castingApplicationInput(today: string) {
  return z
    .object({
      firstName: reqText(100),
      lastName: reqText(100),
      gender: z.enum(GENDERS),
      dateOfBirth: dateStr,
      phone: sitePhone,
      email: optEmail,
      city: optText(100),
      heightCm: optInt(50, 250),
      languages: formList(10),
      skills: formList(20),
      experience: optText(2000),
      links: formLinks,
      message: optText(2000),
      guardianName: optText(200),
      guardianPhone: optSitePhone,
      guardianConsent: formBool,
      privacyConsent: formBool.refine((v) => v, { message: 'site:errors.privacyConsent' }),
      locale: z.enum(LOCALES),
    })
    .superRefine(guardianRules(today))
    .transform((v) => ({
      ...v,
      email: v.email ?? null,
      city: v.city ?? null,
      heightCm: v.heightCm ?? null,
      experience: v.experience ?? null,
      message: v.message ?? null,
      guardianName: v.guardianName ?? null,
      guardianPhone: v.guardianPhone ?? null,
      minor: isMinor(v.dateOfBirth, today),
    }));
}
export type CastingApplicationInput = z.output<ReturnType<typeof castingApplicationInput>>;

// ── Staff API ───────────────────────────────────────────────────────────────

/** GET /api/casting-applications — `q` matches names and city, plus phone (any format) and email with talent.contact. Newest first. */
export const castingApplicationListQuery = z.object({
  status: z.enum(CASTING_APPLICATION_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type CastingApplicationListQuery = z.infer<typeof castingApplicationListQuery>;

/** PATCH /api/casting-applications/:id (talent.write). 'accepted' only through POST /:id/accept; an accepted application can't change (409). */
export const castingApplicationUpdateInput = z.object({
  status: z.enum(['new', 'reviewing', 'declined']),
});
export type CastingApplicationUpdateInput = z.infer<typeof castingApplicationUpdateInput>;

/** Visible only with talent.contact (null otherwise, contactHidden: true). */
export const CASTING_APPLICATION_CONTACT_FIELDS = ['phone', 'email', 'guardianPhone', 'links'] as const;

/** GET /api/casting-applications → { items }. */
export interface CastingApplicationListItem {
  id: number;
  firstName: string;
  lastName: string;
  gender: Gender | null;
  /** On the school's today. */
  age: number | null;
  city: string | null;
  status: CastingApplicationStatus;
  createdAt: number;
  /** The first photo (the headshot). */
  photoFileId: string | null;
  /** Under 18 on the school's today. */
  minor: boolean;
}

/** GET /api/casting-applications/:id (also the answer of PATCH). */
export interface CastingApplicationDetail {
  id: number;
  firstName: string;
  lastName: string;
  gender: Gender | null;
  dateOfBirth: string;
  age: number | null;
  minor: boolean;
  phone: string | null;
  email: string | null;
  city: string | null;
  heightCm: number | null;
  languages: string[];
  skills: string[];
  experience: string | null;
  links: string[] | null;
  message: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianConsent: boolean;
  /** The language of the page they applied from. */
  locale: Locale;
  status: CastingApplicationStatus;
  reviewedById: number | null;
  reviewedByName: string | null;
  reviewedAt: number | null;
  /** The talent profile made from it (accepted). */
  talentId: number | null;
  /** In order: the first is the headshot. */
  photos: { fileId: string }[];
  createdAt: number;
  updatedAt: number;
  /** True without talent.contact: phone, email, guardianPhone and links are null. */
  contactHidden: boolean;
}

/** GET /api/casting-applications/counts — numbers for the status tabs. */
export type CastingApplicationCounts = Record<CastingApplicationStatus, number>;

/** POST /api/casting-applications/:id/accept → 201. */
export interface AcceptCastingApplicationResult {
  talentId: number;
}

/** error.code values of this API besides the generic ones. */
export const CASTING_APPLICATION_ERROR_CODES = {
  /** 409 — already added to the roster (accept again, or change its status). */
  alreadyAccepted: 'application_accepted',
  /** 409 from createCastingApplication — the casting call is closed (the public route answers its 410 page). */
  castingCallClosed: 'casting_call_closed',
} as const;
