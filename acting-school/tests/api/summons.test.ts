import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { DB } from '../../src/server/db/database';
import { authSessions, notifications, positions, pushSubscriptions, settings, summons } from '../../src/server/db/schema';
import { builtInGrantsVersion, upgradeBuiltInPositions } from '../../src/server/lib/access';
import { generateVapidKeys } from '../../src/server/lib/push/keys';
import { MAX_PUSH_FAILURES } from '../../src/server/lib/push/send';
import { BUILT_IN_GRANTS, BUILT_IN_GRANTS_SETTING, BUILT_IN_POSITIONS, LATEST_BUILT_IN_GRANTS_VERSION } from '../../src/shared/permissions';
import { personActions } from '../../src/shared/schemas/team';
import { makeTestContext, testDb } from '../helpers';
import { fakeBrowser, pushRecorder } from '../pushHelpers';

/**
 * Part G4–G5: "call to the office" (staff.summon), the in-app notification
 * bar, and push subscriptions.
 */

const HOUR = 60 * 60 * 1000;

describe('staff.summon: who may call someone to the office', () => {
  it('built in for the Executive Director (BUILT_IN_GRANTS v3); owners have it; nobody else', () => {
    expect(BUILT_IN_GRANTS.find((g) => g.version === 3)).toEqual({ version: 3, grants: { executive_director: ['staff.summon'] } });
    expect(LATEST_BUILT_IN_GRANTS_VERSION).toBeGreaterThanOrEqual(3);
    for (const p of BUILT_IN_POSITIONS) {
      expect((p.permissions as readonly string[]).includes('staff.summon'), p.key).toBe(p.isOwner || p.key === 'executive_director');
    }
  });

  it('the v3 upgrade gives an existing director staff.summon once; removed afterwards, it stays removed', () => {
    const db: DB = testDb();
    const perms = (key: string) => db.select().from(positions).where(eq(positions.key, key)).get()!.permissions as string[];
    // As a database from before the team pack: the director without it, grants applied up to v2.
    db.update(positions)
      .set({ permissions: perms('executive_director').filter((p) => p !== 'staff.summon') as never })
      .where(eq(positions.key, 'executive_director'))
      .run();
    db.update(settings).set({ value: 2 }).where(eq(settings.key, BUILT_IN_GRANTS_SETTING)).run();
    const coach = perms('acting_coach');
    upgradeBuiltInPositions(db);
    expect(perms('executive_director').filter((p) => p === 'staff.summon')).toHaveLength(1);
    expect(perms('acting_coach')).toEqual(coach);
    expect(builtInGrantsVersion(db)).toBe(LATEST_BUILT_IN_GRANTS_VERSION);
    db.update(positions)
      .set({ permissions: perms('executive_director').filter((p) => p !== 'staff.summon') as never })
      .where(eq(positions.key, 'executive_director'))
      .run();
    upgradeBuiltInPositions(db);
    expect(perms('executive_director')).not.toContain('staff.summon');
  });

  it('PersonActions rules: Message for any active colleague but yourself; Call to the office needs staff.summon', () => {
    const director = { id: 1, permissions: ['staff.summon' as const] };
    const coach = { id: 2, permissions: ['courses.read' as const] };
    expect(personActions(director, { id: 2, active: true })).toEqual({ message: true, summon: true });
    expect(personActions(coach, { id: 1, active: true })).toEqual({ message: true, summon: false });
    expect(personActions(director, { id: 1, active: true })).toEqual({ message: false, summon: false });
    expect(personActions(director, { id: 3, active: false })).toEqual({ message: false, summon: false });
    expect(personActions(null, { id: 3, active: true })).toEqual({ message: false, summon: false });
  });
});

describe('POST /api/summons', () => {
  it('the director calls a coach: 201, a notification in the coach’s language, the banner through the poll', async () => {
    const t = await makeTestContext();
    const dalia = await t.as('executive_director', { name: 'Dalia' });
    const layla = await t.as('acting_coach', { name: 'Layla', locale: 'ar' });
    const res = await dalia.post('/api/summons', { userId: layla.user.id, note: '  Bring the attendance sheet  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      from: { id: dalia.user.id, name: 'Dalia' },
      to: { id: layla.user.id, name: 'Layla' },
      note: 'Bring the attendance sheet',
      status: 'pending',
      answeredAt: null,
    });
    expect(res.body.expiresAt - res.body.createdAt).toBe(2 * HOUR);

    const poll = (await layla.get('/api/chat/unread')).body;
    expect(poll.summons).toHaveLength(1);
    expect(poll.summons[0]).toMatchObject({ id: res.body.id, from: { name: 'Dalia' }, note: 'Bring the attendance sheet' });
    expect(poll.notifications).toBe(1);
    expect((await layla.get('/api/summons/incoming')).body.items.map((s: any) => s.id)).toEqual([res.body.id]);
    const note = (await layla.get('/api/notifications')).body.items[0];
    expect(note).toMatchObject({ kind: 'summon', title: 'طلب من Dalia: الحضور إلى المكتب', body: 'Bring the attendance sheet', link: `/team?summons=${res.body.id}&from=${dalia.user.id}` });
  });

  it('needs staff.summon (owners have it); never yourself; an active colleague; owners can be called', async () => {
    const t = await makeTestContext();
    const coach = await t.as('acting_coach');
    const head = await t.as('head_of_casting');
    const cfo = await t.as('cfo');
    const director = await t.as('executive_director');
    expect((await coach.post('/api/summons', { userId: head.user.id })).status).toBe(403);
    expect((await head.post('/api/summons', { userId: coach.user.id })).status).toBe(403);
    expect((await t.anon.post('/api/summons', { userId: coach.user.id })).status).toBe(401);
    expect((await cfo.post('/api/summons', { userId: coach.user.id })).status).toBe(201);
    expect((await director.post('/api/summons', { userId: cfo.user.id })).status).toBe(201);
    const self = await director.post('/api/summons', { userId: director.user.id });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('cannot_summon_self');
    const gone = await t.createUser('video_editor', { active: false });
    expect((await director.post('/api/summons', { userId: gone.id })).status).toBe(404);
    expect((await director.post('/api/summons', { userId: 9999 })).status).toBe(404);
    expect((await director.post('/api/summons', { userId: head.user.id, note: 'x'.repeat(201) })).status).toBe(400);
  });

  it('one pending summons per caller and person (409 with it in details); another caller may still call', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const ceo = await t.as('ceo');
    const coach = await t.as('acting_coach');
    const first = (await director.post('/api/summons', { userId: coach.user.id })).body;
    const again = await director.post('/api/summons', { userId: coach.user.id, note: 'Now please' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'already_pending', details: { summons: { id: first.id, status: 'pending' } } });
    expect((await ceo.post('/api/summons', { userId: coach.user.id })).status).toBe(201);
    expect((await coach.get('/api/summons/incoming')).body.items).toHaveLength(2);
    // Once answered, a new one is fine.
    await coach.post(`/api/summons/${first.id}/answer`, { status: 'on_my_way' });
    expect((await director.post('/api/summons', { userId: coach.user.id })).status).toBe(201);
  });

  it('at most 20 an hour per caller (429)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const people = await Promise.all(Array.from({ length: 21 }, (_, i) => t.createUser('acting_coach', { name: `P${i}` })));
    for (const p of people.slice(0, 20)) expect((await director.post('/api/summons', { userId: p.id })).status).toBe(201);
    const over = await director.post('/api/summons', { userId: people[20]!.id });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('too_many_summons');
    t.db.update(summons).set({ createdAt: Date.now() - HOUR - 1000 }).run();
    expect((await director.post('/api/summons', { userId: people[20]!.id })).status).toBe(201);
  });
});

describe('answering and cancelling', () => {
  it('only the person called answers (others 404); the caller sees the answer, once', async () => {
    const t = await makeTestContext();
    const dalia = await t.as('executive_director', { name: 'Dalia' });
    const tarek = await t.as('casting_team', { name: 'Tarek' });
    const other = await t.as('acting_coach');
    const s = (await dalia.post('/api/summons', { userId: tarek.user.id, note: 'Falaki shortlist' })).body;
    expect((await other.post(`/api/summons/${s.id}/answer`, { status: 'on_my_way' })).status).toBe(404);
    expect((await dalia.post(`/api/summons/${s.id}/answer`, { status: 'on_my_way' })).status).toBe(404);
    expect((await tarek.post(`/api/summons/${s.id}/answer`, { status: 'maybe' })).status).toBe(400);
    expect((await tarek.post('/api/summons/9999/answer', { status: 'on_my_way' })).status).toBe(404);

    const answered = await tarek.post(`/api/summons/${s.id}/answer`, { status: 'on_my_way' });
    expect(answered.status).toBe(200);
    expect(answered.body).toMatchObject({ id: s.id, status: 'on_my_way' });
    expect(typeof answered.body.answeredAt).toBe('number');
    const twice = await tarek.post(`/api/summons/${s.id}/answer`, { status: 'cant_now' });
    expect(twice.status).toBe(409);
    expect(twice.body.error).toMatchObject({ code: 'not_pending', details: { summons: { status: 'on_my_way' } } });

    // Tarek's banner and bell are clear; Dalia has the answer.
    expect((await tarek.get('/api/chat/unread')).body).toMatchObject({ summons: [], notifications: 0 });
    const notes = (await dalia.get('/api/notifications')).body;
    expect(notes.items[0]).toMatchObject({ kind: 'summon_answer', title: 'Tarek: On my way', body: 'About: Falaki shortlist', link: `/team?summons=${s.id}` });
    const sent = (await dalia.get('/api/summons/sent')).body.items;
    expect(sent.map((x: any) => [x.id, x.status])).toEqual([[s.id, 'on_my_way']]);
    expect((await dalia.get('/api/team')).body.items.find((m: any) => m.id === tarek.user.id).lastSummons).toMatchObject({ id: s.id, status: 'on_my_way' });
    // Without staff.summon there's no "last summons" on anyone's row.
    expect((await tarek.get('/api/team')).body.items.every((m: any) => m.lastSummons === null)).toBe(true);
  });

  it('can’t come now; the caller cancels a pending one (others 404, not twice), which clears the person’s bell', async () => {
    const t = await makeTestContext();
    const dalia = await t.as('executive_director');
    const a = await t.as('acting_coach', { name: 'A' });
    const b = await t.as('acting_coach', { name: 'B' });
    const s1 = (await dalia.post('/api/summons', { userId: a.user.id })).body;
    expect((await a.post(`/api/summons/${s1.id}/answer`, { status: 'cant_now' })).body.status).toBe('cant_now');
    expect((await dalia.get('/api/notifications')).body.items[0].title).toBe('A: Can’t come now');

    const s2 = (await dalia.post('/api/summons', { userId: b.user.id })).body;
    expect((await b.post(`/api/summons/${s2.id}/cancel`)).status).toBe(404);
    const cancelled = await dalia.post(`/api/summons/${s2.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
    expect((await dalia.post(`/api/summons/${s2.id}/cancel`)).status).toBe(409);
    expect((await b.post(`/api/summons/${s2.id}/answer`, { status: 'on_my_way' })).status).toBe(409);
    expect((await b.get('/api/chat/unread')).body).toMatchObject({ summons: [], notifications: 0 });

    const sent = (await dalia.get('/api/summons/sent?status=cancelled')).body.items;
    expect(sent.map((x: any) => x.id)).toEqual([s2.id]);
    expect((await dalia.get('/api/summons/sent?status=nope')).status).toBe(400);
  });

  it('GET /api/summons/:id: either of its two people sees what became of it; anyone else gets a 404', async () => {
    const t = await makeTestContext();
    const dalia = await t.as('executive_director', { name: 'Dalia' });
    const tarek = await t.as('casting_team', { name: 'Tarek' });
    const other = await t.as('executive_director');
    const s = (await dalia.post('/api/summons', { userId: tarek.user.id, note: 'Shortlist' })).body;
    expect((await tarek.get(`/api/summons/${s.id}`)).body).toMatchObject({ id: s.id, status: 'pending', from: { name: 'Dalia' }, note: 'Shortlist' });
    await tarek.post(`/api/summons/${s.id}/answer`, { status: 'on_my_way' });
    const seen = await tarek.get(`/api/summons/${s.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body).toMatchObject({ status: 'on_my_way', to: { name: 'Tarek' } });
    expect(typeof seen.body.answeredAt).toBe('number');
    expect((await dalia.get(`/api/summons/${s.id}`)).body.status).toBe('on_my_way');
    expect((await other.get(`/api/summons/${s.id}`)).status).toBe(404);
    expect((await tarek.get('/api/summons/9999')).status).toBe(404);
    expect((await t.anon.get(`/api/summons/${s.id}`)).status).toBe(401);
    // The person called's notification points at the call and the caller; the caller's at the call.
    expect((await tarek.get('/api/notifications')).body.items[0].link).toBe(`/team?summons=${s.id}&from=${dalia.user.id}`);
    expect((await dalia.get('/api/notifications')).body.items[0].link).toBe(`/team?summons=${s.id}`);
  });

  it('an expired call’s notification counts as read: the bell stops counting a call that can’t be answered', async () => {
    const t = await makeTestContext();
    const dalia = await t.as('executive_director');
    const coach = await t.as('acting_coach');
    const s = (await dalia.post('/api/summons', { userId: coach.user.id })).body;
    expect((await coach.get('/api/notifications')).body.unread).toBe(1);
    const created = Date.now() - 2 * HOUR - 1000;
    t.db.update(summons).set({ createdAt: created }).where(eq(summons.id, s.id)).run();
    t.db.update(notifications).set({ createdAt: created }).where(eq(notifications.userId, coach.user.id)).run();
    const bell = (await coach.get('/api/notifications')).body;
    expect(bell.unread).toBe(0);
    expect(bell.items[0]).toMatchObject({ kind: 'summon', readAt: created + 2 * HOUR });
    expect((await coach.get('/api/chat/unread')).body).toMatchObject({ notifications: 0, summons: [] });
    expect((await coach.get(`/api/summons/${s.id}`)).body.status).toBe('expired');
    // The caller's own answers aren't affected: a message still counts.
    const conv = (await dalia.post('/api/chat/conversations', { userId: coach.user.id })).body.id;
    await dalia.post(`/api/chat/conversations/${conv}/messages`, { body: 'Are you coming?' });
    expect((await coach.get('/api/notifications')).body.unread).toBe(1);
  });

  it('a pending summons expires after two hours: no banner, can’t be answered or cancelled, doesn’t block a new one', async () => {
    const t = await makeTestContext();
    const dalia = await t.as('executive_director');
    const coach = await t.as('acting_coach');
    const s = (await dalia.post('/api/summons', { userId: coach.user.id })).body;
    t.db.update(summons).set({ createdAt: Date.now() - 2 * HOUR - 1000 }).where(eq(summons.id, s.id)).run();
    expect((await coach.get('/api/summons/incoming')).body.items).toEqual([]);
    expect((await coach.get('/api/chat/unread')).body.summons).toEqual([]);
    const late = await coach.post(`/api/summons/${s.id}/answer`, { status: 'on_my_way' });
    expect(late.status).toBe(409);
    expect(late.body.error.details.summons.status).toBe('expired');
    expect((await dalia.post(`/api/summons/${s.id}/cancel`)).status).toBe(409);
    expect((await dalia.get('/api/summons/sent?status=expired')).body.items.map((x: any) => x.id)).toEqual([s.id]);
    expect((await dalia.post('/api/summons', { userId: coach.user.id })).status).toBe(201);
  });

  it('push: the summons wakes the person’s phone (high urgency, 2 h), the answer goes to the caller', async () => {
    const vapid = await generateVapidKeys();
    const push = pushRecorder();
    const t = await makeTestContext({ config: { vapid }, outboundFetch: push.fetch });
    const dalia = await t.as('executive_director', { name: 'Dalia' });
    const tarek = await t.as('casting_team', { name: 'Tarek' });
    const tareksPhone = await fakeBrowser('https://web.push.apple.com/QGrZ-tarek');
    const daliasPhone = await fakeBrowser();
    await tarek.post('/api/push/subscribe', tareksPhone.subscription);
    await dalia.post('/api/push/subscribe', daliasPhone.subscription);

    const s = (await dalia.post('/api/summons', { userId: tarek.user.id })).body;
    await t.settle();
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.url).toBe(tareksPhone.endpoint);
    expect(push.sent[0]!.headers).toMatchObject({ urgency: 'high', ttl: '7200', topic: `summons-${s.id}` });
    expect(await tareksPhone.decrypt(push.sent[0]!.body)).toEqual({
      title: 'Dalia is calling you to the office',
      body: 'Please come to the office.',
      link: `/team?summons=${s.id}&from=${dalia.user.id}`,
      kind: 'summon',
      tag: `summons-${s.id}`,
    });
    const claims = JSON.parse(Buffer.from(push.sent[0]!.headers.authorization!.split(' ')[1]!.slice(2).split('.')[1]!, 'base64url').toString());
    expect(claims).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'https://turquoisestudio.app' });

    await tarek.post(`/api/summons/${s.id}/answer`, { status: 'on_my_way' });
    await t.settle();
    expect(push.sent).toHaveLength(2);
    expect(push.sent[1]!.url).toBe(daliasPhone.endpoint);
    expect(await daliasPhone.decrypt(push.sent[1]!.body)).toMatchObject({ title: 'Tarek: On my way', kind: 'summon_answer' });
  });
});

describe('notifications', () => {
  it('lists mine, newest first; marks some (others’ ids ignored) or all read', async () => {
    const t = await makeTestContext();
    const dalia = await t.as('executive_director');
    const a = await t.as('acting_coach');
    const b = await t.as('casting_team');
    await dalia.post('/api/summons', { userId: a.user.id });
    await dalia.post('/api/summons', { userId: b.user.id });
    const conv = (await dalia.post('/api/chat/conversations', { userId: a.user.id })).body.id;
    await dalia.post(`/api/chat/conversations/${conv}/messages`, { body: 'Also: hello' });

    const mine = (await a.get('/api/notifications')).body;
    expect(mine.unread).toBe(2);
    expect(mine.items.map((n: any) => n.kind)).toEqual(['message', 'summon']);
    const theirs = (await b.get('/api/notifications')).body.items[0].id;

    const res = await a.post('/api/notifications/read', { ids: [mine.items[1].id, theirs] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unread: 1 });
    expect((await b.get('/api/notifications')).body.unread).toBe(1);
    expect((await a.post('/api/notifications/read', { all: true })).body).toEqual({ unread: 0 });
    expect((await a.get('/api/notifications')).body.items.every((n: any) => typeof n.readAt === 'number')).toBe(true);

    expect((await a.post('/api/notifications/read', {})).status).toBe(400);
    expect((await a.post('/api/notifications/read', { all: false })).status).toBe(400);
    expect((await a.post('/api/notifications/read', { ids: [] })).status).toBe(400);
    expect((await t.anon.get('/api/notifications')).status).toBe(401);
    expect(t.db.select().from(notifications).all()).toHaveLength(3);
  });
});

describe('push subscriptions', () => {
  it('off without VAPID keys: config says so, subscribing is a 409', async () => {
    const t = await makeTestContext();
    const me = await t.as('acting_coach');
    expect((await me.get('/api/push/config')).body).toEqual({ publicKey: null, devices: 0, thisDevice: false });
    const res = await me.post('/api/push/subscribe', (await fakeBrowser()).subscription);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('push_off');
    expect((await me.post('/api/push/test')).status).toBe(409);
  });

  it('subscribe (201), the same phone again or under another account moves it, unsubscribe (204, own only)', async () => {
    const vapid = await generateVapidKeys();
    const t = await makeTestContext({ config: { vapid } });
    const a = await t.as('acting_coach');
    const b = await t.as('casting_team');
    expect((await a.get('/api/push/config')).body).toEqual({ publicKey: vapid.publicKey, devices: 0, thisDevice: false });
    const phone = await fakeBrowser();
    const res = await a.post('/api/push/subscribe', phone.subscription);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ devices: 1 });
    expect((await a.post('/api/push/subscribe', phone.subscription)).body).toEqual({ devices: 1 });
    // Signed in as someone else on the same phone: it's theirs now.
    expect((await b.post('/api/push/subscribe', phone.subscription)).body).toEqual({ devices: 1 });
    expect((await a.get('/api/push/config')).body.devices).toBe(0);
    const stored = t.db.select().from(pushSubscriptions).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: b.user.id, endpoint: phone.endpoint });

    expect((await a.delete(`/api/push/subscribe?endpoint=${encodeURIComponent(phone.endpoint)}`)).status).toBe(204);
    expect(t.db.select().from(pushSubscriptions).all()).toHaveLength(1);
    expect((await b.delete(`/api/push/subscribe?endpoint=${encodeURIComponent(phone.endpoint)}`)).status).toBe(204);
    expect(t.db.select().from(pushSubscriptions).all()).toHaveLength(0);
    expect((await t.anon.post('/api/push/subscribe', phone.subscription)).status).toBe(401);
  });

  it('refuses endpoints that aren’t push services, and bad keys (400)', async () => {
    const vapid = await generateVapidKeys();
    const t = await makeTestContext({ config: { vapid } });
    const me = await t.as('acting_coach');
    const good = (await fakeBrowser()).subscription;
    const cases = [
      { ...good, endpoint: 'https://internal.example/hook' },
      { ...good, endpoint: 'http://fcm.googleapis.com/fcm/send/x' },
      { ...good, keys: { ...good.keys, auth: good.keys.auth.slice(0, 20) } },
      { ...good, keys: { ...good.keys, p256dh: 'A'.repeat(87) } },
      { endpoint: good.endpoint },
    ];
    for (const body of cases) expect((await me.post('/api/push/subscribe', body)).status, JSON.stringify(body)).toBe(400);
  });

  it('a phone that’s gone (404/410) is removed; other failures are counted and drop it after 10; a success resets the count', async () => {
    const vapid = await generateVapidKeys();
    const gone = await fakeBrowser('https://fcm.googleapis.com/fcm/send/gone');
    const flaky = await fakeBrowser('https://fcm.googleapis.com/fcm/send/flaky');
    let flakyStatus = 500;
    const push = pushRecorder((url) => (url === gone.endpoint ? 410 : flakyStatus));
    const t = await makeTestContext({ config: { vapid }, outboundFetch: push.fetch });
    const me = await t.as('acting_coach');
    await me.post('/api/push/subscribe', gone.subscription);
    await me.post('/api/push/subscribe', flaky.subscription);

    expect((await me.post('/api/push/test')).status).toBe(202);
    await t.settle();
    const left = t.db.select().from(pushSubscriptions).all();
    expect(left.map((s) => [s.endpoint, s.failures])).toEqual([[flaky.endpoint, 1]]);

    flakyStatus = 201;
    await me.post('/api/push/test');
    await t.settle();
    expect(t.db.select().from(pushSubscriptions).get()).toMatchObject({ failures: 0 });
    expect(typeof t.db.select().from(pushSubscriptions).get()!.lastSuccessAt).toBe('number');
    expect(await flaky.decrypt(push.sent.at(-1)!.body)).toMatchObject({ kind: 'test', link: '/profile' });

    flakyStatus = 503;
    t.db.update(pushSubscriptions).set({ failures: MAX_PUSH_FAILURES - 1 }).run();
    await me.post('/api/push/test');
    await t.settle();
    expect(t.db.select().from(pushSubscriptions).all()).toEqual([]);
  });

  it('a network failure doesn’t fail the request; test notifications are limited to 5 an hour', async () => {
    const vapid = await generateVapidKeys();
    const t = await makeTestContext({
      config: { vapid },
      outboundFetch: (async () => {
        throw new Error('offline');
      }) as typeof fetch,
    });
    const me = await t.as('acting_coach');
    await me.post('/api/push/subscribe', (await fakeBrowser()).subscription);
    for (let i = 0; i < 5; i++) expect((await me.post('/api/push/test')).status).toBe(202);
    await t.settle();
    expect(t.db.select().from(pushSubscriptions).get()!.failures).toBe(5);
    const over = await me.post('/api/push/test');
    expect(over.status).toBe(429);
  });

});

/**
 * A push subscription belongs to the sign-in that turned it on (G-SEC-1): a
 * phone or shared computer that signs out — or is signed out everywhere by a
 * password reset or deactivation — stops getting that person's message
 * previews and calls to the office.
 */
describe('push subscriptions end with the sign-in', () => {
  async function setup() {
    const vapid = await generateVapidKeys();
    const push = pushRecorder();
    const t = await makeTestContext({ config: { vapid }, outboundFetch: push.fetch });
    const dalia = await t.as('executive_director', { name: 'Dalia' });
    /** Dalia messages `to` and calls them to the office; resolves to the endpoints that got a push. */
    const pingFrom = async (from: typeof dalia, toUserId: number) => {
      const before = push.sent.length;
      const conv = (await from.post('/api/chat/conversations', { userId: toUserId })).body.id;
      expect((await from.post(`/api/chat/conversations/${conv}/messages`, { body: 'Private: your new password is on my desk' })).status).toBe(201);
      const called = await from.post('/api/summons', { userId: toUserId, note: 'Come and get your new password' });
      expect(called.status).toBe(201);
      await t.settle();
      const urls = push.sent.slice(before).map((p) => p.url);
      // One pending call per pair: cancel it so the next ping can call again.
      expect((await from.post(`/api/summons/${called.body.id}/cancel`)).status).toBe(200);
      await t.settle();
      expect(push.sent.length).toBe(before + urls.length);
      return urls;
    };
    return { t, push, dalia, pingFrom };
  }
  const config = (client: { get: (u: string) => Promise<{ body: any }> }, endpoint: string) =>
    client.get(`/api/push/config?endpoint=${encodeURIComponent(endpoint)}`).then((r) => r.body);

  it('signing out stops the pushes to that browser; config says whether this browser is on for me', async () => {
    const { t, dalia, pingFrom } = await setup();
    const ceo = await t.as('ceo', { name: 'Sherif' });
    const laptop = await fakeBrowser();
    expect(await config(ceo, laptop.endpoint)).toMatchObject({ devices: 0, thisDevice: false });
    expect((await ceo.post('/api/push/subscribe', laptop.subscription)).status).toBe(201);
    expect(await config(ceo, laptop.endpoint)).toMatchObject({ devices: 1, thisDevice: true });
    expect(await config(ceo, 'https://fcm.googleapis.com/fcm/send/other')).toMatchObject({ devices: 1, thisDevice: false });
    expect(await pingFrom(dalia, ceo.user.id)).toEqual([laptop.endpoint, laptop.endpoint]);

    expect((await ceo.post('/api/auth/logout')).status).toBe(200);
    expect((await ceo.get('/api/auth/me')).body.user).toBeNull();
    expect(t.db.select().from(pushSubscriptions).all()).toEqual([]);
    expect(await pingFrom(dalia, ceo.user.id)).toEqual([]);

    // Signing in again on the same browser doesn't quietly turn it back on: Profile offers "Turn on".
    const again = await t.login(ceo.user.email);
    expect(await config(again, laptop.endpoint)).toMatchObject({ devices: 0, thisDevice: false });
  });

  it('a password reset by a manager stops a lost phone’s pushes; resetting your own keeps only this device', async () => {
    const { t, dalia, pingFrom } = await setup();
    const coach = await t.as('acting_coach', { name: 'Layla' });
    const lostPhone = await fakeBrowser('https://web.push.apple.com/lost-phone');
    await coach.post('/api/push/subscribe', lostPhone.subscription);
    expect(await pingFrom(dalia, coach.user.id)).toHaveLength(2);

    expect((await dalia.patch(`/api/staff/${coach.user.id}`, { password: 'a-brand-new-one' })).status).toBe(200);
    expect((await coach.get('/api/auth/me')).body.user).toBeNull();
    expect(await pingFrom(dalia, coach.user.id)).toEqual([]);
    expect(t.db.select().from(pushSubscriptions).all()).toEqual([]);

    // Changing your own password signs out (and silences) your other devices, not this one.
    const tablet = await t.login(coach.user.email, 'a-brand-new-one');
    const phone = await t.login(coach.user.email, 'a-brand-new-one');
    const tabletBrowser = await fakeBrowser();
    const phoneBrowser = await fakeBrowser();
    await tablet.post('/api/push/subscribe', tabletBrowser.subscription);
    await phone.post('/api/push/subscribe', phoneBrowser.subscription);
    expect((await phone.post('/api/auth/password', { currentPassword: 'a-brand-new-one', newPassword: 'another-new-one' })).status).toBe(200);
    expect(await pingFrom(dalia, coach.user.id)).toEqual([phoneBrowser.endpoint, phoneBrowser.endpoint]);
    expect(t.db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).all()).toEqual([{ endpoint: phoneBrowser.endpoint }]);
  });

  it('deactivating someone removes their subscriptions; reactivating doesn’t bring them back', async () => {
    const { t, dalia } = await setup();
    const coach = await t.as('acting_coach');
    await coach.post('/api/push/subscribe', (await fakeBrowser()).subscription);
    expect((await dalia.patch(`/api/staff/${coach.user.id}`, { active: false })).status).toBe(200);
    expect(t.db.select().from(pushSubscriptions).all()).toEqual([]);
    expect((await dalia.patch(`/api/staff/${coach.user.id}`, { active: true })).status).toBe(200);
    expect(t.db.select().from(pushSubscriptions).all()).toEqual([]);
  });

  it('a shared browser: after the next person signs in and turns it on, pushes go only to them', async () => {
    const { t, dalia, pingFrom } = await setup();
    const a = await t.as('acting_coach', { name: 'Layla' });
    const b = await t.as('casting_team', { name: 'Tarek' });
    const officePc = await fakeBrowser();
    await a.post('/api/push/subscribe', officePc.subscription);
    // A closes the tab without signing out; B signs in on the same computer and turns notifications on.
    expect(await config(b, officePc.endpoint)).toMatchObject({ thisDevice: false });
    await b.post('/api/push/subscribe', officePc.subscription);
    expect(await config(b, officePc.endpoint)).toMatchObject({ thisDevice: true });
    expect(await config(a, officePc.endpoint)).toMatchObject({ devices: 0, thisDevice: false });
    expect(await pingFrom(dalia, a.user.id)).toEqual([]);
    expect(await pingFrom(dalia, b.user.id)).toEqual([officePc.endpoint, officePc.endpoint]);
  });

  it('a subscription whose session expired, or one from before sessions were recorded, gets nothing', async () => {
    const { t, dalia, pingFrom } = await setup();
    const coach = await t.as('acting_coach');
    const phone = await fakeBrowser();
    await coach.post('/api/push/subscribe', phone.subscription);
    t.db.update(authSessions).set({ expiresAt: Date.now() - 1000 }).where(eq(authSessions.userId, coach.user.id)).run();
    expect(await pingFrom(dalia, coach.user.id)).toEqual([]);

    const fresh = await t.login(coach.user.email);
    await fresh.post('/api/push/subscribe', phone.subscription);
    expect(await pingFrom(dalia, coach.user.id)).toHaveLength(2);
    t.db.update(pushSubscriptions).set({ sessionId: null }).run();
    expect(await pingFrom(dalia, coach.user.id)).toEqual([]);
  });
});
