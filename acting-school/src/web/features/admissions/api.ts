import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { LeadSource, LeadStatus } from '@shared/enums';
import {
  ADMISSIONS_ERROR_CODES,
  type AdmissionsCourseOption,
  type DuplicateMatch,
  type EnrolInput,
  type EnrolResult,
  type Interview,
  type InterviewScheduleInput,
  type InterviewUpdateInput,
  type LeadActivity,
  type LeadActivityInput,
  type LeadCounts,
  type LeadDetail,
  type LeadGroup,
  type LeadInput,
  type LeadListItem,
  type LeadUpdateInput,
} from '@shared/schemas/admissions';
import type { ListResponse } from '@shared/schemas/common';
import { COURSE_ERROR_CODES } from '@shared/schemas/courses';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/schemas/settings';
import { ApiError, api, qs } from '@web/lib/api';
import { errorMessageKey } from '@web/lib/forms';

export type LeadFilters = {
  q?: string;
  status?: LeadStatus;
  group?: LeadGroup;
  source?: LeadSource;
  assignedToId?: number;
};

/** Query keys: everything about admissions starts with 'leads' so one invalidation refreshes it all. */
export const leadKeys = {
  all: ['leads'] as const,
  list: (filters: LeadFilters) => ['leads', 'list', filters] as const,
  counts: ['leads', 'counts'] as const,
  courseOptions: ['leads', 'course-options'] as const,
  duplicates: (params: { phone?: string; email?: string; excludeLeadId?: number }) => ['leads', 'duplicates', params] as const,
  detail: (id: number) => ['leads', id] as const,
};

export function useLeads(filters: LeadFilters) {
  return useQuery({
    queryKey: leadKeys.list(filters),
    queryFn: () => api.get<ListResponse<LeadListItem>>(`/leads${qs(filters)}`),
    placeholderData: keepPreviousData,
  });
}

/** Numbers for the tab badges. */
export function useLeadCounts() {
  return useQuery({ queryKey: leadKeys.counts, queryFn: () => api.get<LeadCounts>('/leads/counts') });
}

export function useLead(id: number, enabled = true) {
  return useQuery({
    queryKey: leadKeys.detail(id),
    queryFn: () => api.get<LeadDetail>(`/leads/${id}`),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

/** Active classes that haven't ended, with free places — for the preferred-class, recommended-class and enrol pickers. */
export function useCourseOptions(enabled = true) {
  return useQuery({
    queryKey: leadKeys.courseOptions,
    queryFn: () => api.get<ListResponse<AdmissionsCourseOption>>('/leads/course-options'),
    enabled,
  });
}

/** Open leads and students with the same phone / email (names only). A warning, never a block. */
export function useLeadDuplicates(params: { phone?: string; email?: string; excludeLeadId?: number }, enabled: boolean) {
  return useQuery({
    queryKey: leadKeys.duplicates(params),
    queryFn: () => api.get<ListResponse<DuplicateMatch>>(`/leads/duplicates${qs(params)}`),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/**
 * School settings (GET /api/settings, readable by everyone signed in): interview
 * criteria and the country code for WhatsApp numbers. Same key as the schedule
 * and settings screens. Until it loads, the values are DEFAULT_SETTINGS (check
 * `ready`); the school's name for messages comes from useAuth() instead.
 */
export function useAdmissionsSettings(): AppSettings & { ready: boolean } {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<AppSettings>('/settings'),
    staleTime: 10 * 60_000,
  });
  const s = settings.data;
  return {
    schoolName: s?.schoolName ?? DEFAULT_SETTINGS.schoolName,
    schoolNameAr: s?.schoolNameAr ?? DEFAULT_SETTINGS.schoolNameAr,
    defaultLocale: s?.defaultLocale ?? DEFAULT_SETTINGS.defaultLocale,
    weekStartsOn: s?.weekStartsOn ?? DEFAULT_SETTINGS.weekStartsOn,
    interviewCriteria: s?.interviewCriteria ?? DEFAULT_SETTINGS.interviewCriteria,
    defaultCountryCode: s?.defaultCountryCode ?? DEFAULT_SETTINGS.defaultCountryCode,
    ready: !settings.isPending,
  };
}

/**
 * After any admissions change: the lists, counts and lead pages, plus the
 * schedule and home screen (interviews and follow-ups show there). Enrolling
 * also creates a student and an enrollment.
 */
export function useInvalidateAdmissions() {
  const qc = useQueryClient();
  return useCallback(
    (opts: { enrolled?: boolean } = {}) => {
      const keys: string[] = ['leads', 'schedule', 'dashboard'];
      if (opts.enrolled) keys.push('students', 'courses', 'sessions');
      for (const key of keys) void qc.invalidateQueries({ queryKey: [key] });
    },
    [qc],
  );
}

/** Keep the lead page in step with what the server answered, then refresh everything else. */
function useLeadMutationDone(id: number) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAdmissions();
  return (lead?: LeadDetail, opts?: { enrolled?: boolean }) => {
    if (lead) qc.setQueryData(leadKeys.detail(id), lead);
    invalidate(opts);
  };
}

/** Create (no id) or update (id) a lead. */
export function useSaveLead(id?: number) {
  const invalidate = useInvalidateAdmissions();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: LeadInput | LeadUpdateInput) => (id ? api.patch<LeadDetail>(`/leads/${id}`, data) : api.post<LeadDetail>('/leads', data)),
    onSuccess: (saved) => {
      qc.setQueryData(leadKeys.detail(saved.id), saved);
      invalidate();
    },
  });
}

/** PATCH /api/leads/:id with a few fields (status, follow-up…). */
export function useUpdateLead(id: number) {
  const done = useLeadMutationDone(id);
  return useMutation({
    mutationFn: (data: LeadUpdateInput) => api.patch<LeadDetail>(`/leads/${id}`, data),
    onSuccess: (lead) => done(lead),
  });
}

export function useDeleteLead(id: number) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAdmissions();
  return useMutation({
    mutationFn: () => api.delete(`/leads/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: leadKeys.detail(id) });
      invalidate();
    },
  });
}

/** Log a contact or a note (POST /api/leads/:id/activities). */
export function useLogActivity(id: number) {
  const done = useLeadMutationDone(id);
  return useMutation({
    mutationFn: (data: LeadActivityInput) => api.post<LeadActivity>(`/leads/${id}/activities`, data),
    onSuccess: () => done(),
  });
}

export function useScheduleInterview(leadId: number) {
  const done = useLeadMutationDone(leadId);
  return useMutation({
    mutationFn: (data: InterviewScheduleInput) => api.post<Interview>(`/leads/${leadId}/interviews`, data),
    onSuccess: () => done(),
  });
}

export function useUpdateInterview(leadId: number) {
  const done = useLeadMutationDone(leadId);
  return useMutation({
    mutationFn: ({ interviewId, data }: { interviewId: number; data: InterviewUpdateInput }) =>
      api.patch<Interview>(`/leads/${leadId}/interviews/${interviewId}`, data),
    onSuccess: () => done(),
  });
}

export function useEnrol(leadId: number) {
  const done = useLeadMutationDone(leadId);
  return useMutation({
    mutationFn: (data: EnrolInput) => api.post<EnrolResult>(`/leads/${leadId}/enrol`, data),
    onSuccess: (res) => done(res.lead, { enrolled: true }),
  });
}

const CODE_KEYS: Record<string, string> = {
  [ADMISSIONS_ERROR_CODES.leadEnrolled]: 'admissions:errors.leadEnrolled',
  [ADMISSIONS_ERROR_CODES.leadClosed]: 'admissions:errors.leadClosed',
  [ADMISSIONS_ERROR_CODES.courseArchived]: 'admissions:errors.courseArchived',
  [ADMISSIONS_ERROR_CODES.interviewNotScheduled]: 'admissions:errors.interviewNotScheduled',
  [ADMISSIONS_ERROR_CODES.possibleDuplicate]: 'admissions:errors.possibleDuplicate',
  [COURSE_ERROR_CODES.classFull]: 'admissions:errors.classFull',
  [COURSE_ERROR_CODES.alreadyEnrolled]: 'admissions:errors.alreadyEnrolled',
  [COURSE_ERROR_CODES.previouslyEnrolled]: 'admissions:errors.previouslyEnrolled',
};

/** Translation key for an error from the admissions API (specific codes first, then a field message, then the generic ones). */
export function admissionsErrorKey(err: unknown): string {
  if (err instanceof ApiError && CODE_KEYS[err.code]) return CODE_KEYS[err.code]!;
  if (err instanceof ApiError && err.issues?.length) {
    const msg = err.issues[0]!.message;
    if (/^[a-z]+:errors\./i.test(msg)) return msg;
    if (msg.startsWith('errors.')) return `common:${msg}`;
  }
  return errorMessageKey(err);
}

export const isApiCode = (err: unknown, code: string): err is ApiError => err instanceof ApiError && err.code === code;
