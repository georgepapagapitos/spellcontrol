import { logger } from '@/lib/logger';

// Data-driven substitute index: per-card EDHREC `similar` lists (deck
// co-occurrence — "what replaces this card"), built offline by
// scripts/refresh-card-similar.mjs into public/card-similar.json and shipped
// like tagger-tags.json. The substitute finder uses it as the PRIMARY ranking
// signal; absent (offline / not yet loaded) it falls back to the heuristic.
const SIMILAR_URL =
  (import.meta.env.VITE_CARD_SIMILAR_URL as string | undefined) ?? '/card-similar.json';

interface CardSimilarData {
  generatedAt: string;
  similar: Record<string, string[]>;
}

// In-memory cache for the session.
let cached: CardSimilarData | null = null;
let fetchPromise: Promise<CardSimilarData | null> | null = null;
// cardName → (similarName → 0-based rank). Rank 0 is EDHREC's closest match.
let rankMaps: Map<string, Map<string, number>> | null = null;

function buildRankMaps(similar: Record<string, string[]>): Map<string, Map<string, number>> {
  const maps = new Map<string, Map<string, number>>();
  for (const [name, list] of Object.entries(similar)) {
    const m = new Map<string, number>();
    list.forEach((n, i) => {
      if (!m.has(n)) m.set(n, i); // first (best) rank wins on dupes
    });
    maps.set(name, m);
  }
  return maps;
}

/**
 * Fetch the similar index (or return cached). Safe to call repeatedly —
 * deduplicates in-flight requests. Returns null (and the finder falls back to
 * its heuristic) when the snapshot is missing or unreachable.
 */
export async function loadCardSimilar(): Promise<CardSimilarData | null> {
  if (cached) return cached;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const res = await fetch(SIMILAR_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CardSimilarData = await res.json();
      cached = data;
      rankMaps = buildRankMaps(data.similar);
      logger.debug(`[CardSimilar] Loaded ${rankMaps.size} entries (generated ${data.generatedAt})`);
      return data;
    } catch (err) {
      logger.warn(
        '[CardSimilar] Failed to load — substitute ranking falls back to heuristic:',
        err
      );
      return null;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/**
 * EDHREC similar-rank map for a staple (similarName → 0-based rank), or null
 * when the card isn't indexed / the index isn't loaded. Lower rank = closer
 * substitute.
 */
export function getSimilarRank(cardName: string): ReadonlyMap<string, number> | null {
  return rankMaps?.get(cardName) ?? null;
}

/** Whether the similar index is loaded (diagnostics). */
export function hasCardSimilar(): boolean {
  return rankMaps !== null;
}
