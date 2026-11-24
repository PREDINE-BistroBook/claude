import type { StudentDetail } from '@shared/schemas/students';

/** The students screens' plain logic, unit-tested in tests/unit/students-web.test.ts. */

/**
 * What a workshop's row offers in "+ Add to a workshop" on a student's page —
 * the same choices as the workshop's own "Add student" dialog, so a row never
 * offers what the API refuses:
 * - `enrolled`: in it now (or just added from this dialog);
 * - `reenrol`: was in it before (withdrawn or completed) — POST would answer
 *   409 previously_enrolled, so it is PATCH /courses/:id/enrollments/:enrollmentId
 *   back to 'enrolled' (the server checks the room again);
 * - `enrol`: never in it — POST /courses/:id/enrollments.
 * `full`: the workshop has no place left (the button stays, disabled, saying so).
 */
export type EnrolChoice = { kind: 'enrolled' } | { kind: 'reenrol'; enrollmentId: number; full: boolean } | { kind: 'enrol'; full: boolean };

export function enrolChoice(
  course: { id: number; capacity: number | null; enrolledCount: number },
  enrollments: readonly Pick<StudentDetail['enrollments'][number], 'id' | 'courseId' | 'status'>[],
  addedHere: ReadonlySet<number> = new Set(),
): EnrolChoice {
  const existing = enrollments.find((e) => e.courseId === course.id);
  if (addedHere.has(course.id) || existing?.status === 'enrolled') return { kind: 'enrolled' };
  const full = course.capacity !== null && course.enrolledCount >= course.capacity;
  return existing ? { kind: 'reenrol', enrollmentId: existing.id, full } : { kind: 'enrol', full };
}
