import { beforeAll, describe, expect, it } from 'vitest';
import { SCREENS, type ScreenSpec } from '../../src/web/layout/addActions';
import { makeTestContext, type Client } from '../helpers';

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
