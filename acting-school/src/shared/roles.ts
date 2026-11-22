/**
 * Staff roles and what each one may do. This is the single source of truth:
 * the API enforces it (src/server/middleware/auth.ts) and the web app uses it
 * to hide what a person can't use. Hiding is a courtesy; the API is the guard.
 */
export const ROLES = ['owner', 'admin', 'teacher', 'agent'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  /** Create staff accounts, change roles, reset passwords, deactivate. */
  'staff.manage': ['owner', 'admin'],
  /** School name, default language, week start. */
  'settings.manage': ['owner', 'admin'],
  'students.read': ['owner', 'admin', 'teacher', 'agent'],
  'students.write': ['owner', 'admin'],
  'courses.read': ['owner', 'admin', 'teacher', 'agent'],
  /** Create/edit classes, their weekly schedule, enrollments, extra sessions. */
  'courses.write': ['owner', 'admin'],
  /**
   * Mark attendance. Owner/admin: any session. Teacher: only sessions they
   * teach (session.teacherId, falling back to the course's teacher) — that
   * narrower check lives in the sessions route, not here.
   */
  'attendance.write': ['owner', 'admin', 'teacher'],
  'talent.read': ['owner', 'admin', 'agent'],
  'talent.write': ['owner', 'admin', 'agent'],
  'castings.read': ['owner', 'admin', 'agent'],
  'castings.write': ['owner', 'admin', 'agent'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
