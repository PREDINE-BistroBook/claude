/**
 * What a staff member may see and do. Access comes from **positions**
 * (positions table): each position allows a set of these permissions, a person
 * can hold several positions and their permissions add up. A position marked
 * `isOwner` (CEO, CFO) allows every permission, including ones added here later.
 *
 * This file is the single source of truth: the API enforces it
 * (src/server/lib/access.ts, src/server/middleware/auth.ts) and the web app uses
 * it to hide what a person can't use. Hiding is a courtesy; the API is the guard.
 * Labels and one-line descriptions live in src/web/features/positions/i18n.ts.
 */
export const PERMISSIONS = [
  /** Add/edit staff accounts, assign positions, reset passwords, deactivate. */
  'staff.manage',
  /** Create/edit positions and what they allow. */
  'positions.manage',
  /** School name, default language, week start, interview criteria, WhatsApp country code. */
  'settings.manage',
  /**
   * "Call to the office": summon a colleague, who gets a can't-miss banner and a
   * push notification and answers "On my way" / "Can't come now" (/api/summons).
   * Messaging needs no permission: every signed-in worker can message every other.
   */
  'staff.summon',

  /** See students (only students in your own classes or that you added, unless classes.all). */
  'students.read',
  /** See students' phone, email, guardian and emergency contacts. */
  'students.contact',
  /** Add/edit/delete students. */
  'students.write',
  /** See classes and sessions (only your own — ones you teach, cover or created — unless classes.all). */
  'courses.read',
  /** Create/edit classes, schedules, enrollments, extra sessions. */
  'courses.write',
  /** Scope: see ALL classes, sessions and students, not only the ones you teach. */
  'classes.all',
  /** Mark attendance (needs courses.read too; only sessions you teach, unless classes.all). */
  'attendance.write',

  /** See the actor database. */
  'talent.read',
  /** See actors' phone and email. */
  'talent.contact',
  /** Add/edit actors and photos. */
  'talent.write',
  /** See castings, roles and shortlists. */
  'castings.read',
  /** Create castings/roles, add actors to shortlists. */
  'castings.write',
  /** Send actors to clients: move a submission to submitted/audition/callback/booked. */
  'castings.send',

  /** See enquiries (leads) with their contact details, interviews and history. Leads are not class-scoped. */
  'admissions.read',
  /** Add/edit leads, log contacts, set follow-ups, schedule/reschedule/cancel interviews, close/reopen leads. */
  'admissions.write',
  /**
   * Record interview assessments, accept/decline, choose the class (and so the
   * coach), enrol the person — enrolling creates the student and the enrollment
   * even without students.write / courses.write.
   */
  'admissions.decide',

  /** Who paid / who owes (Tuition module, later). */
  'payments.status',
  /** Amounts, totals, revenue, commissions (Tuition module, later). */
  'payments.manage',

  /** Edit the public website: pages, coaches, workshops shown, casting call, links. */
  'website.manage',

  /**
   * The cafeteria (/api/cafe): see the orders board, move orders along (on the
   * way → delivered) or turn one down with a reason, and edit the menu and the
   * places. The Office helper's permission (the Executive Director's too since
   * BUILT_IN_GRANTS v4, so she can create his account). Only someone who serves
   * and opens no section gets the new-order alerts (servesFromBoard). Ordering
   * needs no permission: every signed-in team member can order.
   */
  'cafeteria.serve',
  /**
   * The monthly consumption page (/cafeteria/report, GET /api/cafe/report):
   * who had what from the cafeteria in a month, item by item. No prices.
   * Owners hold it by definition; no other built-in position gets it.
   */
  'cafeteria.report',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** How the permissions are grouped on screen (positions form, profile). */
export const PERMISSION_GROUPS = [
  { id: 'staff', permissions: ['staff.manage', 'positions.manage', 'settings.manage', 'staff.summon'] },
  {
    id: 'school',
    permissions: ['students.read', 'students.contact', 'students.write', 'courses.read', 'courses.write', 'classes.all', 'attendance.write'],
  },
  { id: 'agency', permissions: ['talent.read', 'talent.contact', 'talent.write', 'castings.read', 'castings.write', 'castings.send'] },
  { id: 'admissions', permissions: ['admissions.read', 'admissions.write', 'admissions.decide'] },
  { id: 'money', permissions: ['payments.status', 'payments.manage'] },
  { id: 'website', permissions: ['website.manage'] },
  { id: 'cafeteria', permissions: ['cafeteria.serve', 'cafeteria.report'] },
] as const satisfies readonly { id: string; permissions: readonly Permission[] }[];

export type PermissionGroupId = (typeof PERMISSION_GROUPS)[number]['id'];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Known permissions only, without repeats, in catalogue order. */
export function normalizePermissions(list: readonly string[]): Permission[] {
  const set = new Set(list);
  return PERMISSIONS.filter((p) => set.has(p));
}

/** What a set of positions adds up to. Any owner position means every permission. */
export function effectivePermissions(positions: readonly { isOwner: boolean; permissions: readonly string[] }[]): Permission[] {
  if (positions.some((p) => p.isOwner)) return [...PERMISSIONS];
  return normalizePermissions(positions.flatMap((p) => p.permissions));
}

/** True when every permission in `needed` is in `held`. */
export function holdsAll(held: readonly Permission[], needed: readonly Permission[]): boolean {
  const set = new Set(held);
  return needed.every((p) => set.has(p));
}

// ── Sections ────────────────────────────────────────────────────────────────

/**
 * Which permissions open each of the team app's three sections (School,
 * Casting, Website): a section shows for anyone holding at least one of its
 * list. The web app's tabs (src/web/layout/sections.ts) and the server's
 * "who is the Office helper" rule (servesFromBoard) both read it here.
 */
export const SECTION_PERMISSIONS = {
  school: ['courses.read', 'students.read', 'admissions.read'],
  casting: ['talent.read', 'castings.read'],
  website: ['website.manage'],
} as const satisfies Record<'school' | 'casting' | 'website', readonly Permission[]>;

/** Whether these permissions open at least one of the three sections. */
export function opensAnySection(held: readonly Permission[]): boolean {
  const set = new Set(held);
  return Object.values(SECTION_PERMISSIONS).some((list) => list.some((p) => set.has(p)));
}

/**
 * The dedicated Office helper (the school's decision, 2026-11-23): someone who
 * holds cafeteria.serve and opens no School, Casting or Website section. The
 * orders board is their start page, and only they get the new-order alerts
 * and pushes. Owners and the Executive Director hold cafeteria.serve too but
 * work in the sections: no order alerts for them; they open the board from
 * the Cafeteria entry when they want to. A permission rule, never a position's name.
 */
export function servesFromBoard(held: readonly Permission[]): boolean {
  return held.includes('cafeteria.serve') && !opensAnySection(held);
}

// ── Built-in positions ──────────────────────────────────────────────────────

/**
 * The Executive Director: everything except money amounts and the owners'
 * monthly cafeteria page (website.manage since BUILT_IN_GRANTS v2,
 * staff.summon since v3, cafeteria.serve since v4 — so she can create the
 * Office helper's account and give him the position; she works in the
 * sections, so she gets no order alerts from it: servesFromBoard).
 */
const EXECUTIVE_DIRECTOR_PERMISSIONS = PERMISSIONS.filter((p) => p !== 'payments.manage' && p !== 'cafeteria.report');

/**
 * The school's positions (confirmed 2026-11-22; Reception and Office helper
 * asked for on 2026-11-23). Created on startup when missing (by `key`) — so a
 * position added here appears once in a database that already exists; owners
 * may rename them and change what they allow afterwards, but can't delete
 * them, and a renamed or changed one is never created again or reset.
 */
export const BUILT_IN_POSITIONS = [
  { key: 'ceo', name: 'CEO', nameAr: 'الرئيس التنفيذي', isOwner: true, permissions: [...PERMISSIONS] },
  { key: 'cfo', name: 'CFO', nameAr: 'المدير المالي', isOwner: true, permissions: [...PERMISSIONS] },
  { key: 'executive_director', name: 'Executive Director', nameAr: 'المدير التنفيذي', isOwner: false, permissions: EXECUTIVE_DIRECTOR_PERMISSIONS },
  {
    key: 'head_of_casting',
    name: 'Head of Casting',
    nameAr: 'رئيس الكاستينج',
    isOwner: false,
    permissions: ['students.read', 'classes.all', 'courses.read', 'talent.read', 'talent.contact', 'talent.write', 'castings.read', 'castings.write', 'castings.send'],
  },
  {
    key: 'casting_team',
    name: 'Casting team',
    nameAr: 'فريق الكاستينج',
    isOwner: false,
    permissions: ['students.read', 'classes.all', 'talent.read', 'talent.contact', 'talent.write', 'castings.read', 'castings.write'],
  },
  {
    key: 'video_editor',
    name: 'Video editor',
    nameAr: 'مونتير',
    isOwner: false,
    permissions: ['students.read', 'courses.read', 'classes.all', 'talent.read'],
  },
  {
    key: 'acting_coach',
    name: 'Acting coach',
    nameAr: 'مدرب تمثيل',
    isOwner: false,
    permissions: ['students.read', 'courses.read', 'attendance.write'],
  },
  {
    key: 'finance',
    name: 'Finance',
    nameAr: 'الحسابات',
    isOwner: false,
    permissions: ['students.read', 'students.contact', 'courses.read', 'classes.all', 'payments.status', 'payments.manage'],
  },
  // No section permissions yet: the school will say what Reception does. A receptionist already has
  // what every signed-in team member has: Team, Messages, Alerts, My profile, cafeteria ordering.
  { key: 'reception', name: 'Reception', nameAr: 'الاستقبال', isOwner: false, permissions: [] },
  // "Office helper is like the cafeteria, so food and beverage are on him": the orders board and the menu.
  { key: 'office_helper', name: 'Office helper', nameAr: 'عامل المكتب', isOwner: false, permissions: ['cafeteria.serve'] },
] as const satisfies readonly { key: string; name: string; nameAr: string; isOwner: boolean; permissions: readonly Permission[] }[];

export type BuiltInPositionKey = (typeof BUILT_IN_POSITIONS)[number]['key'];

/** The position the first account (school setup) and `npm run owner` give. */
export const FIRST_OWNER_POSITION: BuiltInPositionKey = 'ceo';

// ── Upgrading built-in positions ────────────────────────────────────────────

/**
 * Permissions added to built-in positions after they first shipped, in order.
 * Existing databases already have their built-in positions stored (and
 * ensureBuiltInPositions only inserts missing ones), so on startup every grant
 * newer than the version stored in settings ('builtInGrantsVersion') is applied
 * once — each permission added to that position only if missing — and the
 * latest version is stored (src/server/lib/access.ts, upgradeBuiltInPositions).
 * Fresh databases get the full current lists above and just record the latest
 * version. Because a grant runs once, a permission an owner later removes
 * stays removed.
 *
 * Adding a permission to a built-in position: add it to BUILT_IN_POSITIONS
 * above AND append a grant here with the next version number. Never edit or
 * reorder a released entry.
 *
 * A NEW built-in position needs no grant: ensureBuiltInPositions creates it
 * with its full list wherever it is missing (Reception and Office helper,
 * 2026-11-23: cafeteria.serve came with the Office helper position itself).
 */
export const BUILT_IN_GRANTS: readonly { version: number; grants: Partial<Record<BuiltInPositionKey, readonly Permission[]>> }[] = [
  { version: 1, grants: { executive_director: ['admissions.read', 'admissions.write', 'admissions.decide'] } },
  // The public website (2026-11-23): the director runs it; owners have it already.
  { version: 2, grants: { executive_director: ['website.manage'] } },
  // The team pack (2026-11-23): Executive Directors can call people to the office; owners (CEO, CFO) have it already.
  { version: 3, grants: { executive_director: ['staff.summon'] } },
  // The cafeteria (the school's decision, 2026-11-23): the director creates the Office helper's account and gives
  // him the position, which needs cafeteria.serve ("nobody gives access they don't hold"). No order alerts follow
  // from it: those go only to someone who serves and opens no section (servesFromBoard).
  { version: 4, grants: { executive_director: ['cafeteria.serve'] } },
];

/** Settings key holding the last BUILT_IN_GRANTS version applied to this database. */
export const BUILT_IN_GRANTS_SETTING = 'builtInGrantsVersion';

export const LATEST_BUILT_IN_GRANTS_VERSION = BUILT_IN_GRANTS.reduce((max, g) => Math.max(max, g.version), 0);
