import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../auth';
import { getPool } from '../db';

export const usersRouter: Router = Router();

const isTest = process.env.NODE_ENV === 'test' || !!process.env.TEST_DATABASE_URL;

const searchLimiter = isTest
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, max: 30 });

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
    return res.status(400).json({ error: 'q must match [a-z0-9_-].' });
  }

  const pool = getPool();

  // Single query: find matching users + LEFT JOIN friendships in both directions
  // to compute friendStatus in one round-trip.
  const result = await pool.query<{
    id: string;
    username: string;
    fwd_status: string | null;
    rev_status: string | null;
  }>(
    `SELECT
       u.id,
       u.username,
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
    return { id: r.id, username: r.username, friendStatus };
  });

  res.json({ users });
});
