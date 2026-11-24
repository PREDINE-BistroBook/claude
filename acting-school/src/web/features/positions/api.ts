import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse } from '@shared/schemas/common';
import type { Position, PositionInput, PositionUpdateInput } from '@shared/schemas/positions';
import { ApiError, api } from '@web/lib/api';
import { ME_KEY } from '@web/lib/auth';

/** Everything about positions starts with 'positions'. Staff lists show position names, so changes refresh ['staff'] too. */
export const positionKeys = {
  all: ['positions'] as const,
  list: ['positions', 'list'] as const,
};

/** GET /api/positions — needs staff.manage or positions.manage (the staff screen uses it to assign). */
export function usePositions(enabled = true) {
  return useQuery({
    queryKey: positionKeys.list,
    queryFn: () => api.get<ListResponse<Position>>('/positions'),
    enabled,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  // A change to a position you hold changes what you can do: refresh /auth/me as well.
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: positionKeys.all }),
      qc.invalidateQueries({ queryKey: ['staff'] }),
      qc.invalidateQueries({ queryKey: ME_KEY }),
    ]);
}

export function useCreatePosition() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (data: PositionInput) => api.post<Position>('/positions', data),
    onSuccess: invalidate,
  });
}

export function useUpdatePosition(id: number) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (data: PositionUpdateInput) => api.patch<Position>(`/positions/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeletePosition(id: number) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.delete(`/positions/${id}`),
    // Not awaited: once the list no longer has this position its page shows "not found" and unmounts,
    // and the caller's onSuccess (which navigates away) would never run.
    onSuccess: () => {
      void invalidate();
    },
  });
}

/** This API's own refusals as message keys (null → let the form handle it). */
export function positionsErrorKey(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  switch (err.code) {
    case 'exceeds_your_access':
      return 'positions:errors.exceedsYourAccess';
    case 'owner_only':
      return 'positions:errors.ownerOnly';
    case 'last_owner':
      return 'positions:errors.lastOwner';
    case 'position_in_use':
      return 'positions:errors.inUse';
    case 'position_built_in':
      return 'positions:errors.builtIn';
    default:
      return null;
  }
}
