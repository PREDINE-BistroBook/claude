import {
  BellRing,
  Binoculars,
  Clapperboard,
  GraduationCap,
  Link2,
  MessageSquarePlus,
  Presentation,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@shared/permissions';

/**
 * "Add" everywhere (Part K2 of docs/SECTIONS_AND_WEBSITE.md): what every
 * screen of the app can add, and where. Plain data — the pages read it (a list
 * screen's ListAddAction / EmptyAddAction take their label, link and permission
 * from here) and tests/unit/add-actions.test.ts walks the app's route table
 * against it: a route that is not named here fails, a list screen needs an
 * `add` or a `nothingToAdd` reason, and an Add that links to a page carries
 * that page's own permission (so it never shows to someone the page — and the
 * API behind it — would refuse).
 *
 * The one pattern, so nobody has to hunt for it:
 * - a **list** screen: a labelled "+ Add …" — on phones a fixed button at the
 *   bottom-end above the tab bar, on desktop in the page header
 *   (components/ui/AddAction.tsx ListAddAction), and "Add the first one" inside
 *   its empty state (EmptyAddAction);
 * - a **record** page: each sub-list has its own "+ Add …" at the top of its
 *   block (AddButton), listed here under `subLists`;
 * - a **section home**: quick-action tiles for the most common additions
 *   (HOME_QUICK_ACTIONS), each shown only with its permission.
 */

export type ScreenKind =
  /** A section home or the start page ("/"). */
  | 'home'
  /** A list of records. */
  | 'list'
  /** One record, with blocks of its own (sub-lists). */
  | 'record'
  /** A form: new, edit. */
  | 'form'
  /** Anything else: a calendar, settings, a report, the profile. */
  | 'page'
  /** Forwards somewhere else. */
  | 'redirect';

export interface AddSpec {
  /** "ns:key" of the label ("+ Add student"). */
  labelKey: string;
  /** The page it opens; omitted when it opens a dialog on the same screen. */
  to?: string;
  /** Who sees it — exactly who the API lets add. Omitted: everyone signed in (e.g. a new message). */
  permission?: Permission;
}

export interface SubListSpec {
  /** What the block holds. */
  block: string;
  labelKey: string;
  /** Who sees its "+ Add …", in words when it is more than one permission (the page computes it, like the API). */
  who: string;
}

export interface ScreenSpec {
  kind: ScreenKind;
  /** A list screen's Add. */
  add?: AddSpec;
  /** Why a list screen has no Add (where its records come from instead). */
  nothingToAdd?: string;
  /** A record page's blocks and their "+ Add …". */
  subLists?: SubListSpec[];
}

/** Every route of the app (the paths as the route tables write them; '' is "/"). */
export const SCREENS = {
  '': { kind: 'home' },
  school: { kind: 'home' },
  casting: { kind: 'home' },
  website: { kind: 'home' },
  profile: { kind: 'page' },
  '*': { kind: 'page' },

  // ── School ──
  schedule: {
    kind: 'list',
    add: { labelKey: 'common:add.extraSession', permission: 'courses.write' },
  },
  admissions: { kind: 'list', add: { labelKey: 'common:add.enquiry', to: '/admissions/new', permission: 'admissions.write' } },
  'admissions/new': { kind: 'form' },
  'admissions/:id': {
    kind: 'record',
    subLists: [
      { block: 'contact log (timeline)', labelKey: 'common:add.contact', who: 'admissions.write, while the enquiry is open' },
      { block: 'interviews', labelKey: 'common:add.interview', who: 'admissions.write, while the enquiry is open' },
    ],
  },
  'admissions/:id/edit': { kind: 'form' },
  students: { kind: 'list', add: { labelKey: 'common:add.student', to: '/students/new', permission: 'students.write' } },
  'students/new': { kind: 'form' },
  'students/:id': {
    kind: 'record',
    subLists: [{ block: 'workshops (enrolments)', labelKey: 'common:add.toWorkshop', who: 'courses.write' }],
  },
  'students/:id/edit': { kind: 'form' },
  classes: { kind: 'list', add: { labelKey: 'common:add.workshop', to: '/classes/new', permission: 'courses.write' } },
  'classes/new': { kind: 'form' },
  'classes/:id': {
    kind: 'record',
    subLists: [
      { block: 'students', labelKey: 'common:add.student', who: 'courses.write (a new student as well: students.write too)' },
      { block: 'sessions', labelKey: 'common:add.session', who: 'courses.write' },
      { block: 'photos & files', labelKey: 'common:add.photosAndFiles', who: 'courses.write, or the workshop’s coach' },
    ],
  },
  'classes/:id/edit': { kind: 'form' },
  'sessions/:id': { kind: 'record', subLists: [] },

  // ── Casting ──
  talent: { kind: 'list', add: { labelKey: 'common:add.talent', to: '/talent/new', permission: 'talent.write' } },
  'talent/new': { kind: 'form' },
  'talent/:id': { kind: 'record', subLists: [{ block: 'photos', labelKey: 'common:add.photos', who: 'talent.write' }] },
  'talent/:id/edit': { kind: 'form' },
  castings: { kind: 'list', add: { labelKey: 'common:add.casting', to: '/castings/new', permission: 'castings.write' } },
  'castings/new': { kind: 'form' },
  'castings/:id': {
    kind: 'record',
    subLists: [
      { block: 'roles', labelKey: 'common:add.role', who: 'castings.write' },
      { block: 'a role’s submissions', labelKey: 'castings:roles.addTalent', who: 'castings.write' },
      { block: 'files', labelKey: 'common:add.photosAndFiles', who: 'castings.write' },
    ],
  },
  'castings/:id/edit': { kind: 'form' },
  'casting/applications': {
    kind: 'list',
    nothingToAdd: 'Applications arrive from the website’s casting-call form; the team accepts them into Talent.',
  },
  'casting/applications/:id': { kind: 'record', subLists: [] },
  'casting/opportunities': {
    kind: 'list',
    add: { labelKey: 'common:add.opportunity', to: '/casting/opportunities/new', permission: 'castings.write' },
  },
  'casting/opportunities/new': { kind: 'form' },
  'casting/opportunities/:id': { kind: 'record', subLists: [] },
  'casting/opportunities/:id/edit': { kind: 'form' },
  'casting/schedule': {
    kind: 'list',
    nothingToAdd: 'Auditions are set on a talent’s submission inside a casting (Castings › a casting › a role).',
  },

  // ── Website ──
  'website/pages': { kind: 'form' },
  'website/coaches': { kind: 'list', add: { labelKey: 'common:add.coach', to: '/website/coaches/new', permission: 'website.manage' } },
  'website/coaches/new': { kind: 'form' },
  'website/coaches/:id': { kind: 'form' },
  'website/workshops': {
    kind: 'list',
    nothingToAdd: 'Every active or upcoming school workshop is listed here with its "Show on website" switch; workshops are added in School › Workshops.',
  },
  'website/workshops/:courseId': { kind: 'form' },
  'website/casting-call': { kind: 'form' },
  'website/links': { kind: 'list', add: { labelKey: 'common:add.link', permission: 'website.manage' } },

  // ── Outside the sections ──
  team: { kind: 'list', add: { labelKey: 'staff:addStaff', to: '/staff/new', permission: 'staff.manage' } },
  staff: { kind: 'redirect' },
  'staff/new': { kind: 'form' },
  'staff/:id': { kind: 'form' },
  positions: { kind: 'list', add: { labelKey: 'common:add.position', to: '/positions/new', permission: 'positions.manage' } },
  'positions/new': { kind: 'form' },
  'positions/:id': { kind: 'form' },
  settings: {
    kind: 'page',
    subLists: [{ block: 'interview criteria', labelKey: 'common:add.criterion', who: 'settings.manage' }],
  },
  messages: { kind: 'list', add: { labelKey: 'common:add.message' } },
  'messages/:id': { kind: 'page' },
  cafeteria: { kind: 'page' },
  'cafeteria/board': {
    kind: 'list',
    nothingToAdd: 'Orders come from the team ordering on the Cafeteria page; the board only moves them along.',
  },
  'cafeteria/menu': {
    kind: 'record',
    subLists: [
      { block: 'menu items', labelKey: 'common:add.menuItem', who: 'cafeteria.serve or settings.manage' },
      { block: 'places', labelKey: 'common:add.place', who: 'cafeteria.serve or settings.manage' },
    ],
  },
  'cafeteria/report': { kind: 'list', nothingToAdd: 'A monthly report of delivered orders: nothing is entered here.' },
} as const satisfies Record<string, ScreenSpec>;

export type ScreenPath = keyof typeof SCREENS;
export type ListScreenWithAdd = { [K in ScreenPath]: (typeof SCREENS)[K] extends { add: AddSpec } ? K : never }[ScreenPath];

/** The Add of a list screen (typed: only screens that have one). */
export function screenAdd(screen: ListScreenWithAdd): AddSpec {
  return (SCREENS[screen] as ScreenSpec).add!;
}

/** Whether the person may use that screen's Add (no permission named: everyone signed in). */
export function canAdd(add: AddSpec, can: (p: Permission) => boolean): boolean {
  return !add.permission || can(add.permission);
}

// ── Section homes ───────────────────────────────────────────────────────────

export interface QuickActionSpec {
  /** Key in dashboard:quick. */
  key: string;
  to: string;
  icon: LucideIcon;
  permission: Permission;
}

/**
 * The quick-action tiles of each section home, in order, each shown only with
 * its permission (the page it opens has the same guard): School — New
 * enquiry, New student, New workshop; Casting — New talent, New casting, Add
 * opportunity; Website — Add coach, Add link. "Call to the office" (with
 * staff.summon) and "Order a drink" (the cafeteria, while it is on) follow.
 */
export const HOME_QUICK_ACTIONS = {
  school: [
    { key: 'newEnquiry', to: '/admissions/new', icon: MessageSquarePlus, permission: 'admissions.write' },
    { key: 'newStudent', to: '/students/new', icon: UserPlus, permission: 'students.write' },
    { key: 'newWorkshop', to: '/classes/new', icon: GraduationCap, permission: 'courses.write' },
    // For those who may call people to the office: the Team page has the button beside everyone.
    { key: 'callToOffice', to: '/team', icon: BellRing, permission: 'staff.summon' },
  ],
  casting: [
    { key: 'addTalent', to: '/talent/new', icon: UserPlus, permission: 'talent.write' },
    { key: 'newCasting', to: '/castings/new', icon: Clapperboard, permission: 'castings.write' },
    { key: 'addOpportunity', to: '/casting/opportunities/new', icon: Binoculars, permission: 'castings.write' },
    { key: 'callToOffice', to: '/team', icon: BellRing, permission: 'staff.summon' },
  ],
  website: [
    { key: 'addCoach', to: '/website/coaches/new', icon: Presentation, permission: 'website.manage' },
    // The links page opens its "Add link" form straight away (?add=1).
    { key: 'addLink', to: '/website/links?add=1', icon: Link2, permission: 'website.manage' },
  ],
} as const satisfies Record<'school' | 'casting' | 'website', readonly QuickActionSpec[]>;
