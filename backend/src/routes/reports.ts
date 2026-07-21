import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { optionalAuth } from '../auth';
import { getPool } from '../db';

/**
 * Public content-reporting endpoint (social program W1) — the app's first
 * moderation surface. Anonymous-capable and tightly rate-limited (an
 * anonymous-write endpoint), so it's mounted standalone rather than under
 * an existing router.
 */
export const reportsRouter: Router = Router();

export type ReportKind = 'deck' | 'profile' | 'game-result';

function isReportKind(x: unknown): x is ReportKind {
  return x === 'deck' || x === 'profile' || x === 'game-result';
}

const REASON_MAX = 500;
const reportLimiter = testAwareLimiter({ windowMs: 60_000, max: 5 });

// Distinct from a bare "not found" — a bad actor unpublishing a deck/profile
// right after an abusive act shouldn't silently discard the report with no
// signal to the reporter that anything happened.
const NOT_AVAILABLE = { error: 'This content is no longer available.' } as const;

/**
 * Resolve targetId -> the current owner's user id straight from the live
 * public-facing tables — never trusts a client-supplied owner id. Returns
 * null when the target doesn't currently resolve to a live public resource
 * (unpublished deck, hidden/unknown profile, or a kind with no live public
 * surface yet), which the route turns into the distinct "no longer
 * available" response instead of a bare 404.
 */
async function resolveTargetOwner(kind: ReportKind, targetId: string): Promise<string | null> {
  const pool = getPool();
  if (kind === 'deck') {
    // Joins the underlying deck row (mirrors routes/public.ts's own
    // "live" definition) so a publication row that's surviving a race past
    // its deck's tombstone can't be reported as if it were still live.
    const result = await pool.query<{ user_id: string }>(
      `SELECT dp.user_id
         FROM deck_publications dp
         JOIN user_decks ud
           ON ud.user_id = dp.user_id AND ud.id = dp.deck_id AND ud.deleted_at IS NULL
        WHERE dp.deck_id = $1 AND dp.unpublished_at IS NULL
        LIMIT 1`,
      [targetId]
    );
    return result.rows[0]?.user_id ?? null;
  }
  if (kind === 'profile') {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE username = $1 AND profile_hidden_at IS NULL LIMIT 1`,
      [targetId]
    );
    return result.rows[0]?.id ?? null;
  }
  // 'game-result': targetId is the share TOKEN, not the session id — a
  // session can have multiple coexisting shares (link/friends/direct), and
  // the token is the only unambiguous "this exact artifact" identifier, so
  // hiding one doesn't touch a sibling share of the same game. The owner is
  // the sharer (accountable for having published it), mirroring 'deck'
  // resolving to the deck's publisher.
  const result = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM shares WHERE token = $1 AND kind = 'game-result' AND revoked_at IS NULL LIMIT 1`,
    [targetId]
  );
  return result.rows[0]?.user_id ?? null;
}

/**
 * POST /api/reports — anonymous-capable, tightly rate-limited content
 * report. `reporter_user_id` is stored only when signed in and is never
 * echoed back to the caller; no IP/email/UA is persisted.
 */
reportsRouter.post('/', reportLimiter, optionalAuth, async (req: Request, res: Response) => {
  const body = req.body as { kind?: unknown; targetId?: unknown; reason?: unknown };
  if (!isReportKind(body.kind)) {
    return res
      .status(400)
      .json({ error: "kind must be one of 'deck', 'profile', or 'game-result'." });
  }
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId) {
    return res.status(400).json({ error: 'targetId is required.' });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > REASON_MAX) {
    return res
      .status(400)
      .json({ error: `reason is required and must be ${REASON_MAX} characters or fewer.` });
  }

  const targetOwnerId = await resolveTargetOwner(body.kind, targetId);
  if (!targetOwnerId) {
    return res.status(404).json(NOT_AVAILABLE);
  }

  await getPool().query(
    `INSERT INTO content_reports
       (id, kind, target_id, target_owner_id, reporter_user_id, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      body.kind,
      targetId,
      targetOwnerId,
      req.user?.id ?? null,
      reason,
      Date.now(),
    ]
  );
  res.status(201).json({ ok: true });
});
