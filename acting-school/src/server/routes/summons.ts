import { and, count, desc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { SUMMONS_EXPIRY_MS } from '../../shared/enums';
import type { ListResponse } from '../../shared/schemas/common';
import {
  SUMMONS_ERROR_CODES,
  SUMMONS_PER_HOUR,
  SUMMONS_SENT_WINDOW_MS,
  summonsAnswerInput,
  summonsInput,
  summonsSentQuery,
  type SummonsView,
} from '../../shared/schemas/summons';
import type { DB } from '../db/database';
import { summons } from '../db/schema';
import type { AppEnv } from '../env';
import { ApiError, notFound } from '../lib/errors';
import { answerTitle, localeOf, markNotificationsRead, notificationText, notify, summonsInboxLink, summonsLink } from '../lib/notifications';
import { queuePush } from '../lib/push';
import { HOUR_MS } from '../lib/rateLimit';
import { incomingSummons, isExpired, toSummonsViews } from '../lib/summons';
import { findActivePerson } from '../lib/team';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * "Call to the office" (G4). Calling someone needs staff.summon (the CEO, CFO
 * and Executive Directors as built in) and never targets yourself; the person
 * called answers "On my way" or "Can't come now", the caller can cancel. One
 * pending summons per caller and person at a time; a pending one older than
 * two hours counts as expired (can't be answered or cancelled, and doesn't
 * block a new one); at most 20 an hour per caller. Each step writes an in-app
 * notification and pushes to the other person's phone after the transaction.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const view = (db: Pick<DB, 'select'>, row: typeof summons.$inferSelect, now: number): SummonsView => toSummonsViews(db, [row], now)[0]!;

const notPending = (v: SummonsView) => new ApiError(409, SUMMONS_ERROR_CODES.notPending, 'This call is no longer waiting for an answer', undefined, { summons: v });

/** Push options for a summons: wake the phone now; useless after the two hours. */
const SUMMONS_PUSH = { ttl: SUMMONS_EXPIRY_MS / 1000, urgency: 'high' } as const;

router.post('/', requirePermission('staff.summon'), async (c) => {
  const input = await body(c, summonsInput);
  const me = currentUser(c);
  if (input.userId === me.id) {
    throw new ApiError(400, SUMMONS_ERROR_CODES.cannotSummonSelf, 'You can’t call yourself to the office', [{ path: ['userId'], code: 'custom', message: 'team:errors.cannotSummonSelf' }]);
  }
  const db = c.get('db');
  const target = findActivePerson(db, input.userId);
  if (!target) throw notFound('Staff member not found');
  const now = Date.now();
  const created = db.transaction((tx) => {
    const pending = tx
      .select()
      .from(summons)
      .where(and(eq(summons.fromUserId, me.id), eq(summons.toUserId, target.id), eq(summons.status, 'pending'), gt(summons.createdAt, now - SUMMONS_EXPIRY_MS)))
      .get();
    if (pending) {
      throw new ApiError(409, SUMMONS_ERROR_CODES.alreadyPending, 'You already called this person; wait for their answer', undefined, { summons: view(tx, pending, now) });
    }
    const lastHour = tx
      .select({ n: count() })
      .from(summons)
      .where(and(eq(summons.fromUserId, me.id), gt(summons.createdAt, now - HOUR_MS)))
      .get()?.n ?? 0;
    if (lastHour >= SUMMONS_PER_HOUR) throw new ApiError(429, SUMMONS_ERROR_CODES.tooManySummons, 'Too many calls to the office this hour');
    const row = tx.insert(summons).values({ fromUserId: me.id, toUserId: target.id, note: input.note ?? null, status: 'pending', createdAt: now }).returning().get();
    notify(
      tx,
      {
        userId: target.id,
        kind: 'summon',
        title: notificationText(target.locale, 'summonTitle', { name: me.name }),
        body: row.note ?? notificationText(target.locale, 'summonBody'),
        link: summonsInboxLink(row.id, me.id),
      },
      now,
    );
    return row;
  });
  queuePush(
    c,
    [target.id],
    {
      title: notificationText(target.locale, 'summonTitle', { name: me.name }),
      body: created.note ?? notificationText(target.locale, 'summonBody'),
      link: summonsInboxLink(created.id, me.id),
      kind: 'summon',
      tag: `summons-${created.id}`,
    },
    { ...SUMMONS_PUSH, topic: `summons-${created.id}` },
  );
  return c.json(view(db, created, now), 201);
});

/** Waiting for my answer (pending, not expired), newest first. */
router.get('/incoming', (c) => {
  return c.json<ListResponse<SummonsView>>({ items: incomingSummons(c.get('db'), currentUser(c).id, Date.now()) });
});

/** What I sent in the last 24 hours, newest first (?status=, 'expired' included). */
router.get('/sent', (c) => {
  const { status } = query(c, summonsSentQuery);
  const db = c.get('db');
  const now = Date.now();
  const rows = db
    .select()
    .from(summons)
    .where(and(eq(summons.fromUserId, currentUser(c).id), gt(summons.createdAt, now - SUMMONS_SENT_WINDOW_MS)))
    .orderBy(desc(summons.createdAt), desc(summons.id))
    .limit(100)
    .all();
  const items = toSummonsViews(db, rows, now).filter((v) => !status || v.status === status);
  return c.json<ListResponse<SummonsView>>({ items });
});

/**
 * One call, for either of its two people (the caller or the person called);
 * 404 for anyone else. The person called's notification opens the Team page,
 * which shows from this what became of the call.
 */
router.get('/:id', (c) => {
  const id = paramId(c);
  const me = currentUser(c).id;
  const db = c.get('db');
  const row = db.select().from(summons).where(eq(summons.id, id)).get();
  if (!row || (row.fromUserId !== me && row.toUserId !== me)) throw notFound('Call not found');
  return c.json(view(db, row, Date.now()));
});

/** The person called answers: on my way / can't come now. 404 for anyone else; 409 once it's answered, cancelled or expired. */
router.post('/:id/answer', async (c) => {
  const id = paramId(c);
  const input = await body(c, summonsAnswerInput);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();
  const row = db.select().from(summons).where(eq(summons.id, id)).get();
  if (!row || row.toUserId !== me.id) throw notFound('Call not found');
  if (row.status !== 'pending' || isExpired(row, now)) throw notPending(view(db, row, now));
  const callerLocale = localeOf(db, row.fromUserId);
  const title = answerTitle(callerLocale, input.status, me.name);
  const answerBody = row.note ? notificationText(callerLocale, 'answerAbout', { note: row.note }) : '';
  const updated = db.transaction((tx) => {
    const done = tx
      .update(summons)
      .set({ status: input.status, answeredAt: now })
      .where(and(eq(summons.id, id), eq(summons.status, 'pending')))
      .returning()
      .get();
    if (!done) return null;
    markNotificationsRead(tx, me.id, 'summon', summonsInboxLink(id, row.fromUserId), now);
    notify(tx, { userId: row.fromUserId, kind: 'summon_answer', title, body: answerBody, link: summonsLink(id) }, now);
    return done;
  });
  if (!updated) throw notPending(view(db, db.select().from(summons).where(eq(summons.id, id)).get()!, now));
  queuePush(c, [row.fromUserId], { title, body: answerBody, link: summonsLink(id), kind: 'summon_answer', tag: `summons-${id}` }, { ttl: 60 * 60, urgency: 'high' });
  return c.json(view(db, updated, now));
});

/** The caller takes it back. 404 for anyone else; 409 once it's answered, cancelled or expired. */
router.post('/:id/cancel', (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();
  const row = db.select().from(summons).where(eq(summons.id, id)).get();
  if (!row || row.fromUserId !== me.id) throw notFound('Call not found');
  if (row.status !== 'pending' || isExpired(row, now)) throw notPending(view(db, row, now));
  const updated = db.transaction((tx) => {
    const done = tx
      .update(summons)
      .set({ status: 'cancelled' })
      .where(and(eq(summons.id, id), eq(summons.status, 'pending')))
      .returning()
      .get();
    // The person called no longer needs to see it in their bell.
    if (done) markNotificationsRead(tx, row.toUserId, 'summon', summonsInboxLink(id, row.fromUserId), now);
    return done ?? null;
  });
  if (!updated) throw notPending(view(db, db.select().from(summons).where(eq(summons.id, id)).get()!, now));
  return c.json(view(db, updated, now));
});

export default router;
