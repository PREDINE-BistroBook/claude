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
  /** School name, default language, week start. */
  'settings.manage',

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

  /** Who paid / who owes (Tuition module, later). */
  'payments.status',
  /** Amounts, totals, revenue, commissions (Tuition module, later). */
  'payments.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** How the permissions are grouped on screen (positions form, profile). */
export const PERMISSION_GROUPS = [
  { id: 'staff', permissions: ['staff.manage', 'positions.manage', 'settings.manage'] },
  {
    id: 'school',
    permissions: ['students.read', 'students.contact', 'students.write', 'courses.read', 'courses.write', 'classes.all', 'attendance.write'],
  },
  { id: 'agency', permissions: ['talent.read', 'talent.contact', 'talent.write', 'castings.read', 'castings.write', 'castings.send'] },
  { id: 'money', permissions: ['payments.status', 'payments.manage'] },
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

// ── Built-in positions ──────────────────────────────────────────────────────

const ALL_BUT_PAYMENTS_MANAGE = PERMISSIONS.filter((p) => p !== 'payments.manage');

/**
 * The school's positions (confirmed 2026-11-22). Created on startup when
 * missing (by `key`); owners may rename them and change what they allow
 * afterwards, but can't delete them.
 */
export const BUILT_IN_POSITIONS = [
  { key: 'ceo', name: 'CEO', nameAr: 'الرئيس التنفيذي', isOwner: true, permissions: [...PERMISSIONS] },
  { key: 'cfo', name: 'CFO', nameAr: 'المدير المالي', isOwner: true, permissions: [...PERMISSIONS] },
  { key: 'executive_director', name: 'Executive Director', nameAr: 'المدير التنفيذي', isOwner: false, permissions: ALL_BUT_PAYMENTS_MANAGE },
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
] as const satisfies readonly { key: string; name: string; nameAr: string; isOwner: boolean; permissions: readonly Permission[] }[];

export type BuiltInPositionKey = (typeof BUILT_IN_POSITIONS)[number]['key'];

/** The position the first account (school setup) and `npm run owner` give. */
export const FIRST_OWNER_POSITION: BuiltInPositionKey = 'ceo';
