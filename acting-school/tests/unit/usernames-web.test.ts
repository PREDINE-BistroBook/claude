import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loginInput } from '../../src/shared/schemas/auth';
import { staffCreateInput, staffUpdateInput } from '../../src/shared/schemas/staff';
import settings from '../../src/web/features/settings/i18n';
import staff from '../../src/web/features/staff/i18n';
import {
  accountNamesPatch,
  automaticEmailFor,
  emailFollowsUsername,
  shownEmail,
  typedEmail,
  usernameCheckedFree,
  usernameCheckError,
} from '../../src/web/features/staff/utils';
import common from '../../src/web/i18n/common';
import { ApiError } from '../../src/web/lib/api';
import { authGate } from '../../src/web/lib/authGate';
import { errorMessageKey, issuesToErrors } from '../../src/web/lib/forms';

/**
 * The web side of Part I (usernames, the first-password screen): the rules the
 * screens follow, as plain functions, and the words they show. The API's side
 * is tests/api/usernames.test.ts and tests/api/first-password.test.ts.
 */
const src = (file: string) => fs.readFileSync(path.resolve(__dirname, '../../src/web', file), 'utf8');

describe('what a signed-in-only screen shows (authGate)', () => {
  const base = { loading: false, needsSetup: false, offline: false };
  const user = (mustChangePassword: boolean) => ({ mustChangePassword });

  it('someone on a temporary password gets the "Choose your own password" screen — at every address — and nothing else', () => {
    expect(authGate({ ...base, user: user(true) })).toBe('choosePassword');
    // Whatever else is true about the moment: still that screen, never the app.
    expect(authGate({ ...base, user: user(true), offline: true })).toBe('choosePassword');
    expect(authGate({ ...base, user: user(true), needsSetup: true })).toBe('choosePassword');
  });

  it('once they have chosen, the app', () => {
    expect(authGate({ ...base, user: user(false) })).toBe('app');
  });

  it('nobody signed in: the sign-in page, or setup on first run; loading and offline as before', () => {
    expect(authGate({ ...base, user: null })).toBe('login');
    expect(authGate({ ...base, user: null, needsSetup: true })).toBe('setup');
    expect(authGate({ ...base, user: null, loading: true })).toBe('loading');
    expect(authGate({ ...base, user: null, offline: true })).toBe('offline');
    expect(authGate({ ...base, user: user(false), loading: true })).toBe('loading');
  });

  it('RequireAuth renders the screen in place of the app (no route of its own to navigate away from)', () => {
    const auth = src('lib/auth.tsx');
    expect(auth).toMatch(/case 'choosePassword':\s+return \(\s+<Suspense fallback=\{<SplashScreen \/>\}>\s+<ChoosePasswordPage \/>/);
    expect(src('router.tsx')).not.toContain('ChoosePassword');
  });
});

describe('the sign-in page', () => {
  it('has one field, "Username", that also takes an email address — sent as `username`', () => {
    const page = src('pages/LoginPage.tsx');
    expect(page).toContain("form.bind('username')");
    expect(page).toContain("t('fields.username')");
    expect(page).toContain("t('auth.usernameHint')");
    expect(page).toContain('autoComplete="username"');
    expect(page).toContain('autoCapitalize="none"');
    expect(page).toContain('dir="ltr"');
    // Not an email box: the browser would refuse "salma" in one.
    expect(page).not.toContain('type="email"');
    expect(page).not.toContain("form.bind('email')");
    expect(common.en.fields.username).toBe('Username');
    expect(common.ar.fields.username).toBe('اسم المستخدم');
    expect(common.en.auth.usernameHint).toMatch(/email/i);
    expect(common.ar.auth.usernameHint).toContain('بريدك الإلكتروني');
    // The wrong-sign-in message no longer says "Email".
    expect(common.en.errors.invalidCredentials).toBe('Username or password is incorrect.');
    expect(common.ar.errors.invalidCredentials).toContain('اسم المستخدم');
  });

  it('validates with the request’s own schema: an empty field is "Required", anything typed goes to the server', () => {
    const errors = (values: unknown) => {
      const r = loginInput.safeParse(values);
      return r.success ? {} : issuesToErrors(r.error.issues as never);
    };
    expect(errors({ username: '', password: '' })).toEqual({ username: 'common:errors.required', password: 'common:errors.required' });
    expect(errors({ username: 'salma', password: 'x' })).toEqual({});
    expect(errors({ username: 'salma@turquoisestudio.app', password: 'x' })).toEqual({});
  });
});

describe('the messages the API’s answers turn into', () => {
  it('field issues about usernames and the first password have words in both languages', () => {
    const keys = ['usernameInvalid', 'usernameTaken', 'passwordSameAsTemporary', 'passwordsDontMatch', 'passwordChangeRequired', 'passwordTooShort', 'required'] as const;
    for (const k of keys) {
      expect(common.en.errors[k], k).toBeTruthy();
      expect(common.ar.errors[k], k).toBeTruthy();
    }
    expect(issuesToErrors([{ path: ['username'], code: 'custom', message: 'errors.usernameTaken' }])).toEqual({ username: 'common:errors.usernameTaken' });
    expect(issuesToErrors([{ path: ['username'], code: 'invalid_format', message: 'errors.usernameInvalid' }])).toEqual({ username: 'common:errors.usernameInvalid' });
    expect(issuesToErrors([{ path: ['newPassword'], code: 'custom', message: 'errors.passwordSameAsTemporary' }])).toEqual({ newPassword: 'common:errors.passwordSameAsTemporary' });
    expect(issuesToErrors([{ path: ['repeatPassword'], code: 'custom', message: 'errors.passwordsDontMatch' }])).toEqual({ repeatPassword: 'common:errors.passwordsDontMatch' });
    expect(issuesToErrors([{ path: ['emailDomain'], code: 'invalid_format', message: 'settings:errors.emailDomain' }])).toEqual({ emailDomain: 'settings:errors.emailDomain' });
    expect(settings.en.errors.emailDomain && settings.ar.errors.emailDomain).toBeTruthy();
  });

  it('the gate’s refusal and a taken username read as themselves, not as "Something went wrong"', () => {
    expect(errorMessageKey(new ApiError(403, 'password_change_required', 'x'))).toBe('common:errors.passwordChangeRequired');
    expect(errorMessageKey(new ApiError(409, 'username_taken', 'x'))).toBe('common:errors.usernameTaken');
  });

  it('the username rules are spelled out in plain words, with the numbers in Western digits', () => {
    expect(common.en.errors.usernameInvalid).toMatch(/3 to 20/);
    expect(common.ar.errors.usernameInvalid).toMatch(/3.*20/);
    expect(common.en.profile.username.hint).toMatch(/3 to 20/);
    expect(common.ar.profile.username.hint).toMatch(/3.*20/);
  });
});

describe('"Choose your own password" screen', () => {
  it('two password fields, the rules, one labelled box to show what is typed, sign-out — and it posts only the new password', () => {
    const page = src('pages/ChoosePasswordPage.tsx');
    expect(page).toContain("api.post<{ user: SessionUser }>('/auth/choose-password', data)");
    expect(page).toContain('save.mutate({ newPassword: data.newPassword })');
    expect(page).toContain("form.bind('newPassword')");
    expect(page).toContain("form.bind('repeatPassword')");
    expect(page.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(page).toContain("t('auth.choosePassword.show')");
    expect(page).toContain('void signOut()');
    // No link into the app and no router navigation: there is nowhere to go from here.
    expect(page).not.toMatch(/<Link|useNavigate|<Navigate|href=/);
    // Tap targets of at least 48 px: the submit button is size="lg" (h-12), the rest carry min-h-12.
    expect(page).toMatch(/type="submit" variant="primary" size="lg"/);
    expect(page.match(/min-h-12/g)!.length).toBeGreaterThanOrEqual(2);
    const en = common.en.auth.choosePassword;
    const ar = common.ar.auth.choosePassword as typeof en;
    expect(en.title).toBe('Choose your own password');
    expect(ar.title).toBe('اختر كلمة مرورك');
    expect(en.ruleLength).toContain('8');
    expect(ar.ruleLength).toContain('8');
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ar[k], k).toBeTruthy();
  });
});

describe('the add and edit forms: username and email', () => {
  const domain = 'turquoisestudio.app';

  it('the address an account will get is shown from the username as it is typed', () => {
    expect(automaticEmailFor('ahmed', domain)).toBe('ahmed@turquoisestudio.app');
    expect(automaticEmailFor('  Ahmed ', domain)).toBe('ahmed@turquoisestudio.app');
    expect(automaticEmailFor('ah', domain)).toBe('');
    expect(automaticEmailFor('not valid', domain)).toBe('');
    // Until the settings have loaded there is no domain to show.
    expect(automaticEmailFor('ahmed', undefined)).toBe('');
  });

  it('the add form sends an email only when the manager typed one', () => {
    expect(typedEmail('')).toBeUndefined();
    expect(typedEmail('   ')).toBeUndefined();
    expect(typedEmail(' ahmed@gmail.com ')).toBe('ahmed@gmail.com');
    const base = { name: 'Ahmed', username: 'ahmed', positionIds: [1], password: 'temporary1' };
    expect(staffCreateInput.parse({ ...base, email: typedEmail('') })).not.toHaveProperty('email', expect.any(String));
    expect(staffCreateInput.parse({ ...base, email: typedEmail('Ahmed@Gmail.com') }).email).toBe('ahmed@gmail.com');
    // An empty Username field is "Required" in the form, before anything is sent.
    const empty = staffCreateInput.safeParse({ ...base, username: '' });
    expect(empty.success ? {} : issuesToErrors(empty.error.issues as never)).toEqual({ username: 'common:errors.required' });
    const bad = staffCreateInput.safeParse({ ...base, username: 'Ahmed Abdellah' });
    expect(bad.success ? {} : issuesToErrors(bad.error.issues as never)).toEqual({ username: 'common:errors.usernameInvalid' });
  });

  it('the live check speaks only about what is in the field right now', () => {
    expect(usernameCheckError(undefined, 'ahmed')).toBeNull();
    expect(usernameCheckError({ username: 'ahmed', status: 'taken' }, 'ahmed')).toBe('common:errors.usernameTaken');
    expect(usernameCheckError({ username: 'ahmed', status: 'taken' }, ' Ahmed ')).toBe('common:errors.usernameTaken');
    expect(usernameCheckError({ username: 'ab', status: 'invalid' }, 'ab')).toBe('common:errors.usernameInvalid');
    expect(usernameCheckError({ username: 'ahmed', status: 'ok' }, 'ahmed')).toBeNull();
    // An answer for what was typed a moment ago says nothing about the new text.
    expect(usernameCheckError({ username: 'ahmed', status: 'taken' }, 'ahmed.a')).toBeNull();
    expect(usernameCheckedFree({ username: 'ahmed', status: 'ok' }, 'Ahmed')).toBe(true);
    expect(usernameCheckedFree({ username: 'ahmed', status: 'ok' }, 'ahmed.a')).toBe(false);
    expect(usernameCheckedFree({ username: 'ahmed', status: 'taken' }, 'ahmed')).toBe(false);
    expect(usernameCheckedFree(undefined, 'ahmed')).toBe(false);
  });

  it('on the member page an automatic address follows the username until the manager types another', () => {
    const auto = { username: 'mohamed', email: 'mohamed@turquoisestudio.app' };
    const own = { username: 'ahmed', email: 'ahmed@gmail.com' };
    expect(emailFollowsUsername(auto, domain)).toBe(true);
    expect(emailFollowsUsername(own, domain)).toBe(false);
    expect(emailFollowsUsername(auto, undefined)).toBe(false);
    expect(emailFollowsUsername(auto, 'other.example')).toBe(false);

    // Untouched: the stored address, or the one the new username will bring.
    expect(shownEmail(auto, { username: 'mohamed', email: auto.email }, false, domain)).toBe('mohamed@turquoisestudio.app');
    expect(shownEmail(auto, { username: 'hamzawy', email: auto.email }, false, domain)).toBe('hamzawy@turquoisestudio.app');
    // While the new username isn't usable yet, the stored address stays on screen.
    expect(shownEmail(auto, { username: 'h', email: auto.email }, false, domain)).toBe('mohamed@turquoisestudio.app');
    expect(shownEmail(own, { username: 'ahmed.a', email: own.email }, false, domain)).toBe('ahmed@gmail.com');
    // Touched: exactly what was typed.
    expect(shownEmail(auto, { username: 'hamzawy', email: 'm@x.com' }, true, domain)).toBe('m@x.com');
    expect(shownEmail(auto, { username: 'hamzawy', email: '' }, true, domain)).toBe('');
  });

  it('the edit form sends only what the manager changed', () => {
    const auto = { username: 'mohamed', email: 'mohamed@turquoisestudio.app' };
    // Nothing changed.
    expect(accountNamesPatch(auto, { username: 'mohamed', email: auto.email }, false)).toEqual({});
    // A new username, email untouched: the username alone (the server moves the address).
    expect(accountNamesPatch(auto, { username: 'hamzawy', email: 'hamzawy@turquoisestudio.app' }, false)).toEqual({ username: 'hamzawy' });
    // A typed email: sent when it differs…
    expect(accountNamesPatch(auto, { username: 'mohamed', email: 'm@gmail.com' }, true)).toEqual({ email: 'm@gmail.com' });
    expect(accountNamesPatch(auto, { username: 'mohamed', email: auto.email }, true)).toEqual({});
    // …and always together with a new username, so "keep this address" isn't overruled.
    expect(accountNamesPatch(auto, { username: 'hamzawy', email: auto.email }, true)).toEqual({ username: 'hamzawy', email: auto.email });
    expect(staffUpdateInput.parse(accountNamesPatch(auto, { username: 'hamzawy', email: auto.email }, true))).toEqual({ username: 'hamzawy', email: auto.email });
  });

  it('the forms ask for a username, show a temporary-password note, and never say "email" where they mean the sign-in name', () => {
    const forms = src('features/staff/components/StaffForms.tsx');
    expect(forms).toContain('<UsernameField');
    expect(forms).toContain("t('common:fields.username')");
    expect(forms).toContain('exceptId={member.id}');
    expect(forms).toContain("t('form.temporaryNote')");
    for (const lang of [staff.en, staff.ar]) {
      expect(lang.form.usernameHint && lang.form.usernameFree && lang.form.emailAutoHint && lang.form.temporaryNote && lang.usernameLabel).toBeTruthy();
    }
    expect(staff.en.form.addDescription).toMatch(/username/i);
    expect(staff.en.form.addDescription).not.toMatch(/email/i);
    expect(staff.ar.form.addDescription).toContain('اسم المستخدم');
    // A first password works once: the hint says so instead of "they can change it in My profile".
    expect(staff.en.form.tempPasswordHint).toMatch(/choose their own password/);
    expect(staff.en.form.resetDescription).toMatch(/temporary password/);
  });

  it('usernames show on the Team list (for managers, from their account), the member page and My profile', () => {
    const team = src('features/team/TeamPage.tsx');
    expect(team).toContain('username={account?.username}');
    expect(team).toContain('username={a.username}');
    expect(team).not.toContain('email={account?.email}');
    const profile = src('pages/ProfilePage.tsx');
    expect(profile).toContain("t('profile.username.title')");
    expect(profile).toContain("api.patch<MeResponse>('/auth/profile', data)");
    expect(profile).toContain("uname.bind('username')");
  });
});
