import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ListResponse } from '@shared/schemas/common';
import { COURSE_ERROR_CODES, type CourseDetail, type CourseListItem, type SessionDetail } from '@shared/schemas/courses';
import type { AppSettings } from '@shared/schemas/settings';
import type { StaffDirectoryEntry } from '@shared/schemas/staff';
import type { StudentListItem } from '@shared/schemas/students';
import { ApiError, api, qs } from '@web/lib/api';
import { errorMessageKey } from '@web/lib/forms';

/** Query keys: everything about classes starts with 'courses' or 'sessions'. */
export const keys = {
  courses: ['courses'] as const,
  courseList: (filters: { status?: string; teacherId?: number }) => ['courses', 'list', filters] as const,
  course: (id: number) => ['courses', id] as const,
  sessions: ['sessions'] as const,
  session: (id: number) => ['sessions', id] as const,
};

export function useCourses(filters: { status?: string; teacherId?: number }) {
  return useQuery({
    queryKey: keys.courseList(filters),
    queryFn: () => api.get<ListResponse<CourseListItem>>(`/courses${qs(filters)}`),
  });
}

export function useCourse(id: number, enabled = true) {
  return useQuery({
    queryKey: keys.course(id),
    queryFn: () => api.get<CourseDetail>(`/courses/${id}`),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

export function useSession(id: number) {
  return useQuery({
    queryKey: keys.session(id),
    queryFn: () => api.get<SessionDetail>(`/sessions/${id}`),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/** Active-staff picker data (GET /api/staff/directory). */
export function useStaffDirectory() {
  return useQuery({
    queryKey: ['staff', 'directory'],
    queryFn: () => api.get<ListResponse<StaffDirectoryEntry>>('/staff/directory'),
    staleTime: 5 * 60_000,
  });
}

export function useStudentSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ['students', 'list', { q }],
    queryFn: () => api.get<ListResponse<StudentListItem>>(`/students${qs({ q })}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** Week start from the school settings; Monday if they can't be read. */
export function useWeekStart(): number {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Partial<AppSettings>>('/settings'),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const w = settings.data?.weekStartsOn;
  return w === 0 || w === 1 || w === 6 ? w : 1;
}

/**
 * After any change to a class, its sessions, enrollments or attendance: refresh
 * everything that shows them (lists, schedule, dashboard, student pages).
 */
export function useInvalidateClasses() {
  const qc = useQueryClient();
  return useCallback(
    (opts: { students?: boolean } = {}) => {
      for (const key of [['courses'], ['sessions'], ['schedule'], ['dashboard'], ...(opts.students ? [['students']] : [])]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
    [qc],
  );
}

const CODE_KEYS: Record<string, string> = {
  [COURSE_ERROR_CODES.alreadyEnrolled]: 'classes:errors.alreadyEnrolled',
  [COURSE_ERROR_CODES.previouslyEnrolled]: 'classes:errors.previouslyEnrolled',
  [COURSE_ERROR_CODES.classFull]: 'classes:errors.classFull',
  [COURSE_ERROR_CODES.sessionExists]: 'classes:errors.sessionExists',
  [COURSE_ERROR_CODES.sessionCancelled]: 'classes:errors.sessionCancelled',
};

/** Translation key for an error from the classes API (specific codes first). */
export function classesErrorKey(err: unknown): string {
  if (err instanceof ApiError && CODE_KEYS[err.code]) return CODE_KEYS[err.code]!;
  if (err instanceof ApiError && err.issues?.length) {
    const msg = err.issues[0]!.message;
    if (/^[a-z]+:errors\./i.test(msg)) return msg;
    if (msg.startsWith('errors.')) return `common:${msg}`;
  }
  return errorMessageKey(err);
}

export const isApiCode = (err: unknown, code: string) => err instanceof ApiError && err.code === code;
