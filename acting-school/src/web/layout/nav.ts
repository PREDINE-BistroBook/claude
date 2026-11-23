import { BadgeCheck, CalendarDays, Clapperboard, GraduationCap, Inbox, LayoutDashboard, Settings, Star, UserCog, Users, type LucideIcon } from 'lucide-react';
import type { Permission } from '@shared/permissions';

export interface NavItem {
  to: string;
  /** Key in common:nav. */
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Shown when the person holds at least one of these (in addition to `permission`, if set). */
  anyPermission?: readonly Permission[];
  group: 'main' | 'school' | 'agency' | 'admin';
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'home', icon: LayoutDashboard, group: 'main' },
  // Classes, auditions and admissions interviews: nothing to show to someone who can see none of them.
  { to: '/schedule', label: 'schedule', icon: CalendarDays, anyPermission: ['courses.read', 'castings.read', 'admissions.read'], group: 'main' },
  { to: '/admissions', label: 'admissions', icon: Inbox, permission: 'admissions.read', group: 'school' },
  { to: '/students', label: 'students', icon: Users, permission: 'students.read', group: 'school' },
  { to: '/classes', label: 'classes', icon: GraduationCap, permission: 'courses.read', group: 'school' },
  { to: '/talent', label: 'talent', icon: Star, permission: 'talent.read', group: 'agency' },
  { to: '/castings', label: 'castings', icon: Clapperboard, permission: 'castings.read', group: 'agency' },
  { to: '/staff', label: 'staff', icon: UserCog, permission: 'staff.manage', group: 'admin' },
  { to: '/positions', label: 'positions', icon: BadgeCheck, permission: 'positions.manage', group: 'admin' },
  { to: '/settings', label: 'settings', icon: Settings, permission: 'settings.manage', group: 'admin' },
];

/** Whether the person's permissions open this destination. */
export function navItemOpen(item: NavItem, can: (p: Permission) => boolean): boolean {
  return (!item.permission || can(item.permission)) && (!item.anyPermission || item.anyPermission.some(can));
}

/**
 * Phone bottom bar: Home, then the first three destinations the person can open
 * from a priority list that fits their work, then "More".
 * - coaches (attendance for their own classes only): classes first;
 * - admissions people who don't teach their own classes (the director, owners):
 *   admissions, students, schedule — enquiries are their first stop;
 * - agency people (castings, but no say over students): talent and castings first;
 * - everyone else (finance, editors): students first.
 */
export function mobileTabs(can: (p: Permission) => boolean): string[] {
  let priority: string[];
  if (can('attendance.write') && !can('classes.all')) priority = ['/schedule', '/classes', '/students', '/talent', '/castings', '/admissions'];
  else if (can('admissions.read')) priority = ['/admissions', '/students', '/schedule', '/classes', '/talent', '/castings'];
  else if (can('castings.write') && !can('students.write')) priority = ['/schedule', '/talent', '/castings', '/students', '/classes'];
  else priority = ['/schedule', '/students', '/talent', '/classes', '/castings'];
  const open = new Set(NAV_ITEMS.filter((i) => navItemOpen(i, can)).map((i) => i.to));
  return ['/', ...priority.filter((to) => open.has(to)).slice(0, 3)];
}
