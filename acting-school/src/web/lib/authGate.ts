/**
 * What a signed-in-only screen shows, worked out from who is signed in. Kept
 * free of React and the DOM so the rule can be tested on its own
 * (tests/unit/usernames-web.test.ts); RequireAuth in lib/auth.tsx renders it.
 *
 * - `offline`: the server can't be reached and we don't know who is signed in.
 * - `loading`: still finding out.
 * - `setup` / `login`: nobody is signed in (first run, or the sign-in page).
 * - `choosePassword`: signed in with a temporary password (SessionUser.mustChangePassword):
 *   the "Choose your own password" screen and nothing else, whatever the address
 *   in the browser — the API refuses everything else for this session anyway.
 * - `app`: the app.
 */
export type AuthGate = 'offline' | 'loading' | 'setup' | 'login' | 'choosePassword' | 'app';

export function authGate(state: {
  user: { mustChangePassword: boolean } | null;
  loading: boolean;
  needsSetup: boolean;
  offline: boolean;
}): AuthGate {
  if (state.offline && !state.user) return 'offline';
  if (state.loading) return 'loading';
  if (!state.user) return state.needsSetup ? 'setup' : 'login';
  return state.user.mustChangePassword ? 'choosePassword' : 'app';
}
