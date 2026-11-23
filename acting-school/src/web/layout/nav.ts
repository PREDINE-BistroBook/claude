import {
  BadgeCheck,
  CalendarDays,
  Clapperboard,
  FileText,
  GraduationCap,
  House,
  Inbox,
  Link2,
  Megaphone,
  Presentation,
  Settings,
  Star,
  UserRoundPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@shared/permissions';
import { sectionByKey, sectionForPath, visibleSections, type SectionKey } from './sections';

export type NavSection = SectionKey | 'admin';

/** A count shown next to a menu entry: things waiting for someone (AppShell fetches it only in that entry's section). */
export type NavBadge = 'newCastingApplications';

export interface NavItem {
  to: string;
  /** Key in common:nav. */
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Shown when the person holds at least one of these (in addition to `permission`, if set). */
  anyPermission?: readonly Permission[];
  /** The section whose menu shows it; admin items (Positions, Settings) show in every section, under "Administration". */
  section: NavSection;
  /** Active only on this exact path (a section's home: /casting is not active on /casting/schedule). */
  end?: boolean;
  badge?: NavBadge;
}

const home = (section: SectionKey): NavItem => ({
  to: sectionByKey(section).home,
  label: 'home',
  icon: House,
  anyPermission: sectionByKey(section).anyPermission,
  section,
  end: true,
});

export const NAV_ITEMS: NavItem[] = [
  // ── School ──
  home('school'),
  // Classes and admissions interviews: nothing to show to someone who can see neither.
  { to: '/schedule', label: 'schedule', icon: CalendarDays, anyPermission: ['courses.read', 'admissions.read'], section: 'school' },
  { to: '/admissions', label: 'admissions', icon: Inbox, permission: 'admissions.read', section: 'school' },
  { to: '/students', label: 'students', icon: Users, permission: 'students.read', section: 'school' },
  { to: '/classes', label: 'classes', icon: GraduationCap, permission: 'courses.read', section: 'school' },
  // ── Casting ──
  home('casting'),
  { to: '/talent', label: 'talent', icon: Star, permission: 'talent.read', section: 'casting' },
  { to: '/castings', label: 'castings', icon: Clapperboard, permission: 'castings.read', section: 'casting' },
  { to: '/casting/applications', label: 'applications', icon: UserRoundPlus, permission: 'talent.read', section: 'casting', badge: 'newCastingApplications' },
  { to: '/casting/schedule', label: 'schedule', icon: CalendarDays, permission: 'castings.read', section: 'casting' },
  // ── Website ──
  home('website'),
  { to: '/website/pages', label: 'sitePages', icon: FileText, permission: 'website.manage', section: 'website' },
  { to: '/website/workshops', label: 'siteWorkshops', icon: GraduationCap, permission: 'website.manage', section: 'website' },
  { to: '/website/casting-call', label: 'castingCall', icon: Megaphone, permission: 'website.manage', section: 'website' },
  { to: '/website/coaches', label: 'coaches', icon: Presentation, permission: 'website.manage', section: 'website' },
  { to: '/website/links', label: 'links', icon: Link2, permission: 'website.manage', section: 'website' },
  // ── Administration (every section). The team — adding and editing members included — is the
  // Team page, in the account / "More" menu of every section (TEAM_PATH below), not an entry here. ──
  { to: '/positions', label: 'positions', icon: BadgeCheck, permission: 'positions.manage', section: 'admin' },
  { to: '/settings', label: 'settings', icon: Settings, permission: 'settings.manage', section: 'admin' },
];

/** Whether the person's permissions open this destination. */
export function navItemOpen(item: NavItem, can: (p: Permission) => boolean): boolean {
  return (!item.permission || can(item.permission)) && (!item.anyPermission || item.anyPermission.some(can));
}

/** The section's own destinations the person can open, in menu order (its home first). */
export function sectionNavItems(section: SectionKey, can: (p: Permission) => boolean): NavItem[] {
  return NAV_ITEMS.filter((i) => i.section === section && navItemOpen(i, can));
}

/** Positions, Settings — whichever the person may manage. */
export function adminNavItems(can: (p: Permission) => boolean): NavItem[] {
  return NAV_ITEMS.filter((i) => i.section === 'admin' && navItemOpen(i, can));
}

/** The one Team page: everyone signed in, from the account / "More" menu of every section. */
export const TEAM_PATH = '/team';

/** The Team entry is the current page on /team and on the member pages it opens with staff.manage (/staff/new, /staff/:id). */
export function teamMenuActive(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return path === TEAM_PATH || path === '/staff' || path.startsWith('/staff/');
}

/**
 * What the Team page is for, in plain words under its entry in the phone's
 * "More" sheet (a key in common:nav): messaging for everyone, calling to the
 * office with staff.summon, adding and editing members with staff.manage.
 */
export function teamMenuHint(can: (p: Permission) => boolean): 'teamHint' | 'teamHintSummon' | 'teamHintManage' | 'teamHintManageSummon' {
  if (can('staff.manage')) return can('staff.summon') ? 'teamHintManageSummon' : 'teamHintManage';
  return can('staff.summon') ? 'teamHintSummon' : 'teamHint';
}

/** Whether a menu entry is the page at `pathname` (or one under it). */
export function navItemActive(item: Pick<NavItem, 'to' | 'end'>, pathname: string): boolean {
  if (item.end || item.to === '/') return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * Where someone lands after signing in, given the page the previous screen
 * was on (`next`, from /login?next=…). On a shared phone or computer that page
 * was often someone else's: when it is in a section this person doesn't see,
 * or is a menu page (or a team member's account page) their positions don't
 * open, they go to "/" (their own start) instead of a "No access" screen as
 * the first thing after a correct sign-in. Anything else — a deep link they
 * can open, the profile, the Team page, messages — is kept.
 */
export function landingAfterSignIn(next: string, can: (p: Permission) => boolean): string {
  const pathname = (next.split(/[?#]/)[0] ?? '').replace(/\/+$/, '') || '/';
  const section = sectionForPath(pathname);
  if (section && !visibleSections(can).some((s) => s.key === section)) return '/';
  // The page's own menu entry (the longest match: /casting/applications before /casting).
  const item = NAV_ITEMS.filter((i) => pathname === i.to || pathname.startsWith(`${i.to}/`)).sort((a, b) => b.to.length - a.to.length)[0];
  if (item && !navItemOpen(item, can)) return '/';
  // A team member's account page (/staff/new, /staff/:id) is the Team page's management side: staff.manage.
  // The Team page itself (/team, and /staff, which forwards to it) is everyone's.
  if (pathname.startsWith('/staff/') && !can('staff.manage')) return '/';
  return next;
}

/** Bottom-bar priorities per section, before filtering by permission. */
const PHONE_PRIORITY = {
  // Coaches mark attendance for their own classes: the timetable first.
  schoolCoach: ['/schedule', '/classes', '/students'],
  // Enquiries are the first stop for the director and owners.
  schoolAdmissions: ['/admissions', '/students', '/classes'],
  school: ['/students', '/classes', '/schedule'],
  casting: ['/talent', '/castings', '/casting/applications'],
  website: ['/website/pages', '/website/workshops', '/website/casting-call'],
} as const;

/**
 * Phone bottom bar for a section: its Home, then up to three of its
 * destinations, then "More" (added by AppShell). Each section has a priority
 * list that fits the person's work; when some of those are closed to them, the
 * section's other destinations (in menu order) fill the gap. Someone who sees
 * no section (section = null) gets the plain Home ("/") only.
 */
export function mobileTabs(section: SectionKey | null, can: (p: Permission) => boolean): string[] {
  if (!section) return ['/'];
  const items = sectionNavItems(section, can);
  if (!items.length) return [];
  const homePath = sectionByKey(section).home;
  let priority: readonly string[];
  if (section === 'school') {
    if (can('attendance.write') && !can('classes.all')) priority = PHONE_PRIORITY.schoolCoach;
    else if (can('admissions.read')) priority = PHONE_PRIORITY.schoolAdmissions;
    else priority = PHONE_PRIORITY.school;
  } else priority = PHONE_PRIORITY[section];
  const open = items.map((i) => i.to).filter((to) => to !== homePath);
  const ordered = [...priority.filter((to) => open.includes(to)), ...open.filter((to) => !priority.includes(to))];
  return [homePath, ...ordered.slice(0, 3)];
}
