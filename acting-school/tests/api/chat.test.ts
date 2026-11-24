import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { files, messages, notifications, rateLimits } from '../../src/server/db/schema';
import { generateVapidKeys } from '../../src/server/lib/push/keys';
import { makeTestContext, PDF_BYTES, uploadBytes, uploadPng, type Client } from '../helpers';
import { fakeBrowser, pushRecorder } from '../pushHelpers';

/**
 * Part G2–G3: the Team directory and the internal chat. Everyone can message
 * everyone (owners too, as name and photo); a conversation is its two
 * members' only.
 */

const MINUTE = 60_000;

async function open(from: Client, toUserId: number): Promise<number> {
  const res = await from.post('/api/chat/conversations', { userId: toUserId });
  expect([200, 201]).toContain(res.status);
  return res.body.id;
}

describe('GET /api/team', () => {
  it('lists active staff for everyone; non-owners see owners as name and photo, without positions', async () => {
    const t = await makeTestContext();
    const coach = await t.as('acting_coach', { name: 'Layla' });
    const ceo = await t.createUser('ceo', { name: 'Karim' });
    await t.createUser(['cfo', 'acting_coach'], { name: 'Hisham' });
    await t.createUser('casting_team', { name: 'Tarek' });
    await t.createUser('casting_team', { name: 'Gone', active: false });
    const photo = await uploadPng(coach);
    await coach.put('/api/auth/photo', { fileId: photo });

    const res = await coach.get('/api/team');
    expect(res.status).toBe(200);
    expect(res.body.items.map((m: any) => m.name)).toEqual(['Hisham', 'Karim', 'Layla', 'Tarek']);
    const byName = Object.fromEntries(res.body.items.map((m: any) => [m.name, m]));
    expect(Object.keys(byName.Karim).sort()).toEqual(['active', 'id', 'isMe', 'lastSummons', 'name', 'photoFileId', 'positions']);
    expect(byName.Karim).toMatchObject({ id: ceo.id, positions: [], isMe: false, lastSummons: null });
    expect(byName.Hisham.positions).toEqual([]);
    expect(byName.Tarek.positions.map((p: any) => p.key)).toEqual(['casting_team']);
    expect(byName.Layla).toMatchObject({ isMe: true, photoFileId: photo });
    expect(JSON.stringify(res.body)).not.toContain('isOwner":true');

    const owner = await t.as('owner', { name: 'Zed' });
    const asOwner = await owner.get('/api/team');
    expect(asOwner.body.items.find((m: any) => m.name === 'Hisham').positions.map((p: any) => p.key).sort()).toEqual(['acting_coach', 'cfo']);
    expect((await t.anon.get('/api/team')).status).toBe(401);
  });
});

describe('chat: conversations', () => {
  it('opens one direct chat per pair (201, then 200 from either side); outsiders get a 404 — owners included', async () => {
    const t = await makeTestContext();
    const layla = await t.as('acting_coach', { name: 'Layla' });
    const tarek = await t.as('casting_team', { name: 'Tarek' });
    const created = await layla.post('/api/chat/conversations', { userId: tarek.user.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ other: { id: tarek.user.id, name: 'Tarek', photoFileId: null, active: true }, myLastReadMessageId: null, otherLastReadMessageId: null });
    const again = await tarek.post('/api/chat/conversations', { userId: layla.user.id });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(created.body.id);
    expect(again.body.other.name).toBe('Layla');

    const id = created.body.id;
    await layla.post(`/api/chat/conversations/${id}/messages`, { body: 'Hi Tarek' });
    for (const outsider of [await t.as('executive_director'), await t.as('owner')]) {
      expect((await outsider.get(`/api/chat/conversations/${id}`)).status).toBe(404);
      expect((await outsider.get(`/api/chat/conversations/${id}/messages`)).status).toBe(404);
      expect((await outsider.post(`/api/chat/conversations/${id}/messages`, { body: 'sneaky' })).status).toBe(404);
      expect((await outsider.post(`/api/chat/conversations/${id}/read`, { messageId: 1 })).status).toBe(404);
      expect((await outsider.get('/api/chat/conversations')).body.items).toEqual([]);
      const msgId = t.db.select().from(messages).get()!.id;
      expect((await outsider.delete(`/api/chat/messages/${msgId}`)).status).toBe(404);
    }
    expect((await t.anon.get('/api/chat/conversations')).status).toBe(401);
  });

  it('a non-owner can message an owner; nobody messages themselves or an inactive or missing account', async () => {
    const t = await makeTestContext();
    const coach = await t.as('acting_coach');
    const ceo = await t.as('ceo', { name: 'Karim' });
    const id = await open(coach, ceo.user.id);
    expect((await coach.post(`/api/chat/conversations/${id}/messages`, { body: 'Good morning' })).status).toBe(201);
    expect((await ceo.get('/api/chat/conversations')).body.items[0]).toMatchObject({ id, unread: 1, other: { id: coach.user.id } });

    const self = await coach.post('/api/chat/conversations', { userId: coach.user.id });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('cannot_message_self');
    const gone = await t.createUser('casting_team', { active: false });
    expect((await coach.post('/api/chat/conversations', { userId: gone.id })).status).toBe(404);
    expect((await coach.post('/api/chat/conversations', { userId: 9999 })).status).toBe(404);
    expect((await coach.post('/api/chat/conversations', {})).status).toBe(400);
  });

  it('after the other person is deactivated the history stays readable but nothing new can be sent (409)', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const coach = await t.as('acting_coach');
    const id = await open(owner, coach.user.id);
    await owner.post(`/api/chat/conversations/${id}/messages`, { body: 'Bye' });
    await owner.patch(`/api/staff/${coach.user.id}`, { active: false });
    expect((await owner.get(`/api/chat/conversations/${id}/messages`)).body.items).toHaveLength(1);
    const res = await owner.post(`/api/chat/conversations/${id}/messages`, { body: 'Hello?' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('recipient_inactive');
  });

  it('the list: newest first, the other person, a preview and unread counts; empty conversations aren’t listed', async () => {
    const t = await makeTestContext();
    const me = await t.as('executive_director');
    const a = await t.as('acting_coach', { name: 'A' });
    const b = await t.as('casting_team', { name: 'B' });
    const c = await t.as('video_editor', { name: 'C' });
    const withA = await open(a, me.user.id);
    const withB = await open(b, me.user.id);
    await open(c, me.user.id);
    await a.post(`/api/chat/conversations/${withA}/messages`, { body: 'x'.repeat(150) });
    await a.post(`/api/chat/conversations/${withA}/messages`, { body: 'second' });
    await b.post(`/api/chat/conversations/${withB}/messages`, { fileIds: [await uploadPng(b), await uploadPng(b)] });

    const list = (await me.get('/api/chat/conversations')).body.items;
    expect(list.map((x: any) => x.other.name)).toEqual(['B', 'A']);
    expect(list[0]).toMatchObject({ unread: 1, lastMessage: { text: null, photos: 2, documents: 0, mine: false, deleted: false } });
    expect(list[1]).toMatchObject({ unread: 2, lastMessage: { text: 'second' } });

    const unread = await me.get('/api/chat/unread');
    expect(unread.body).toMatchObject({ total: 3, notifications: 2, summons: [] });

    // Reading moves forward only; reading the newest clears the count and the conversation's notification.
    const msgs = (await me.get(`/api/chat/conversations/${withA}/messages`)).body.items;
    expect((await me.post(`/api/chat/conversations/${withA}/read`, { messageId: msgs[1].id })).status).toBe(204);
    await me.post(`/api/chat/conversations/${withA}/read`, { messageId: msgs[0].id });
    expect((await me.get('/api/chat/unread')).body).toMatchObject({ total: 1, notifications: 1 });
    expect((await a.get(`/api/chat/conversations/${withA}/messages`)).body.otherLastReadMessageId).toBe(msgs[1].id);
    expect((await me.post(`/api/chat/conversations/${withA}/read`, { messageId: 999999 })).status).toBe(400);
  });
});

describe('chat: messages', () => {
  it('sends text and attachments (photos inline, documents with their name); paging before/after', async () => {
    const t = await makeTestContext();
    const layla = await t.as('acting_coach');
    const dalia = await t.as('executive_director');
    const id = await open(layla, dalia.user.id);
    const photo = await uploadPng(layla);
    const pdf = (await uploadBytes(layla, PDF_BYTES, 'monologue.pdf')).body.id;
    const sent = await layla.post(`/api/chat/conversations/${id}/messages`, { body: '  Here are the pages  ', fileIds: [photo, pdf] });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({
      conversationId: id,
      senderId: layla.user.id,
      mine: true,
      body: 'Here are the pages',
      deleted: false,
      canDelete: true,
      attachments: [
        { fileId: photo, kind: 'photo', mime: 'image/png' },
        { fileId: pdf, kind: 'document', name: 'monologue.pdf', mime: 'application/pdf' },
      ],
    });
    // The other member can open the files; they were "handed" to them by the conversation.
    expect((await dalia.raw(`/api/files/${pdf}`, { headers: { cookie: dalia.cookie! } })).status).toBe(200);

    for (let i = 1; i <= 5; i++) await dalia.post(`/api/chat/conversations/${id}/messages`, { body: `reply ${i}` });
    const page = await layla.get(`/api/chat/conversations/${id}/messages?limit=3`);
    expect(page.body.items.map((m: any) => m.body)).toEqual(['reply 3', 'reply 4', 'reply 5']);
    expect(page.body.hasMore).toBe(true);
    expect(page.body.items[0].mine).toBe(false);
    const older = await layla.get(`/api/chat/conversations/${id}/messages?before=${page.body.items[0].id}&limit=10`);
    expect(older.body.items.map((m: any) => m.body)).toEqual(['Here are the pages', 'reply 1', 'reply 2']);
    expect(older.body.hasMore).toBe(false);
    const newer = await layla.get(`/api/chat/conversations/${id}/messages?after=${older.body.items[1].id}&limit=2`);
    expect(newer.body.items.map((m: any) => m.body)).toEqual(['reply 2', 'reply 3']);
    expect(newer.body.hasMore).toBe(true);
    expect((await layla.get(`/api/chat/conversations/${id}/messages?after=1&before=9`)).status).toBe(400);
  });

  it('validates: text or attachments, ≤ 4000 characters, ≤ 5 attachments', async () => {
    const t = await makeTestContext();
    const a = await t.as('acting_coach');
    const b = await t.as('casting_team');
    const id = await open(a, b.user.id);
    expect((await a.post(`/api/chat/conversations/${id}/messages`, {})).status).toBe(400);
    expect((await a.post(`/api/chat/conversations/${id}/messages`, { body: '   ' })).status).toBe(400);
    expect((await a.post(`/api/chat/conversations/${id}/messages`, { body: 'x'.repeat(4001) })).status).toBe(400);
    expect((await a.post(`/api/chat/conversations/${id}/messages`, { body: 'x'.repeat(4000) })).status).toBe(201);
    const six = await Promise.all(Array.from({ length: 6 }, () => uploadPng(a)));
    expect((await a.post(`/api/chat/conversations/${id}/messages`, { fileIds: six })).status).toBe(400);
  });

  it('attachments are only your own uploads from the last hour that aren’t used anywhere', async () => {
    const t = await makeTestContext();
    const a = await t.as('acting_coach');
    const b = await t.as('casting_team');
    const id = await open(a, b.user.id);
    const theirs = await uploadPng(b);
    const old = await uploadPng(a);
    t.db.update(files).set({ createdAt: Date.now() - 61 * MINUTE }).where(eq(files.id, old)).run();
    const once = await uploadPng(a);
    expect((await a.post(`/api/chat/conversations/${id}/messages`, { fileIds: [once] })).status).toBe(201);
    const fresh = await uploadPng(a);
    for (const fileIds of [[theirs], [old], [once], [fresh, fresh], ['00000000-0000-4000-8000-000000000000']]) {
      const res = await a.post(`/api/chat/conversations/${id}/messages`, { fileIds });
      expect(res.status, JSON.stringify(fileIds)).toBe(400);
      expect(res.body.error.issues[0]).toMatchObject({ path: ['fileIds'], message: 'team:errors.fileInvalid' });
    }
    // Nothing half-sent.
    expect((await a.get(`/api/chat/conversations/${id}/messages`)).body.items).toHaveLength(1);
  });

  it('the sender deletes within 15 minutes: shows as deleted, files freed; others can’t, and later it’s a 409', async () => {
    const t = await makeTestContext();
    const a = await t.as('acting_coach');
    const b = await t.as('casting_team');
    const id = await open(a, b.user.id);
    const photo = await uploadPng(a);
    const msg = (await a.post(`/api/chat/conversations/${id}/messages`, { body: 'oops', fileIds: [photo] })).body;
    expect((await b.delete(`/api/chat/messages/${msg.id}`)).status).toBe(403);
    expect((await a.delete(`/api/chat/messages/${msg.id}`)).status).toBe(204);
    expect((await a.delete(`/api/chat/messages/${msg.id}`)).status).toBe(204);
    const seen = (await b.get(`/api/chat/conversations/${id}/messages`)).body.items[0];
    expect(seen).toMatchObject({ id: msg.id, deleted: true, body: null, attachments: [], canDelete: false });
    expect(t.db.select().from(files).where(eq(files.id, photo)).get()).toBeUndefined();
    // The notification no longer shows the text.
    const note = t.db.select().from(notifications).where(eq(notifications.userId, b.user.id)).get()!;
    expect(note.body).toBe('This message was deleted');
    expect((await b.get('/api/chat/conversations')).body.items[0].lastMessage).toMatchObject({ deleted: true, text: null });

    const late = (await a.post(`/api/chat/conversations/${id}/messages`, { body: 'too late' })).body;
    t.db.update(messages).set({ createdAt: Date.now() - 16 * MINUTE }).where(eq(messages.id, late.id)).run();
    expect((await a.get(`/api/chat/conversations/${id}/messages`)).body.items[1].canDelete).toBe(false);
    const res = await a.delete(`/api/chat/messages/${late.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('delete_window_over');
    expect((await a.delete('/api/chat/messages/999999')).status).toBe(404);
  });

  it('rate limit: 60 messages a minute per person (429)', async () => {
    const t = await makeTestContext();
    const a = await t.as('acting_coach');
    const b = await t.as('casting_team');
    const id = await open(a, b.user.id);
    for (let i = 0; i < 59; i++) expect((await a.post(`/api/chat/conversations/${id}/messages`, { body: `m${i}` })).status).toBe(201);
    expect((await a.post(`/api/chat/conversations/${id}/messages`, { body: 'sixtieth' })).status).toBe(201);
    const over = await a.post(`/api/chat/conversations/${id}/messages`, { body: 'one too many' });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('too_many_messages');
    // The other person isn't affected; a minute later it works again.
    expect((await b.post(`/api/chat/conversations/${id}/messages`, { body: 'fine' })).status).toBe(201);
    t.db.update(rateLimits).set({ windowStart: Date.now() - 61_000 }).run();
    expect((await a.post(`/api/chat/conversations/${id}/messages`, { body: 'again' })).status).toBe(201);
  });

  it('one notification per conversation, updated; in the recipient’s language; pushed to their phone, not the sender’s', async () => {
    const vapid = await generateVapidKeys();
    const push = pushRecorder();
    const t = await makeTestContext({ config: { vapid }, outboundFetch: push.fetch });
    const dalia = await t.as('executive_director', { name: 'Dalia' });
    const sherif = await t.as('head_of_casting', { name: 'Sherif', locale: 'ar' });
    const phone = await fakeBrowser();
    const daliasPhone = await fakeBrowser();
    expect((await sherif.post('/api/push/subscribe', phone.subscription)).status).toBe(201);
    expect((await dalia.post('/api/push/subscribe', daliasPhone.subscription)).status).toBe(201);

    const id = await open(dalia, sherif.user.id);
    await dalia.post(`/api/chat/conversations/${id}/messages`, { body: 'Are the photos ready?' });
    await dalia.post(`/api/chat/conversations/${id}/messages`, { body: `${'ب'.repeat(120)}` });
    await t.settle();

    const notes = (await sherif.get('/api/notifications')).body;
    expect(notes.unread).toBe(1);
    expect(notes.items).toHaveLength(1);
    expect(notes.items[0]).toMatchObject({ kind: 'message', title: 'رسالة جديدة من Dalia', link: `/messages/${id}`, readAt: null });
    expect([...notes.items[0].body].length).toBe(100);
    expect((await dalia.get('/api/notifications')).body.items).toEqual([]);

    expect(push.sent.map((p) => p.url)).toEqual([phone.endpoint, phone.endpoint]);
    for (const p of push.sent) {
      expect(p.headers).toMatchObject({ 'content-encoding': 'aes128gcm', ttl: '86400', urgency: 'normal', topic: `conversation-${id}` });
      expect(p.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    }
    // The two pushes go out in the background, in either order.
    const payloads = await Promise.all(push.sent.map((p) => phone.decrypt(p.body)));
    for (const payload of payloads) {
      expect(payload).toMatchObject({ title: 'رسالة جديدة من Dalia', link: `/messages/${id}`, kind: 'message', tag: `conversation-${id}` });
    }
    expect(payloads.map((p) => [...p.body].length).sort((a, b) => a - b)).toEqual([21, 100]);

    // Opening the conversation marks it read.
    const msgs = (await sherif.get(`/api/chat/conversations/${id}/messages`)).body.items;
    await sherif.post(`/api/chat/conversations/${id}/read`, { messageId: msgs.at(-1).id });
    expect((await sherif.get('/api/notifications')).body.unread).toBe(0);
  });

  it('push is off without VAPID keys: nothing is sent, the bell still works', async () => {
    const push = pushRecorder();
    const t = await makeTestContext({ outboundFetch: push.fetch });
    const a = await t.as('acting_coach');
    const b = await t.as('casting_team');
    const id = await open(a, b.user.id);
    await a.post(`/api/chat/conversations/${id}/messages`, { body: 'hello' });
    await t.settle();
    expect(push.sent).toEqual([]);
    expect((await b.get('/api/notifications')).body.unread).toBe(1);
  });

  it('replying counts as having seen the chat: the bell’s “New message from …” is read, crossed messages included', async () => {
    const t = await makeTestContext();
    const dalia = await t.as('executive_director');
    const layla = await t.as('acting_coach', { name: 'Layla' });
    const id = await open(dalia, layla.user.id);
    await dalia.post(`/api/chat/conversations/${id}/messages`, { body: 'Can you come?' });
    // Layla answers; Dalia types her next message at the same moment, without opening the new one first.
    await layla.post(`/api/chat/conversations/${id}/messages`, { body: 'On my way' });
    expect((await dalia.get('/api/chat/unread')).body).toMatchObject({ total: 1, notifications: 1 });
    await dalia.post(`/api/chat/conversations/${id}/messages`, { body: 'Thanks!' });
    expect((await dalia.get('/api/chat/unread')).body).toMatchObject({ total: 0, notifications: 0 });
    expect((await dalia.get('/api/notifications')).body.items.every((n: any) => n.readAt !== null)).toBe(true);
    // Layla's own bell still has Dalia's latest.
    expect((await layla.get('/api/chat/unread')).body).toMatchObject({ total: 1, notifications: 1 });
    // The open chat's poll from before Dalia's reply still brings Layla's message.
    const page = (await dalia.get(`/api/chat/conversations/${id}/messages?after=1`)).body.items;
    expect(page.map((m: any) => m.text ?? m.body)).toEqual(['On my way', 'Thanks!']);
  });
});
