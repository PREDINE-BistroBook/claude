import type { SummonsViewStatus } from '@shared/enums';
import type { Permission } from '@shared/permissions';
import type { SummonsView } from '@shared/schemas/summons';
import { personActions, type TeamMember } from '@shared/schemas/team';

/**
 * Which buttons PersonActions shows beside a colleague. The person is looked
 * up in the Team directory (GET /api/team: active staff, owners included as
 * name + photo): someone not in it — deactivated, unknown, or the list not
 * loaded yet — gets no buttons. Otherwise the shared rule (the API enforces
 * the same): "Message" for anyone but yourself, "Call to the office" also
 * needs staff.summon.
 */
export function personActionButtons(
  viewer: { id: number; permissions: readonly Permission[] } | null | undefined,
  member: Pick<TeamMember, 'id' | 'active'> | null | undefined,
): { message: boolean; summon: boolean } {
  if (!member) return { message: false, summon: false };
  return personActions(viewer, member);
}

/** True when PersonActions renders anything at all. */
export function hasPersonActions(buttons: { message: boolean; summon: boolean }): boolean {
  return buttons.message || buttons.summon;
}

/**
 * A link from a notification (or a push message) as an in-app path. Only
 * same-app paths ("/messages/3", "/team?summons=4") pass; anything that could
 * leave the app (another site, "//host", "javascript:") becomes "/".
 */
export function safeAppLink(link: unknown): string {
  if (typeof link !== 'string' || link.length > 500) return '/';
  if (!link.startsWith('/') || link.startsWith('//') || link.includes('\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(link)) return '/';
  return link;
}

/** The summons id in a "/team?summons=12" link (or search string), else null. */
export function summonsIdFrom(search: string): number | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search : search.split('?')[1] ?? '').get('summons');
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

/** The caller's id in the person called's link "/team?summons=12&from=3", else null. */
export function summonsFromId(search: string): number | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search : search.split('?')[1] ?? '').get('from');
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

/** "HH:MM" on this device's clock, for useFormat().time(). */
export function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The moment a summons line talks about: when it was answered, else when it was sent. */
export function summonsMoment(s: Pick<SummonsView, 'createdAt' | 'answeredAt'>): number {
  return s.answeredAt ?? s.createdAt;
}

/** The banner: waiting calls (pending and not past their time), newest first; the first is shown, the rest counted. */
export function bannerSummons(items: readonly SummonsView[], now: number): { first: SummonsView | null; more: number } {
  const waiting = items.filter((s) => s.status === 'pending' && s.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  return { first: waiting[0] ?? null, more: Math.max(0, waiting.length - 1) };
}

/**
 * For the caller's toast: calls I sent that have been answered since I last
 * looked. `before` is what I knew (id → status); a call I hadn't seen yet
 * counts only if it was sent after `since` (so opening the app doesn't toast
 * yesterday's answers).
 */
export function newlyAnswered(before: ReadonlyMap<number, SummonsViewStatus>, sent: readonly SummonsView[], since: number): SummonsView[] {
  return sent.filter((s) => {
    if (s.status !== 'on_my_way' && s.status !== 'cant_now') return false;
    const known = before.get(s.id);
    return known === undefined ? s.createdAt >= since : known === 'pending';
  });
}

/**
 * A short buzz, where the browser allows it. Browsers refuse vibration until
 * the page has been tapped (and log an error for trying), so before that
 * nothing is attempted: the banner on screen is enough, and with the app
 * closed the push notification vibrates instead.
 */
export function vibrateIfAllowed(pattern: number | number[]): void {
  try {
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (activation && !activation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported: nothing to do.
  }
}

/** base64url (the server's VAPID public key) → bytes for pushManager.subscribe's applicationServerKey. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type PushSupport = 'ok' | 'unsupported' | 'iphoneNeedsHomeScreen';

/**
 * Whether this phone/browser can get push notifications, and what to explain.
 * iPhones and iPads only allow them once the app is on the Home Screen and
 * opened from there (until then Safari has no PushManager at all).
 */
export function pushSupport(env: {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
}): { iphone: boolean; status: PushSupport } {
  const iphone = /iPhone|iPad|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);
  if (iphone && !env.standalone) return { iphone, status: 'iphoneNeedsHomeScreen' };
  if (!env.serviceWorker || !env.pushManager || !env.notification) return { iphone, status: 'unsupported' };
  return { iphone, status: 'ok' };
}

/**
 * A name (or file name) inside a translated sentence, isolated from the
 * sentence's direction: "Dalia Fathy" in an Arabic line keeps its colon and
 * punctuation where they belong.
 */
export const isolate = (s: string) => `\u2068${s}\u2069`;

// ── The Team page's management side (staff.manage) ──────────────────────────

/** What staff.manage adds to the one Team page: active members (everyone sees these) or the inactive accounts. */
export type TeamFilter = 'active' | 'inactive';

/** The filter a person may use: "inactive" only with staff.manage; everyone else always sees the active team. */
export function teamFilter(wanted: TeamFilter, canManage: boolean): TeamFilter {
  return canManage ? wanted : 'active';
}

/**
 * The link from a row to that member's page (/staff/:id), for people with
 * staff.manage. `account` is the member's row in GET /api/staff: missing while
 * that list loads, and for an owner seen by a non-owner (the staff API hides
 * owner accounts, the Team list shows them as name and photo) — then there is
 * no link. Someone who can do more than you opens read-only ("view").
 */
export function accountLink(canManage: boolean, account: { id: number; manageable: boolean } | null | undefined): { to: string; mode: 'edit' | 'view' } | null {
  if (!canManage || !account) return null;
  return { to: `/staff/${account.id}`, mode: account.manageable ? 'edit' : 'view' };
}

/** The accounts that can't sign in any more (the "Inactive" side of the filter), in the order the API gave. */
export function inactiveAccounts<T extends { active: boolean }>(accounts: readonly T[]): T[] {
  return accounts.filter((a) => !a.active);
}

/** Filter the Team directory by a typed name (any part, any case; Arabic and Latin alike). */
export function filterTeam<T extends { name: string }>(items: readonly T[], q: string): T[] {
  const needle = q.trim().toLocaleLowerCase();
  if (!needle) return [...items];
  return items.filter((m) => m.name.toLocaleLowerCase().includes(needle));
}
