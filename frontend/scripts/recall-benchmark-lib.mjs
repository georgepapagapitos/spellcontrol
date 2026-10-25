// Pure parts of the held-out card-recovery benchmark (roadmap item 0.1, board
// E1038): no network, no fs. recall-benchmark.mjs does the I/O and the
// rankers; recall-benchmark-lib.test.mjs pins everything here.
//
// Protocol: hide k cards of a real deck, rank the commander's FULL legal pool
// (never a sample of negatives: sampled metrics can invert which model wins),
// and score where the hidden cards land.

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** String to 32-bit seed (FNV-1a), so per-deck streams are stable under reordering. */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Name key shared by every source: front face, straight quotes, lower case. */
export const nameKey = (name) => name.split(' // ')[0].replace(/[‘’]/g, "'").trim().toLowerCase();

/** Jaccard similarity of two sets (iterables of strings). Two empty sets are 1. */
export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Greedy near-duplicate removal: keep a deck unless it overlaps an already
 * kept deck above `threshold` (Jaccard of the card-name sets). Order decides
 * which of a pair survives, so callers pass a stable order. Returns the kept
 * decks; each deck is `{ keys: Set<string> }` at minimum.
 */
export function dedupeByJaccard(decks, threshold = 0.9) {
  const kept = [];
  for (const d of decks) {
    if (!kept.some((k) => jaccard(k.keys, d.keys) > threshold)) kept.push(d);
  }
  return kept;
}

/** Fisher-Yates over a copy, with the supplied random() in [0, 1). */
export function shuffled(items, random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** k cards chosen uniformly at random (fewer when the deck is smaller). */
export function pickRandom(names, k, random) {
  return shuffled(names, random).slice(0, k);
}

/**
 * k cards spread across role groups: shuffle each group, then draw one from
 * each non-empty group in turn (groups visited in a shuffled order each
 * round), so a deck with ramp, draw, removal and "other" cards loses one of
 * each before it loses two of one. `roleOf(name)` returns a role string or
 * null/undefined for "no role" (its own group).
 */
export function pickRoleStratified(names, k, roleOf, random) {
  const groups = new Map();
  for (const n of names) {
    const r = roleOf(n) ?? '_other';
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n);
  }
  const queues = [...groups.keys()].sort().map((r) => shuffled(groups.get(r), random));
  const out = [];
  while (out.length < k && queues.some((q) => q.length > 0)) {
    for (const q of shuffled(queues, random)) {
      if (out.length >= k) break;
      const next = q.shift();
      if (next !== undefined) out.push(next);
    }
  }
  return out;
}

/**
 * Order `names` best-first by `scoreOf` (higher is better). Ties break on a
 * seeded random key, not alphabetically, so a ranker that scores most of the
 * pool zero is not quietly favored or punished by card names. Ranks are
 * 1-based positions in the returned array.
 */
export function rankPool(names, scoreOf, random) {
  const rows = names.map((name) => ({ name, score: scoreOf(name), tie: random() }));
  rows.sort((a, b) => b.score - a.score || a.tie - b.tie);
  return rows.map((r) => r.name);
}

/**
 * Per-query metrics for one ranked list against a set of relevant names.
 * `ranking` is the full pool best-first. recall@k = relevant hits in the top
 * k over |relevant|; nDCG@k uses binary gain with the ideal list holding
 * min(|relevant|, k) hits; reciprocal rank is 1 / rank of the first hit.
 * Returns null when nothing is relevant (the query does not count).
 */
export function queryMetrics(ranking, relevant, { ks = [10, 20], ndcgK = 20 } = {}) {
  const rel = relevant instanceof Set ? relevant : new Set(relevant);
  if (rel.size === 0) return null;
  const out = { n: rel.size };
  let firstHit = 0;
  const hitAt = [];
  for (let i = 0; i < ranking.length; i++) {
    if (rel.has(ranking[i])) {
      hitAt.push(i + 1);
      if (!firstHit) firstHit = i + 1;
    }
  }
  for (const k of ks) out[`recall@${k}`] = hitAt.filter((r) => r <= k).length / rel.size;
  let dcg = 0;
  for (const r of hitAt) if (r <= ndcgK) dcg += 1 / Math.log2(r + 1);
  let ideal = 0;
  for (let i = 1; i <= Math.min(rel.size, ndcgK); i++) ideal += 1 / Math.log2(i + 1);
  out[`ndcg@${ndcgK}`] = ideal > 0 ? dcg / ideal : 0;
  out.mrr = firstHit ? 1 / firstHit : 0;
  return out;
}

/**
 * Split hidden cards into head and tail by popularity. `popularityOf(name)` is
 * the card's play rate (percent) on the commander's page, 0 when absent; a card
 * strictly below `tailBelow` percent is tail, the rest head.
 */
export function splitByPopularity(hidden, popularityOf, tailBelow = 10) {
  const head = [];
  const tail = [];
  for (const n of hidden) (popularityOf(n) < tailBelow ? tail : head).push(n);
  return { head, tail };
}

/** Share of the first `k` ranked names that are tail (popularity < tailBelow). */
export function tailShare(ranking, popularityOf, k = 20, tailBelow = 10) {
  const top = ranking.slice(0, k);
  if (top.length === 0) return 0;
  return top.filter((n) => popularityOf(n) < tailBelow).length / top.length;
}

/** Mean of each numeric field over rows (skipping nulls). `n` counts rows. */
export function meanMetrics(rows) {
  const live = rows.filter(Boolean);
  const sums = {};
  for (const r of live) {
    for (const [key, v] of Object.entries(r)) {
      if (key === 'n') continue;
      sums[key] = (sums[key] ?? 0) + v;
    }
  }
  const out = { queries: live.length };
  for (const [key, s] of Object.entries(sums)) out[key] = live.length ? s / live.length : 0;
  return out;
}
