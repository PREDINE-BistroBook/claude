import { z } from 'zod';
import { GENDERS, TALENT_STATUSES, type Gender, type SubmissionStatus, type TalentStatus } from '../enums';
import { id, optDate, optEmail, optEnum, optFileId, optId, optInt, optText, optUrl, reqText, tagList } from './common';

const talentFields = z.object({
  /** Link to a student record when the talent trained at the school. */
  studentId: optId,
  firstName: reqText(100),
  lastName: reqText(100),
  stageName: optText(150),
  email: optEmail,
  phone: optText(50),
  dateOfBirth: optDate,
  gender: optEnum(GENDERS),
  playingAgeMin: optInt(0, 120),
  playingAgeMax: optInt(0, 120),
  heightCm: optInt(30, 250),
  eyeColor: optText(50),
  hairColor: optText(50),
  city: optText(100),
  languages: tagList(30).optional(),
  skills: tagList(100).optional(),
  showreelUrl: optUrl,
  instagram: optText(100),
  /** Primary headshot. Must be one of the talent's photos (or null). */
  headshotFileId: optFileId,
  /** Defaults to 'active' on create. */
  status: z.enum(TALENT_STATUSES).optional(),
  representedSince: optDate,
  notes: optText(5000),
});

export const talentInput = talentFields.refine(
  (t) => t.playingAgeMin == null || t.playingAgeMax == null || t.playingAgeMax >= t.playingAgeMin,
  { message: 'errors.rangeOrder', path: ['playingAgeMax'] },
);
export type TalentInput = z.infer<typeof talentInput>;
export const talentUpdateInput = talentFields.partial();

/** POST /api/talent/:id/photos — attach an uploaded file to the gallery. */
export const talentPhotoInput = z.object({
  fileId: z.uuid(),
  caption: optText(200),
});

/**
 * GET /api/talent query. `age` matches talent whose playing-age range contains it.
 * `skill` / `language` match one tag, case-insensitively.
 */
export const talentListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(TALENT_STATUSES).optional(),
  gender: z.enum(GENDERS).optional(),
  age: z.coerce.number().int().min(0).max(120).optional(),
  skill: z.string().trim().max(60).optional(),
  language: z.string().trim().max(60).optional(),
  studentId: id.optional(),
});

export interface Talent {
  id: number;
  studentId: number | null;
  firstName: string;
  lastName: string;
  stageName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  playingAgeMin: number | null;
  playingAgeMax: number | null;
  heightCm: number | null;
  eyeColor: string | null;
  hairColor: string | null;
  city: string | null;
  languages: string[];
  skills: string[];
  showreelUrl: string | null;
  instagram: string | null;
  headshotFileId: string | null;
  status: TalentStatus;
  representedSince: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

/** GET /api/talent → { items: TalentListItem[] } — also used by the casting "add talent" picker. */
export interface TalentListItem {
  id: number;
  firstName: string;
  lastName: string;
  stageName: string | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  playingAgeMin: number | null;
  playingAgeMax: number | null;
  heightCm: number | null;
  city: string | null;
  headshotFileId: string | null;
  skills: string[];
  languages: string[];
  status: TalentStatus;
}

export interface TalentPhoto {
  id: number;
  fileId: string;
  caption: string | null;
  sortOrder: number;
}

/** GET /api/talent/:id */
export interface TalentDetail extends Talent {
  photos: TalentPhoto[];
  submissions: {
    id: number;
    status: SubmissionStatus;
    castingId: number;
    castingTitle: string;
    roleId: number;
    roleName: string;
    auditionAt: string | null;
    updatedAt: number;
  }[];
  student: { id: number; firstName: string; lastName: string } | null;
}

/** GET /api/talent/tags → every skill and language in use, for autocomplete. */
export interface TalentTags {
  skills: string[];
  languages: string[];
}
