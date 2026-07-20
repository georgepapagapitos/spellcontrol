import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '../auth';
import { getDb, getPool } from '../db';
import { users } from '../db/schema';
import { invalidateDeckPublicationCache, invalidatePublicUserCache } from '../publications/cache';

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

interface AdminReportRow {
  id: string;
  kind: string;
  target_id: string;
  reason: string;
  created_at: string;
  owner_username: string;
  reporter_username: string | null;
  deck_name: string | null;
}

/**
 * GET /api/admin/reports
 * Unresolved content reports (social program W1), newest first, each joined
 * with a best-effort target label (deck name via user_decks, or the target
 * username itself for a profile report) and the reporter's username when
 * signed in (null -> the client shows "Anonymous").
 */
adminRouter.get('/reports', requireAdmin, async (_req: Request, res: Response) => {
  const { rows } = await getPool().query<AdminReportRow>(`
    SELECT cr.id, cr.kind, cr.target_id, cr.reason, cr.created_at,
           owner.username AS owner_username,
           reporter.username AS reporter_username,
           ud.data->>'name' AS deck_name
      FROM content_reports cr
      JOIN users owner ON owner.id = cr.target_owner_id
      LEFT JOIN users reporter ON reporter.id = cr.reporter_user_id
      LEFT JOIN user_decks ud
        ON ud.user_id = cr.target_owner_id AND ud.id = cr.target_id
       AND cr.kind = 'deck' AND ud.deleted_at IS NULL
     WHERE cr.resolved_at IS NULL
     ORDER BY cr.created_at DESC
  `);
  res.json({
    reports: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      targetLabel:
        r.kind === 'deck' ? `${r.deck_name ?? 'Deleted deck'} by ${r.owner_username}` : r.target_id,
      reporterUsername: r.reporter_username,
      reason: r.reason,
      createdAt: Number(r.created_at),
    })),
  });
});

/**
 * POST /api/admin/reports/:id/resolve
 * body `{ action: 'dismiss' | 'hide' }`. `'hide'` unpublishes the reported
 * deck, or — for a profile report — hides the profile AND cascades to
 * unpublishing every one of that user's other live publications (folded-in
 * amendment: a hidden profile that left every one of the user's decks still
 * reachable at their direct /d/:slug URL wouldn't actually take the content
 * down, only the hub page listing it). Gated on `resolved_at IS NULL` so a
 * double resolve 404s rather than double-applying the side effect.
 */
adminRouter.post('/reports/:id/resolve', requireAdmin, async (req: Request, res: Response) => {
  const id = req.params.id;
  const action = (req.body as { action?: unknown }).action;
  if (action !== 'dismiss' && action !== 'hide') {
    return res.status(400).json({ error: "action must be 'dismiss' or 'hide'." });
  }

  const pool = getPool();
  const found = await pool.query<{
    kind: string;
    target_id: string;
    target_owner_id: string;
    owner_username: string;
  }>(
    `SELECT cr.kind, cr.target_id, cr.target_owner_id, u.username AS owner_username
       FROM content_reports cr
       JOIN users u ON u.id = cr.target_owner_id
      WHERE cr.id = $1 AND cr.resolved_at IS NULL`,
    [id]
  );
  const report = found.rows[0];
  if (!report) {
    return res.status(404).json({ error: 'Report not found.' });
  }

  if (action === 'hide') {
    const now = Date.now();
    if (report.kind === 'deck') {
      const updated = await pool.query<{ slug: string }>(
        `UPDATE deck_publications SET unpublished_at = $3
           WHERE user_id = $1 AND deck_id = $2 AND unpublished_at IS NULL
         RETURNING slug`,
        [report.target_owner_id, report.target_id, now]
      );
      if (updated.rows[0]) invalidateDeckPublicationCache(updated.rows[0].slug);
      invalidatePublicUserCache(report.owner_username);
    } else if (report.kind === 'profile') {
      await pool.query(`UPDATE users SET profile_hidden_at = $2 WHERE id = $1`, [
        report.target_owner_id,
        now,
      ]);
      const cascaded = await pool.query<{ slug: string }>(
        `UPDATE deck_publications SET unpublished_at = $2
           WHERE user_id = $1 AND unpublished_at IS NULL
         RETURNING slug`,
        [report.target_owner_id, now]
      );
      for (const row of cascaded.rows) invalidateDeckPublicationCache(row.slug);
      invalidatePublicUserCache(report.owner_username);
    }
    // 'game-result' hide: no live surface exists yet — the report still
    // resolves; there's nothing to unpublish.
  }

  await pool.query(`UPDATE content_reports SET resolved_at = $2, resolution = $3 WHERE id = $1`, [
    id,
    Date.now(),
    action === 'hide' ? 'hidden' : 'dismissed',
  ]);
  res.json({ ok: true });
});
