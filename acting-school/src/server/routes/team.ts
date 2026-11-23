import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ListResponse } from '../../shared/schemas/common';
import { SUMMONS_SENT_WINDOW_MS } from '../../shared/schemas/summons';
import type { TeamMember } from '../../shared/schemas/team';
import { summons, users } from '../db/schema';
import type { AppEnv } from '../env';
import { accessFrom, hasPermission, loadPositionRows } from '../lib/access';
import { toSummonsViews } from '../lib/summons';
import { personColumns } from '../lib/team';
import { currentUser, requireAuth } from '../middleware/auth';

/**
 * The Team directory (GET /api/team, every signed-in worker): active staff by
 * name with photo and positions, for the Team page's "Message" / "Call to the
 * office" buttons. Owner accounts are listed for everyone — the documented
 * exception to owner hiding — but a non-owner sees them as name and photo
 * only: no positions (the owner-hiding rule for positions and access stays).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

router.get('/', (c) => {
  const db = c.get('db');
  const me = currentUser(c);
  const now = Date.now();
  const rows = db
    .select(personColumns)
    .from(users)
    .where(eq(users.active, true))
    .orderBy(sql`${users.name} collate nocase`, asc(users.id))
    .all();
  const held = loadPositionRows(
    db,
    rows.map((r) => r.id),
  );

  // With staff.summon: the newest summons I sent each person in the last day ("On my way ✓ 10:42").
  const lastSummons = new Map<number, TeamMember['lastSummons']>();
  if (hasPermission(me, 'staff.summon')) {
    const sent = db
      .select()
      .from(summons)
      .where(and(eq(summons.fromUserId, me.id), gt(summons.createdAt, now - SUMMONS_SENT_WINDOW_MS)))
      .orderBy(desc(summons.createdAt), desc(summons.id))
      .limit(200)
      .all();
    const newest = sent.filter((s, i) => sent.findIndex((o) => o.toUserId === s.toUserId) === i);
    for (const view of toSummonsViews(db, newest, now)) lastSummons.set(view.to.id, view);
  }

  const items: TeamMember[] = rows.map((r) => {
    const access = accessFrom(held.get(r.id) ?? []);
    return {
      ...r,
      positions: me.isOwner || !access.isOwner ? access.positions : [],
      isMe: r.id === me.id,
      lastSummons: lastSummons.get(r.id) ?? null,
    };
  });
  return c.json<ListResponse<TeamMember>>({ items });
});

export default router;
