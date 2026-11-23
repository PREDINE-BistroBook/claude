import { z } from 'zod';
import { LOCALES, type Locale } from '../enums';
import { COUNTRY_CODE_RE } from '../phone';
import { EMAIL_DOMAIN_RE } from '../usernames';
import { optText, reqText } from './common';

/** A stable slug for an interview criterion: lower-case letters, digits and "_", starting with a letter. */
export const CRITERION_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_INTERVIEW_CRITERIA = 30;

/**
 * One thing Salma scores in an admissions interview (1–5). `key` is stable:
 * renaming a criterion keeps its key, so stored scores stay attached; scores
 * for a removed criterion are kept on the interview and shown with the key.
 */
export const interviewCriterion = z
  .object({
    key: z.string().trim().regex(CRITERION_KEY_RE, { message: 'settings:errors.criterionKey' }),
    label: reqText(80),
    /** Arabic label; blank/null → the English label is shown in Arabic too. */
    labelAr: optText(80),
  })
  .transform((c): InterviewCriterion => ({ key: c.key, label: c.label, labelAr: c.labelAr ?? null }));
export interface InterviewCriterion {
  key: string;
  label: string;
  labelAr: string | null;
}

/** "+20", " 20 " → "20"; anything else is left for the regex to reject. */
const countryCode = z.preprocess(
  (v) => (typeof v === 'string' ? v.replace(/[\s+]/g, '') : v),
  z.string().regex(COUNTRY_CODE_RE, { message: 'settings:errors.countryCode' }),
);

/** "@Turquoisestudio.app " → "turquoisestudio.app"; anything else is left for the regex to reject. */
const emailDomain = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().replace(/^@/, '').toLowerCase() : v),
  z.string().regex(EMAIL_DOMAIN_RE, { message: 'settings:errors.emailDomain' }),
);

export const settingsInput = z
  .object({
    schoolName: reqText(120),
    /** The school's name in Arabic, shown instead of schoolName when the app is in Arabic. Blank/null → none (schoolName is shown). */
    schoolNameAr: optText(80),
    defaultLocale: z.enum(LOCALES),
    /** 0 Sunday, 1 Monday, 6 Saturday. */
    weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]),
    /** The whole list, in display order (replaces the stored list). Keys must be unique. */
    interviewCriteria: z
      .array(interviewCriterion)
      .max(MAX_INTERVIEW_CRITERIA)
      .superRefine((list, ctx) => {
        const seen = new Set<string>();
        list.forEach((c, i) => {
          if (seen.has(c.key)) ctx.addIssue({ code: 'custom', path: [i, 'key'], message: 'settings:errors.criterionKeyTaken' });
          seen.add(c.key);
        });
      }),
    /** Calling code used to turn local numbers (01012345678) into WhatsApp numbers (201012345678). Digits only, e.g. "20". */
    defaultCountryCode: countryCode,
    /**
     * The domain of the team's addresses: a new team member whose email isn't
     * typed gets <username>@<emailDomain>. Changing it doesn't touch the
     * addresses accounts already have.
     */
    emailDomain,
  })
  .partial();
export type SettingsInput = z.infer<typeof settingsInput>;

/** GET /api/settings — every signed-in person may read them. */
export interface AppSettings {
  schoolName: string;
  /** Arabic name; show `schoolName` when null. */
  schoolNameAr: string | null;
  defaultLocale: Locale;
  weekStartsOn: 0 | 1 | 6;
  interviewCriteria: InterviewCriterion[];
  defaultCountryCode: string;
  /** Domain of the automatic email addresses (<username>@<emailDomain>). */
  emailDomain: string;
}

/** Until the school tells us what Salma assesses (ROADMAP "Waiting on the school"). */
export const DEFAULT_INTERVIEW_CRITERIA: InterviewCriterion[] = [
  { key: 'presence', label: 'Stage presence', labelAr: 'الحضور المسرحي' },
  { key: 'voice', label: 'Voice & diction', labelAr: 'الصوت والإلقاء' },
  { key: 'body', label: 'Body & movement', labelAr: 'الجسد والحركة' },
  { key: 'emotion', label: 'Emotional range', labelAr: 'المدى العاطفي' },
  { key: 'imagination', label: 'Imagination', labelAr: 'الخيال' },
  { key: 'listening', label: 'Listening & focus', labelAr: 'الإنصات والتركيز' },
  { key: 'commitment', label: 'Commitment', labelAr: 'الالتزام' },
];

export const DEFAULT_SETTINGS: AppSettings = {
  schoolName: 'Acting School',
  schoolNameAr: null,
  defaultLocale: 'en',
  weekStartsOn: 1,
  interviewCriteria: DEFAULT_INTERVIEW_CRITERIA,
  /** Egypt. */
  defaultCountryCode: '20',
  /** The studio's own domain. */
  emailDomain: 'turquoisestudio.app',
};
