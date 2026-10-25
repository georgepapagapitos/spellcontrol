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

// ── lift-upgrade variants (roadmap 2.4) ──────────────────────────────────────
// Edges are EDHREC card-page LiftEntry rows: { lift, coPlayPct, numDecks }.

/**
 * Lift shrunk toward the no-association prior of 1 by sample size: with k
 * co-occurring decks and m pseudo-decks of prior, 1 + (lift - 1) * k / (k + m).
 * k = 0 gives 1, k >> m gives the raw lift; a lift below 1 shrinks up toward 1.
 */
export function shrunkLift(lift, k, m) {
  return 1 + ((lift - 1) * k) / (k + m);
}

/**
 * Normalized pointwise mutual information of a card pair from EDHREC's lift:
 * PMI = ln(lift), joint probability p(a,b) = k / total decks, NPMI = PMI /
 * -ln p(a,b), in [-1, 1]. 0 when the inputs cannot give a probability.
 */
export function npmi(lift, k, totalDecks) {
  if (!(lift > 0) || !(k > 0) || !(totalDecks > k)) return 0;
  return Math.log(lift) / -Math.log(k / totalDecks);
}

/**
 * Sum an edge score over every seed that mentions a candidate. `pools` is
 * Map(seedName -> LiftEntry[]), `edgeFn(entry, seedName)` returns the edge
 * strength (negative edges may be clipped by the caller). Seeds and
 * `excludeKeys` never score. Returns Map(nameKey -> summed score).
 */
export function sumEdges(pools, edgeFn, excludeKeys = new Set()) {
  const out = new Map();
  for (const [seed, entries] of pools) {
    const seedKey = nameKey(seed);
    for (const e of entries) {
      const key = nameKey(e.name);
      if (key === seedKey || excludeKeys.has(key)) continue;
      out.set(key, (out.get(key) ?? 0) + edgeFn(e, seed));
    }
  }
  return out;
}

/**
 * Weighted reciprocal-rank fusion of full rankings (best-first name arrays):
 * score(name) = sum over rankers of weight / (c + rank), rank 1-based. Returns
 * Map(name -> score). A name missing from a ranking contributes nothing.
 */
export function rrfScores(rankings, weights = rankings.map(() => 1), c = 60) {
  const out = new Map();
  rankings.forEach((ranking, i) => {
    for (let r = 0; r < ranking.length; r++) {
      out.set(ranking[r], (out.get(ranking[r]) ?? 0) + weights[i] / (c + r + 1));
    }
  });
  return out;
}

/**
 * Index combos (arrays of nameKeys) by card: Map(nameKey -> combo[]). Combos
 * with fewer than two distinct cards carry no pair information and are dropped.
 */
export function buildComboIndex(combos) {
  const index = new Map();
  for (const cards of combos) {
    const uniq = [...new Set(cards)];
    if (uniq.length < 2) continue;
    for (const k of uniq) {
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(uniq);
    }
  }
  return index;
}

/**
 * Combo-hypergraph prior for one candidate: over every combo containing it
 * that shares at least one OTHER card with the deck, add (other cards in the
 * deck) / (other cards in the combo). With `completeOnly` only a full
 * completion counts (adds 1).
 */
export function comboScore(candidate, deck, comboIndex, completeOnly = false) {
  let s = 0;
  for (const combo of comboIndex.get(candidate) ?? []) {
    let present = 0;
    for (const k of combo) if (k !== candidate && deck.has(k)) present++;
    if (present === 0) continue;
    const frac = present / (combo.length - 1);
    if (completeOnly) {
      if (frac === 1) s += 1;
    } else s += frac;
  }
  return s;
}

/**
 * Cluster bootstrap of a paired mean difference. `rows` are { group, diff }
 * (diff = variant metric - baseline metric for one query; queries of the same
 * deck share a group). Resamples groups with replacement `iters` times and
 * returns the pooled mean difference with a percentile 95% interval.
 */
export function bootstrapDiff(rows, random, iters = 2000) {
  const byGroup = new Map();
  for (const { group, diff } of rows) {
    const g = byGroup.get(group) ?? { sum: 0, n: 0 };
    g.sum += diff;
    g.n++;
    byGroup.set(group, g);
  }
  const groups = [...byGroup.values()];
  if (groups.length === 0) return { mean: 0, lo: 0, hi: 0, groups: 0 };
  const total = groups.reduce((a, g) => ({ sum: a.sum + g.sum, n: a.n + g.n }), { sum: 0, n: 0 });
  const means = [];
  for (let it = 0; it < iters; it++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[Math.floor(random() * groups.length)];
      sum += g.sum;
      n += g.n;
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    mean: total.sum / total.n,
    lo: means[Math.floor(0.025 * (iters - 1))],
    hi: means[Math.ceil(0.975 * (iters - 1))],
    groups: groups.length,
  };
}

/**
 * Slot-reserving merge of best-first lists: walk `pattern` (list indexes, e.g.
 * [0, 0, 1] = two from list 0 then one from list 1, repeating), taking each
 * list's next name not already placed, until every list is exhausted. Unlike
 * rank fusion, a list keeps its share of the top slots whatever the others say.
 */
export function interleave(lists, pattern) {
  const seen = new Set();
  const out = [];
  const pos = lists.map(() => 0);
  const next = (i) => {
    while (pos[i] < lists[i].length && seen.has(lists[i][pos[i]])) pos[i]++;
    return pos[i] < lists[i].length ? lists[i][pos[i]++] : undefined;
  };
  for (let step = 0; ; step++) {
    // a spent list's slot passes to the first list that still has names
    let name = next(pattern[step % pattern.length]);
    for (let j = 0; name === undefined && j < lists.length; j++) name = next(j);
    if (name === undefined) break;
    seen.add(name);
    out.push(name);
  }
  return out;
}
