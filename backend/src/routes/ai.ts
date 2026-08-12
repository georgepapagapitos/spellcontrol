import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { logger } from '../logger';
import { requireAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';
import { getScryfallCache } from '../scryfall-cache';
import { aiEnabled, generateReview, AI_MODEL } from '../ai/client';
import {
  DECK_REVIEW_FEATURE,
  DECK_REVIEW_SYSTEM_PROMPT,
  buildUserMessage,
  hashDeckReviewInput,
  parseDeckReviewRequest,
  type OracleEntry,
} from '../ai/deck-review';

/**
 * Opt-in AI features (T96 "Read the deck"). Consent is enforced server-side —
 * a hidden button is not consent — and the whole router 404s when the API key
 * is absent, so `main` stays shippable without the feature configured.
 *
 * Reviews are cached by content hash in `ai_reviews`, which doubles as the
 * per-user quota meter (count today's rows) and the cost audit trail (token
 * columns). AI output never enters the sync layer.
 */
export const aiRouter: Router = Router();

export const DEFAULT_DAILY_LIMIT = 10;

const reviewLimiter = testAwareLimiter({ windowMs: 60_000, max: 10 });
const optInLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

aiRouter.use((_req: Request, res: Response, next) => {
  if (!aiEnabled()) return res.status(404).json({ error: 'Not found.' });
  next();
});

interface AiUserRow {
  ai_opt_in: boolean;
  ai_daily_limit: number | null;
}

async function loadAiUser(userId: string): Promise<AiUserRow> {
  const res = await getPool().query<AiUserRow>(
    'SELECT ai_opt_in, ai_daily_limit FROM users WHERE id = $1',
    [userId]
  );
  return res.rows[0] ?? { ai_opt_in: false, ai_daily_limit: null };
}

async function usedToday(userId: string): Promise<number> {
  const dayStartMs = new Date().setUTCHours(0, 0, 0, 0);
  const res = await getPool().query<{ n: string }>(
    'SELECT COUNT(*) AS n FROM ai_reviews WHERE user_id = $1 AND created_at >= $2',
    [userId, dayStartMs]
  );
  return Number(res.rows[0]?.n ?? 0);
}

// ────────────────────────────────────────────────
// GET /api/ai/status — everything the UI needs to gate itself:
// opt-in state, today's usage, and the effective daily limit.
// (404 from the router guard = the feature is unavailable entirely.)
// ────────────────────────────────────────────────
aiRouter.get('/status', requireAuth, async (req: Request, res: Response) => {
  const user = await loadAiUser(req.user!.id);
  const used = user.ai_opt_in ? await usedToday(req.user!.id) : 0;
  res.json({
    optIn: user.ai_opt_in,
    used,
    limit: user.ai_daily_limit ?? DEFAULT_DAILY_LIMIT,
  });
});

// ────────────────────────────────────────────────
// POST /api/ai/opt-in { enabled: boolean }
// ────────────────────────────────────────────────
aiRouter.post('/opt-in', optInLimiter, requireAuth, async (req: Request, res: Response) => {
  const enabled = (req.body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Body must be { enabled: boolean }.' });
  }
  await getPool().query('UPDATE users SET ai_opt_in = $1 WHERE id = $2', [enabled, req.user!.id]);
  res.json({ optIn: enabled });
});

// ────────────────────────────────────────────────
// POST /api/ai/deck-review — the review itself. Flow: consent → hash →
// cache hit (free, no quota) → quota → hydrate oracle text (cache-only,
// never a live Scryfall fetch) → one model call → store + return.
// ────────────────────────────────────────────────
aiRouter.post('/deck-review', reviewLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = parseDeckReviewRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const request = parsed.value;
  const userId = req.user!.id;

  const user = await loadAiUser(userId);
  if (!user.ai_opt_in) {
    return res.status(403).json({ error: 'AI features are not enabled for this account.' });
  }

  const inputHash = hashDeckReviewInput(request);
  const pool = getPool();

  const cached = await pool.query<{
    content: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
  }>(
    `SELECT content, model, input_tokens, output_tokens
       FROM ai_reviews
      WHERE user_id = $1 AND feature = $2 AND input_hash = $3`,
    [userId, DECK_REVIEW_FEATURE, inputHash]
  );
  if (cached.rows.length > 0) {
    const row = cached.rows[0];
    return res.json({
      content: row.content,
      cached: true,
      model: row.model,
      usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
    });
  }

  const limit = user.ai_daily_limit ?? DEFAULT_DAILY_LIMIT;
  const used = await usedToday(userId);
  if (used >= limit) {
    return res.status(429).json({
      error: `Daily limit reached (${limit} per day). It resets at midnight UTC.`,
    });
  }

  // Oracle-text hydration is cache-only by design: a miss means the model
  // reasons without that card's text (the prompt tells it how), never a live
  // Scryfall call from the shared egress IP.
  const cache = getScryfallCache();
  const oracle: OracleEntry[] = [];
  const seen = new Set<string>();
  for (const card of [{ name: request.commander }, ...request.cards]) {
    if (seen.has(card.name)) continue;
    seen.add(card.name);
    const hit = cache.getCheapestByName(card.name);
    if (hit) {
      oracle.push({
        name: hit.name,
        manaCost: hit.mana_cost ?? undefined,
        typeLine: hit.type_line ?? undefined,
        oracleText: hit.oracle_text ?? undefined,
      });
    }
  }

  let generation;
  try {
    generation = await generateReview(DECK_REVIEW_SYSTEM_PROMPT, buildUserMessage(request, oracle));
  } catch (err) {
    logger.error('[ai] deck review generation failed', err);
    return res.status(502).json({ error: 'The review could not be generated. Try again.' });
  }

  await pool.query(
    `INSERT INTO ai_reviews
       (id, user_id, feature, input_hash, model, content, input_tokens, output_tokens, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, feature, input_hash) DO NOTHING`,
    [
      crypto.randomUUID(),
      userId,
      DECK_REVIEW_FEATURE,
      inputHash,
      AI_MODEL,
      generation.content,
      generation.inputTokens,
      generation.outputTokens,
      Date.now(),
    ]
  );

  res.json({
    content: generation.content,
    cached: false,
    model: AI_MODEL,
    usage: { inputTokens: generation.inputTokens, outputTokens: generation.outputTokens },
  });
});
