/**
 * Colleagues as the team pack shows them (chat, summons, files, the Team
 * directory): name and photo — owners too. This is the one deliberate
 * exception to owner hiding (CLAUDE.md): an owner can be seen and messaged as
 * a name and a photo, while their positions and access stay hidden from
 * non-owners everywhere.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Locale } from '../../shared/enums';
import type { PersonRef } from '../../shared/schemas/team';
import type { DB } from '../db/database';
import { users } from '../db/schema';
import { inChunks } from './sqlLimits';

export const personColumns = { id: users.id, name: users.name, photoFileId: users.photoFileId, active: users.active };

/** Name, photo and active flag of several people (missing ids are left out). */
export function loadPersons(db: Pick<DB, 'select'>, ids: readonly (number | null | undefined)[]): Map<number, PersonRef> {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === 'number'))];
  const rows = inChunks(unique, (part) => db.select(personColumns).from(users).where(inArray(users.id, part)).all());
  return new Map(rows.map((r) => [r.id, r]));
}

/** An active staff account (owners included — anyone can message them). */
export function findActivePerson(db: Pick<DB, 'select'>, id: number): (PersonRef & { locale: Locale }) | null {
  return db
    .select({ ...personColumns, locale: users.locale })
    .from(users)
    .where(and(eq(users.id, id), eq(users.active, true)))
    .get() ?? null;
}

/** A stand-in for a person whose row is gone (never expected: accounts are deactivated, not deleted). */
export function missingPerson(id: number): PersonRef {
  return { id, name: '—', photoFileId: null, active: false };
}
