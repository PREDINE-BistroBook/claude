import { CASTING_APPLICATION_STATUSES, type CastingApplicationStatus } from '@shared/enums';

/** Tabs on /casting/applications (?status=), in display order; New when missing or unknown. */
export const APPLICATION_TABS = CASTING_APPLICATION_STATUSES;

export function parseApplicationStatus(value: string | null): CastingApplicationStatus {
  return (CASTING_APPLICATION_STATUSES as readonly string[]).includes(value ?? '') ? (value as CastingApplicationStatus) : 'new';
}

export type ApplicationAction = 'accept' | 'reviewing' | 'new' | 'decline' | 'delete';

/**
 * The buttons an application's page offers, mirroring the API: everything
 * needs talent.write; an application already added to the roster can only be
 * deleted (its status can't change: 409) — unless its talent profile was
 * deleted since (`profileGone`: accepted with no talentId), which opens it
 * again: add once more, decline or delete; a declined one can still be added
 * or looked at again.
 */
export function applicationActions(status: CastingApplicationStatus, canWrite: boolean, profileGone = false): ApplicationAction[] {
  if (!canWrite) return [];
  switch (status) {
    case 'new':
      return ['accept', 'reviewing', 'decline', 'delete'];
    case 'reviewing':
      return ['accept', 'decline', 'new', 'delete'];
    case 'declined':
      return ['accept', 'reviewing', 'delete'];
    case 'accepted':
      return profileGone ? ['accept', 'decline', 'delete'] : ['delete'];
  }
}
