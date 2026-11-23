import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUDFLARE_DEFAULTS, configFromVars, MIN_ADMIN_TOKEN_LENGTH } from '../../src/server/config';
import { DEFAULT_TIME_ZONE, epochAt, isValidTimeZone, nowTimeIn, todayIn } from '../../src/server/lib/clock';
import type { DashboardData } from '../../src/shared/schemas/dashboard';
import { makeTestContext } from '../helpers';

/**
 * The server's "today"/"now" come from the school's time zone (Africa/Cairo),
 * never the runtime's: Cloudflare Workers run in UTC (and so does vitest here),
 * so just after midnight in Cairo the runtime's date is still yesterday.
 */

// 22:30 UTC on 9 March 2026 = 00:30 on 10 March in Cairo (UTC+2 in winter).
const WINTER = new Date('2026-03-09T22:30:00Z');
// 21:30 UTC on 15 July 2026 = 00:30 on 16 July in Cairo (UTC+3: Egypt's summer time).
const SUMMER = new Date('2026-07-15T21:30:00Z');

describe('school clock helpers', () => {
  it('give the date and time in Cairo, not the runtime time zone', () => {
    expect(process.env.TZ).toBe('UTC');
    expect(WINTER.getUTCDate()).toBe(9);
    expect(todayIn('Africa/Cairo', WINTER)).toBe('2026-03-10');
    expect(nowTimeIn('Africa/Cairo', WINTER)).toBe('00:30');
    expect(todayIn('Africa/Cairo', SUMMER)).toBe('2026-07-16');
    expect(nowTimeIn('Africa/Cairo', SUMMER)).toBe('00:30');
    expect(todayIn('UTC', WINTER)).toBe('2026-03-09');
    expect(nowTimeIn('America/Los_Angeles', WINTER)).toBe('15:30');
  });

  it('epochAt turns a school-local wall-clock time back into an instant', () => {
    expect(epochAt('Africa/Cairo', '2026-03-10', '00:30')).toBe(WINTER.getTime());
    expect(epochAt('Africa/Cairo', '2026-07-16', '00:30')).toBe(SUMMER.getTime());
    expect(new Date(epochAt('Africa/Cairo', '2026-11-23', '10:00')).toISOString()).toBe('2026-11-23T08:00:00.000Z');
  });

  it('a time zone the runtime does not know falls back to Cairo', () => {
    expect(isValidTimeZone('Africa/Cairo')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(configFromVars({ SCHOOL_TIME_ZONE: 'Mars/Olympus' }, CLOUDFLARE_DEFAULTS).timeZone).toBe(DEFAULT_TIME_ZONE);
    expect(configFromVars({ SCHOOL_TIME_ZONE: 'Asia/Dubai' }, CLOUDFLARE_DEFAULTS).timeZone).toBe('Asia/Dubai');
    error.mockRestore();
  });
});

describe('config from variables (Node env or Worker vars)', () => {
  it('reads cookies, sessions, the admin token and the reset switch', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cf = configFromVars({}, CLOUDFLARE_DEFAULTS);
    expect(cf).toMatchObject({ cookieSecure: true, sessionDays: 30, timeZone: 'Africa/Cairo', adminToken: null, allowDemoReset: false, requireSetupCode: true });
    // Setup needs the setup code on Cloudflare whatever the variables say; on Node only when asked.
    expect(configFromVars({ REQUIRE_SETUP_CODE: 'false' }, CLOUDFLARE_DEFAULTS).requireSetupCode).toBe(true);
    const node = { cookieSecure: false, isProduction: false, requireSetupCode: false };
    expect(configFromVars({}, node).requireSetupCode).toBe(false);
    expect(configFromVars({ REQUIRE_SETUP_CODE: 'true' }, node).requireSetupCode).toBe(true);
    const token = 'x'.repeat(MIN_ADMIN_TOKEN_LENGTH);
    expect(configFromVars({ ADMIN_TOKEN: ` ${token} `, ALLOW_DEMO_RESET: 'true', SESSION_DAYS: '7', COOKIE_SECURE: 'false' }, CLOUDFLARE_DEFAULTS)).toMatchObject(
      { adminToken: token, allowDemoReset: true, sessionDays: 7, cookieSecure: false },
    );
    // A token too short to be safe switches the admin routes off (and isn't printed).
    expect(configFromVars({ ADMIN_TOKEN: 'short-token' }, CLOUDFLARE_DEFAULTS).adminToken).toBeNull();
    expect(error.mock.calls.flat().join(' ')).not.toContain('short-token');
    expect(configFromVars({ ALLOW_DEMO_RESET: 'yes' }, { cookieSecure: false, isProduction: false, requireSetupCode: false }).allowDemoReset).toBe(false);
    error.mockRestore();
  });
});

describe('the API uses the school date', () => {
  afterEach(() => vi.useRealTimers());

  it('at 00:30 in Cairo (22:30 UTC the day before): dashboard, new student and lead follow-ups are on the Cairo date', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(WINTER);

    const dash = await owner.get<DashboardData>('/api/dashboard');
    expect(dash.body.today).toBe('2026-03-10');

    const student = await owner.post('/api/students', { firstName: 'Midnight', lastName: 'Student' });
    expect(student.status).toBe(201);
    expect(student.body.joinedOn).toBe('2026-03-10');

    // A follow-up due "today" (10 March) is due now, although it's still 9 March in UTC.
    const lead = await owner.post('/api/leads', { firstName: 'Late', lastName: 'Caller', phone: '0100 111 2222', nextFollowUpOn: '2026-03-10' });
    expect(lead.status).toBe(201);
    const due = await owner.get('/api/leads?group=follow_up_due');
    expect(due.body.items.map((l: { id: number }) => l.id)).toEqual([lead.body.id]);
    expect((await owner.get('/api/leads/counts')).body.followUpDue).toBe(1);
  });

  it('follows the configured time zone', async () => {
    const t = await makeTestContext({ config: { timeZone: 'America/Los_Angeles' } });
    const owner = await t.as('owner');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(WINTER);
    expect((await owner.get<DashboardData>('/api/dashboard')).body.today).toBe('2026-03-09');
  });
});
