/**
 * Enrollment rules shared by the classes module (POST/PATCH
 * /api/courses/:id/enrollments) and admissions (POST /api/leads/:id/enrol).
 * Call inside the caller's transaction so the capacity check and the insert
 * can't race.
 */
import { and, eq, sql } from 'drizzle-orm';
import { COURSE_ERROR_CODES } from '../../shared/schemas/courses';
import type { EnrollmentStatus } from '../../shared/enums';
import type { DB } from '../db/client';
import { enrollments, type courses } from '../db/schema';
import { ApiError } from './errors';

type Tx = Pick<DB, 'select' | 'insert' | 'update'>;
type CourseForEnrollment = Pick<typeof courses.$inferSelect, 'id' | 'capacity'>;

/** Students currently 'enrolled' in the course. */
export function enrolledCount(db: Pick<DB, 'select'>, courseId: number): number {
  return (
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.status, 'enrolled')))
      .get()?.n ?? 0
  );
}

export function classFull(): ApiError {
  return new ApiError(409, COURSE_ERROR_CODES.classFull, 'This class is full');
}

/** 409 class_full when the course has a capacity and it is reached. */
export function assertHasRoom(tx: Pick<DB, 'select'>, course: CourseForEnrollment) {
  if (course.capacity !== null && enrolledCount(tx, course.id) >= course.capacity) throw classFull();
}

/**
 * Enrol a student: 409 already_enrolled if they're in the class, 409
 * previously_enrolled if they were before (re-enrol them with a status change
 * instead), 409 class_full at capacity. Returns the new enrollment id.
 */
export function addEnrollment(tx: Tx, course: CourseForEnrollment, studentId: number, enrolledOn: string): number {
  const existing = tx
    .select({ status: enrollments.status })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, course.id), eq(enrollments.studentId, studentId)))
    .get();
  if (existing?.status === 'enrolled') throw new ApiError(409, COURSE_ERROR_CODES.alreadyEnrolled, 'This student is already enrolled');
  if (existing) throw new ApiError(409, COURSE_ERROR_CODES.previouslyEnrolled, 'This student was in this class before; re-enroll them instead');
  assertHasRoom(tx, course);
  return tx.insert(enrollments).values({ courseId: course.id, studentId, status: 'enrolled', enrolledOn }).returning({ id: enrollments.id }).get().id;
}

/**
 * Change an enrollment's status (withdraw, complete, re-enrol). Moving back to
 * 'enrolled' needs room in the class. False when there is no such enrollment
 * in this course.
 */
export function setEnrollmentStatus(tx: Tx, course: CourseForEnrollment, enrollmentId: number, status: EnrollmentStatus): boolean {
  const row = tx
    .select({ status: enrollments.status })
    .from(enrollments)
    .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.courseId, course.id)))
    .get();
  if (!row) return false;
  if (row.status === status) return true;
  if (status === 'enrolled') assertHasRoom(tx, course);
  tx.update(enrollments).set({ status }).where(eq(enrollments.id, enrollmentId)).run();
  return true;
}

/**
 * Admissions linking an existing student to a class: make sure they are
 * enrolled. Already enrolled → that enrollment as it is; in the class before
 * (withdrawn/completed) → re-enrolled, capacity checked (setEnrollmentStatus);
 * never in it → a new enrollment (addEnrollment). Returns the enrollment id.
 */
export function ensureEnrolled(tx: Tx, course: CourseForEnrollment, studentId: number, enrolledOn: string): number {
  const existing = tx
    .select({ id: enrollments.id, status: enrollments.status })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, course.id), eq(enrollments.studentId, studentId)))
    .get();
  if (!existing) return addEnrollment(tx, course, studentId, enrolledOn);
  setEnrollmentStatus(tx, course, existing.id, 'enrolled');
  return existing.id;
}
