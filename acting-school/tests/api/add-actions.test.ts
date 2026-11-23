import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, weekdayOf } from '../../src/shared/dates';
import type { CourseDetail } from '../../src/shared/schemas/courses';
import { canAddVideoHere } from '../../src/web/features/videos/utils';
import { SCREENS, type ScreenSpec } from '../../src/web/layout/addActions';
import { makeTestContext, todayISO, type Client } from '../helpers';

/**
 * Part K2: "an Add button never appears for someone who would be refused by
 * the API". Each list screen's Add names the request it ends in (`api`) and
 * who sees it (`permission`) in layout/addActions.ts; here that request is
 * sent for real — by someone holding only that permission (never refused:
 * whatever else it says, not 401/403) and by someone without it (403). That
 * covers the Adds that open a dialog on the screen (website links, a new
 * message) as much as the ones that open a page (whose Guard
 * tests/unit/add-actions.test.ts compares).
 */

const adds = Object.entries(SCREENS as Record<string, ScreenSpec>)
  .filter(([, s]) => s.add)
  .map(([screen, s]) => ({ screen, ...s.add! }));

describe('each list’s "+ Add …" and the API agree on who may add', () => {
  let t: Awaited<ReturnType<typeof makeTestContext>>;
  let nobody: Client;
  beforeAll(async () => {
    t = await makeTestContext();
    // Signed in, a position with no permissions at all (Reception today).
    nobody = await t.as({ permissions: [] });
  });

  const send = (client: Client, api: string) => {
    const [method, path] = api.split(' ') as [string, string];
    expect(['POST', 'PUT', 'PATCH'], api).toContain(method);
    expect(path, api).toMatch(/^\/api\//);
    // A record's id that doesn't exist: the permission is checked before the record is looked up.
    const url = path.replace(/:\w+/g, '999999');
    return method === 'POST' ? client.post(url, {}) : method === 'PUT' ? client.put(url, {}) : client.patch(url, {});
  };

  it('every list Add names its request', () => {
    expect(adds.length).toBeGreaterThan(8);
    expect(adds.filter((a) => !a.api).map((a) => a.screen)).toEqual([]);
  });

  it.each(adds.map((a) => [a.screen, a] as const))('%s', async (_screen, add) => {
    const held = [add.permission, add.also].filter((p) => p !== undefined);
    const holder = await t.as({ permissions: held });
    const allowed = await send(holder, add.api);
    expect([401, 403], `${add.api} as someone holding ${held.join(' + ') || 'nothing'}: ${JSON.stringify(allowed.body)}`).not.toContain(allowed.status);
    if (add.permission) expect((await send(nobody, add.api)).status, `${add.api} without ${add.permission}`).toBe(403);
    // Each permission the Add asks for is needed: with one of the two missing, the API refuses too.
    for (const p of held) {
      const short = await t.as({ permissions: held.filter((x) => x !== p) });
      expect((await send(short, add.api)).status, `${add.api} without ${p}`).toBe(403);
    }
  });
});

describe('a session’s and a workshop’s "+ Add video" (Part L) and the API agree', () => {
  it('the page opens exactly where the video is taken: videos.add + courses.read, inside the class scope', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const coach = await t.as('acting_coach');
    const other = await t.as('acting_coach');
    const today = todayISO();
    const workshop = async (teacherId: number) =>
      (
        await owner.post<CourseDetail>('/api/courses', {
          name: `Workshop ${teacherId}`,
          teacherId,
          startDate: addDays(today, -7),
          endDate: addDays(today, 7),
          schedule: [{ weekday: weekdayOf(today), startTime: '18:00', endTime: '20:00' }],
        })
      ).body;
    const mine = await workshop(coach.user.id);
    const theirs = await workshop(other.user.id);
    const session = (c: CourseDetail) => c.sessions.find((s) => s.date === today)!.id;
    const video = (where: Record<string, number>) => ({ title: 'Scene', rawLink: 'https://drive.google.com/file/d/x/view', ...where });
    // What the web's useAuth().can reads: the signed-in person's permissions from /api/auth/me.
    const held = async (c: Client) => {
      const perms: string[] = (await c.get('/api/auth/me')).body.user.permissions;
      return (p: string) => perms.includes(p);
    };

    // The coach: her own session and workshop open, and the video is taken from both.
    expect(canAddVideoHere(await held(coach))).toBe(true);
    expect((await coach.get(`/api/sessions/${session(mine)}`)).status).toBe(200);
    expect((await coach.post('/api/videos', video({ sessionId: session(mine) }))).status).toBe(201);
    expect((await coach.get(`/api/courses/${mine.id}`)).status).toBe(200);
    expect((await coach.post('/api/videos', video({ courseId: mine.id }))).status).toBe(201);
    // Another coach's class: the page doesn't open for her (no block, no button) — and the API answers like a missing one.
    expect((await coach.get(`/api/sessions/${session(theirs)}`)).status).toBe(404);
    expect((await coach.post('/api/videos', video({ sessionId: session(theirs) }))).status).toBe(404);
    // videos.add without courses.read: no session page at all, no button (canAddVideoHere) — and nothing is taken.
    const blind = await t.as({ permissions: ['videos.add'] });
    expect(canAddVideoHere(await held(blind))).toBe(false);
    expect((await blind.get(`/api/sessions/${session(mine)}`)).status).toBe(403);
    expect((await blind.post('/api/videos', video({ sessionId: session(mine) }))).status).toBe(404);
    // The video editor sees the session (classes.all) but adds nothing: no button, and a 403.
    const editor = await t.as('video_editor');
    expect(canAddVideoHere(await held(editor))).toBe(false);
    expect((await editor.get(`/api/sessions/${session(mine)}`)).status).toBe(200);
    expect((await editor.post('/api/videos', video({ sessionId: session(mine) }))).status).toBe(403);
  });
});
