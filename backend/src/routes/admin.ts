import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '../auth';
import { getDb, getPool } from '../db';
import { users } from '../db/schema';

export const adminRouter: Router = Router();

/**
 * GET /api/admin/users
 * List every user with role, registration date, and a rough byte-size of
 * their synced state (so an admin can spot which accounts are heavy). Bytes
 * sum `pg_column_size(data)` across the per-entity tables for live (not
 * tombstoned) rows — cheap enough to run on every request because each
 * sum is one indexed scan per table.
 */
adminRouter.get('/users', requireAdmin, async (_req: Request, res: Response) => {
  const { rows } = await getPool().query<{
    id: string;
    username: string;
    role: string;
    created_at: string;
    data_bytes: string;
    display_name: string | null;
    bio: string | null;
    avatar_card_name: string | null;
  }>(`
    SELECT
      u.id,
      u.username,
      u.role,
      u.created_at,
      u.display_name,
      u.bio,
      u.avatar_card_name,
      COALESCE(ui.bytes, 0) + COALESCE(uc.bytes, 0) + COALESCE(ub.bytes, 0)
        + COALESCE(ud.bytes, 0) + COALESCE(ug.bytes, 0) + COALESCE(ul.bytes, 0)
        AS data_bytes
    FROM users u
    LEFT JOIN (
      SELECT user_id, SUM(pg_column_size(data))::bigint AS bytes
      FROM user_imports WHERE deleted_at IS NULL GROUP BY user_id
    ) ui ON ui.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(pg_column_size(data))::bigint AS bytes
      FROM user_cards WHERE deleted_at IS NULL GROUP BY user_id
    ) uc ON uc.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(pg_column_size(data))::bigint AS bytes
      FROM user_binders WHERE deleted_at IS NULL GROUP BY user_id
    ) ub ON ub.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(pg_column_size(data))::bigint AS bytes
      FROM user_decks WHERE deleted_at IS NULL GROUP BY user_id
    ) ud ON ud.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(pg_column_size(data))::bigint AS bytes
      FROM user_games WHERE deleted_at IS NULL GROUP BY user_id
    ) ug ON ug.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(pg_column_size(data))::bigint AS bytes
      FROM user_lists WHERE deleted_at IS NULL GROUP BY user_id
    ) ul ON ul.user_id = u.id
    ORDER BY u.created_at DESC
  `);
  res.json({
    users: rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      createdAt: Number(r.created_at),
      dataBytes: Number(r.data_bytes),
      displayName: r.display_name,
      bio: r.bio,
      avatarCardName: r.avatar_card_name,
    })),
  });
});

/**
 * DELETE /api/admin/users/:id
 * Hard-delete a user account. All per-entity rows cascade via FK on user_id.
 * Guards against an admin deleting themselves (would lock them out of the
 * admin panel and likely orphan the only admin seat).
 */
adminRouter.delete('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return res.status(400).json({ error: 'Missing user id.' });
  }
  if (id === req.user!.id) {
    return res
      .status(400)
      .json({ error: 'You cannot delete your own account from the admin panel.' });
  }
  const db = getDb();
  const deleted = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (deleted.length === 0) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({ ok: true });
});

/**
 * POST /api/admin/users/:id/clear-profile
 * Reactive-moderation lever (social program W0): wipes a target user's
 * public-profile fields (display name, bio, avatar) in one UPDATE. No
 * self-target guard — unlike account deletion, clearing a profile is
 * reversible by re-setting it, so there's no lockout risk.
 */
adminRouter.post('/users/:id/clear-profile', requireAdmin, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return res.status(400).json({ error: 'Missing user id.' });
  }
  const db = getDb();
  const cleared = await db
    .update(users)
    .set({
      displayName: null,
      bio: null,
      avatarCardId: null,
      avatarCardName: null,
      avatarImageUrl: null,
    })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (cleared.length === 0) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({ ok: true });
});
