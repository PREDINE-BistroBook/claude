import { CalendarDays, Clapperboard, GraduationCap, LayoutDashboard, Settings, Star, UserCog, Users, type LucideIcon } from 'lucide-react';
import type { Permission } from '@shared/roles';
import type { Role } from '@shared/roles';

export interface NavItem {
  to: string;
  /** Key in common:nav. */
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  group: 'main' | 'school' | 'agency' | 'admin';
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'home', icon: LayoutDashboard, group: 'main' },
  { to: '/schedule', label: 'schedule', icon: CalendarDays, group: 'main' },
  { to: '/students', label: 'students', icon: Users, permission: 'students.read', group: 'school' },
  { to: '/classes', label: 'classes', icon: GraduationCap, permission: 'courses.read', group: 'school' },
  { to: '/talent', label: 'talent', icon: Star, permission: 'talent.read', group: 'agency' },
  { to: '/castings', label: 'castings', icon: Clapperboard, permission: 'castings.read', group: 'agency' },
  { to: '/staff', label: 'staff', icon: UserCog, permission: 'staff.manage', group: 'admin' },
  { to: '/settings', label: 'settings', icon: Settings, permission: 'settings.manage', group: 'admin' },
];

/** Phone bottom bar: the four destinations each role uses most, then "More". */
export const MOBILE_TABS: Record<Role, string[]> = {
  owner: ['/', '/schedule', '/students', '/talent'],
  admin: ['/', '/schedule', '/students', '/talent'],
  teacher: ['/', '/schedule', '/classes', '/students'],
  agent: ['/', '/schedule', '/talent', '/castings'],
};
