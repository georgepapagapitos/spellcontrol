import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../auth';
import { getDb, getPool } from '../db';
import { users as usersTable } from '../db/schema';
import { testAwareLimiter } from '../route-utils';

export const usersRouter: Router = Router();

const searchLimiter = testAwareLimiter({ windowMs: 60_000, max: 30 });
const inboxSeenLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

// ────────────────────────────────────────────────
// POST /api/users/me/inbox-seen
// ────────────────────────────────────────────────
/**
 * Stamp `users.inbox_seen_at` to now (T117) — the server truth behind the
 * inbox/friend-request "unseen" badges, replacing the old localStorage-only
 * mark so a second device agrees. Called when the user opens the inbox or
 * friends page; `GET /api/auth/me` returns the value.
 */
usersRouter.post(
  '/me/inbox-seen',
  requireAuth,
  inboxSeenLimiter,
  async (req: Request, res: Response) => {
    const inboxSeenAt = Date.now();
    await getDb().update(usersTable).set({ inboxSeenAt }).where(eq(usersTable.id, req.user!.id));
    res.json({ ok: true, inboxSeenAt });
  }
);

// ────────────────────────────────────────────────
// GET /api/users/search?q=
// ────────────────────────────────────────────────
usersRouter.get('/search', requireAuth, searchLimiter, async (req: Request, res: Response) => {
  const callerId = req.user!.id;
  const rawQ = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

  if (!rawQ) {
    return res.status(400).json({ error: 'q is required.' });
  }
  if (rawQ.length > 32) {
    return res.status(400).json({ error: 'q must be 32 characters or fewer.' });
  }
  if (!/^[a-z0-9_-]+$/.test(rawQ)) {
    // Rendered verbatim as the search error on /friends (userMessage passes a
    // 4xx message through), so it has to read as a sentence, not a regex.
    return res
      .status(400)
      .json({ error: 'Usernames only use lowercase letters, digits, _ and -.' });
  }

  const pool = getPool();

  // Single query: find matching users + LEFT JOIN friendships in both directions
  // to compute friendStatus in one round-trip.
  const result = await pool.query<{
    id: string;
    username: string;
    display_name: string | null;
    fwd_status: string | null;
    rev_status: string | null;
  }>(
    `SELECT
       u.id,
       u.username,
       u.display_name,
       fwd.status AS fwd_status,
       rev.status AS rev_status
     FROM users u
     LEFT JOIN friendships fwd
       ON fwd.requester_id = $1 AND fwd.addressee_id = u.id
     LEFT JOIN friendships rev
       ON rev.requester_id = u.id AND rev.addressee_id = $1
     WHERE u.username LIKE $2
       AND u.id != $1
     ORDER BY
       CASE WHEN u.username = $3 THEN 0 ELSE 1 END,
       u.username
     LIMIT 10`,
    [callerId, rawQ + '%', rawQ]
  );

  type FriendStatus = 'none' | 'friends' | 'request_sent' | 'request_received';

  const users = result.rows.map((r) => {
    let friendStatus: FriendStatus = 'none';
    if (r.fwd_status === 'accepted' || r.rev_status === 'accepted') {
      friendStatus = 'friends';
    } else if (r.fwd_status === 'pending') {
      friendStatus = 'request_sent';
    } else if (r.rev_status === 'pending') {
      friendStatus = 'request_received';
    }
    return { id: r.id, username: r.username, displayName: r.display_name, friendStatus };
  });

  res.json({ users });
});
