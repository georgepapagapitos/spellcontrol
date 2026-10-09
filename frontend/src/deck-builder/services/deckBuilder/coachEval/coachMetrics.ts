/**
 * Ranking metrics for the Coach benchmark (E539): precision@k of a ranked
 * cut list against labeled weak cards, recall@k of a ranked add list
 * against labeled missing cards, macro-averaged over decks, with a seeded
 * bootstrap over decks for the interval. Names compare by front face,
 * case-insensitively, so "Esika, God of the Tree" and the full DFC name meet.
 */
import { frontFaceName } from '@/lib/cards/card-text';

export function nameKey(name: string): string {
  return frontFaceName(name).trim().toLowerCase();
}

function keySet(names: Iterable<string>): Set<string> {
  return new Set([...names].map(nameKey));
}

/** Unique names in rank order (a list can name a card twice across surfaces). */
export function dedupeRanked(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = nameKey(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/** Hits in the top k of `ranked` that are labels. */
export function hitsAtK(ranked: readonly string[], labels: Iterable<string>, k: number): number {
  const want = keySet(labels);
  return dedupeRanked(ranked)
    .slice(0, k)
    .filter((n) => want.has(nameKey(n))).length;
}

/**
 * Precision@k: hits over the rows actually shown (min(k, list length)), so
 * a short list isn't charged for rows it never offered. Null when the list
 * is empty (no claim to score).
 */
export function precisionAtK(
  ranked: readonly string[],
  labels: Iterable<string>,
  k: number
): number | null {
  const shown = Math.min(k, dedupeRanked(ranked).length);
  if (shown === 0) return null;
  return hitsAtK(ranked, labels, k) / shown;
}

/** Recall@k over the labels. Null when there are no labels to recall. */
export function recallAtK(
  ranked: readonly string[],
  labels: Iterable<string>,
  k: number
): number | null {
  const want = keySet(labels);
  if (want.size === 0) return null;
  return hitsAtK(ranked, want, k) / want.size;
}

/** Mean of the non-null values, null when there are none. */
export function mean(values: readonly (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** mulberry32: a small seeded PRNG, so an interval is reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Interval {
  mean: number | null;
  lo: number | null;
  hi: number | null;
  /** Decks the statistic was computed over (non-null values). */
  n: number;
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * The mean of per-deck values with a percentile bootstrap interval (decks
 * resampled with replacement). Null values (a deck with nothing to score)
 * are dropped first.
 */
export function bootstrapMean(
  values: readonly (number | null)[],
  { resamples = 2000, seed = 539, level = 0.95 } = {}
): Interval {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length === 0) return { mean: null, lo: null, hi: null, n: 0 };
  const rand = seededRandom(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rand() * xs.length)];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return {
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    lo: quantile(means, tail),
    hi: quantile(means, 1 - tail),
    n: xs.length,
  };
}

/**
 * Paired bootstrap of the per-deck difference b − a (same decks on both
 * sides; a deck missing either value is dropped).
 */
export function bootstrapPairedDelta(
  a: readonly (number | null)[],
  b: readonly (number | null)[],
  opts?: { resamples?: number; seed?: number; level?: number }
): Interval {
  const diffs: (number | null)[] = a.map((x, i) => {
    const y = b[i];
    return x == null || y == null ? null : y - x;
  });
  return bootstrapMean(diffs, opts);
}

/** "0.31 [0.22, 0.40] n=57", or "n/a". */
export function formatInterval(iv: Interval, digits = 2): string {
  if (iv.mean == null || iv.lo == null || iv.hi == null) return 'n/a';
  const f = (x: number) => x.toFixed(digits);
  return `${f(iv.mean)} [${f(iv.lo)}, ${f(iv.hi)}] n=${iv.n}`;
}
