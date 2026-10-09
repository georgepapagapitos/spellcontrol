/**
 * Pairwise weight fit for the whole-deck objective (E516): real decklists
 * against perturbed copies of themselves.
 *
 * An example is the per-term VALUE delta (real deck minus perturbed deck) and
 * the group it came from (its commander). The real deck should score higher,
 * so every label is +1 and a weight vector is right on an example when
 * Σ w_k x_k > 0. Folds are grouped by commander: perturbations of one deck
 * share cards, so a random split would leak the deck into its own test.
 *
 * Non-negative logistic regression on the deltas, shrunk toward the HAND weights
 * (all ones: every term is already in card-equivalents), by damped
 * Newton. The objective is the MEAN loss plus lambda times the squared distance
 * of the weights from the hand weights (all ones). Pure and
 * deterministic. (validation.ts's fitBeta is the leave-one-out version for ~50
 * labeled pairs; it is far too slow for thousands.)
 */
import { hit, rng } from './validation';

export interface PairExample {
  /** Per-term value deltas: real minus perturbed. */
  x: Record<string, number>;
  /** The commander (or any unit that must not straddle a train/test split). */
  group: string;
}

export const PAIR_LAMBDAS = [0.0001, 0.001, 0.01, 0.1, 1] as const;

const dot = (x: Record<string, number>, w: Record<string, number>): number => {
  let s = 0;
  for (const k of Object.keys(w)) s += w[k] * (x[k] ?? 0);
  return s;
};

/** Share of examples the weights rank the real deck first (a tie counts half). */
export function pairAccuracy(
  examples: readonly PairExample[],
  weights: Record<string, number>
): number {
  if (examples.length === 0) return NaN;
  return (
    examples.reduce((s, e) => s + hit({ delta: dot(e.x, weights), label: 1 }), 0) / examples.length
  );
}

/** Mean log(1 + e^(−z)) of the weights on the examples. */
export function pairLogLoss(
  examples: readonly PairExample[],
  weights: Record<string, number>
): number {
  if (examples.length === 0) return NaN;
  return (
    examples.reduce((s, e) => s + Math.log(1 + Math.exp(-dot(e.x, weights))), 0) / examples.length
  );
}

/** Deterministic fold per group: shuffled group list dealt round-robin. */
export function groupFolds(groups: readonly string[], k: number, seed = 1): Map<string, number> {
  const unique = [...new Set(groups)].sort();
  const next = rng(seed);
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return new Map(unique.map((g, i) => [g, i % k]));
}

function betaToWeights(beta: number[], keys: readonly string[]): Record<string, number> {
  const mean = beta.reduce((s, b) => s + b, 0) / keys.length || 1;
  const out: Record<string, number> = {};
  keys.forEach((k, i) => (out[k] = beta[i] / mean));
  return out;
}

/** Solve A x = b (A symmetric positive definite, small) by Gaussian elimination. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

/**
 * Minimize mean log(1 + e^(−w·x)) + lambda Σ (w_k − 1)² over w ≥ 0: logistic
 * regression shrunk toward the HAND weights (all ones). Damped Newton on the
 * active terms; a term that goes negative is pinned at 0 and the rest refit.
 */
function newtonFit(xs: number[][], lambda: number): number[] {
  const d = xs[0]?.length ?? 0;
  const n = xs.length;
  const active = new Array<boolean>(d).fill(true);
  const w = new Array<number>(d).fill(1);
  const loss = (v: number[]): number => {
    let s = 0;
    for (const row of xs) {
      let z = 0;
      for (let k = 0; k < d; k++) z += v[k] * row[k];
      s += z > 30 ? Math.exp(-z) : Math.log(1 + Math.exp(-z));
    }
    let pen = 0;
    for (let k = 0; k < d; k++) pen += (v[k] - 1) ** 2;
    return s / n + lambda * pen;
  };
  for (let pass = 0; pass < d + 1; pass++) {
    const idx = active.flatMap((a, k) => (a ? [k] : []));
    if (idx.length === 0) break;
    for (let it = 0; it < 40; it++) {
      const grad = idx.map((k) => 2 * lambda * (w[k] - 1));
      const H = idx.map((_, i) => idx.map((__, j) => (i === j ? 2 * lambda : 0)));
      for (const row of xs) {
        let z = 0;
        for (let k = 0; k < d; k++) z += w[k] * row[k];
        const p = 1 / (1 + Math.exp(z)); // sigmoid(−z)
        const h = p * (1 - p);
        for (let i = 0; i < idx.length; i++) {
          grad[i] -= (p * row[idx[i]]) / n;
          for (let j = 0; j <= i; j++) {
            const v = (h * row[idx[i]] * row[idx[j]]) / n;
            H[i][j] += v;
            if (i !== j) H[j][i] += v;
          }
        }
      }
      const dir = solve(H, grad);
      const f0 = loss(w);
      let t = 1;
      let moved = false;
      for (let ls = 0; ls < 20; ls++, t /= 2) {
        const trial = w.slice();
        idx.forEach((k, i) => (trial[k] = w[k] - t * dir[i]));
        if (loss(trial) <= f0 + 1e-14) {
          idx.forEach((k) => (w[k] -= t * dir[idx.indexOf(k)]));
          moved = true;
          break;
        }
      }
      const step = Math.max(...dir.map(Math.abs)) * t;
      if (!moved || step < 1e-7) break;
    }
    const neg = idx.filter((k) => w[k] < 0);
    if (neg.length === 0) break;
    for (const k of neg) {
      active[k] = false;
      w[k] = 0;
    }
  }
  return w;
}

/** Fit on all examples at one lambda; weights normalized to mean 1. */
export function fitPairWeights(
  examples: readonly PairExample[],
  keys: readonly string[],
  lambda: number
): Record<string, number> {
  const xs = examples.map((e) => keys.map((k) => e.x[k] ?? 0));
  return betaToWeights(newtonFit(xs, lambda), keys);
}

/** The lambda with the lowest grouped-CV log loss on `examples` (inner folds). */
export function pickLambda(
  examples: readonly PairExample[],
  keys: readonly string[],
  folds = 4,
  seed = 11
): number {
  const fold = groupFolds(
    examples.map((e) => e.group),
    folds,
    seed
  );
  let best = { lambda: PAIR_LAMBDAS[PAIR_LAMBDAS.length - 1] as number, loss: Infinity };
  for (const lambda of PAIR_LAMBDAS) {
    let loss = 0;
    for (let f = 0; f < folds; f++) {
      const train = examples.filter((e) => fold.get(e.group) !== f);
      const test = examples.filter((e) => fold.get(e.group) === f);
      if (!train.length || !test.length) continue;
      loss += pairLogLoss(test, fitPairWeights(train, keys, lambda)) * test.length;
    }
    loss /= examples.length;
    if (loss < best.loss - 1e-9) best = { lambda, loss };
  }
  return best.lambda;
}

export interface HeldOutReport {
  /** Pooled held-out accuracy of the fitted weights (each example scored by a fit that never saw its commander). */
  fitted: number;
  /** The same examples under the hand weights (all ones over `keys`). */
  hand: number;
  fittedLogLoss: number;
  handLogLoss: number;
  /** Per-example fitted-vs-hand outcomes, for a paired comparison: [handHit, fittedHit]. */
  pairs: Array<[number, number]>;
  lambdas: number[];
  n: number;
}

/** Grouped k-fold: fit on k−1 folds (lambda picked inside them), score the held-out fold. */
export function heldOut(
  examples: readonly PairExample[],
  keys: readonly string[],
  folds = 5,
  seed = 3
): HeldOutReport {
  const hand = Object.fromEntries(keys.map((k) => [k, 1]));
  const fold = groupFolds(
    examples.map((e) => e.group),
    folds,
    seed
  );
  let fitHits = 0;
  let handHits = 0;
  let fitLoss = 0;
  let handLoss = 0;
  let n = 0;
  const pairs: Array<[number, number]> = [];
  const lambdas: number[] = [];
  for (let f = 0; f < folds; f++) {
    const train = examples.filter((e) => fold.get(e.group) !== f);
    const test = examples.filter((e) => fold.get(e.group) === f);
    if (!train.length || !test.length) continue;
    const lambda = pickLambda(train, keys);
    lambdas.push(lambda);
    const w = fitPairWeights(train, keys, lambda);
    for (const e of test) {
      const hf = hit({ delta: dot(e.x, w), label: 1 });
      const hh = hit({ delta: dot(e.x, hand), label: 1 });
      fitHits += hf;
      handHits += hh;
      pairs.push([hh, hf]);
    }
    fitLoss += pairLogLoss(test, w) * test.length;
    handLoss += pairLogLoss(test, hand) * test.length;
    n += test.length;
  }
  return {
    fitted: fitHits / n,
    hand: handHits / n,
    fittedLogLoss: fitLoss / n,
    handLogLoss: handLoss / n,
    pairs,
    lambdas,
    n,
  };
}
