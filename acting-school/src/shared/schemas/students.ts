import { z } from 'zod';
import { GENDERS, STUDENT_STATUSES, type EnrollmentStatus, type Gender, type StudentStatus } from '../enums';
import { optDate, optEmail, optEnum, optFileId, optText, reqText } from './common';

export const studentInput = z.object({
  firstName: reqText(100),
  lastName: reqText(100),
  email: optEmail,
  phone: optText(50),
  dateOfBirth: optDate,
  gender: optEnum(GENDERS),
  /** Defaults to 'active' on create. */
  status: z.enum(STUDENT_STATUSES).optional(),
  /** Defaults to today on create. */
  joinedOn: optDate,
  guardianName: optText(200),
  guardianPhone: optText(50),
  guardianEmail: optEmail,
  emergencyName: optText(200),
  emergencyPhone: optText(50),
  photoFileId: optFileId,
  /** Photo/filming consent. Defaults to false on create. */
  mediaConsent: z.boolean().optional(),
  notes: optText(5000),
});
export type StudentInput = z.infer<typeof studentInput>;
export const studentUpdateInput = studentInput.partial();

/**
 * Contact details, visible only with students.contact. Without it the API
 * answers null for these (and contactHidden: true), doesn't search them, and
 * ignores them on create/update so an edit form can't wipe them.
 */
export const STUDENT_CONTACT_FIELDS = ['email', 'phone', 'guardianName', 'guardianPhone', 'guardianEmail', 'emergencyName', 'emergencyPhone'] as const;
export type StudentContactField = (typeof STUDENT_CONTACT_FIELDS)[number];

/** Query string for GET /api/students. */
export const studentListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
});

export interface Student {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  status: StudentStatus;
  joinedOn: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  photoFileId: string | null;
  mediaConsent: boolean;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  /** True when the caller can't see contact details (no students.contact): those fields are null. */
  contactHidden: boolean;
}

/** GET /api/students → { items: StudentListItem[] } (sorted by last name, first name). */
export interface StudentListItem {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  status: StudentStatus;
  photoFileId: string | null;
  /** Number of enrollments with status 'enrolled' (in classes the caller can see). */
  activeEnrollments: number;
  /** True when the caller can't see contact details (no students.contact): email and phone are null. */
  contactHidden: boolean;
}

/** GET /api/students/:id — enrollments and attendance cover only the classes the caller can see. */
export interface StudentDetail extends Student {
  enrollments: {
    id: number;
    courseId: number;
    courseName: string;
    courseColor: string | null;
    status: EnrollmentStatus;
    enrolledOn: string;
  }[];
  attendance: { present: number; late: number; absent: number; excused: number; total: number };
  /** Set when this student is also on the agency's talent roster. */
  talentId: number | null;
}
