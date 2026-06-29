// @vitest-environment node
//
// Substitute-weight CALIBRATION + regression, against an INDEPENDENT oracle.
//
// The substitute finder ranks owned cards as stand-ins for a missing staple
// using four weighted similarity terms (tags / type / subtype / cmc). Those
// weights used to be hand-guessed. This test grounds them in real data: EDHREC's
// per-card `similar` list — its own deck-co-occurrence answer to "what replaces
// this card", derived from millions of decks and completely independent of the
// tagger tags the scorer consumes (so it is NOT circular).
//
// Fixture: src/deck-builder/services/deckBuilder/__fixtures__/edhrec-similar.fixture.json
//   regenerate with `node scripts/fetch-edhrec-similar.mjs`.
//
// Two modes:
//   * regression (always, CI): the DEFAULT weights must clear a mean-nDCG@5 floor.
//   * grid search (TUNE=1):     prints the weight vector that maximizes mean nDCG@5.
//     `TUNE=1 npx vitest run src/deck-builder/services/deckBuilder/substituteFinder.eval.test.ts`

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadTaggerData,
  getCardTags,
  getCardSubtype,
  getCardRole,
  cardMatchesRole,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import {
  similarityScore,
  DEFAULT_SIMILARITY_WEIGHTS,
  type SimilarityWeights,
  type SubstituteCandidate,
} from './substituteFinder';
import type { GapAnalysisCard } from '@/deck-builder/types';

const here = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  cards: Record<string, { typeLine: string; cmc: number }>;
  similar: Record<string, string[]>;
}
const fx: Fixture = JSON.parse(
  readFileSync(resolve(here, '__fixtures__', 'edhrec-similar.fixture.json'), 'utf8')
);

// ── load REAL tagger tags (committed snapshot) by stubbing the network fetch ──
beforeAll(async () => {
  const taggerJson = readFileSync(
    resolve(here, '..', '..', '..', '..', 'public', 'tagger-tags.json'),
    'utf8'
  );
  const data = JSON.parse(taggerJson);
  // loadTaggerData() fetches TAG_REPO_URL; feed it the on-disk snapshot.
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => data,
  });
  const loaded = await loadTaggerData();
  if (!loaded) throw new Error('tagger data failed to load for eval');
  queries = buildQueries(); // needs tagger roles → must run AFTER load, not at import
});

// ── eval-set construction ────────────────────────────────────────────────────
// Faithful to the finder: the weights only re-rank candidates that already pass
// the role gate, so each query's candidate pool is its same-role cards, and the
// positives are the EDHREC-similar cards that survive that gate.

interface Card {
  name: string;
  typeLine: string;
  cmc: number;
}
interface Query {
  q: Card;
  pool: Card[];
  positives: Set<string>;
}

const cards: Record<string, Card> = {};
for (const [name, m] of Object.entries(fx.cards)) {
  cards[name] = { name, typeLine: m.typeLine, cmc: m.cmc };
}
const allNames = Object.keys(cards);

const asGap = (c: Card): GapAnalysisCard =>
  ({ name: c.name, typeLine: c.typeLine, cmc: c.cmc }) as GapAnalysisCard;
const asCand = (c: Card): SubstituteCandidate => ({
  name: c.name,
  colorIdentity: [],
  cmc: c.cmc,
  typeLine: c.typeLine,
});

function buildQueries(): Query[] {
  const out: Query[] = [];
  for (const [qName, simList] of Object.entries(fx.similar)) {
    const qc = cards[qName];
    if (!qc) continue;
    const role = getCardRole(qName) as RoleKey | null;
    if (!role) continue; // the finder needs a role to match within
    const pool = allNames
      .filter((n) => n !== qName && cardMatchesRole(n, role))
      .map((n) => cards[n]);
    const positives = new Set(simList.filter((n) => pool.some((p) => p.name === n)));
    if (positives.size === 0 || pool.length < 3) continue; // not evaluable
    out.push({ q: qc, pool, positives });
  }
  return out;
}
let queries: Query[] = []; // populated in beforeAll, once tagger roles are loaded

// ── metrics ──────────────────────────────────────────────────────────────────
function rankPool(q: Query, score: (a: Card, b: Card) => number): string[] {
  return [...q.pool]
    .sort((a, b) => {
      const d = score(q.q, b) - score(q.q, a);
      return d !== 0 ? d : a.name.localeCompare(b.name); // deterministic tiebreak
    })
    .map((c) => c.name);
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

function meanNdcg(score: (a: Card, b: Card) => number, k = 5): number {
  return mean(queries.map((q) => ndcgAtK(rankPool(q, score), q.positives, k)));
}

// Real scorer with a given weight vector (drives the production code path).
const scorerWith =
  (weights: SimilarityWeights) =>
  (qc: Card, cc: Card): number => {
    const wantedSub = getCardSubtype(qc.name);
    const subtypeMatch = wantedSub != null && getCardSubtype(cc.name) === wantedSub;
    const cmcDelta = Math.abs(cc.cmc - qc.cmc);
    return similarityScore(asGap(qc), asCand(cc), subtypeMatch, cmcDelta, weights);
  };

// ── tests ────────────────────────────────────────────────────────────────────
describe('substitute weight calibration (EDHREC similar-list oracle)', () => {
  it('has a usable eval set', () => {
    expect(queries.length).toBeGreaterThanOrEqual(30);
  });

  it('default weights clear the calibrated mean-nDCG@5 floor', () => {
    const score = scorerWith(DEFAULT_SIMILARITY_WEIGHTS);
    const ndcg = meanNdcg(score, 5);
    const p3 = mean(queries.map((q) => precisionAtK(rankPool(q, score), q.positives, 3)));
    console.log(
      `[substitute-eval] queries=${queries.length} meanNDCG@5=${ndcg.toFixed(4)} meanP@3=${p3.toFixed(4)}`
    );
    // Default weights score ~0.44 here (~0.46 on holdout) and are holdout-stable
    // — see the TUNE=1 grid/holdout. FLOOR sits just under that to catch a real
    // regression (a broken term, a bad reweight) without flaking on fixture
    // refreshes. Raise it only alongside a deliberate, holdout-validated change.
    expect(ndcg).toBeGreaterThanOrEqual(SUBSTITUTE_NDCG5_FLOOR);
  });

  it('beats a tags-only ranking (the four terms together earn their place)', () => {
    const full = meanNdcg(scorerWith(DEFAULT_SIMILARITY_WEIGHTS), 5);
    const tagsOnly = meanNdcg(scorerWith({ tags: 1, type: 0, subtype: 0, cmc: 0 }), 5);
    console.log(`[substitute-eval] full=${full.toFixed(4)} tagsOnly=${tagsOnly.toFixed(4)}`);
    expect(full).toBeGreaterThanOrEqual(tagsOnly);
  });

  it('grid-searches the weights (TUNE=1 only)', () => {
    if (!process.env.TUNE) return; // exploratory; skipped in CI

    // Precompute the four similarity components per (query, candidate) ONCE so
    // the 20k-combo sweep is just weighted dot-products, not 50M re-scorings.
    const jac = (a: Set<string>, b: Set<string>): number => {
      if (!a.size || !b.size) return 0;
      let i = 0;
      for (const x of a) if (b.has(x)) i++;
      return i / (a.size + b.size - i);
    };
    const typeTok = (t: string): Set<string> =>
      new Set(t.toLowerCase().replace(/[—-]/g, ' ').split(/\s+/).filter(Boolean));
    const tagsOf = new Map<string, Set<string>>();
    const typeOf = new Map<string, Set<string>>();
    const subOf = new Map<string, string | null>();
    for (const n of allNames) {
      tagsOf.set(n, new Set(getCardTags(n)));
      typeOf.set(n, typeTok(cards[n].typeLine));
      subOf.set(n, getCardSubtype(n));
    }
    interface Comp {
      tagSim: number;
      typeSim: number;
      subMatch: number;
      cmcSim: number;
      isPos: boolean;
    }
    const precomp = queries.map((q) => ({
      positives: q.positives,
      rows: q.pool.map((c): Comp & { name: string } => {
        const wantedSub = subOf.get(q.q.name) ?? null;
        return {
          name: c.name,
          tagSim: jac(tagsOf.get(q.q.name)!, tagsOf.get(c.name)!),
          typeSim: jac(typeOf.get(q.q.name)!, typeOf.get(c.name)!),
          subMatch: wantedSub != null && subOf.get(c.name) === wantedSub ? 1 : 0,
          cmcSim: 1 / (1 + Math.abs(c.cmc - q.q.cmc)),
          isPos: q.positives.has(c.name),
        };
      }),
    }));
    const ndcgFor = (w: SimilarityWeights): number =>
      mean(
        precomp.map(({ rows, positives }) => {
          const order = [...rows].sort((a, b) => {
            const d =
              w.tags * b.tagSim +
              w.type * b.typeSim +
              w.subtype * b.subMatch +
              w.cmc * b.cmcSim -
              (w.tags * a.tagSim + w.type * a.typeSim + w.subtype * a.subMatch + w.cmc * a.cmcSim);
            return d !== 0 ? d : a.name.localeCompare(b.name);
          });
          return ndcgAtK(
            order.map((r) => r.name),
            positives,
            5
          );
        })
      );

    const grid = [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1];
    let best = { ndcg: -1, w: DEFAULT_SIMILARITY_WEIGHTS };
    const ranked: { ndcg: number; w: SimilarityWeights }[] = [];
    for (const tags of grid) {
      for (const type of grid) {
        for (const subtype of grid) {
          for (const cmc of grid) {
            if (tags + type + subtype + cmc === 0) continue;
            const w = { tags, type, subtype, cmc };
            const ndcg = ndcgFor(w);
            ranked.push({ ndcg, w });
            if (ndcg > best.ndcg) best = { ndcg, w };
          }
        }
      }
    }
    ranked.sort((a, b) => b.ndcg - a.ndcg);

    // ndcg over an arbitrary subset of the precomputed queries (for holdout).
    const ndcgSubset = (w: SimilarityWeights, subset: typeof precomp): number =>
      mean(
        subset.map(({ rows, positives }) => {
          const order = [...rows].sort((a, b) => {
            const d =
              w.tags * b.tagSim +
              w.type * b.typeSim +
              w.subtype * b.subMatch +
              w.cmc * b.cmcSim -
              (w.tags * a.tagSim + w.type * a.typeSim + w.subtype * a.subMatch + w.cmc * a.cmcSim);
            return d !== 0 ? d : a.name.localeCompare(b.name);
          });
          return ndcgAtK(
            order.map((r) => r.name),
            positives,
            5
          );
        })
      );

    // Holdout: tune on even-indexed queries, report the winner's gain on the
    // odd-indexed holdout. If the gain survives, it generalizes; if it vanishes,
    // the grid max was overfitting the fixture.
    const train = precomp.filter((_, i) => i % 2 === 0);
    const hold = precomp.filter((_, i) => i % 2 === 1);
    let trainBest = { ndcg: -1, w: DEFAULT_SIMILARITY_WEIGHTS };
    for (const tags of grid)
      for (const type of grid)
        for (const subtype of grid)
          for (const cmc of grid) {
            if (tags + type + subtype + cmc === 0) continue;
            const w = { tags, type, subtype, cmc };
            const n = ndcgSubset(w, train);
            if (n > trainBest.ndcg) trainBest = { ndcg: n, w };
          }

    const def = DEFAULT_SIMILARITY_WEIGHTS;
    const tagsOnly = { tags: 1, type: 0, subtype: 0, cmc: 0 };
    const typeOnly = { tags: 0, type: 1, subtype: 0, cmc: 0 };
    console.log(
      `\n[substitute-tune] baselines (full set, nDCG@5):` +
        `\n  default     ${ndcgFor(def).toFixed(4)}  (${JSON.stringify(def)})` +
        `\n  tags-only   ${ndcgFor(tagsOnly).toFixed(4)}` +
        `\n  type-only   ${ndcgFor(typeOnly).toFixed(4)}` +
        `\n  grid-best   ${best.ndcg.toFixed(4)}  (${JSON.stringify(best.w)})` +
        `\n[substitute-tune] HOLDOUT (tune on even, score odd):` +
        `\n  default  on holdout ${ndcgSubset(def, hold).toFixed(4)}` +
        `\n  trainBest on holdout ${ndcgSubset(trainBest.w, hold).toFixed(4)}  (${JSON.stringify(trainBest.w)})` +
        `\n[substitute-tune] top 10 (full set):\n` +
        ranked
          .slice(0, 10)
          .map(
            (r) =>
              `  nDCG@5=${r.ndcg.toFixed(4)}  tags=${r.w.tags} type=${r.w.type} subtype=${r.w.subtype} cmc=${r.w.cmc}`
          )
          .join('\n')
    );
    expect(best.ndcg).toBeGreaterThan(0);
  });
});

// Validated floor — see the regression test above. Update only alongside a
// deliberate, holdout-validated weight/fixture change, never to paper over a
// real regression. Default weights score ~0.44; 0.40 leaves refresh headroom.
const SUBSTITUTE_NDCG5_FLOOR = 0.4;
