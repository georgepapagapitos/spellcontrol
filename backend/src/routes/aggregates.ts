import { logger } from '../logger';
import { errorMessage } from '../error-utils';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import { requireAdmin } from '../auth';
import { desc, gte, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { commanderStats, commanderCardInclusion, type CommanderStatsRow } from '../db/schema';
import { runRollup, RISING_MIN_NEW_7D } from '../aggregates/rollup';

/**
 * Read API for the commander-popularity aggregate (social program W4) —
 * global, reference-data stats over PUBLIC decks only, computed nightly by
 * aggregates/rollup.ts. Anonymous-readable (no requireAuth) since this must
 * work on logged-out public deck-page views; helmet already applies globally
 * before all route mounts. Every threshold (min sample sizes, suppression)
 * is baked in server-side at rollup write time — this layer only shapes and
 * caches the read.
 */
export const aggregatesRouter: Router = Router();

const aggregatesLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

const MAX_BATCH_KEYS = 50;
const TRENDING_LIMIT = 10;
const CACHE_HEADER = 'public, max-age=3600';

interface CommanderResponse {
  commanderKey: string;
  commanderName: string;
  partnerName: string | null;
  deckCount: number;
  avgBracket: number | null;
  bracketSampleCount: number;
  budgetDistribution: { low: number | null; mid: number | null; high: number | null };
  topCards: Array<{ oracleId: string; cardName: string; deckCount: number; pct: number }>;
}

function toResponse(
  row: CommanderStatsRow,
  cards: { oracleId: string; cardName: string; deckCount: number }[]
): CommanderResponse {
  return {
    commanderKey: row.commanderKey,
    commanderName: row.commanderName,
    partnerName: row.partnerName,
    deckCount: row.deckCount,
    avgBracket: row.avgBracket,
    bracketSampleCount: row.bracketSampleCount,
    budgetDistribution: {
      low: row.budgetLowCount,
      mid: row.budgetMidCount,
      high: row.budgetHighCount,
    },
    // pct is computed at read time, not stored -- neither commander_stats nor
    // commander_card_inclusion carries a pct column (verdict amendment).
    topCards: cards.map((c) => ({
      oracleId: c.oracleId,
      cardName: c.cardName,
      deckCount: c.deckCount,
      pct: Math.round((c.deckCount / row.deckCount) * 100),
    })),
  };
}

/** Loads the full response shape for every key that has a commander_stats
 *  row. Keys with no row (unknown OR below-threshold -- indistinguishable by
 *  construction, since sub-threshold commanders are never written) are
 *  simply absent from the returned map. */
async function loadCommanderResponses(keys: string[]): Promise<Map<string, CommanderResponse>> {
  const db = getDb();
  const statRows = await db
    .select()
    .from(commanderStats)
    .where(inArray(commanderStats.commanderKey, keys));
  if (statRows.length === 0) return new Map();

  const foundKeys = statRows.map((r) => r.commanderKey);
  const cardRows = await db
    .select()
    .from(commanderCardInclusion)
    .where(inArray(commanderCardInclusion.commanderKey, foundKeys))
    .orderBy(commanderCardInclusion.rank);

  const cardsByKey = new Map<string, typeof cardRows>();
  for (const row of cardRows) {
    const list = cardsByKey.get(row.commanderKey) ?? [];
    list.push(row);
    cardsByKey.set(row.commanderKey, list);
  }

  const out = new Map<string, CommanderResponse>();
  for (const row of statRows) {
    out.set(row.commanderKey, toResponse(row, cardsByKey.get(row.commanderKey) ?? []));
  }
  return out;
}

aggregatesRouter.get(
  '/commanders/:commanderKey',
  aggregatesLimiter,
  async (req: Request, res: Response) => {
    const key = req.params.commanderKey;
    if (typeof key !== 'string' || key.length === 0) {
      return res.status(400).json({ error: 'commanderKey is required.' });
    }
    const found = await loadCommanderResponses([key]);
    const commander = found.get(key);
    if (!commander) {
      return res.status(404).json({ error: 'Not enough public decks yet.' });
    }
    res.set('Cache-Control', CACHE_HEADER);
    res.json(commander);
  }
);

aggregatesRouter.get('/commanders', aggregatesLimiter, async (req: Request, res: Response) => {
  const raw = typeof req.query.keys === 'string' ? req.query.keys : '';
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (keys.length > MAX_BATCH_KEYS) {
    return res.status(400).json({ error: `keys is capped at ${MAX_BATCH_KEYS}.` });
  }

  const found =
    keys.length > 0 ? await loadCommanderResponses(keys) : new Map<string, CommanderResponse>();
  res.set('Cache-Control', CACHE_HEADER);
  res.json({
    // Missing keys are silently omitted, not 404'd -- this is a batch lookup.
    commanders: keys
      .map((k) => found.get(k))
      .filter((c): c is CommanderResponse => c !== undefined),
  });
});

aggregatesRouter.get('/trending', aggregatesLimiter, async (_req: Request, res: Response) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(commanderStats)
    .where(gte(commanderStats.newLast7d, RISING_MIN_NEW_7D))
    .orderBy(desc(commanderStats.newLast7d), desc(commanderStats.deckCount))
    .limit(TRENDING_LIMIT);

  res.set('Cache-Control', CACHE_HEADER);
  // topCopiedDecks is deliberately absent here -- added later by w4-trending
  // as an additive field, not present-but-empty, so that PR's frontend can
  // feature-detect via `'topCopiedDecks' in data`.
  res.json({
    risingCommanders: rows.map((r) => ({
      commanderKey: r.commanderKey,
      commanderName: r.commanderName,
      partnerName: r.partnerName,
      deckCount: r.deckCount,
      newLast7d: r.newLast7d,
    })),
  });
});

aggregatesRouter.post('/admin/refresh', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await runRollup();
    res.json(result);
  } catch (err) {
    logger.error('[aggregates] admin refresh failed:', err);
    res.status(500).json({ error: `Refresh failed: ${errorMessage(err)}` });
  }
});
