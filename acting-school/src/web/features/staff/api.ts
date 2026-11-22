import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse } from '@shared/schemas/common';
import type { AppSettings } from '@shared/schemas/settings';
import type { StaffCreateInput, StaffMember, StaffUpdateInput } from '@shared/schemas/staff';
import { ApiError, api } from '@web/lib/api';
import { ME_KEY } from '@web/lib/auth';

/** Everything about staff starts with 'staff' (the directory other screens use is ['staff', 'directory']). */
export const staffKeys = {
  all: ['staff'] as const,
  list: ['staff', 'list'] as const,
};

export function useStaffList() {
  return useQuery({
    queryKey: staffKeys.list,
    queryFn: () => api.get<ListResponse<StaffMember>>('/staff'),
  });
}

/** School settings (any signed-in role may read them). Same key and shape as the other screens use. */
export function useSchoolSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<AppSettings>('/settings'),
    staleTime: 5 * 60_000,
  });
}

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: StaffCreateInput) => api.post<StaffMember>('/staff', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKeys.all }),
  });
}

/** PATCH a staff account. Editing yourself also refreshes /auth/me (name, language in the shell). */
export function useUpdateStaff(id: number, isSelf: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: StaffUpdateInput) => api.patch<StaffMember>(`/staff/${id}`, data),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: staffKeys.all }),
        isSelf ? qc.invalidateQueries({ queryKey: ME_KEY }) : Promise.resolve(),
      ]);
    },
  });
}

/** The 409/403 answers this API gives, as message keys in this namespace (null → let the form handle it). */
export function staffErrorKey(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.code === 'cannot_change_self') return 'staff:errors.cannotChangeSelf';
  if (err.code === 'last_owner') return 'staff:errors.lastOwner';
  if (err.code === 'forbidden') return 'staff:errors.ownerOnly';
  return null;
}

/** A readable temporary password: no look-alike characters (0/O, 1/l/I). */
export function generatePassword(length = 12): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  // Group in fours so it's easy to read out loud: abcd-efgh-jkmn.
  return out.match(/.{1,4}/g)!.join('-');
}
