/**
 * Statistics for validating the objective against labeled gate runs: does
 * the sign of score(treatment) − score(baseline) agree with a per-deck
 * differ's verdict? Pure and seeded, so a validation run reproduces exactly.
 *
 * - agreement:      share of pairs whose delta sign matches the label (a tie
 *                   counts half: the score had no opinion).
 * - bootstrapCI:    percentile interval from resampling pairs with replacement.
 * - binomialTwoSided: exact p-value against chance (0.5).
 * - fitWeights:     non-negative logistic fit of the label on per-term value
 *                   deltas, no intercept (swapping the two decks must flip the
 *                   prediction), shrunk toward EQUAL weights (the prior: every
 *                   term is already in card-equivalents), with the shrinkage
 *                   picked by leave-one-out on the training set only.
 * - spearman:       rank correlation, ties averaged.
 */

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LabelledDelta {
  /** score(treatment) − score(baseline). */
  delta: number;
  /** +1 improved, −1 regressed. */
  label: 1 | -1;
}

/** 1 when the delta's sign matches the label, 0.5 on a tie, else 0. */
export function hit(p: LabelledDelta): number {
  if (p.delta === 0) return 0.5;
  return Math.sign(p.delta) === p.label ? 1 : 0;
}

export function agreement(pairs: readonly LabelledDelta[]): number {
  if (pairs.length === 0) return NaN;
  return pairs.reduce((s, p) => s + hit(p), 0) / pairs.length;
}

/** Percentile bootstrap interval of `stat` over resampled items. */
export function bootstrapCI<T>(
  items: readonly T[],
  stat: (sample: T[]) => number,
  opts: { reps?: number; seed?: number; level?: number } = {}
): [number, number] {
  const reps = opts.reps ?? 10000;
  const level = opts.level ?? 0.95;
  const next = rng(opts.seed ?? 1);
  const values: number[] = [];
  for (let r = 0; r < reps; r++) {
    const sample: T[] = [];
    for (let i = 0; i < items.length; i++) sample.push(items[Math.floor(next() * items.length)]);
    const v = stat(sample);
    if (Number.isFinite(v)) values.push(v);
  }
  values.sort((a, b) => a - b);
  const lo = values[Math.floor(((1 - level) / 2) * (values.length - 1))];
  const hi = values[Math.ceil((1 - (1 - level) / 2) * (values.length - 1))];
  return [lo, hi];
}

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** Exact two-sided binomial p-value of k successes in n against p = 0.5. */
export function binomialTwoSided(k: number, n: number): number {
  if (n === 0) return 1;
  const pmf = (i: number) => Math.exp(logChoose(n, i) - n * Math.log(2));
  const observed = pmf(Math.round(k));
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= observed * (1 + 1e-9)) p += pmf(i);
  return Math.min(1, p);
}

function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
}

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  return pearson(ranks(xs), ranks(ys));
}

export interface FitExample {
  /** Per-feature value deltas (treatment − baseline). */
  x: Record<string, number>;
  y: 1 | -1;
}

export interface WeightFit {
  /** Weights normalized so their mean is 1 (the prior is all ones). */
  weights: Record<string, number>;
  /** The shrinkage leave-one-out picked. */
  lambda: number;
  /** Leave-one-out agreement at that lambda (training set only). */
  looAgreement: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Minimize Σ log(1 + e^(−y β·x)) + λ Σ (β_k − β̄)², β ≥ 0, by projected
 * gradient descent (fixed steps, deterministic). β̄ is the mean of β, so the
 * penalty pulls toward equal weights without fixing the overall slope.
 */
function fitBeta(
  examples: readonly FitExample[],
  keys: readonly string[],
  lambda: number
): number[] {
  const n = keys.length;
  let beta = new Array<number>(n).fill(0.1);
  // Step size from the data scale: the largest squared feature norm.
  let maxNorm = 1e-9;
  for (const e of examples) {
    let s = 0;
    for (const k of keys) s += (e.x[k] ?? 0) ** 2;
    maxNorm = Math.max(maxNorm, s);
  }
  const step = 1 / (examples.length * maxNorm * 0.25 + 2 * lambda + 1e-9);
  for (let it = 0; it < 4000; it++) {
    const grad = new Array<number>(n).fill(0);
    for (const e of examples) {
      let z = 0;
      for (let k = 0; k < n; k++) z += beta[k] * (e.x[keys[k]] ?? 0);
      const g = -e.y * sigmoid(-e.y * z);
      for (let k = 0; k < n; k++) grad[k] += g * (e.x[keys[k]] ?? 0);
    }
    const mean = beta.reduce((s, b) => s + b, 0) / n;
    for (let k = 0; k < n; k++) grad[k] += 2 * lambda * (beta[k] - mean);
    beta = beta.map((b, k) => Math.max(0, b - step * grad[k]));
  }
  return beta;
}

export const LAMBDAS = [0.001, 0.01, 0.1, 1, 10, 100] as const;

export function fitWeights(examples: readonly FitExample[], keys: readonly string[]): WeightFit {
  let best: { lambda: number; loo: number; loss: number } | null = null;
  for (const lambda of LAMBDAS) {
    let hits = 0;
    let loss = 0;
    for (let i = 0; i < examples.length; i++) {
      const train = examples.filter((_, j) => j !== i);
      const beta = fitBeta(train, keys, lambda);
      const e = examples[i];
      let z = 0;
      keys.forEach((k, j) => (z += beta[j] * (e.x[k] ?? 0)));
      hits += hit({ delta: z, label: e.y });
      loss += Math.log(1 + Math.exp(-e.y * z));
    }
    const loo = hits / examples.length;
    // Best LOO agreement; ties go to the lower held-out log loss, then the
    // STRONGER shrinkage (closer to the prior).
    if (
      !best ||
      loo > best.loo + 1e-12 ||
      (Math.abs(loo - best.loo) <= 1e-12 && loss < best.loss - 1e-9) ||
      (Math.abs(loo - best.loo) <= 1e-12 &&
        Math.abs(loss - best.loss) <= 1e-9 &&
        lambda > best.lambda)
    ) {
      best = { lambda, loo, loss };
    }
  }
  const beta = fitBeta(examples, keys, best!.lambda);
  const mean = beta.reduce((s, b) => s + b, 0) / keys.length || 1;
  const weights: Record<string, number> = {};
  keys.forEach((k, i) => (weights[k] = beta[i] / mean));
  return { weights, lambda: best!.lambda, looAgreement: best!.loo };
}

/** Σ w_k × x_k. */
export function weightedDelta(x: Record<string, number>, weights: Record<string, number>): number {
  let s = 0;
  for (const [k, v] of Object.entries(x)) s += (weights[k] ?? 0) * v;
  return s;
}
