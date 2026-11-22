import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StudentStatus } from '@shared/enums';
import type { ListResponse } from '@shared/schemas/common';
import type { Student, StudentDetail, StudentInput, StudentListItem } from '@shared/schemas/students';
import { api, qs } from '@web/lib/api';

/** Query keys: everything about students starts with 'students' so one invalidation refreshes it all. */
export const studentKeys = {
  all: ['students'] as const,
  list: (filters: { q?: string; status?: StudentStatus }) => ['students', filters] as const,
  detail: (id: number) => ['students', id] as const,
};

export function useStudents(filters: { q?: string; status?: StudentStatus }) {
  return useQuery({
    queryKey: studentKeys.list(filters),
    queryFn: () => api.get<ListResponse<StudentListItem>>(`/students${qs(filters)}`),
    // Keep showing the previous results while a new search loads, instead of flashing a spinner.
    placeholderData: keepPreviousData,
  });
}

export function useStudent(id: number, enabled = true) {
  return useQuery({
    queryKey: studentKeys.detail(id),
    queryFn: () => api.get<StudentDetail>(`/students/${id}`),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

/** Create (no id) or update (id) a student. */
export function useSaveStudent(id?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: StudentInput) => (id ? api.patch<Student>(`/students/${id}`, data) : api.post<Student>('/students', data)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: studentKeys.all });
      // Names and photos show up on class rosters too.
      void qc.invalidateQueries({ queryKey: ['courses'] });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useDeleteStudent(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/students/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: studentKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: studentKeys.all });
      // Their enrollments and attendance are gone; a linked talent profile is now unlinked.
      for (const key of ['courses', 'sessions', 'talent', 'dashboard', 'schedule']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}
