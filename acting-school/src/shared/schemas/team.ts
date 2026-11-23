import { z } from 'zod';
import type { Permission } from '../permissions';
import type { PositionSummary } from './auth';
import type { SummonsView } from './summons';

/**
 * A colleague as shown next to a message, a summons, a file: name and photo
 * only (owners too — the Team pack's documented exception to owner hiding:
 * owners can be seen and messaged as a name and a photo, never their
 * positions or access). Photo bytes: GET /api/files/:photoFileId.
 */
export interface PersonRef {
  id: number;
  name: string;
  photoFileId: string | null;
  /** Deactivated accounts stay in old conversations but can't be messaged or called. */
  active: boolean;
}

/**
 * GET /api/team — the Team directory, for every signed-in worker: active staff
 * by name. Owner accounts are listed for everyone, but a non-owner sees them
 * with name and photo only (`positions` empty).
 */
export interface TeamMember extends PersonRef {
  /** Empty for an owner account when the caller isn't an owner. */
  positions: PositionSummary[];
  /** The signed-in person themself (no "Message" / "Call to the office" on their own row). */
  isMe: boolean;
  /**
   * With staff.summon: the newest summons the caller sent this person in the
   * last 24 hours (to show "On my way ✓ 10:42" on their row); otherwise null.
   */
  lastSummons: SummonsView | null;
}

/**
 * PUT /api/auth/photo (your own) and PUT /api/staff/:id/photo (staff.manage):
 * a photo you uploaded in the last hour (POST /api/files, an image), or null to
 * remove it. The old photo's file is deleted when nothing else uses it.
 */
export const photoInput = z.object({
  fileId: z.uuid().nullable(),
});
export type PhotoInput = z.infer<typeof photoInput>;

/** Error message keys (issues[].message) of the team endpoints, for the web's `team` namespace. */
export const TEAM_ERROR_KEYS = {
  /** photoInput.fileId: not an image you uploaded in the last hour (or already used elsewhere). */
  photoNotYours: 'team:errors.photoInvalid',
  /** recordFileInput.fileId / message fileIds: not a fresh, unused upload of yours. */
  fileNotYours: 'team:errors.fileInvalid',
} as const;

/**
 * Which buttons PersonActions shows beside a colleague (the API enforces the
 * same rules): "Message" for anyone active but yourself; "Call to the office"
 * also needs staff.summon. Used by the web's PersonActions and tested in
 * tests/unit.
 */
export function personActions(
  viewer: { id: number; permissions: readonly Permission[] } | null | undefined,
  person: { id: number; active: boolean },
): { message: boolean; summon: boolean } {
  if (!viewer || viewer.id === person.id || !person.active) return { message: false, summon: false };
  return { message: true, summon: viewer.permissions.includes('staff.summon') };
}
