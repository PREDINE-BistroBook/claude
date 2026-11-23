import type { StaffMember, StaffUpdateInput, UsernameCheck } from '@shared/schemas/staff';
import { automaticEmail, isValidUsername, normalizeUsername } from '@shared/usernames';

/**
 * The rules behind the Username and Email fields of the add and edit forms
 * (components/StaffForms.tsx), kept out of the components so they can be
 * tested on their own (tests/unit/usernames-web.test.ts). The server applies
 * the same rules whatever the form sends.
 */

/** The address an account with this username gets when no email is typed; '' until the username is usable or the settings have loaded. */
export function automaticEmailFor(username: string, emailDomain: string | undefined): string {
  const u = normalizeUsername(username);
  return emailDomain && isValidUsername(u) ? automaticEmail(u, emailDomain) : '';
}

/**
 * What the add form sends as `email`: an address the manager typed, or nothing
 * — then the server gives the account <username>@<emailDomain>.
 */
export function typedEmail(value: string): string | undefined {
  const v = value.trim();
  return v ? v : undefined;
}

/**
 * The live answer under the Username field, as an error key — or null while
 * there is nothing to say (no answer yet, or the answer is for what was typed
 * a moment ago).
 */
export function usernameCheckError(check: Pick<UsernameCheck, 'username' | 'status'> | undefined, typed: string): string | null {
  if (!check || check.username !== normalizeUsername(typed)) return null;
  if (check.status === 'taken') return 'common:errors.usernameTaken';
  if (check.status === 'reserved') return 'common:errors.usernameReserved';
  if (check.status === 'invalid') return 'common:errors.usernameInvalid';
  return null;
}

/** True once the live check has said this very username is valid and free. */
export function usernameCheckedFree(check: Pick<UsernameCheck, 'username' | 'status'> | undefined, typed: string): boolean {
  return !!check && check.status === 'ok' && check.username === normalizeUsername(typed);
}

/** An account whose email address is the automatic one for its username: it follows a new username (the server's rule). */
export function emailFollowsUsername(member: Pick<StaffMember, 'username' | 'email'>, emailDomain: string | undefined): boolean {
  return !!emailDomain && !!member.username && member.email === automaticEmail(member.username, emailDomain);
}

/**
 * The Email field of the edit form: what the manager typed once they have
 * touched it; until then the stored address — or, when that follows the
 * username, the address the new username will bring.
 */
export function shownEmail(member: Pick<StaffMember, 'username' | 'email'>, form: { username: string; email: string }, emailTouched: boolean, emailDomain: string | undefined): string {
  if (emailTouched) return form.email;
  if (!emailFollowsUsername(member, emailDomain)) return member.email;
  return automaticEmailFor(form.username, emailDomain) || member.email;
}

/**
 * The username and email part of the edit form's PATCH: only what the manager
 * changed. An untouched Email field is never sent — the server keeps it, or
 * moves it with the username when it follows. A touched one is sent whenever
 * it differs, and also together with a new username (so "keep this address"
 * is not overruled by the follow rule).
 */
export function accountNamesPatch(
  member: Pick<StaffMember, 'username' | 'email'>,
  data: { username?: string; email?: string },
  emailTouched: boolean,
): Pick<StaffUpdateInput, 'username' | 'email'> {
  const patch: Pick<StaffUpdateInput, 'username' | 'email'> = {};
  if (data.username !== undefined && data.username !== member.username) patch.username = data.username;
  if (emailTouched && data.email !== undefined && (data.email !== member.email || patch.username !== undefined)) patch.email = data.email;
  return patch;
}
