import { z } from 'zod';
import {
  CASTING_STATUSES,
  CASTING_TYPES,
  GENDERS,
  SUBMISSION_STATUSES,
  type CastingStatus,
  type CastingType,
  type Gender,
  type SubmissionStatus,
} from '../enums';
import { id, optDate, optDateTime, optEmail, optEnum, optInt, optText, reqText } from './common';

const castingFields = z.object({
  title: reqText(200),
  production: optText(200),
  castingDirector: optText(200),
  contactEmail: optEmail,
  contactPhone: optText(50),
  type: optEnum(CASTING_TYPES),
  location: optText(200),
  description: optText(10000),
  /** Defaults to 'open' on create. */
  status: z.enum(CASTING_STATUSES).optional(),
  submissionDeadline: optDate,
  shootStart: optDate,
  shootEnd: optDate,
  /** Free text, e.g. "€500/day + buyout". Informational only — no money moves in this app. */
  rate: optText(200),
});

export const castingInput = castingFields.refine((c) => !c.shootStart || !c.shootEnd || c.shootEnd >= c.shootStart, {
  message: 'errors.endBeforeStart',
  path: ['shootEnd'],
});
export type CastingInput = z.infer<typeof castingInput>;
export const castingUpdateInput = castingFields.partial();

export const castingListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CASTING_STATUSES).optional(),
});

const roleFields = z.object({
  name: reqText(150),
  description: optText(5000),
  gender: optEnum(GENDERS),
  ageMin: optInt(0, 120),
  ageMax: optInt(0, 120),
  requirements: optText(2000),
});
export const castingRoleInput = roleFields.refine((r) => r.ageMin == null || r.ageMax == null || r.ageMax >= r.ageMin, {
  message: 'errors.rangeOrder',
  path: ['ageMax'],
});
export const castingRoleUpdateInput = roleFields.partial();

/** POST /api/submissions — put a talent forward for a role. */
export const submissionInput = z.object({
  roleId: id,
  talentId: id,
  /** Defaults to 'shortlisted'. */
  status: z.enum(SUBMISSION_STATUSES).optional(),
  auditionAt: optDateTime,
  auditionLocation: optText(200),
  notes: optText(5000),
});
/**
 * Statuses that mean the talent was sent to the client. Moving a submission to
 * one of these needs castings.send (403 'cannot_send' otherwise); shortlisted,
 * rejected and withdrawn need only castings.write.
 */
export const SENDING_SUBMISSION_STATUSES = ['submitted', 'audition', 'callback', 'booked'] as const satisfies readonly SubmissionStatus[];
export const isSendingStatus = (s: SubmissionStatus): boolean => (SENDING_SUBMISSION_STATUSES as readonly string[]).includes(s);

export const submissionUpdateInput = z
  .object({
    status: z.enum(SUBMISSION_STATUSES),
    auditionAt: optDateTime,
    auditionLocation: optText(200),
    notes: optText(5000),
  })
  .partial();

/** GET /api/castings → { items: CastingListItem[] } */
export interface CastingListItem {
  id: number;
  title: string;
  production: string | null;
  type: CastingType | null;
  status: CastingStatus;
  location: string | null;
  submissionDeadline: string | null;
  shootStart: string | null;
  shootEnd: string | null;
  rolesCount: number;
  submissionsCount: number;
  bookedCount: number;
}

export interface Submission {
  id: number;
  roleId: number;
  talentId: number;
  status: SubmissionStatus;
  auditionAt: string | null;
  auditionLocation: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  talent: {
    id: number;
    firstName: string;
    lastName: string;
    stageName: string | null;
    headshotFileId: string | null;
  };
}

export interface CastingRole {
  id: number;
  castingId: number;
  name: string;
  description: string | null;
  gender: Gender | null;
  ageMin: number | null;
  ageMax: number | null;
  requirements: string | null;
  submissions: Submission[];
}

/** GET /api/castings/:id */
export interface CastingDetail extends Omit<CastingListItem, 'rolesCount' | 'submissionsCount' | 'bookedCount'> {
  castingDirector: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  description: string | null;
  rate: string | null;
  createdAt: number;
  updatedAt: number;
  roles: CastingRole[];
}
