/**
 * Clear the demo and create the real team — POST /api/admin/clear-demo
 * (routes/admin.ts; Part I3 of docs/SECTIONS_AND_WEBSITE.md). An operator
 * tool for a live database: it deletes every record the app holds and every
 * account not named under `keep`, creates the accounts under `create` with a
 * temporary first password, and leaves the settings, the positions and (as
 * asked) the website's content.
 *
 * How it stays safe:
 * - **A dry run first, always.** planClearDemo only reads. It answers exactly
 *   what a real run would do and a `confirm` code — an HMAC (keyed with the
 *   ADMIN_TOKEN, so the code says nothing about the passwords in the request)
 *   over the request and over the plan: the accounts afterwards, the kept
 *   accounts' ids, the ids of the accounts that go, the row counts and the
 *   last rowid of every emptied table, the website content afterwards. So a
 *   code works once: after a run the accounts it created have new ids.
 * - **A real run needs that code, and the same plan.** It plans again inside
 *   its transaction, on the data as it is then, and stops unless the code
 *   still matches: a different request is `confirm_mismatch`, the same request
 *   on changed data is `plan_changed`.
 * - **One synchronous transaction.** Passwords are hashed and the restore
 *   point is recorded before it (nothing awaits inside); every delete, insert
 *   and the website reset happen in it, and at its end the row counts of every
 *   table are compared with the plan — any difference throws, and the whole
 *   run rolls back. Stored file bytes are deleted after it.
 * - **Every table is listed** in CLEAR_DEMO_TABLES with what happens to its
 *   rows. tests/api/clear-demo.test.ts walks the schema: a new table that is
 *   not listed here fails the suite.
 *
 * Durable Object rules (CLAUDE.md): table by table, a plain DELETE each —
 * never a long IN list; account ids go in slices of IN_LIST_CHUNK.
 */
import { and, count, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { createHmac } from 'node:crypto';
import type { Locale } from '../../shared/enums';
import {
  CLEAR_DEMO_ERROR_CODES as CODES,
  CLEAR_DEMO_WARNING_CODES as WARNINGS,
  type ClearDemoAccount,
  type ClearDemoCounts,
  type ClearDemoDeletedAccount,
  type ClearDemoInput,
  type ClearDemoResult,
  type ClearDemoSiteContent,
  type ClearDemoWarning,
  type RestorePoint,
} from '../../shared/schemas/admin';
import type { ApiIssue } from '../../shared/schemas/common';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../shared/schemas/site';
import { automaticEmail } from '../../shared/usernames';
import { loadPositionRows } from '../lib/access';
import { ApiError } from '../lib/errors';
import { FILE_REFERENCES, deleteStoredFiles, takeEveryUnusedFile } from '../lib/fileRefs';
import type { FileStore } from '../lib/fileStore';
import { ownerPositionToGive } from '../lib/ownerRecovery';
import { hashPassword, sameSecret } from '../lib/password';
import type { RestoreDeps } from '../lib/restorePoint';
import { getSettings } from '../lib/settings';
import { SITE_SETTING, getSiteContent, hasSiteContent, saveSiteContent } from '../lib/siteContent';
import { IN_LIST_CHUNK, chunk, inChunks, insertBatches } from '../lib/sqlLimits';
import { findSignInAccount, newAccountNames, usernameOf } from '../lib/usernames';
import type { DB } from './database';
import * as t from './schema';

// ── Every table, and what happens to its rows ───────────────────────────────

/**
 * - 'all': every row is deleted (the school's records, and the bookkeeping
 *   that belongs to the old accounts: sessions, sign-in brakes, counters).
 * - 'accounts': the rows of accounts that are not kept are deleted; the kept
 *   accounts' rows stay and the new accounts' rows are added.
 * - 'unused': files — a row goes when nothing uses it any more (a kept
 *   account's photo stays; the website's main photo stays if the content does).
 * - 'bytes': the stored bytes of the files table (file_chunks): they follow
 *   their files row, through the FileStore, after the transaction.
 * - 'stay': left as it is (positions; the cafeteria's menu; settings, where
 *   only the website's content object changes, as `keepSiteContent` says —
 *   the cafeteria's switch and places are settings too, and stay).
 */
export type ClearDemoRows = 'all' | 'accounts' | 'unused' | 'bytes' | 'stay';

export interface ClearDemoTable {
  table: SQLiteTable;
  rows: ClearDemoRows;
  /**
   * Counted and deleted like the rest, but not part of the confirm code:
   * these change whenever someone signs in or a form is posted, which is no
   * reason to refuse a run the operator has just looked at.
   */
  volatile?: true;
}

/**
 * Every table of the schema, children before parents (so no delete leaves a
 * row pointing at nothing, and no cascade has work left to do). The one link
 * that runs the other way — files.uploaded_by → users — is cleared by hand
 * before the accounts go.
 */
export const CLEAR_DEMO_TABLES: readonly ClearDemoTable[] = [
  // The video pipeline (it points at workshops, sessions, students and accounts): every video, who is in it, its history
  { table: t.videoEvents, rows: 'all' },
  { table: t.videoStudents, rows: 'all' },
  { table: t.videos, rows: 'all' },
  // The cafeteria's orders (they point at accounts); its menu stays (below)
  { table: t.cafeOrderItems, rows: 'all' },
  { table: t.cafeOrders, rows: 'all' },
  // The team pack (notifications: every kind, the cafeteria's included)
  { table: t.pushSubscriptions, rows: 'all', volatile: true },
  { table: t.notifications, rows: 'all' },
  { table: t.summons, rows: 'all' },
  { table: t.messageAttachments, rows: 'all' },
  { table: t.messages, rows: 'all' },
  { table: t.conversationMembers, rows: 'all' },
  { table: t.conversations, rows: 'all' },
  { table: t.castingFiles, rows: 'all' },
  { table: t.courseFiles, rows: 'all' },
  // The website's records
  { table: t.castingApplicationPhotos, rows: 'all' },
  { table: t.castingApplications, rows: 'all' },
  { table: t.siteWorkshops, rows: 'all' },
  { table: t.siteCoaches, rows: 'all' },
  { table: t.rateLimits, rows: 'all', volatile: true },
  // Admissions
  { table: t.interviews, rows: 'all' },
  { table: t.leadActivities, rows: 'all' },
  { table: t.leads, rows: 'all' },
  // Casting
  { table: t.submissions, rows: 'all' },
  { table: t.castingRoles, rows: 'all' },
  { table: t.castings, rows: 'all' },
  { table: t.talentPhotos, rows: 'all' },
  { table: t.talent, rows: 'all' },
  // School
  { table: t.attendance, rows: 'all' },
  { table: t.classSessions, rows: 'all' },
  { table: t.enrollments, rows: 'all' },
  { table: t.courseSlots, rows: 'all' },
  { table: t.courses, rows: 'all' },
  { table: t.students, rows: 'all' },
  // Signing in: everyone is signed out, kept accounts included, and every brake is lifted
  { table: t.loginFailures, rows: 'all', volatile: true },
  { table: t.authSessions, rows: 'all', volatile: true },
  // Accounts
  { table: t.userPositions, rows: 'accounts' },
  { table: t.users, rows: 'accounts' },
  // Stored files
  { table: t.files, rows: 'unused' },
  { table: t.fileChunks, rows: 'bytes' },
  // What stays
  { table: t.positions, rows: 'stay' },
  { table: t.cafeItems, rows: 'stay' },
  { table: t.settings, rows: 'stay' },
];

const tableName = (table: SQLiteTable) => getTableConfig(table).name;
const NAME = {
  users: tableName(t.users),
  userPositions: tableName(t.userPositions),
  files: tableName(t.files),
  positions: tableName(t.positions),
  cafeItems: tableName(t.cafeItems),
  settings: tableName(t.settings),
};

type Reader = Pick<DB, 'select'>;
const rowCount = (db: Reader, table: SQLiteTable) => db.select({ n: count() }).from(table).get()?.n ?? 0;

// ── The plan ────────────────────────────────────────────────────────────────

interface PlannedAccount {
  name: string;
  username: string;
  /** As typed in the request; null → the automatic address (`email`). */
  typedEmail: string | null;
  email: string;
  locale: Locale;
  positionIds: number[];
}

type PlannedOwner = { status: 'created'; index: number } | { status: 'kept'; id: number; give: number | null; activate: boolean };

/** What a run does, worked out by reading only. `accounts`, `willDelete` and `site.summary` are what the operator is shown. */
export interface ClearDemoPlan {
  emailDomain: string;
  /** Accounts that go (every one not kept). */
  deleteUserIds: number[];
  create: PlannedAccount[];
  owner: PlannedOwner;
  /** The kept accounts (by id), then the created ones (in the request's order; id null until they exist). */
  accounts: ClearDemoAccount[];
  /** The accounts that go, by id: what the operator is shown of `deleteUserIds`. */
  deletedAccounts: ClearDemoDeletedAccount[];
  /** Things in the request the operator should look at twice (a temporary password two accounts share, a created account taking the name of one that goes). */
  warnings: ClearDemoWarning[];
  willDelete: ClearDemoCounts;
  /**
   * The highest rowid of every table that is emptied (null when it is empty) —
   * part of the confirm code, not shown: a record deleted and another added
   * between the dry run and the real run leaves the counts equal, not these.
   */
  lastRowIds: Record<string, number | null>;
  /** Rows each table that is not emptied must hold when the run is over (checked before the transaction commits). */
  after: Record<string, number>;
  site: { write: 'leave' | 'save' | 'remove'; after: SiteContent | null; summary: ClearDemoSiteContent };
}

const issue = (path: (string | number)[], message: string): ApiIssue => ({ path, code: 'custom', message });

/** The website's content object after the run (null: no 'site' key), and what to tell the operator about it. */
function planSiteContent(db: Reader, mode: ClearDemoInput['keepSiteContent']): ClearDemoPlan['site'] {
  const stored = hasSiteContent(db) ? getSiteContent(db) : null;
  let after: SiteContent | null = null;
  let write: ClearDemoPlan['site']['write'] = 'leave';
  if (mode === 'all') after = stored;
  else if (mode === 'none') write = stored ? 'remove' : 'leave';
  else if (stored) {
    // 'contact': the studio's own words and contact lines stay; what was made up for the demo, or pointed at it,
    // goes — the casting call's texts too (they are not on the spec's list, and switching the call on would publish them).
    after = { ...stored, published: false, heroFileId: null, links: [], castingCall: structuredClone(DEFAULT_SITE_CONTENT.castingCall) };
    write = 'save';
  }
  const texts: [string, unknown][] = after
    ? [
        ['tagline', after.tagline.en || after.tagline.ar],
        ['about', after.about.en || after.about.ar],
        ['address', after.address.en || after.address.ar],
        ['mapUrl', after.mapUrl],
        ['whatsappWorkshops', after.whatsappWorkshops],
        ['whatsappCasting', after.whatsappCasting],
        ['phone', after.phone],
        ['email', after.email],
        ['instagram', after.instagram],
        ['castingCall.intro', after.castingCall.intro.en || after.castingCall.intro.ar],
        ['castingCall.lookingFor', after.castingCall.lookingFor.en || after.castingCall.lookingFor.ar],
      ]
    : [];
  const linksAfter = after?.links.length ?? 0;
  return {
    write,
    after,
    summary: {
      mode,
      published: after?.published ?? false,
      castingCallOpen: after?.castingCall.open ?? false,
      kept: texts.filter(([, value]) => !!value).map(([name]) => name),
      links: { kept: linksAfter, removed: (stored?.links.length ?? 0) - linksAfter },
      mainPhoto: stored?.heroFileId ? (after?.heroFileId ? 'kept' : 'removed') : 'none',
    },
  };
}

/**
 * The files something will still use once the records are gone: looked up
 * through the same FILE_REFERENCES list the deleting uses (takeEveryUnusedFile)
 * — the columns of tables that are emptied count for nothing, a kept
 * account's photo counts — plus the website's main photo as it will be.
 */
function filesStaying(db: Reader, keptIds: readonly number[], heroAfter: string | null): number {
  const ids = new Set<string>(heroAfter ? [heroAfter] : []);
  for (const { table, column } of FILE_REFERENCES) {
    const rows = CLEAR_DEMO_TABLES.find((x) => x.table === table)?.rows;
    if (rows === 'all') continue;
    if (rows === 'accounts' && table !== t.users) throw new Error(`clear-demo: don't know which rows of ${tableName(table)} stay`);
    const read = (where?: SQL) =>
      db
        .select({ id: column })
        .from(table)
        .where(and(isNotNull(column), where))
        .all() as { id: string }[];
    const found = rows === 'accounts' ? inChunks(keptIds, (part) => read(inArray(t.users.id, part))) : read();
    for (const r of found) ids.add(r.id);
  }
  return inChunks([...ids], (part) => db.select({ id: t.files.id }).from(t.files).where(inArray(t.files.id, part)).all()).length;
}

/** The highest rowid of a table, or null when it has no rows (one indexed read: rowid is the table's own order). */
const lastRowId = (db: Reader, table: SQLiteTable): number | null => db.select({ n: sql<number | null>`max(rowid)` }).from(table).get()?.n ?? null;

/** The accounts a run deletes, as the operator is shown them (by id). */
function accountsGoing(db: Reader, ids: readonly number[]): ClearDemoDeletedAccount[] {
  const rows = inChunks(ids, (part) =>
    db.select({ id: t.users.id, username: t.users.username, email: t.users.email, name: t.users.name, active: t.users.active }).from(t.users).where(inArray(t.users.id, part)).all(),
  ).sort((a, b) => a.id - b.id);
  const held = loadPositionRows(db, ids);
  return rows.map((u) => ({ id: u.id, username: usernameOf(u), email: u.email, name: u.name, active: u.active, owner: held.get(u.id)!.some((p) => p.isOwner) }));
}

/**
 * What the operator should look at twice before the real run (it goes ahead
 * all the same — the request is theirs):
 * - `shared_password`: created accounts with the same temporary password.
 *   Whoever signs in first with it can take any of those accounts and choose
 *   its password — an owner's too (`owner: true`). Compared as scrypt sees
 *   them (NFKC, lib/password.ts). Never says what the password is.
 * - `replaces_account`: a created account takes the username or the email
 *   address of an account that is deleted — a new account with a temporary
 *   password replaces one someone may be using (it belongs under `keep` if
 *   that person should keep their password, photo and records of their own).
 */
function planWarnings(input: ClearDemoInput, accounts: readonly ClearDemoAccount[], going: readonly ClearDemoDeletedAccount[]): ClearDemoWarning[] {
  const warnings: ClearDemoWarning[] = [];
  const created = accounts.filter((a) => a.status === 'created');
  const byPassword = new Map<string, ClearDemoAccount[]>();
  input.create.forEach((a, i) => {
    const key = a.password.normalize('NFKC');
    byPassword.set(key, [...(byPassword.get(key) ?? []), created[i]!]);
  });
  for (const group of byPassword.values()) {
    if (group.length < 2) continue;
    const owner = group.some((a) => a.owner);
    const usernames = group.map((a) => a.username);
    warnings.push({
      code: WARNINGS.sharedPassword,
      usernames,
      owner,
      message: `${usernames.join(', ')} would share one temporary password: whoever signs in first with it can take ${owner ? 'any of these accounts — an owner’s included —' : 'any of these accounts'} and choose its password. Give each account a password of its own.`,
    });
  }
  for (const a of created) {
    const old = going.find((g) => g.username === a.username || g.email === a.email);
    if (!old) continue;
    warnings.push({
      code: WARNINGS.replacesAccount,
      username: a.username,
      replaces: { id: old.id, username: old.username, name: old.name },
      message: `"${a.username}" is created new, with a temporary password, in place of the existing account ${old.id} ("${old.username}", ${old.name}), which is deleted with its password, photo and records. If that person should keep their account, list it under keep instead.`,
    });
  }
  return warnings;
}

/**
 * Work out what a run of this request would do, on the data as it is now.
 * Reads only. Throws the 4xx that stops the request (CLEAR_DEMO_ERROR_CODES).
 */
export function planClearDemo(db: DB, input: ClearDemoInput): ClearDemoPlan {
  const settings = getSettings(db);
  const keepNames = [...new Set(input.keep ?? [])];
  if (!input.create.length && !keepNames.length) {
    throw new ApiError(400, CODES.noAccounts, 'Nobody could sign in afterwards: list at least one account under create or keep');
  }

  // The accounts that stay.
  const kept = new Map<number, typeof t.users.$inferSelect>();
  const unknownNames: ApiIssue[] = [];
  (input.keep ?? []).forEach((name, i) => {
    const account = findSignInAccount(db, name);
    if (account) kept.set(account.id, account);
    else unknownNames.push(issue(['keep', i], 'errors.notFound'));
  });
  if (unknownNames.length) {
    const names = unknownNames.map((x) => input.keep![x.path[1] as number]!);
    throw new ApiError(400, CODES.unknownAccount, `No account has this username or email address: ${names.join(', ')}`, unknownNames, { names });
  }
  const keptRows = [...kept.values()].sort((a, b) => a.id - b.id);
  const keptIds = keptRows.map((u) => u.id);
  const keptPositions = loadPositionRows(db, keptIds);

  // The positions of the new accounts: built-in keys only.
  const allPositions = db.select().from(t.positions).all();
  const byKey = new Map(allPositions.flatMap((p) => (p.key ? [[p.key, p] as const] : [])));
  const unknownKeys: ApiIssue[] = [];
  input.create.forEach((a, i) => a.positions.forEach((key, j) => void (byKey.has(key) || unknownKeys.push(issue(['create', i, 'positions', j], 'errors.notFound')))));
  if (unknownKeys.length) {
    const keys = [...new Set(unknownKeys.map((x) => input.create[x.path[1] as number]!.positions[x.path[3] as number]!))];
    throw new ApiError(400, CODES.unknownPosition, `No built-in position has this key: ${keys.join(', ')}`, unknownKeys, { positions: keys });
  }

  // One username and one email address per account, across the kept and the new ones.
  const usernames = new Set(keptRows.map(usernameOf).filter(Boolean));
  const emails = new Set(keptRows.map((u) => u.email));
  const create: PlannedAccount[] = input.create.map((a, i) => {
    if (usernames.has(a.username)) {
      throw new ApiError(400, CODES.duplicateUsername, `Two accounts would have the username "${a.username}"`, [issue(['create', i, 'username'], 'errors.usernameTaken')], { username: a.username });
    }
    usernames.add(a.username);
    const typedEmail = a.email ?? null;
    const email = typedEmail ?? automaticEmail(a.username, settings.emailDomain);
    if (emails.has(email)) {
      throw new ApiError(400, CODES.duplicateEmail, `Two accounts would have the email address "${email}"`, [issue(['create', i, typedEmail ? 'email' : 'username'], 'staff:errors.emailTaken')], { email });
    }
    emails.add(email);
    const positionIds = [...new Set(a.positions.map((key) => byKey.get(key)!.id))];
    return { name: a.name, username: a.username, typedEmail, email, locale: a.locale ?? settings.defaultLocale, positionIds };
  });

  // The owner: one of those accounts, an active owner afterwards.
  const byEmail = input.owner.includes('@');
  const ownerKept = keptRows.find((u) => (byEmail ? u.email : usernameOf(u)) === input.owner);
  const ownerIndex = create.findIndex((a) => (byEmail ? a.email : a.username) === input.owner);
  if (!ownerKept && ownerIndex < 0) {
    throw new ApiError(400, CODES.ownerNotListed, `"${input.owner}" is not one of the accounts under create or keep`, [issue(['owner'], 'errors.notFound')]);
  }
  const positionById = new Map(allPositions.map((p) => [p.id, p]));
  const holdsOwnerPosition = ownerKept ? keptPositions.get(ownerKept.id)!.some((p) => p.isOwner) : create[ownerIndex]!.positionIds.some((id) => positionById.get(id)!.isOwner);
  const give = holdsOwnerPosition ? undefined : ownerPositionToGive(db);
  if (!holdsOwnerPosition && !give) {
    throw new ApiError(409, CODES.noOwnerPosition, 'No position is an owner position any more, so nobody can be made an owner. Run POST /api/admin/grant-owner first: it makes CEO one again.');
  }
  if (give && !ownerKept) create[ownerIndex]!.positionIds.push(give.id);
  const owner: PlannedOwner = ownerKept
    ? { status: 'kept', id: ownerKept.id, give: give?.id ?? null, activate: !ownerKept.active }
    : { status: 'created', index: ownerIndex };

  const accounts: ClearDemoAccount[] = [
    ...keptRows.map((u): ClearDemoAccount => {
      const held = keptPositions.get(u.id)!.map((p) => ({ key: p.key, name: p.name, isOwner: p.isOwner }));
      if (give && u.id === ownerKept?.id) held.push({ key: give.key, name: give.name, isOwner: true });
      return {
        id: u.id,
        username: usernameOf(u),
        email: u.email,
        name: u.name,
        positions: held.map(({ key, name }) => ({ key, name })),
        owner: held.some((p) => p.isOwner),
        active: u.active || u.id === ownerKept?.id,
        status: 'kept',
      };
    }),
    ...create.map((a): ClearDemoAccount => {
      const held = a.positionIds.map((id) => positionById.get(id)!);
      return { id: null, username: a.username, email: a.email, name: a.name, positions: held.map((p) => ({ key: p.key, name: p.name })), owner: held.some((p) => p.isOwner), active: true, status: 'created' };
    }),
  ];

  // What goes, table by table.
  const site = planSiteContent(db, input.keepSiteContent);
  const allUserIds = db
    .select({ id: t.users.id })
    .from(t.users)
    .all()
    .map((r) => r.id);
  const deleteUserIds = allUserIds.filter((id) => !kept.has(id));
  const deletedAccounts = accountsGoing(db, deleteUserIds);
  const warnings = planWarnings(input, accounts, deletedAccounts);
  const keptLinks = keptIds.reduce((n, id) => n + keptPositions.get(id)!.length, 0);
  const filesBefore = rowCount(db, t.files);
  const filesAfter = filesStaying(db, keptIds, site.after?.heroFileId ?? null);
  const willDelete: ClearDemoCounts = {};
  const lastRowIds: Record<string, number | null> = {};
  for (const { table, rows, volatile } of CLEAR_DEMO_TABLES) {
    if (rows !== 'all') continue;
    willDelete[tableName(table)] = rowCount(db, table);
    if (!volatile) lastRowIds[tableName(table)] = lastRowId(db, table);
  }
  willDelete[NAME.userPositions] = rowCount(db, t.userPositions) - keptLinks;
  willDelete[NAME.users] = deleteUserIds.length;
  willDelete[NAME.files] = filesBefore - filesAfter;

  return {
    emailDomain: settings.emailDomain,
    deleteUserIds,
    create,
    owner,
    accounts,
    deletedAccounts,
    warnings,
    willDelete,
    lastRowIds,
    after: {
      [NAME.users]: accounts.length,
      [NAME.userPositions]: accounts.reduce((n, a) => n + a.positions.length, 0),
      [NAME.files]: filesAfter,
      [NAME.positions]: allPositions.length,
      [NAME.cafeItems]: rowCount(db, t.cafeItems),
      [NAME.settings]: rowCount(db, t.settings) - (site.write === 'remove' ? 1 : 0),
    },
    site,
  };
}

// ── The confirm code ────────────────────────────────────────────────────────

const VOLATILE = new Set(CLEAR_DEMO_TABLES.filter((x) => x.volatile).map((x) => tableName(x.table)));

/**
 * "<request>-<plan>", 8 hex characters each: HMAC-SHA-256 keyed with the
 * ADMIN_TOKEN (the request holds passwords; without the key the code says
 * nothing about them). The first half is the request alone, so a wrong code
 * can be told apart from a right code on changed data.
 */
export function clearDemoConfirmCode(token: string, input: ClearDemoInput, plan: ClearDemoPlan): string {
  const request = JSON.stringify({
    create: input.create.map((a) => [a.name, a.username, a.password, [...new Set(a.positions)].sort(), a.locale ?? null, a.email ?? null]),
    keep: [...new Set(input.keep ?? [])].sort(),
    owner: input.owner,
    keepSiteContent: input.keepSiteContent,
  });
  const planned = JSON.stringify({
    accounts: plan.accounts.map((a) => [a.id, a.username, a.email, a.name, a.positions.map((p) => [p.key, p.name]), a.owner, a.active, a.status]),
    // Which accounts go, by id: after a run the accounts it created have new ids, so the same request
    // sent again — from shell history, or a retry — no longer matches and can't delete them again.
    deleted: plan.deletedAccounts.map((a) => [a.id, a.username, a.email]),
    willDelete: Object.entries(plan.willDelete).filter(([name]) => !VOLATILE.has(name)),
    lastRowIds: Object.entries(plan.lastRowIds),
    after: Object.entries(plan.after),
    site: [plan.site.write, plan.site.after],
  });
  const mac = (text: string) => createHmac('sha256', token).update(text).digest('hex').slice(0, 8);
  return `${mac(`request\n${request}`)}-${mac(`plan\n${request}\n${planned}`)}`;
}

/** A real run goes on only with the code of a dry run of this request (else 400 / 409), on data that still gives this plan (else 409). */
function assertConfirmed(given: string | undefined, expected: string) {
  if (!given) throw new ApiError(400, CODES.confirmRequired, 'A real run needs "confirm": the code a dry run of this same request returned', [issue(['confirm'], 'errors.required')]);
  const [request, plan] = expected.split('-') as [string, string];
  const sent = /^([0-9a-f]{8})-([0-9a-f]{8})$/.exec(given.toLowerCase());
  if (!sent || !sameSecret(sent[1]!, request)) {
    throw new ApiError(409, CODES.confirmMismatch, 'This confirm code is not for this request. Send the request as a dry run, look at the plan, and use the code it returns.');
  }
  if (!sameSecret(sent[2]!, plan)) {
    throw new ApiError(409, CODES.planChanged, 'The data changed since that dry run, so nothing was done. Run the dry run again, look at the plan, and use its new code.');
  }
}

// ── The run ─────────────────────────────────────────────────────────────────

/** Inside the transaction: do what the plan says, then check every table against it. Returns the new accounts' ids and the storage keys to delete afterwards. */
function carryOut(tx: DB, plan: ClearDemoPlan, passwordHashes: readonly string[]) {
  // Every record, table by table (children first): one plain DELETE each.
  for (const { table, rows } of CLEAR_DEMO_TABLES) {
    if (rows === 'all') tx.delete(table).run();
  }

  // The accounts that are not kept. Their uploads that survive (a kept account's photo) forget who uploaded them.
  for (const part of chunk(plan.deleteUserIds, IN_LIST_CHUNK)) {
    tx.update(t.files).set({ uploadedBy: null }).where(inArray(t.files.uploadedBy, part)).run();
    tx.delete(t.userPositions).where(inArray(t.userPositions.userId, part)).run();
    tx.delete(t.users).where(inArray(t.users.id, part)).run();
  }

  // The new accounts: a temporary password each — the first sign-in asks for their own.
  const createdIds = plan.create.map((a, i) => {
    const names = newAccountNames(tx, { name: a.name, username: a.username, email: a.typedEmail }, plan.emailDomain);
    if (names.username !== a.username || names.email !== a.email) throw new Error(`clear-demo: ${a.username} would not get the planned names`);
    const user = tx
      .insert(t.users)
      .values({ name: a.name, username: names.username, email: names.email, passwordHash: passwordHashes[i]!, mustChangePassword: true, locale: a.locale, active: true })
      .returning({ id: t.users.id })
      .get();
    for (const batch of insertBatches(t.userPositions, a.positionIds.map((positionId) => ({ userId: user.id, positionId })))) tx.insert(t.userPositions).values(batch).run();
    return user.id;
  });

  // The owner (a new account already has its owner position among its own).
  const ownerId = plan.owner.status === 'kept' ? plan.owner.id : createdIds[plan.owner.index]!;
  if (plan.owner.status === 'kept') {
    if (plan.owner.give !== null) tx.insert(t.userPositions).values({ userId: ownerId, positionId: plan.owner.give }).run();
    if (plan.owner.activate) tx.update(t.users).set({ active: true }).where(eq(t.users.id, ownerId)).run();
  }

  // The website's content object.
  if (plan.site.write === 'remove') tx.delete(t.settings).where(eq(t.settings.key, SITE_SETTING)).run();
  else if (plan.site.write === 'save') saveSiteContent(tx, plan.site.after!);

  // Files nothing uses any more: the rows now, the bytes after the transaction.
  const fileKeys = takeEveryUnusedFile(tx);

  // Before anything is committed: every table holds exactly what the plan said it would.
  const wrong: string[] = [];
  for (const { table, rows } of CLEAR_DEMO_TABLES) {
    if (rows === 'bytes') continue;
    const name = tableName(table);
    const expected = rows === 'all' ? 0 : plan.after[name];
    const found = rowCount(tx, table);
    if (found !== expected) wrong.push(`${name}: ${found} rows, planned ${expected}`);
  }
  if (fileKeys.length !== plan.willDelete[NAME.files]) wrong.push(`files deleted: ${fileKeys.length}, planned ${plan.willDelete[NAME.files]}`);
  const ownerRow = tx.select({ active: t.users.active }).from(t.users).where(eq(t.users.id, ownerId)).get();
  if (!ownerRow?.active || !loadPositionRows(tx, [ownerId]).get(ownerId)!.some((p) => p.isOwner)) wrong.push('the owner is not an active owner');
  if (wrong.length) throw new Error(`clear-demo stopped and changed nothing — the result would not match its plan (${wrong.join('; ')})`);

  return { createdIds, fileKeys };
}

/**
 * POST /api/admin/clear-demo. A dry run (the default) only plans. A real run
 * (`dryRun: false` with the dry run's `confirm`): hash the new passwords,
 * record the restore point, then everything in one transaction, then the
 * stored bytes of the deleted files.
 */
export async function clearDemo(deps: { db: DB; files: FileStore; token: string; restore?: RestoreDeps }, input: ClearDemoInput): Promise<ClearDemoResult> {
  const { db, token } = deps;
  const plan = planClearDemo(db, input);
  const confirm = clearDemoConfirmCode(token, input, plan);
  if (input.dryRun !== false) {
    return {
      dryRun: true,
      confirm,
      accounts: plan.accounts,
      willDeleteAccounts: plan.deletedAccounts,
      warnings: plan.warnings,
      willDelete: plan.willDelete,
      siteContent: plan.site.summary,
    };
  }

  // Refused here, a run costs nothing: no hashing, no restore point.
  assertConfirmed(input.confirm, confirm);

  // scrypt is asynchronous and a transaction can't wait for it: every hash first.
  const passwordHashes: string[] = [];
  for (const account of input.create) passwordHashes.push(await hashPassword(account.password));

  let restorePoint: RestorePoint | null = null;
  if (deps.restore) {
    try {
      restorePoint = await deps.restore.record();
    } catch (err) {
      console.error('clear-demo: the restore point could not be recorded', err);
      throw new ApiError(503, CODES.restorePointFailed, 'The restore point could not be recorded, so nothing was changed');
    }
  }

  const done = db.transaction((tx) => {
    // Other requests may have run while the passwords were hashed: plan again on what is there now,
    // and go on only if that is still the plan the operator confirmed.
    const current = planClearDemo(tx, input);
    assertConfirmed(input.confirm, clearDemoConfirmCode(token, input, current));
    return { plan: current, ...carryOut(tx, current, passwordHashes) };
  });
  // After the rows: a file that fails to delete is only an orphan, never a dangling row.
  await deleteStoredFiles(deps.files, done.fileKeys);

  let next = 0;
  return {
    dryRun: false,
    confirm,
    accounts: done.plan.accounts.map((a) => (a.status === 'created' ? { ...a, id: done.createdIds[next++]! } : a)),
    deletedAccounts: done.plan.deletedAccounts,
    warnings: done.plan.warnings,
    deleted: done.plan.willDelete,
    siteContent: done.plan.site.summary,
    restorePoint,
  };
}
