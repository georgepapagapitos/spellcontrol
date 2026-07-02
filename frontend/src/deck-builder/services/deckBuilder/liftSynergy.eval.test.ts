// @vitest-environment node
//
// liftSynergy VALIDATION against an INDEPENDENT oracle.
//
// aggregateLiftCandidates ranks co-play candidates by clustering context cards'
// EDHREC card-page "lift" pools. This eval asks: does that ranking actually
// surface a commander's own EDHREC high-synergy cards better than the existing
// tags-only synergyFingerprint baseline (synergyFingerprint.ts), given only the
// SAME six context cards as input? The commander's own card page was never
// fetched for the fixture — positives are held out, not an input to either
// ranker, so this is not circular.
//
// Fixture: __fixtures__/edhrec-lift.fixture.json (24 queries, regenerate with
// `node scripts/fetch-edhrec-similar.mjs --lift`). Per query: a commander, 6
// context cards, ~10 positives (the commander's own high-synergy list) and
// ~30 distractors. liftPools carries each context card's card-page lift list
// as [name, lift, numDecks, potentialDecks] tuples (pre-filtered numDecks>=12,
// capped top-70-by-lift ∪ top-70-by-coplay — looser than the real adaptive
// floor, which this eval re-applies via liftDeckFloor).
//
// Observed (see console output of a real run):
//   lift     meanNDCG@10 full=0.8253  holdout(odd)=0.8410  meanP@10=0.7875
//   baseline meanNDCG@10 full=0.3369  holdout(odd)=0.2708  meanP@10=0.3250
// Lift beats the tags-only baseline by a wide, holdout-stable margin. Floor
// set well under the observed full-set mean to catch a real regression
// without flaking on fixture refreshes.
//
// TUNE=1 grid (K sensitivity, see bottom block): K in {10,25,50,100,200}
// produces IDENTICAL nDCG@10 on both halves. This fixture's pool candidates
// mostly have numDecks in the thousands (median ~20k across all lift-pool
// entries), so numDecks/(numDecks+K) is within ~1% of 1 for every K in that
// range — the confidence discount only bites for thin-sample candidates,
// most of which are already excluded by the adaptive floor. K=50 (inherited
// from the reference implementation, not tuned on this fixture) is provably
// not an overfit optimum here: it's indistinguishable from the rest of the
// range, not a cherry-picked winner.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTaggerData, getCardTags } from '@/deck-builder/services/tagger/client';
import { aggregateLiftCandidates, type LiftCandidate } from './liftSynergy';
import { buildSynergyFingerprint, synergyScore } from './synergyFingerprint';
import { liftDeckFloor, LIFT_STRICT_FLOOR } from '@/deck-builder/services/edhrec/client';
import type { LiftEntry } from '@/deck-builder/types';

const here = dirname(fileURLToPath(import.meta.url));

interface FixtureQuery {
  commander: string;
  context: string[];
  positives: string[];
  distractors: string[];
}
type LiftTuple = [name: string, lift: number, numDecks: number, potentialDecks: number];
interface Fixture {
  queries: FixtureQuery[];
  liftPools: Record<string, LiftTuple[]>;
}
const fx: Fixture = JSON.parse(
  readFileSync(resolve(here, '__fixtures__', 'edhrec-lift.fixture.json'), 'utf8')
);

// ── load REAL tagger tags (committed snapshot) by stubbing the network fetch ──
beforeAll(async () => {
  const taggerJson = readFileSync(
    resolve(here, '..', '..', '..', '..', 'public', 'tagger-tags.json'),
    'utf8'
  );
  const data = JSON.parse(taggerJson);
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  const loaded = await loadTaggerData();
  if (!loaded) throw new Error('tagger data failed to load for eval');
  queries = buildQueries();
});

afterAll(() => vi.unstubAllGlobals());

// ── eval-set construction ────────────────────────────────────────────────────

interface EvalQuery {
  commander: string;
  pool: string[]; // deduped, alphabetically sorted — deterministic, no positional bias
  positives: Set<string>;
  liftCandidatesByName: Map<string, LiftCandidate>; // lowercased name -> candidate (raw edges, for TUNE sweep too)
  fingerprint: Map<string, number>; // baseline synergy fingerprint over [commander, ...context]
}

function tuplesToPool(tuples: LiftTuple[]): LiftEntry[] {
  const out: LiftEntry[] = [];
  for (const [name, lift, numDecks, potentialDecks] of tuples) {
    if (numDecks < liftDeckFloor(potentialDecks)) continue; // real adaptive floor, stricter than fixture pre-filter
    out.push({
      name,
      lift,
      coPlayPct: potentialDecks > 0 ? Math.round((numDecks / potentialDecks) * 100) : 0,
      numDecks,
      potentialDecks,
      lowSample: numDecks < LIFT_STRICT_FLOOR,
    });
  }
  return out;
}

function buildQueries(): EvalQuery[] {
  const out: EvalQuery[] = [];
  for (const q of fx.queries) {
    const pool = [...new Set([...q.positives, ...q.distractors])].sort();
    const positives = new Set(q.positives.filter((n) => pool.includes(n)));
    if (positives.size < 5 || pool.length < 10) continue; // not evaluable

    const seedPools = new Map<string, LiftEntry[]>();
    for (const ctx of q.context) {
      const tuples = fx.liftPools[ctx];
      if (tuples) seedPools.set(ctx, tuplesToPool(tuples));
    }
    const candidates = aggregateLiftCandidates(seedPools, {
      excludeNames: new Set([q.commander, ...q.context]),
    });
    const liftCandidatesByName = new Map(candidates.map((c) => [c.name.toLowerCase(), c]));

    const fingerprint = buildSynergyFingerprint([q.commander, ...q.context], getCardTags);

    out.push({ commander: q.commander, pool, positives, liftCandidatesByName, fingerprint });
  }
  return out;
}
let queries: EvalQuery[] = []; // populated in beforeAll, once tagger tags are loaded

// ── metrics (mirrors substituteFinder.eval.test.ts) ─────────────────────────
function rankPool(pool: string[], scoreOf: (name: string) => number): string[] {
  return [...pool].sort((a, b) => {
    const d = scoreOf(b) - scoreOf(a);
    return d !== 0 ? d : a.localeCompare(b); // deterministic tiebreak
  });
}
function ndcgAtK(ranked: string[], positives: Set<string>, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) {
    if (positives.has(ranked[i])) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(k, positives.size); i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}
function precisionAtK(ranked: string[], positives: Set<string>, k: number): number {
  const kk = Math.min(k, ranked.length);
  if (kk === 0) return 0;
  let hit = 0;
  for (let i = 0; i < kk; i++) if (positives.has(ranked[i])) hit++;
  return hit / kk;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function liftScorer(q: EvalQuery): (name: string) => number {
  return (name) => q.liftCandidatesByName.get(name.toLowerCase())?.clusterScore ?? 0;
}
function baselineScorer(q: EvalQuery): (name: string) => number {
  return (name) => synergyScore(name, q.fingerprint, getCardTags);
}

function evalSet(qs: EvalQuery[], scorerOf: (q: EvalQuery) => (name: string) => number, k = 10) {
  const ndcgs = qs.map((q) => ndcgAtK(rankPool(q.pool, scorerOf(q)), q.positives, k));
  const precisions = qs.map((q) => precisionAtK(rankPool(q.pool, scorerOf(q)), q.positives, k));
  return { ndcg: mean(ndcgs), precision: mean(precisions) };
}

// Mirrors the scryfallFill owned-fallback re-rank comparator exactly: lift
// clusterScore primary, tags-only fingerprint synergyScore secondary, name
// asc as the deterministic tiebreak (see scryfallFill.ts).
function combinedRank(q: EvalQuery): string[] {
  const lift = liftScorer(q);
  const base = baselineScorer(q);
  return [...q.pool].sort((a, b) => lift(b) - lift(a) || base(b) - base(a) || a.localeCompare(b));
}
function evalSetCombined(qs: EvalQuery[], k = 10) {
  const ndcgs = qs.map((q) => ndcgAtK(combinedRank(q), q.positives, k));
  const precisions = qs.map((q) => precisionAtK(combinedRank(q), q.positives, k));
  return { ndcg: mean(ndcgs), precision: mean(precisions) };
}

// ── tests ────────────────────────────────────────────────────────────────────
describe('liftSynergy validation (EDHREC high-synergy-list oracle)', () => {
  it('has a usable eval set', () => {
    expect(queries.length).toBeGreaterThanOrEqual(18);
  });

  it('lift ranking beats the tags-only synergy fingerprint baseline (full set)', () => {
    const lift = evalSet(queries, liftScorer);
    const baseline = evalSet(queries, baselineScorer);
    console.log(
      `[liftSynergy-eval] full n=${queries.length} ` +
        `lift nDCG@10=${lift.ndcg.toFixed(4)} P@10=${lift.precision.toFixed(4)} | ` +
        `baseline nDCG@10=${baseline.ndcg.toFixed(4)} P@10=${baseline.precision.toFixed(4)}`
    );
    expect(lift.ndcg).toBeGreaterThan(baseline.ndcg);
    expect(lift.ndcg).toBeGreaterThanOrEqual(LIFT_NDCG10_FLOOR);
  });

  it('combined (lift + fingerprint tiebreak) scorer — the actual scryfallFill re-rank — beats baseline', () => {
    const combinedFull = evalSetCombined(queries);
    const baselineFull = evalSet(queries, baselineScorer);
    const liftFull = evalSet(queries, liftScorer);
    console.log(
      `[liftSynergy-eval] combined full n=${queries.length} nDCG@10=${combinedFull.ndcg.toFixed(4)} ` +
        `P@10=${combinedFull.precision.toFixed(4)} | lift-only nDCG@10=${liftFull.ndcg.toFixed(4)} | ` +
        `baseline nDCG@10=${baselineFull.ndcg.toFixed(4)}`
    );
    expect(combinedFull.ndcg).toBeGreaterThan(baselineFull.ndcg);
    expect(combinedFull.ndcg).toBeGreaterThanOrEqual(LIFT_NDCG10_FLOOR);

    const holdout = queries.filter((_, i) => i % 2 === 1);
    const combinedHoldout = evalSetCombined(holdout);
    const baselineHoldout = evalSet(holdout, baselineScorer);
    console.log(
      `[liftSynergy-eval] combined holdout(odd) n=${holdout.length} nDCG@10=${combinedHoldout.ndcg.toFixed(4)} | ` +
        `baseline nDCG@10=${baselineHoldout.ndcg.toFixed(4)}`
    );
    expect(combinedHoldout.ndcg).toBeGreaterThan(baselineHoldout.ndcg);
  });

  it('holds on the odd-index holdout half', () => {
    const holdout = queries.filter((_, i) => i % 2 === 1);
    const lift = evalSet(holdout, liftScorer);
    const baseline = evalSet(holdout, baselineScorer);
    console.log(
      `[liftSynergy-eval] holdout(odd) n=${holdout.length} ` +
        `lift nDCG@10=${lift.ndcg.toFixed(4)} | baseline nDCG@10=${baseline.ndcg.toFixed(4)}`
    );
    expect(lift.ndcg).toBeGreaterThan(baseline.ndcg);
  });

  it('sensitivity-sweeps LIFT_CONFIDENCE_K (TUNE=1 only)', () => {
    if (!process.env.TUNE) return; // exploratory; skipped in CI

    // Recompute each candidate's clusterScore under a different K, reusing the
    // already-aggregated edges (lift/coPlayPct/numDecks) rather than re-running
    // aggregateLiftCandidates per K.
    const scorerAt =
      (q: EvalQuery, k: number) =>
      (name: string): number => {
        const cand = q.liftCandidatesByName.get(name.toLowerCase());
        if (!cand) return 0;
        return cand.edges.reduce(
          (sum, e) => sum + e.lift * e.coPlayPct * (e.numDecks / (e.numDecks + k)),
          0
        );
      };
    const meanNdcgAt = (qs: EvalQuery[], k: number): number =>
      mean(qs.map((q) => ndcgAtK(rankPool(q.pool, scorerAt(q, k)), q.positives, 10)));

    const holdout = queries.filter((_, i) => i % 2 === 1);
    const rows = [10, 25, 50, 100, 200].map((k) => ({
      k,
      full: meanNdcgAt(queries, k),
      holdout: meanNdcgAt(holdout, k),
    }));
    console.log(
      `\n[liftSynergy-tune] K sensitivity (nDCG@10):\n` +
        rows
          .map((r) => `  K=${r.k}  full=${r.full.toFixed(4)}  holdout=${r.holdout.toFixed(4)}`)
          .join('\n')
    );
    expect(rows.find((r) => r.k === 50)).toBeDefined();
  });
});

// Validated floor — see the regression test above. Update only alongside a
// deliberate, holdout-validated change, never to paper over a real regression.
// Observed full-set mean ~0.825; 0.72 leaves refresh headroom.
const LIFT_NDCG10_FLOOR = 0.72;
