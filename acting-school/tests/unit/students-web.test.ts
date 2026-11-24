import { describe, expect, it } from 'vitest';
import { enrolChoice } from '../../src/web/features/students/utils';

/** A student's page, "+ Add to a workshop" (Part K2): each workshop row offers what the API will accept. */

describe('"+ Add to a workshop" on a student’s page', () => {
  const course = (id: number, capacity: number | null = null, enrolledCount = 0) => ({ id, capacity, enrolledCount });
  const mine = [
    { id: 11, courseId: 1, status: 'enrolled' as const },
    { id: 12, courseId: 2, status: 'withdrawn' as const },
    { id: 13, courseId: 3, status: 'completed' as const },
  ];

  it('in it now: no button; left or finished: Re-enroll that enrolment; never in it: Enroll', () => {
    expect(enrolChoice(course(1), mine)).toEqual({ kind: 'enrolled' });
    expect(enrolChoice(course(2), mine)).toEqual({ kind: 'reenrol', enrollmentId: 12, full: false });
    expect(enrolChoice(course(3), mine)).toEqual({ kind: 'reenrol', enrollmentId: 13, full: false });
    expect(enrolChoice(course(4), mine)).toEqual({ kind: 'enrol', full: false });
  });

  it('a full workshop says so on either button; one added from this dialog shows as enrolled before the refetch', () => {
    expect(enrolChoice(course(2, 10, 10), mine)).toEqual({ kind: 'reenrol', enrollmentId: 12, full: true });
    expect(enrolChoice(course(4, 10, 10), mine)).toEqual({ kind: 'enrol', full: true });
    expect(enrolChoice(course(4, 10, 9), mine)).toEqual({ kind: 'enrol', full: false });
    expect(enrolChoice(course(4, 10, 10), mine, new Set([4]))).toEqual({ kind: 'enrolled' });
    expect(enrolChoice(course(2), mine, new Set([2]))).toEqual({ kind: 'enrolled' });
  });
});
