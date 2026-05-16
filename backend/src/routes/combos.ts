import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { desc, eq, inArray } from 'drizzle-orm';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { combos, comboCards } from '../db/schema';
import { matchCombos, type ComboInput } from '../combos/match';
import { ingestCombos, streamSpellbookVariants } from '../combos/ingest';

export const combosRouter: Router = Router();

// /match is the heaviest endpoint in the app: up to MAX_OWNED_IDS ids, three
// Postgres round-trips, SHA-256 + in-JS bucketing, all in a 256MB container
// that has OOM-crashed under load. Without a limiter any one authed user can
// loop it (varying inputs to dodge the LRU cache) and 502 everyone. Disabled
// under test so the suite can fire many matches without tripping it.
const isTest = process.env.NODE_ENV === 'test' || !!process.env.TEST_DATABASE_URL;
const matchLimiter = isTest
  ? (_req: Request, _res: Response, next: () => void) => next()
  : rateLimit({ windowMs: 60_000, max: 30 });

const MAX_OWNED_IDS = 10_000;
const MAX_DECK_IDS = 500;

/**
 * Hard cap on how many candidate combos we materialize per request. With a
 * large collection (5000+ unique oracle ids) the naive "load every combo
 * touching any owned card" pulls 30k+ rows of metadata + ~100k card rows
 * into memory — easily 50MB+ of allocation in a 256MB container, on top of
 * the phash store and node baseline. That's been crashing the backend mid-
 * request and returning 502s through nginx.
 *
 * 2000 most-popular candidates covers virtually every combo a player would
 * actually care about (Spellbook's long tail is dominated by combos with
 * 1-10 deck registrations). Bounded memory; bounded latency.
 */
const MAX_CANDIDATE_COMBOS = 2000;

/**
 * Server-side LRU cache for /match responses. The result is a deterministic
 * function of (ownedOracleIds, deckOracleIds, format) plus the dataset
 * version (only changes nightly when ingest runs). The cache key is the
 * SHA-256 of the normalized inputs; entries live for an hour. First request
 * hits Postgres; subsequent identical requests hit memory in microseconds.
 *
 * 64 entries × ~50 KB per response = ~3 MB cap on cache memory.
 */
interface CacheEntry {
  body: unknown;
  expiresAt: number;
}
const matchCache = new Map<string, CacheEntry>();
const MATCH_CACHE_TTL_MS = 60 * 60 * 1000;
const MATCH_CACHE_LIMIT = 64;

function rememberMatch(key: string, body: unknown): void {
  if (matchCache.size >= MATCH_CACHE_LIMIT) {
    const oldest = matchCache.keys().next().value;
    if (oldest) matchCache.delete(oldest);
  }
  matchCache.set(key, { body, expiresAt: Date.now() + MATCH_CACHE_TTL_MS });
}

function readMatchCache(key: string): unknown | null {
  const entry = matchCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    matchCache.delete(key);
    return null;
  }
  // Re-insert at the end so this entry is now the most-recently-used.
  matchCache.delete(key);
  matchCache.set(key, entry);
  return entry.body;
}

function matchCacheKey(
  owned: string[],
  deck: string[] | undefined,
  format: string | undefined
): string {
  const h = createHash('sha256');
  h.update(format ?? '');
  h.update('|');
  // Sort so order doesn't fragment cache hits.
  for (const id of [...owned].sort()) h.update(id + ',');
  h.update('|');
  if (deck) for (const id of [...deck].sort()) h.update(id + ',');
  return h.digest('hex');
}

/** Reset hook for tests. */
export function __resetMatchCacheForTesting(): void {
  matchCache.clear();
}

function adminUsernames(): Set<string> {
  const raw = process.env.ADMIN_USERNAMES ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function asStringArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Loads candidate combos that touch at least one of the supplied oracle
 * ids. Capped at MAX_CANDIDATE_COMBOS (most-popular first) so a request
 * from a user with thousands of owned oracle ids can't try to materialize
 * every combo in the dataset and OOM the container.
 *
 * The oracle index handles the first hop fast. We then join against the
 * combos table to take the top-N by popularity, then fetch the card list
 * for just those N. Two round-trips total (vs. three in the naive shape).
 */
async function loadRelevantCombos(oracleIds: string[]): Promise<ComboInput[]> {
  if (oracleIds.length === 0) return [];
  const db = getDb();

  // Hop 1: combo ids whose card list intersects the seed set.
  const matchingComboIds = await db
    .selectDistinct({ comboId: comboCards.comboId })
    .from(comboCards)
    .where(inArray(comboCards.oracleId, oracleIds));
  const allCandidateIds = matchingComboIds.map((r) => r.comboId);
  if (allCandidateIds.length === 0) return [];

  // Hop 2: take the top-N candidate combos by popularity. Avoids
  // materializing 30k+ combo rows when the user has a huge collection.
  const comboRows = await db
    .select()
    .from(combos)
    .where(inArray(combos.id, allCandidateIds))
    .orderBy(desc(combos.popularity))
    .limit(MAX_CANDIDATE_COMBOS);
  if (comboRows.length === 0) return [];
  const ids = comboRows.map((r) => r.id);

  // Hop 3: load ONLY the cards belonging to the surviving candidates. With
  // N=2000 combos × ~3 cards each, this is ~6000 rows — tiny.
  const cardRows = await db
    .select()
    .from(comboCards)
    .where(inArray(comboCards.comboId, ids))
    .orderBy(comboCards.position);

  const cardsByCombo = new Map<string, ComboInput['cards']>();
  for (const r of cardRows) {
    const list = cardsByCombo.get(r.comboId) ?? [];
    list.push({ oracleId: r.oracleId, cardName: r.cardName, quantity: r.quantity });
    cardsByCombo.set(r.comboId, list);
  }

  return comboRows.map((row) => ({
    id: row.id,
    identity: row.identity,
    produces: row.produces,
    prerequisites: row.prerequisites,
    description: row.description,
    manaNeeded: row.manaNeeded,
    popularity: row.popularity,
    legalities: row.legalities,
    cardCount: row.cardCount,
    bracket: row.bracket,
    cards: cardsByCombo.get(row.id) ?? [],
  }));
}

combosRouter.post('/match', matchLimiter, requireAuth, async (req: Request, res: Response) => {
  const body = req.body as {
    ownedOracleIds?: unknown;
    deckOracleIds?: unknown;
    format?: unknown;
  };

  const ownedOracleIds = asStringArray(body.ownedOracleIds, MAX_OWNED_IDS);
  if (!ownedOracleIds) {
    return res.status(400).json({ error: 'ownedOracleIds must be a string array.' });
  }
  const deckOracleIds =
    body.deckOracleIds === undefined ? undefined : asStringArray(body.deckOracleIds, MAX_DECK_IDS);
  if (body.deckOracleIds !== undefined && deckOracleIds === null) {
    return res.status(400).json({ error: 'deckOracleIds must be a string array if provided.' });
  }
  const format = typeof body.format === 'string' ? body.format : undefined;

  // Cache hit? — match results are deterministic given (inputs + dataset).
  // The dataset only changes on the nightly ingest, so the only invalidator
  // is TTL expiry. Saves the entire query + JS bucketing on identical
  // subsequent requests (e.g. the user reloading the page or switching
  // between decks with the same collection).
  const cacheKey = matchCacheKey(ownedOracleIds, deckOracleIds ?? undefined, format);
  const cached = readMatchCache(cacheKey);
  if (cached) {
    res.set('X-Combos-Cache', 'hit');
    res.json(cached);
    return;
  }

  // Only fetch combos that touch at least one card the user has present
  // (deck ∪ collection). The seeded set is what `matchCombos` then buckets.
  const seedIds = new Set<string>(ownedOracleIds);
  if (deckOracleIds) for (const id of deckOracleIds) seedIds.add(id);

  const relevant = await loadRelevantCombos(Array.from(seedIds));
  const result = matchCombos({
    combos: relevant,
    ownedOracleIds,
    deckOracleIds: deckOracleIds ?? undefined,
    format,
  });

  rememberMatch(cacheKey, result);
  res.set('X-Combos-Cache', 'miss');
  res.json(result);
});

combosRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return res.status(400).json({ error: 'id is required.' });
  }
  const db = getDb();
  const [comboRow] = await db.select().from(combos).where(eq(combos.id, id)).limit(1);
  if (!comboRow) {
    return res.status(404).json({ error: 'Combo not found.' });
  }
  const cards = await db
    .select()
    .from(comboCards)
    .where(eq(comboCards.comboId, id))
    .orderBy(comboCards.position);

  res.json({
    id: comboRow.id,
    identity: comboRow.identity,
    produces: comboRow.produces,
    prerequisites: comboRow.prerequisites,
    description: comboRow.description,
    manaNeeded: comboRow.manaNeeded,
    popularity: comboRow.popularity,
    legalities: comboRow.legalities,
    cardCount: comboRow.cardCount,
    bracket: comboRow.bracket,
    cards: cards.map((c) => ({
      oracleId: c.oracleId,
      cardName: c.cardName,
      quantity: c.quantity,
      position: c.position,
    })),
  });
});

combosRouter.post('/admin/refresh', requireAuth, async (req: Request, res: Response) => {
  const admins = adminUsernames();
  if (admins.size === 0 || !admins.has(req.user!.username.toLowerCase())) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  try {
    const result = await ingestCombos(streamSpellbookVariants());
    res.json(result);
  } catch (err) {
    console.error('[combos] admin refresh failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `Refresh failed: ${message}` });
  }
});
