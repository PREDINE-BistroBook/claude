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
 *   its empty state (EmptyAddAction) — only while the list has nothing at all
 *   (`wholeListEmpty`): an empty tab next to full ones has the screen's own Add;
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
  /**
   * "ns:key" of the empty state's button, "Add the first one" — per screen,
   * because Arabic needs the noun («أضف أول طالب», «أضف أول فرصة»): a list whose
   * page shows <ScreenEmptyAdd> has one (the test checks).
   */
  firstKey?: string;
  /** The page it opens; omitted when it opens a dialog on the same screen. */
  to?: string;
  /** Who sees it — exactly who the API lets add. Omitted: everyone signed in (e.g. a new message). */
  permission?: Permission;
  /** A second permission the API needs as well (the enquiries API is behind admissions.read): the Add shows only with both. */
  also?: Permission;
  /**
   * The request the Add ends in, "METHOD /api/path" (":id" for a record's id).
   * tests/api/add-actions.test.ts sends it as someone holding only `permission`
   * (never refused) and as someone without it (403): the button and the API
   * agree, for a dialog as much as for a page.
   */
  api: string;
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
  // A week calendar, not a list: its "+ Add a session on Mon 23" sits under the day it starts on (phones; desktop: by the week's heading).
  schedule: {
    kind: 'page',
    subLists: [{ block: 'the day shown (phones) / the week (desktop)', labelKey: 'schedule:addSessionOn', who: 'courses.write' }],
  },
  admissions: {
    kind: 'list',
    add: {
      labelKey: 'common:add.enquiry',
      firstKey: 'common:add.firstOf.enquiry',
      to: '/admissions/new',
      permission: 'admissions.write',
      also: 'admissions.read',
      api: 'POST /api/leads',
    },
  },
  'admissions/new': { kind: 'form' },
  'admissions/:id': {
    kind: 'record',
    subLists: [
      { block: 'contact log (timeline)', labelKey: 'common:add.contact', who: 'admissions.write (any status, as the API)' },
      { block: 'interviews', labelKey: 'common:add.interview', who: 'admissions.write, while the enquiry is open' },
    ],
  },
  'admissions/:id/edit': { kind: 'form' },
  students: {
    kind: 'list',
    add: { labelKey: 'common:add.student', firstKey: 'common:add.firstOf.student', to: '/students/new', permission: 'students.write', api: 'POST /api/students' },
  },
  'students/new': { kind: 'form' },
  'students/:id': {
    kind: 'record',
    subLists: [{ block: 'workshops (enrolments)', labelKey: 'common:add.toWorkshop', who: 'courses.write' }],
  },
  'students/:id/edit': { kind: 'form' },
  classes: {
    kind: 'list',
    add: { labelKey: 'common:add.workshop', firstKey: 'common:add.firstOf.workshop', to: '/classes/new', permission: 'courses.write', api: 'POST /api/courses' },
  },
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
  talent: {
    kind: 'list',
    add: { labelKey: 'common:add.talent', firstKey: 'common:add.firstOf.talent', to: '/talent/new', permission: 'talent.write', api: 'POST /api/talent' },
  },
  'talent/new': { kind: 'form' },
  'talent/:id': { kind: 'record', subLists: [{ block: 'photos', labelKey: 'common:add.photos', who: 'talent.write' }] },
  'talent/:id/edit': { kind: 'form' },
  castings: {
    kind: 'list',
    add: { labelKey: 'common:add.casting', firstKey: 'common:add.firstOf.casting', to: '/castings/new', permission: 'castings.write', api: 'POST /api/castings' },
  },
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
    add: {
      labelKey: 'common:add.opportunity',
      firstKey: 'common:add.firstOf.opportunity',
      to: '/casting/opportunities/new',
      permission: 'castings.write',
      api: 'POST /api/opportunities',
    },
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
  'website/coaches': {
    kind: 'list',
    add: { labelKey: 'common:add.coach', firstKey: 'common:add.firstOf.coach', to: '/website/coaches/new', permission: 'website.manage', api: 'POST /api/site/coaches' },
  },
  'website/coaches/new': { kind: 'form' },
  'website/coaches/:id': { kind: 'form' },
  'website/workshops': {
    kind: 'list',
    nothingToAdd: 'Every active or upcoming school workshop is listed here with its "Show on website" switch; workshops are added in School › Workshops.',
  },
  'website/workshops/:courseId': { kind: 'form' },
  'website/casting-call': { kind: 'form' },
  // A dialog on the page: the links are part of the site's content.
  'website/links': {
    kind: 'list',
    add: { labelKey: 'common:add.link', firstKey: 'common:add.firstOf.link', permission: 'website.manage', api: 'PUT /api/site/content' },
  },

  // ── Outside the sections ──
  team: { kind: 'list', add: { labelKey: 'staff:addStaff', to: '/staff/new', permission: 'staff.manage', api: 'POST /api/staff' } },
  staff: { kind: 'redirect' },
  'staff/new': { kind: 'form' },
  'staff/:id': { kind: 'form' },
  positions: {
    kind: 'list',
    add: { labelKey: 'common:add.position', firstKey: 'common:add.firstOf.position', to: '/positions/new', permission: 'positions.manage', api: 'POST /api/positions' },
  },
  'positions/new': { kind: 'form' },
  'positions/:id': { kind: 'form' },
  settings: {
    kind: 'page',
    subLists: [{ block: 'interview criteria', labelKey: 'common:add.criterion', who: 'settings.manage' }],
  },
  // A dialog: pick someone, then their conversation opens (started on the server).
  messages: { kind: 'list', add: { labelKey: 'common:add.message', api: 'POST /api/chat/conversations' } },
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

/** Whether the person may use that screen's Add (no permission named: everyone signed in; `also`: that one too). */
export function canAdd(add: Partial<AddSpec>, can: (p: Permission) => boolean): boolean {
  return (!add.permission || can(add.permission)) && (!add.also || can(add.also));
}

/**
 * Whether a list has nothing at all — every tab's count is known and zero —
 * so its empty state may say "Add the first one". An empty tab (New, Open…)
 * while others hold records is not an empty list: there the screen's own
 * "+ Add …" is already on screen, and "the first one" would be wrong.
 */
export function wholeListEmpty(counts: readonly (number | null | undefined)[] | undefined | false): boolean {
  return !!counts && counts.length > 0 && counts.every((n) => n === 0);
}

/**
 * Who owns which corner of a phone screen, above the tab bar (so two floating
 * buttons never sit on top of each other): a list's fixed "+ Add …" keeps the
 * bottom-end; the AI pack's "Secretary" (Part F2, not built yet) takes the
 * bottom-start. tests/unit/add-actions.test.ts holds the spec and the
 * component to this.
 */
export const PHONE_FLOATING_CORNERS = { add: 'bottom-end', secretary: 'bottom-start' } as const;

// ── Section homes ───────────────────────────────────────────────────────────

export interface QuickActionSpec {
  /** Its name (and React key). */
  key: string;
  /** "ns:key" of the words: the same as the list button that opens the same page ("Add student" on the home and on Students). */
  labelKey: string;
  to: string;
  icon: LucideIcon;
  permission: Permission;
  /** A second permission the page (and its API) needs as well — as its list's Add. */
  also?: Permission;
}

/**
 * The quick-action tiles of each section home, in order, each shown only with
 * its permission (the page it opens has the same guard) and worded like the
 * list's own button: School — Add enquiry, Add student, Add workshop; Casting
 * — Add talent, Add casting, Add opportunity; Website — Add coach, Add link.
 * "Call to the office" (with staff.summon) and "Order a drink" (the
 * cafeteria, while it is on) follow.
 */
export const HOME_QUICK_ACTIONS = {
  school: [
    { key: 'addEnquiry', labelKey: 'common:add.enquiry', to: '/admissions/new', icon: MessageSquarePlus, permission: 'admissions.write', also: 'admissions.read' },
    { key: 'addStudent', labelKey: 'common:add.student', to: '/students/new', icon: UserPlus, permission: 'students.write' },
    { key: 'addWorkshop', labelKey: 'common:add.workshop', to: '/classes/new', icon: GraduationCap, permission: 'courses.write' },
    // For those who may call people to the office: the Team page has the button beside everyone.
    { key: 'callToOffice', labelKey: 'dashboard:quick.callToOffice', to: '/team', icon: BellRing, permission: 'staff.summon' },
  ],
  casting: [
    { key: 'addTalent', labelKey: 'common:add.talent', to: '/talent/new', icon: UserPlus, permission: 'talent.write' },
    { key: 'addCasting', labelKey: 'common:add.casting', to: '/castings/new', icon: Clapperboard, permission: 'castings.write' },
    { key: 'addOpportunity', labelKey: 'common:add.opportunity', to: '/casting/opportunities/new', icon: Binoculars, permission: 'castings.write' },
    { key: 'callToOffice', labelKey: 'dashboard:quick.callToOffice', to: '/team', icon: BellRing, permission: 'staff.summon' },
  ],
  website: [
    { key: 'addCoach', labelKey: 'common:add.coach', to: '/website/coaches/new', icon: Presentation, permission: 'website.manage' },
    // The links page opens its "Add link" form straight away (?add=1).
    { key: 'addLink', labelKey: 'common:add.link', to: '/website/links?add=1', icon: Link2, permission: 'website.manage' },
  ],
} as const satisfies Record<'school' | 'casting' | 'website', readonly QuickActionSpec[]>;
