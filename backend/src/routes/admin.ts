import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '../auth';
import { testAwareLimiter } from '../route-utils';
import { getDb, getPool } from '../db';
import { users } from '../db/schema';
import { invalidateDeckPublicationCache, invalidatePublicUserCache } from '../publications/cache';
import { invalidateShareContext } from '../shares/context';
import { purgeUserPublicCaches } from '../publications/purge';
import { AI_MODEL, estimateUsd, type AiTokenCounts } from '../ai/client';

export const adminRouter: Router = Router();

// Admin-only, low-volume: one shared bucket mirrors the 60/min read limiters elsewhere.
const adminLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

interface SpendRow {
  calls: string;
  input_tokens: string;
  output_tokens: string;
  cache_write_tokens: string;
  cache_read_tokens: string;
}

function spendWindow(r: SpendRow): AiTokenCounts & { calls: number; usd: number } {
  const t: AiTokenCounts = {
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    cacheWriteTokens: Number(r.cache_write_tokens),
    cacheReadTokens: Number(r.cache_read_tokens),
  };
  return { calls: Number(r.calls), ...t, usd: estimateUsd(t) };
}

/**
 * GET /api/admin/ai-spend
 * Estimated AI cost (T116): token totals per window (today UTC, last 7 days,
 * last 30 days) priced at AI_USD_PER_MTOK, plus a per-user 30-day breakdown.
 * ai_reviews only holds FRESH generations (cached replays write no row), so
 * every row is a billable call.
 */
adminRouter.get('/ai-spend', requireAdmin, adminLimiter, async (_req: Request, res: Response) => {
  const now = Date.now();
  const day = 86_400_000;
  const since = {
    today: new Date().setUTCHours(0, 0, 0, 0),
    d7: now - 7 * day,
    d30: now - 30 * day,
  };
  const sums = (alias: string) =>
    `COUNT(*) FILTER (WHERE created_at >= $${alias})::text AS calls,
     COALESCE(SUM(input_tokens) FILTER (WHERE created_at >= $${alias}), 0)::text AS input_tokens,
     COALESCE(SUM(output_tokens) FILTER (WHERE created_at >= $${alias}), 0)::text AS output_tokens,
     COALESCE(SUM(cache_write_tokens) FILTER (WHERE created_at >= $${alias}), 0)::text AS cache_write_tokens,
     COALESCE(SUM(cache_read_tokens) FILTER (WHERE created_at >= $${alias}), 0)::text AS cache_read_tokens`;
  const pool = getPool();
  const [today, d7, d30, perUser] = await Promise.all([
    pool.query<SpendRow>(`SELECT ${sums('1')} FROM ai_reviews`, [since.today]),
    pool.query<SpendRow>(`SELECT ${sums('1')} FROM ai_reviews`, [since.d7]),
    pool.query<SpendRow>(`SELECT ${sums('1')} FROM ai_reviews`, [since.d30]),
    pool.query<SpendRow & { user_id: string }>(
      `SELECT user_id, ${sums('1')} FROM ai_reviews WHERE created_at >= $1 GROUP BY user_id`,
      [since.d30]
    ),
  ]);
  res.json({
    model: AI_MODEL,
    windows: {
      today: spendWindow(today.rows[0]),
      d7: spendWindow(d7.rows[0]),
      d30: spendWindow(d30.rows[0]),
    },
    users: perUser.rows.map((r) => ({ userId: r.user_id, ...spendWindow(r) })),
  });
});

/**
 * GET /api/admin/users
 * List every user with role, registration date, and a rough byte-size of
 * their synced state (so an admin can spot which accounts are heavy). Bytes
 * sum `pg_column_size(data)` across the per-entity tables for live (not
 * tombstoned) rows — cheap enough to run on every request because each
 * sum is one indexed scan per table.
 */
/**
 * GET /api/admin/events?days=30
 * Raw (day, name, path, count) rows from the first-party beacon for the last
 * N days (default 30, max 365), plus the client-error and web-vital rows the
 * same beacon counts. The admin page aggregates client-side.
 */
adminRouter.get('/events', requireAdmin, adminLimiter, async (req: Request, res: Response) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const pool = getPool();
  const [events, errors, vitals] = await Promise.all([
    pool.query<{ day: string; name: string; path: string; count: number }>(
      `SELECT day::text AS day, name, path, count FROM event_counts
        WHERE day >= CURRENT_DATE - ($1::int - 1) ORDER BY day DESC, count DESC`,
      [days]
    ),
    pool.query<{
      day: string;
      path: string;
      kind: string;
      message: string;
      frame: string;
      count: number;
      last_seen: string;
    }>(
      `SELECT day::text AS day, path, kind, message, frame, count, last_seen::text AS last_seen
         FROM error_counts
        WHERE day >= CURRENT_DATE - ($1::int - 1) ORDER BY count DESC, last_seen DESC`,
      [days]
    ),
    pool.query<{ day: string; path: string; metric: string; rating: string; count: number }>(
      `SELECT day::text AS day, path, metric, rating, count FROM vital_counts
        WHERE day >= CURRENT_DATE - ($1::int - 1)`,
      [days]
    ),
  ]);
  res.json({ events: events.rows, errors: errors.rows, vitals: vitals.rows });
});

adminRouter.get('/users', requireAdmin, adminLimiter, async (_req: Request, res: Response) => {
  const { rows } = await getPool().query<{
    id: string;
    username: string;
    role: string;
    created_at: string;
    data_bytes: string;
    display_name: string | null;
    bio: string | null;
    avatar_card_name: string | null;
    ai_access: boolean;
    ai_daily_limit: number | null;
  }>(`
    SELECT
      u.id,
      u.username,
      u.role,
      u.created_at,
      u.display_name,
      u.bio,
      u.avatar_card_name,
      u.ai_access,
      u.ai_daily_limit,
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
      aiAccess: r.ai_access,
      aiDailyLimit: r.ai_daily_limit,
    })),
  });
});

/**
 * PATCH /api/admin/users/:id/ai
 * body `{ access?: boolean, dailyLimit?: number | null }` — grant or revoke
 * the per-user AI unlock (T114) and/or override the daily quota (null =
 * back to the app default). The user's own opt-in consent still applies;
 * this only opens the door. Reversible, so no self-target guard.
 */
adminRouter.patch('/users/:id/ai', requireAdmin, adminLimiter, async (req, res) => {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return res.status(400).json({ error: 'Missing user id.' });
  }
  const { access, dailyLimit } = req.body as { access?: unknown; dailyLimit?: unknown };
  const patch: { aiAccess?: boolean; aiDailyLimit?: number | null } = {};
  if (access !== undefined) {
    if (typeof access !== 'boolean')
      return res.status(400).json({ error: 'access must be a boolean.' });
    patch.aiAccess = access;
  }
  if (dailyLimit !== undefined) {
    if (dailyLimit !== null && !(Number.isInteger(dailyLimit) && (dailyLimit as number) >= 0)) {
      return res.status(400).json({ error: 'dailyLimit must be a whole number or null.' });
    }
    patch.aiDailyLimit = dailyLimit as number | null;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nothing to change.' });
  }
  const updated = await getDb()
    .update(users)
    .set(patch)
    .where(eq(users.id, id))
    .returning({ aiAccess: users.aiAccess, aiDailyLimit: users.aiDailyLimit });
  if (updated.length === 0) return res.status(404).json({ error: 'User not found.' });
  res.json({ ok: true, ...updated[0] });
});

/**
 * DELETE /api/admin/users/:id
 * Hard-delete a user account. All per-entity rows cascade via FK on user_id.
 * Guards against an admin deleting themselves (would lock them out of the
 * admin panel and likely orphan the only admin seat).
 */
adminRouter.delete(
  '/users/:id',
  requireAdmin,
  adminLimiter,
  async (req: Request, res: Response) => {
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
    const target = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (target.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    // Before the cascade takes the slugs and tokens with it.
    await purgeUserPublicCaches(id, target[0].username);
    await db.delete(users).where(eq(users.id, id));
    res.json({ ok: true });
  }
);

/**
 * POST /api/admin/users/:id/clear-profile
 * Reactive-moderation lever (social program W0): wipes a target user's
 * public-profile fields (display name, bio, avatar) in one UPDATE. No
 * self-target guard — unlike account deletion, clearing a profile is
 * reversible by re-setting it, so there's no lockout risk.
 */
adminRouter.post(
  '/users/:id/clear-profile',
  requireAdmin,
  adminLimiter,
  async (req: Request, res: Response) => {
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
      .returning({ id: users.id, username: users.username });
    if (cleared.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    await purgeUserPublicCaches(id, cleared[0].username);
    res.json({ ok: true });
  }
);

interface AdminReportRow {
  id: string;
  kind: string;
  target_id: string;
  reason: string;
  created_at: string;
  owner_username: string;
  reporter_username: string | null;
  deck_name: string | null;
  game_format: string | null;
  game_ended_at: string | null;
}

/**
 * GET /api/admin/reports
 * Unresolved content reports (social program W1), newest first, each joined
 * with a best-effort target label (deck name via user_decks, the target
 * username itself for a profile report, or the game's format + date for a
 * game-result report — joined token -> shares.resource_id -> game_results,
 * since a game-result's target_id is the share token, not the session id)
 * and the reporter's username when signed in (null -> the client shows
 * "Anonymous").
 */
adminRouter.get('/reports', requireAdmin, adminLimiter, async (_req: Request, res: Response) => {
  const { rows } = await getPool().query<AdminReportRow>(`
    SELECT cr.id, cr.kind, cr.target_id, cr.reason, cr.created_at,
           owner.username AS owner_username,
           reporter.username AS reporter_username,
           ud.data->>'name' AS deck_name,
           gr.format AS game_format,
           gr.ended_at AS game_ended_at
      FROM content_reports cr
      JOIN users owner ON owner.id = cr.target_owner_id
      LEFT JOIN users reporter ON reporter.id = cr.reporter_user_id
      LEFT JOIN user_decks ud
        ON ud.user_id = cr.target_owner_id AND ud.id = cr.target_id
       AND cr.kind = 'deck' AND ud.deleted_at IS NULL
      LEFT JOIN shares sh ON sh.token = cr.target_id AND cr.kind = 'game-result'
      LEFT JOIN game_results gr ON gr.session_id = sh.resource_id AND cr.kind = 'game-result'
     WHERE cr.resolved_at IS NULL
     ORDER BY cr.created_at DESC
  `);
  res.json({
    reports: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      targetLabel:
        r.kind === 'deck'
          ? `${r.deck_name ?? 'Deleted deck'} by ${r.owner_username}`
          : r.kind === 'game-result'
            ? r.game_format
              ? `${r.game_format} game — ${new Date(Number(r.game_ended_at)).toLocaleDateString()}`
              : 'Deleted game'
            : r.target_id,
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
adminRouter.post(
  '/reports/:id/resolve',
  requireAdmin,
  adminLimiter,
  async (req: Request, res: Response) => {
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

    // Whether "hide" actually changed anything — false when the target was
    // already taken down some other way (e.g. the owner unpublished it after
    // the report was filed). The report still resolves either way; only the
    // response — and the admin panel's toast — needs to be honest about it.
    let changed = true;

    if (action === 'hide') {
      const now = Date.now();
      if (report.kind === 'deck') {
        const updated = await pool.query<{ slug: string }>(
          `UPDATE deck_publications SET unpublished_at = $3
           WHERE user_id = $1 AND deck_id = $2 AND unpublished_at IS NULL
         RETURNING slug`,
          [report.target_owner_id, report.target_id, now]
        );
        changed = updated.rows.length > 0;
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
      } else if (report.kind === 'game-result') {
        // target_id is the share TOKEN (not the session id) — revoking exactly
        // that token takes down the reported artifact without touching a
        // sibling share of the same underlying game. Same two-step every
        // existing DELETE /api/shares/:token revoke already performs.
        const revoked = await pool.query(
          `UPDATE shares SET revoked_at = $2 WHERE token = $1 AND kind = 'game-result' AND revoked_at IS NULL`,
          [report.target_id, now]
        );
        changed = (revoked.rowCount ?? 0) > 0;
        invalidateShareContext(report.target_id);
      }
    }

    await pool.query(`UPDATE content_reports SET resolved_at = $2, resolution = $3 WHERE id = $1`, [
      id,
      Date.now(),
      action === 'hide' ? 'hidden' : 'dismissed',
    ]);
    // `changed` only means something for 'hide' — dismiss has no side effect
    // to be honest or dishonest about, so its response shape is untouched.
    res.json(action === 'hide' ? { ok: true, changed } : { ok: true });
  }
);
