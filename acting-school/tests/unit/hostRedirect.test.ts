import { describe, expect, it } from 'vitest';
import { hostRedirect, parseHostRedirects } from '../../src/worker/hostRedirect';

const map = parseHostRedirects('staff.turquoisestudio.app=team.turquoisestudio.app');
const ask = (url: string, init?: RequestInit) => hostRedirect(new Request(url, init), map);

describe('retired staff address', () => {
  it('parses the setting and ignores rubbish', () => {
    expect([...map]).toEqual([['staff.turquoisestudio.app', 'team.turquoisestudio.app']]);
    expect(parseHostRedirects(undefined).size).toBe(0);
    expect(parseHostRedirects('a=a, =b, c=, bad host=x.y, x.y=https://evil').size).toBe(0);
  });

  it('forwards pages to the same path on the new address', () => {
    const res = ask('https://staff.turquoisestudio.app/students/12?tab=notes');
    expect(res?.status).toBe(301);
    expect(res?.headers.get('location')).toBe('https://team.turquoisestudio.app/students/12?tab=notes');
    expect(ask('https://staff.turquoisestudio.app/')?.headers.get('location')).toBe('https://team.turquoisestudio.app/');
    // A path can't change where the redirect goes.
    expect(ask('https://staff.turquoisestudio.app//evil.com/x')?.headers.get('location')).toBe('https://team.turquoisestudio.app//evil.com/x');
  });

  it('keeps the API answering and leaves writes alone', () => {
    expect(ask('https://staff.turquoisestudio.app/api/auth/me')).toBeNull();
    expect(ask('https://staff.turquoisestudio.app/login', { method: 'POST', body: 'x' })).toBeNull();
  });

  it('serves a service worker that removes itself', async () => {
    const res = ask('https://staff.turquoisestudio.app/sw.js');
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe('application/javascript');
    expect(res?.headers.get('cache-control')).toBe('no-store');
    const js = await res!.text();
    expect(js).toContain('registration.unregister()');
    expect(js).toContain('client.navigate');
  });

  it('does nothing on other hosts', () => {
    for (const host of ['team.turquoisestudio.app', 'turquoisestudio.app', 'claude.hashesha.workers.dev', 'localhost']) {
      expect(ask(`https://${host}/students`), host).toBeNull();
    }
  });
});
