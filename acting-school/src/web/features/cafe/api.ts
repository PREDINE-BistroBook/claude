import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CafeServeStatus } from '@shared/enums';
import {
  CAFE_ERROR_CODES,
  type CafeItem,
  type CafeItemInput,
  type CafeItemUpdateInput,
  type CafeMenu,
  type CafeOrder,
  type CafeOrderInput,
  type CafePlace,
  type CafeUnread,
} from '@shared/schemas/cafe';
import type { ListResponse } from '@shared/schemas/common';
import { api, ApiError } from '@web/lib/api';
import { errorMessageKey } from '@web/lib/forms';
import { teamKeys, useUnread } from '../team/api';

/** Query keys of the cafeteria: everything starts with 'cafe', so one invalidation refreshes it all. */
export const cafeKeys = {
  all: ['cafe'] as const,
  menu: ['cafe', 'menu'] as const,
  mine: ['cafe', 'orders', 'mine'] as const,
  board: ['cafe', 'orders', 'board'] as const,
};

/** How often the board and an open order of mine are read again while the page is visible. */
export const CAFE_REFRESH_MS = 10_000;

/**
 * The cafeteria as the 20-second poll reports it (GET /api/chat/unread →
 * `cafe`): switched on or not, and the counts behind the badges. `undefined`
 * until the poll has answered — nothing about the cafeteria is shown before.
 */
export function useCafeStatus(): CafeUnread | undefined {
  return useUnread().data?.cafe;
}

/** GET /api/cafe/menu: the menu, the places, and where my last order went. */
export function useCafeMenu(enabled = true) {
  return useQuery({ queryKey: cafeKeys.menu, queryFn: () => api.get<CafeMenu>('/cafe/menu'), enabled, staleTime: 30_000 });
}

/** GET /api/cafe/orders/mine — read again every 10 s while one of them is still coming (`watch`). */
export function useMyCafeOrders(enabled: boolean, watch: (orders: CafeOrder[]) => boolean) {
  return useQuery({
    queryKey: cafeKeys.mine,
    queryFn: () => api.get<ListResponse<CafeOrder>>('/cafe/orders/mine'),
    enabled,
    refetchInterval: (query) => (query.state.data && watch(query.state.data.items) ? CAFE_REFRESH_MS : false),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/** GET /api/cafe/orders (cafeteria.serve): the board, read again every 10 s while it is on screen. */
export function useCafeBoard(enabled: boolean) {
  return useQuery({
    queryKey: cafeKeys.board,
    queryFn: () => api.get<ListResponse<CafeOrder>>('/cafe/orders'),
    enabled,
    refetchInterval: CAFE_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/** After anything changes: the cafeteria's own lists, and the poll behind the badges and the bell. */
function useRefreshCafe() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: cafeKeys.all }),
      qc.invalidateQueries({ queryKey: teamKeys.unread }),
      qc.invalidateQueries({ queryKey: teamKeys.notifications }),
    ]);
}

/** POST /api/cafe/orders. */
export function useSendOrder() {
  const refresh = useRefreshCafe();
  return useMutation({ mutationFn: (data: CafeOrderInput) => api.post<CafeOrder>('/cafe/orders', data), onSettled: refresh });
}

/** POST /api/cafe/orders/:id/cancel (my own order, while it is new). */
export function useCancelMyOrder() {
  const refresh = useRefreshCafe();
  return useMutation({ mutationFn: (id: number) => api.post<CafeOrder>(`/cafe/orders/${id}/cancel`), onSettled: refresh });
}

/** POST /api/cafe/orders/:id/status (cafeteria.serve): the next step, or cancelled with a reason. */
export function useMoveOrder() {
  const refresh = useRefreshCafe();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: CafeServeStatus; reason?: string }) => api.post<CafeOrder>(`/cafe/orders/${id}/status`, { status, reason }),
    onSettled: refresh,
  });
}

/** The menu editor's changes (cafeteria.serve or settings.manage). */
export function useMenuEditor() {
  const refresh = useRefreshCafe();
  const add = useMutation({ mutationFn: (data: CafeItemInput) => api.post<CafeItem>('/cafe/menu', data), onSettled: refresh });
  const update = useMutation({
    mutationFn: ({ id, ...data }: CafeItemUpdateInput & { id: number }) => api.patch<CafeItem>(`/cafe/menu/${id}`, data),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/cafe/menu/${id}`), onSettled: refresh });
  const reorder = useMutation({ mutationFn: (ids: number[]) => api.post<ListResponse<CafeItem>>('/cafe/menu/order', { ids }), onSettled: refresh });
  const addUsual = useMutation({ mutationFn: () => api.post<ListResponse<CafeItem>>('/cafe/menu/defaults'), onSettled: refresh });
  const savePlaces = useMutation({
    mutationFn: (places: { en: string; ar: string }[]) => api.put<{ places: CafePlace[] }>('/cafe/places', { places }),
    onSettled: refresh,
  });
  return { add, update, remove, reorder, addUsual, savePlaces };
}

/** Message keys for the cafeteria's errors (falls back to the generic ones). */
export function cafeErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const issue = err.issues?.find((i) => /^[a-z]+:errors\./i.test(i.message));
    if (issue) return issue.message;
    switch (err.code) {
      case CAFE_ERROR_CODES.cafeteriaOff:
        return 'cafe:errors.cafeteriaOff';
      case CAFE_ERROR_CODES.itemUnavailable:
        return 'cafe:errors.itemUnavailable';
      case CAFE_ERROR_CODES.tooManyOrders:
        return 'cafe:errors.tooManyOrders';
      case CAFE_ERROR_CODES.orderClosed:
        return 'cafe:errors.orderClosed';
      case CAFE_ERROR_CODES.notNextStep:
        return 'cafe:errors.notNextStep';
      case CAFE_ERROR_CODES.alreadyOnTheWay:
        return 'cafe:errors.alreadyOnTheWay';
      case CAFE_ERROR_CODES.menuNotEmpty:
        return 'cafe:errors.menuNotEmpty';
      case CAFE_ERROR_CODES.menuFull:
        return 'cafe:errors.menuFull';
    }
  }
  return errorMessageKey(err);
}
