import { holdsAll, type Permission } from '@shared/permissions';
import type { Position } from '@shared/schemas/positions';

/**
 * Why a position you can't edit is locked, when it isn't what it allows: you
 * hold all of that, so the API refused because someone holding it can do more
 * than you (editing it would change their access too).
 */
export function heldByOthersBeyondReach(position: Pick<Position, 'editable' | 'isOwner' | 'permissions'>, myPermissions: readonly Permission[]): boolean {
  return !position.editable && !position.isOwner && holdsAll(myPermissions, position.permissions);
}
