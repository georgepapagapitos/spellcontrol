import { Router, type Request, type Response } from 'express';
import { normalizeUsername, requireAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';
import { loadBrewerCards } from '../brewers/cards';

/**
 * One-way follow, alongside the mutual friends table (T175). A follow gives
 * the follower a feed and the followee a count, and nothing else: collection,
 * trades and pods stay friends-only. Anyone signed in can follow any account a
 * moderator has not hidden, except themselves.
 */
export const followsRouter: Router = Router();

const followLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

const USER_NOT_FOUND = { error: 'User not found.' } as const;
/** The following list is capped; nobody follows more than this in practice. */
const FOLLOWING_MAX = 500;

interface Target {
  id: string;
  hidden: boolean;
}

async function findTarget(raw: unknown): Promise<Target | null> {
  const username = normalizeUsername(raw);
  if (!username) return null;
  const { rows } = await getPool().query<{ id: string; profile_hidden_at: string | null }>(
    `SELECT id, profile_hidden_at FROM users WHERE username = $1`,
    [username]
  );
  const row = rows[0];
  return row ? { id: row.id, hidden: row.profile_hidden_at !== null } : null;
}

async function followerCount(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM user_follows WHERE followee_id = $1`,
    [userId]
  );
  return Number(rows[0].n);
}

/** Follow. Idempotent: following someone you already follow succeeds. */
followsRouter.post(
  '/:username',
  followLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const target = await findTarget(req.params.username);
    if (!target) return res.status(404).json(USER_NOT_FOUND);
    if (target.id === req.user!.id) {
      return res.status(400).json({ error: "You can't follow yourself." });
    }
    // Same 404 as an unknown name: a hidden account is not findable.
    if (target.hidden) return res.status(404).json(USER_NOT_FOUND);
    await getPool().query(
      `INSERT INTO user_follows (follower_id, followee_id, created_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.user!.id, target.id, Date.now()]
    );
    res.json({ following: true, followerCount: await followerCount(target.id) });
  }
);

/** Unfollow. Idempotent, and allowed for a since-hidden account so nobody is
 *  stuck following someone they cannot see. */
followsRouter.delete(
  '/:username',
  followLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const target = await findTarget(req.params.username);
    if (!target) return res.status(404).json(USER_NOT_FOUND);
    await getPool().query(`DELETE FROM user_follows WHERE follower_id = $1 AND followee_id = $2`, [
      req.user!.id,
      target.id,
    ]);
    res.json({ following: false, followerCount: await followerCount(target.id) });
  }
);

/** Everyone the caller follows, newest follow first, as brewer cards. A
 *  hidden account drops out of the list (it stays followed if it returns). */
followsRouter.get('/following', followLimiter, requireAuth, async (req: Request, res: Response) => {
  const { rows } = await getPool().query<{ followee_id: string }>(
    `SELECT followee_id FROM user_follows WHERE follower_id = $1
      ORDER BY created_at DESC, followee_id LIMIT ${FOLLOWING_MAX}`,
    [req.user!.id]
  );
  res.json({ brewers: await loadBrewerCards(rows.map((r) => r.followee_id)) });
});
