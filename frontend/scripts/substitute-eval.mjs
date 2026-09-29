#!/usr/bin/env node
// Substitute ranking v2 (E517): fit, evaluate and ablate the role-conditioned
// ranker in src/deck-builder/services/substitutes against hand-graded
// judgments, next to the two rankers the suggestion surfaces ran before it.
//
//   node scripts/substitute-eval.mjs              evaluate + ablate (prints the tables)
//   node scripts/substitute-eval.mjs --fit        also print the weights to ship
//   node scripts/substitute-eval.mjs --pool F     write every pooled system's unjudged
//                                                 top 5, with oracle text, to F for grading
//   node scripts/substitute-eval.mjs --errors     list each main system's misses by bucket
//
// JUDGMENTS. Every (query, role, candidate, grade 0-3) was graded by reading
// oracle text, never derived from the tagger corpus, the card-facts extractor
// or EDHREC (grading a signal against labels built from it would be circular):
//   cardFacts/substitutes.fixtures.ts     lane B's 89 symmetric rows
//   substitutes/judgments.fixtures.ts     the pooled rows this eval added (its
//                                         header says how they were graded)
//
// SYSTEMS, per query (card Q, role R), each ranking the whole commander-legal
// universe:
//   owned-v1        the collection lane before v2: EDHREC similar rank first,
//                   then the validated tagger-tag heuristic
//   owned-v1 w/o EDHREC   its heuristic alone: what v1 does for a card
//                   EDHREC's similar lists don't cover
//   similar-v1      the Similar cards strip before v2: synergy-axis Jaccard +
//                   tagger role + mana value + type, 0.15 floor
//   lane B          IDF-weighted Jaccard over card-facts tags, role-filtered
//   v2              the fitted linear ranker (features.ts), and v2 with each
//                   signal group removed, and each group alone
//
// PROTOCOLS. "owned lane": candidates pass the tagger role gate the collection
// lane applies (only the ORDER differs between systems, as in the app).
// "similar strip": no role gate. Both drop lands for a nonland query and vice
// versa, as the finder does.
//
// METRICS, per query; unjudged candidates count as grade 0 (conservative), and
// ties are scored in expectation over a random order:
//   nDCG@5, nDCG@10   graded, ideal = the query's judged grades
//   R@10              share of the query's grade>=2 candidates in the top 10
//   judged@5          share of the top 5 that is graded (pool coverage; a
//                     system with low coverage is scored low by construction)
// 95% intervals from 2,000 seeded bootstrap draws over queries; the paired
// difference against v1 is also resampled over query FAMILIES (connected
// components of lane B's rows), because queries in one family are not
// independent.
//
// HELD OUT. v2's weights are fitted by leave-one-role-out cross-validation
// (the L2 strength picked by an inner leave-one-role-out on the training
// roles): every query is scored by a model that never saw a judgment for its
// role. Training pairs are the judged candidates plus 30 random universe cards
// per query as grade 0, so a feature isn't learned backwards from the pool's
// own selection (every pooled card already looked similar to some ranker).
// The shipped weights are the same fit on every judgment.
//
// Reads public/card-facts.json, public/tagger-tags.json, public/card-similar.json
// and the cached Scryfall oracle_cards bulk file (refresh-card-facts.mjs caches
// it; --bulk <file> pins one). Offline.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FRONTEND, ensureBulk, inUniverse, streamBulk } from './card-facts-lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// ── Load the TypeScript modules through ONE module runner ──────────────────
// The tagger client and the similar index keep module state; importing them
// through separate runners would give the finder a tagger that never loaded.
async function importTogether(modules) {
  const { runnerImport } = await import('vite');
  const abs = (p) => join(FRONTEND, 'src', p).replace(/\\/g, '/');
  const entry = Object.entries(modules)
    .map(([k, p]) => `export * as ${k} from ${JSON.stringify(abs(p))};`)
    .join('\n');
  const pkg = (name) => join(FRONTEND, '..', 'packages', name, 'src', 'index.ts');
  const config = {
    configFile: false,
    root: FRONTEND,
    logLevel: 'error',
    resolve: {
      alias: {
        // The shared packages' ESM dist is bundler-only; alias their sources.
        '@spellcontrol/deck-metrics': pkg('deck-metrics'),
        '@spellcontrol/binder-routing': pkg('binder-routing'),
        '@': join(FRONTEND, 'src'),
      },
    },
    plugins: [
      {
        name: 'substitute-eval-entry',
        resolveId: (id) => (id === 'virtual:entry' ? '\0virtual:entry' : null),
        load: (id) => (id === '\0virtual:entry' ? entry : null),
      },
    ],
  };
  return (await runnerImport('virtual:entry', config)).module;
}

const m = await importTogether({
  codec: 'deck-builder/services/cardFacts/codec.ts',
  schema: 'deck-builder/services/cardFacts/schema.ts',
  sim: 'deck-builder/services/cardFacts/similarity.ts',
  subs: 'deck-builder/services/cardFacts/substitutes.fixtures.ts',
  bench: 'deck-builder/services/cardFacts/bench.ts',
  features: 'deck-builder/services/substitutes/features.ts',
  ranker: 'deck-builder/services/substitutes/ranker.ts',
  judgments: 'deck-builder/services/substitutes/judgments.fixtures.ts',
  tagger: 'deck-builder/services/tagger/client.ts',
  similar: 'deck-builder/services/deckBuilder/cardSimilar.ts',
  finder: 'deck-builder/services/deckBuilder/substituteFinder.ts',
  similarCards: 'lib/similar-cards.ts',
});
const FEATURES = m.features.FEATURES;

// ── Data ────────────────────────────────────────────────────────────────────
const readJson = async (file) => JSON.parse(await readFile(join(FRONTEND, 'public', file), 'utf8'));
const [snapshot, taggerJson, similarJson] = await Promise.all([
  readJson('card-facts.json'),
  readJson('tagger-tags.json'),
  readJson('card-similar.json'),
]);
const served = { 'tagger-tags.json': taggerJson, 'card-similar.json': similarJson };
globalThis.fetch = async (url) => {
  const body = served[String(url).split('/').pop()];
  return { ok: !!body, status: body ? 200 : 404, json: async () => body };
};
const quiet = console.debug;
console.debug = () => {};
await m.tagger.loadTaggerData();
await m.similar.loadCardSimilar();
console.debug = quiet;

const facts = snapshot.cards.map((c) => m.codec.decodeCard(snapshot, c));
const byName = new Map(facts.map((f) => [f.name, f]));

// Scryfall records: oracle text for the grading packets, and the card shape
// similar-v1's synergy-axis classifier reads.
const bulk = await ensureBulk({ explicit: opt('--bulk'), offline: true });
const scry = new Map();
for await (const c of streamBulk(bulk.path)) if (inUniverse(c)) scry.set(c.oracle_id, c);
const universe = facts.filter((f) => scry.has(f.oracleId));

const tagIdf = m.sim.tagIdf(facts.map((f) => m.features.cardTags(f)));
const sources = (idf) => ({
  idf,
  similarRank: (n) => m.similar.getSimilarRank(n),
  taggerRole: (n) => m.tagger.getCardRole(n),
  taggerSubtype: (n) => m.tagger.getCardSubtype(n),
  taggerTags: (n) => m.tagger.getCardTags(n),
});
// v2 ships without IDF (see "v2 with IDF" in the tables): the runtime would
// have to decode the whole snapshot to compute it.
const SRC = sources(null);
const SRC_IDF = sources(tagIdf);

// ── Judgments: (query, role) → candidate → grade ───────────────────────────
const queries = new Map();
const judge = (q, c, role, grade) => {
  if (!byName.has(q) || !byName.has(c) || q === c) return;
  const key = `${q}\u0000${role}`;
  let entry = queries.get(key);
  if (!entry) queries.set(key, (entry = { q, role, grades: new Map() }));
  entry.grades.set(c, grade);
};
for (const r of m.subs.SUBSTITUTES) {
  judge(r.a, r.b, r.role, r.grade);
  judge(r.b, r.a, r.role, r.grade);
}
for (const r of m.judgments.JUDGMENTS) judge(r.q, r.c, r.role, r.grade);
const evalQueries = [...queries.values()].filter((e) => [...e.grades.values()].some((g) => g >= 2));

// Families: connected components of lane B's grade >= 2 rows, for the
// cluster bootstrap.
const familyOf = (() => {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  const add = (x) => parent.has(x) || parent.set(x, x);
  for (const r of m.subs.SUBSTITUTES) {
    add(r.a);
    add(r.b);
    if (r.grade >= 2) parent.set(find(r.a), find(r.b));
  }
  return (e) => `${e.role}:${parent.has(e.q) ? find(e.q) : e.q}`;
})();

// ── Gates and the v1 rankers ────────────────────────────────────────────────
const isLand = (f) => f.types.includes('land');
/** The tagger role the owned lane gates on: the role's tagger key, else the card's own. */
function taggerRoleFor(q, role) {
  const mapped = m.features.isFactRole(role) ? m.schema.ROLE_TO_TAGGER[role].roleKey : null;
  return mapped ?? m.tagger.getCardRole(q.name);
}
function gateFor(q, role, protocol) {
  if (protocol !== 'owned') return () => true;
  const tr = taggerRoleFor(q, role);
  return tr ? (c) => m.tagger.cardMatchesRole(c.name, tr) : () => false;
}
function candidates(e, protocol) {
  const q = byName.get(e.q);
  const gate = gateFor(q, e.role, protocol);
  return universe.filter((c) => c.oracleId !== q.oracleId && isLand(c) === isLand(q) && gate(c));
}

/** owned-v1's comparator as one number: EDHREC similar rank first, then the heuristic (< 1). */
function ownedV1Score(q, { edhrec = true } = {}) {
  const ranks = edhrec ? m.similar.getSimilarRank(q.name) : null;
  const qSub = m.tagger.getCardSubtype(q.name);
  const missing = {
    name: q.name,
    typeLine: scry.get(q.oracleId)?.type_line,
    cmc: q.mv ?? undefined,
  };
  return (c) => {
    const subtypeMatch = qSub != null && m.tagger.getCardSubtype(c.name) === qSub;
    const cmcDelta = q.mv != null && c.mv != null ? Math.abs(q.mv - c.mv) : Infinity;
    const h = m.finder.similarityScore(
      missing,
      {
        name: c.name,
        colorIdentity: [],
        cmc: c.mv ?? undefined,
        typeLine: scry.get(c.oracleId)?.type_line,
      },
      subtypeMatch,
      cmcDelta
    );
    const rank = ranks?.get(c.name);
    return rank === undefined ? h : 1000 - rank;
  };
}
function similarV1Score(q) {
  const target = { card: scry.get(q.oracleId), role: m.tagger.getCardRole(q.name) };
  return (c) => {
    const { score } = m.similarCards.scoreSimilarity(target, {
      card: scry.get(c.oracleId),
      role: m.tagger.getCardRole(c.name),
    });
    return score < 0.15 ? -Infinity : score; // computeSimilarCards' noise floor
  };
}
function laneBScore(q, role) {
  const qt = m.features.cardTags(q);
  return (c) =>
    (c.strengths[role] ?? 0) >= 0.6
      ? m.sim.weightedJaccard(qt, m.features.cardTags(c), tagIdf)
      : -Infinity;
}

// ── Features and training items ─────────────────────────────────────────────
const featureCache = new Map();
function featuresFor(e, c, src = SRC) {
  const key = `${e.q}\u0000${e.role}\u0000${c.name}\u0000${src === SRC ? 1 : 0}`;
  let v = featureCache.get(key);
  if (!v) featureCache.set(key, (v = m.features.pairFeatures(byName.get(e.q), c, e.role, src).x));
  return v;
}
const dot = (w, x) => FEATURES.reduce((s, f) => s + (w[f] ?? 0) * x[f], 0);

const NEGATIVES = 30;
const negativesOf = new Map();
/** Seeded random universe cards for a query, graded 0 for training only. */
function negatives(e) {
  const key = `${e.q}\u0000${e.role}`;
  let out = negativesOf.get(key);
  if (out) return out;
  const q = byName.get(e.q);
  const rand = m.bench.mulberry32(
    m.bench.BOOTSTRAP_SEED + [...key].reduce((s, ch) => s + ch.charCodeAt(0), 0)
  );
  out = [];
  while (out.length < NEGATIVES) {
    const c = universe[Math.floor(rand() * universe.length)];
    if (c.oracleId === q.oracleId || isLand(c) !== isLand(q) || e.grades.has(c.name)) continue;
    if (!out.includes(c)) out.push(c);
  }
  negativesOf.set(key, out);
  return out;
}
const judgedItems = (e) => [...e.grades].map(([name, grade]) => ({ c: byName.get(name), grade }));
const trainItems = (e) => [...judgedItems(e), ...negatives(e).map((c) => ({ c, grade: 0 }))];

// ── Pairwise logistic ranker (L2), fitted by Newton's method ───────────────
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || M[c][c] === 0) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (row[i] === 0 ? 0 : row[n] / row[i]));
}
/**
 * The sign each weight must take: every similarity feature can only raise a
 * score, a polarity clash can only lower it. A fit that flips a sign is
 * leaning on a collinear partner (cardTags against roleTags) or on a feature
 * that almost never fires (polarity), and would rank a false friend UP.
 */
const SIGN = (f) => (f === 'polarity' ? -1 : 1);

/**
 * Sign-constrained fit (active set): fit, drop the feature whose weight has
 * the wrong sign by the widest margin, refit, until every sign holds. `free`
 * skips the constraint (the "unconstrained" row).
 */
function fit(train, feats, lambda, src = SRC, free = false) {
  let active = [...feats];
  for (;;) {
    const w = fitFree(train, active, lambda, src);
    if (free) return w;
    const wrong = active
      .filter((f) => w[f] * SIGN(f) < 0)
      .sort((a, b) => w[a] * SIGN(a) - w[b] * SIGN(b));
    if (wrong.length === 0) return w;
    active = active.filter((f) => f !== wrong[0]);
  }
}

/**
 * Weights over `feats`, standardized for the fit and returned in raw units.
 * Every query weighs the same; a pair inside a query weighs its grade gap.
 */
function fitFree(train, feats, lambda, src = SRC) {
  const vec = (e, c) => feats.map((f) => featuresFor(e, c, src)[f]);
  const rows = train.flatMap((e) => trainItems(e).map((it) => vec(e, it.c)));
  const sd = feats.map((_, j) => {
    const mu = mean(rows.map((r) => r[j]));
    return Math.sqrt(mean(rows.map((r) => (r[j] - mu) ** 2)));
  });
  const pairs = [];
  for (const e of train) {
    const items = trainItems(e).map((it) => ({
      g: it.grade,
      v: vec(e, it.c).map((x, j) => (sd[j] ? x / sd[j] : 0)),
    }));
    const local = [];
    for (const a of items)
      for (const b of items)
        if (a.g > b.g) local.push({ d: a.v.map((x, j) => x - b.v[j]), w: a.g - b.g });
    const tot = local.reduce((s, p) => s + p.w, 0);
    for (const p of local) pairs.push({ d: p.d, w: p.w / tot });
  }
  const n = feats.length;
  let w = new Array(n).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    const g = w.map((x) => lambda * x);
    const H = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? lambda : 0))
    );
    for (const p of pairs) {
      const z = p.d.reduce((s, x, j) => s + x * w[j], 0);
      const s = 1 / (1 + Math.exp(-z));
      for (let i = 0; i < n; i++) {
        g[i] += p.w * (s - 1) * p.d[i];
        for (let j = 0; j < n; j++) H[i][j] += p.w * s * (1 - s) * p.d[i] * p.d[j];
      }
    }
    const step = solve(H, g);
    w = w.map((x, i) => x - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-10) break;
  }
  const out = Object.fromEntries(FEATURES.map((f) => [f, 0]));
  feats.forEach((f, j) => (out[f] = sd[j] ? w[j] / sd[j] : 0));
  return out;
}

// ── Metrics ─────────────────────────────────────────────────────────────────
/**
 * Graded nDCG@k over scored items (unjudged = grade 0), ties in expectation.
 * One pass over the scores: only the judged items' rank statistics matter.
 */
function metrics(items, idealGrades) {
  const judged = items.filter((i) => i.judged && Number.isFinite(i.score));
  const thr = [...new Set(judged.map((i) => i.score))].sort((a, b) => b - a);
  const bucket = new Array(thr.length + 1).fill(0);
  const equalCnt = new Array(thr.length).fill(0);
  for (const it of items) {
    const s = it.score;
    if (!Number.isFinite(s)) continue;
    let lo = 0;
    let hi = thr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (thr[mid] > s) lo = mid + 1;
      else hi = mid;
    }
    const tie = lo < thr.length && thr[lo] === s;
    if (tie) equalCnt[lo]++;
    bucket[tie ? lo + 1 : lo]++;
  }
  const greaterAt = [];
  let acc = 0;
  for (let k = 0; k < thr.length; k++) greaterAt.push((acc += bucket[k]));
  const stat = new Map(thr.map((s, k) => [s, { greater: greaterAt[k], equal: equalCnt[k] - 1 }]));
  const at = (k) => {
    let dcg = 0;
    let judgedTop = 0;
    let rel = 0;
    for (const it of judged) {
      const { greater, equal } = stat.get(it.score);
      const pIn = Math.max(0, Math.min(1, (k - greater) / (equal + 1)));
      judgedTop += pIn;
      if (it.grade >= 2) rel += pIn;
      if (it.grade === 0) continue;
      let disc = 0;
      for (let p = greater; p <= greater + equal; p++) if (p < k) disc += 1 / Math.log2(p + 2);
      dcg += ((2 ** it.grade - 1) * disc) / (equal + 1);
    }
    const ideal = [...idealGrades]
      .sort((a, b) => b - a)
      .slice(0, k)
      .reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
    const nRel = idealGrades.filter((g) => g >= 2).length;
    return { ndcg: ideal ? dcg / ideal : 0, judged: judgedTop / k, recall: nRel ? rel / nRel : 0 };
  };
  return { n5: at(5).ndcg, n10: at(10).ndcg, r10: at(10).recall, j5: at(5).judged };
}

function bootstrap(values, clusters = null) {
  const ITER = 2000;
  const rand = m.bench.mulberry32(m.bench.BOOTSTRAP_SEED);
  const groups = clusters
    ? [
        ...Map.groupBy(
          values.map((v, i) => [clusters[i], v]),
          ([c]) => c
        ).values(),
      ].map((g) => g.map(([, v]) => v))
    : values.map((v) => [v]);
  const means = [];
  for (let i = 0; i < ITER; i++) {
    let s = 0;
    let n = 0;
    for (let j = 0; j < groups.length; j++) {
      const g = groups[Math.floor(rand() * groups.length)];
      for (const v of g) s += v;
      n += g.length;
    }
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(ITER * 0.025)], means[Math.floor(ITER * 0.975)]];
}
const fmt = (vals) => {
  const [lo, hi] = bootstrap(vals);
  return `${mean(vals).toFixed(3)} [${lo.toFixed(3)}, ${hi.toFixed(3)}]`;
};
const sign = (x) => (x >= 0 ? '+' : '') + x.toFixed(3);
const fmtDiff = (diffs, clusters) => {
  const [lo, hi] = bootstrap(diffs);
  const [clo, chi] = bootstrap(diffs, clusters);
  return `${sign(mean(diffs))} [${sign(lo)}, ${sign(hi)}] fam [${sign(clo)}, ${sign(chi)}]`;
};

// ── Cross-validation ────────────────────────────────────────────────────────
const LAMBDAS = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1];
const rolesOf = (qs) => [...new Set(qs.map((e) => e.role))];
/** Held-out nDCG@5 over the judged + negative items (the fast inner metric). */
const innerScore = (e, w, src) =>
  metrics(
    trainItems(e).map((it) => ({
      score: dot(w, featuresFor(e, it.c, src)),
      grade: it.grade,
      judged: true,
    })),
    [...e.grades.values()]
  ).n5;
function pickLambda(qs, feats, src) {
  let best = null;
  for (const lambda of LAMBDAS) {
    const s = [];
    for (const role of rolesOf(qs)) {
      const w = fit(
        qs.filter((e) => e.role !== role),
        feats,
        lambda,
        src
      );
      for (const e of qs.filter((x) => x.role === role)) s.push(innerScore(e, w, src));
    }
    if (!best || mean(s) > best.s) best = { lambda, s: mean(s) };
  }
  return best.lambda;
}
/**
 * Leave-one-role-out. λ comes from an inner leave-one-role-out on the training
 * roles; a variant given `lambdas` (the full model's, per fold) reuses them, so
 * an ablation differs from v2 only in its features.
 */
function crossValidate(feats, src = SRC, lambdas = null, free = false) {
  const weightsByRole = new Map();
  const lambdaByRole = new Map();
  for (const role of rolesOf(evalQueries)) {
    const train = evalQueries.filter((e) => e.role !== role);
    const lambda = lambdas?.get(role) ?? pickLambda(train, feats, src);
    weightsByRole.set(role, fit(train, feats, lambda, src, free));
    lambdaByRole.set(role, lambda);
  }
  return { weightsByRole, lambdaByRole };
}

const GROUPS = {
  structure: ['roleTags', 'cardTags', 'sameEffect', 'polarity', 'interaction'],
  'role strength': ['roleStrength'],
  'EDHREC similar': ['edhrec'],
  tagger: ['taggerRole', 'taggerSub', 'taggerTags'],
  'mana value': ['mv'],
  type: ['type'],
};

const t0 = Date.now();
const cvFull = crossValidate(FEATURES);
const cvIdf = crossValidate(FEATURES, SRC_IDF, cvFull.lambdaByRole);
const cvFree = crossValidate(FEATURES, SRC, cvFull.lambdaByRole, true);
const ablations = Object.entries(GROUPS).map(([name, drop]) => ({
  name,
  cv: crossValidate(
    FEATURES.filter((f) => !drop.includes(f)),
    SRC,
    cvFull.lambdaByRole
  ),
}));
const alone = Object.entries(GROUPS).map(([name, keep]) => ({
  name,
  cv: crossValidate(
    FEATURES.filter((f) => keep.includes(f)),
    SRC,
    cvFull.lambdaByRole
  ),
}));
const finalLambda = pickLambda(evalQueries, FEATURES, SRC);
const finalWeights = fit(evalQueries, FEATURES, finalLambda, SRC);
console.log(
  `[eval] ${evalQueries.length} queries (${m.subs.SUBSTITUTES.length} lane B rows, ${m.judgments.JUDGMENTS.length} pooled judgments), ${universe.length} cards in the universe; fits in ${((Date.now() - t0) / 1000).toFixed(0)} s`
);
console.log(
  `[eval] λ per held-out role: ${JSON.stringify(Object.fromEntries(cvFull.lambdaByRole))}\n`
);

// The hand-set prior the first grading pool was drawn with, kept as a baseline.
const PRIOR = {
  roleTags: 1,
  cardTags: 0.5,
  sameEffect: 1,
  polarity: -1,
  interaction: 0.5,
  roleStrength: 0.5,
  mv: 0.3,
  type: 0.3,
  edhrec: 1,
  taggerRole: 0.3,
  taggerSub: 0.3,
  taggerTags: 0.3,
};

// Fixed-weight baseline: every feature at unit weight over its spread (polarity negative).
const equalWeights = (() => {
  const rows = evalQueries.flatMap((e) => trainItems(e).map((it) => featuresFor(e, it.c)));
  return Object.fromEntries(
    FEATURES.map((f) => {
      const mu = mean(rows.map((r) => r[f]));
      const sd = Math.sqrt(mean(rows.map((r) => (r[f] - mu) ** 2))) || 1;
      return [f, (f === 'polarity' ? -1 : 1) / sd];
    })
  );
})();

// ── Systems over the universe ───────────────────────────────────────────────
// A v2 variant scores with the weights of the fold that held its query's role out.
const linear = (label, pick, src = SRC) => ({ label, kind: 'v2', src, weights: pick });
const byFold = (cv) => (e) => cv.weightsByRole.get(e.role);
function systemsFor(protocol) {
  return [
    protocol === 'owned'
      ? { label: 'owned-v1 (shipped)', kind: 'fn', score: (e) => ownedV1Score(byName.get(e.q)) }
      : {
          label: 'similar-v1 (shipped)',
          kind: 'fn',
          score: (e) => similarV1Score(byName.get(e.q)),
        },
    ...(protocol === 'owned'
      ? [
          {
            label: 'owned-v1 w/o EDHREC',
            kind: 'fn',
            score: (e) => ownedV1Score(byName.get(e.q), { edhrec: false }),
          },
        ]
      : []),
    { label: 'lane B facts-idf+R', kind: 'fn', score: (e) => laneBScore(byName.get(e.q), e.role) },
    linear('v2 prior (unfitted)', () => PRIOR),
    linear('v2 equal weights', () => equalWeights),
    linear('v2 (held-out fit)', byFold(cvFull)),
    linear('v2 with IDF', byFold(cvIdf), SRC_IDF),
    linear('v2 unconstrained signs', byFold(cvFree)),
    ...ablations.map((a) => linear(`v2 minus ${a.name}`, byFold(a.cv))),
    ...alone.map((a) => linear(`${a.name} alone`, byFold(a.cv))),
  ];
}
/** Systems whose top 5 is pooled for grading (every system in the headline table). */
const POOLED = new Set([
  'owned-v1 (shipped)',
  'similar-v1 (shipped)',
  'v2 (held-out fit)',
  'v2 minus structure',
  'v2 minus EDHREC similar',
  'owned-v1 w/o EDHREC',
]);

/** Score every system on every query over the universe: metrics, and each system's top 5. */
function runUniverse(protocol) {
  const qs = evalQueries.filter((e) => {
    const gate = gateFor(byName.get(e.q), e.role, protocol);
    return [...e.grades].some(([n, g]) => g >= 2 && gate(byName.get(n)));
  });
  const systems = systemsFor(protocol);
  const perSystem = new Map(systems.map((s) => [s.label, []]));
  const tops = new Map(systems.map((s) => [s.label, []]));
  for (const e of qs) {
    const q = byName.get(e.q);
    const pool = candidates(e, protocol);
    const gate = gateFor(q, e.role, protocol);
    const ideal = [...e.grades].filter(([n]) => gate(byName.get(n))).map(([, g]) => g);
    const needIdf = systems.some((s) => s.src === SRC_IDF);
    const x = pool.map((c) => m.features.pairFeatures(q, c, e.role, SRC).x);
    const xIdf = needIdf ? pool.map((c) => m.features.pairFeatures(q, c, e.role, SRC_IDF).x) : null;
    for (const s of systems) {
      let scores;
      if (s.kind === 'fn') {
        const f = s.score(e);
        scores = pool.map((c) => f(c));
      } else {
        const w = s.weights(e);
        const xs = s.src === SRC_IDF ? xIdf : x;
        scores = xs.map((v) => dot(w, v));
      }
      const items = pool.map((c, i) => ({
        c,
        score: scores[i],
        grade: e.grades.get(c.name) ?? 0,
        judged: e.grades.has(c.name),
      }));
      perSystem.get(s.label).push(metrics(items, ideal));
      if (!POOLED.has(s.label)) continue;
      // Top 5 by score, name as the tie-break (a partial selection, not a full sort).
      const before = (a, b) => a.score > b.score || (a.score === b.score && a.c.name < b.c.name);
      const top = [];
      for (const it of items) {
        if (!Number.isFinite(it.score)) continue;
        if (top.length === 5 && !before(it, top[4])) continue;
        let i = top.length === 5 ? 4 : top.length;
        top[i] = it;
        while (i > 0 && before(top[i], top[i - 1])) {
          [top[i], top[i - 1]] = [top[i - 1], top[i]];
          i--;
        }
      }
      tops.get(s.label).push({ e, top });
    }
  }
  return { qs, systems, perSystem, tops };
}

const runs = { owned: runUniverse('owned'), similar: runUniverse('similar') };

// ── Pool mode: write every pooled system's unjudged top 5 for grading ──────
if (opt('--pool')) {
  const text = (f) => {
    const s = scry.get(f.oracleId);
    return (s.card_faces ?? [s])
      .map(
        (x) =>
          `${x.name} ${x.mana_cost ?? ''} | ${x.type_line ?? s.type_line}\n${x.oracle_text ?? ''}`
      )
      .join('\n//\n');
  };
  const byQuery = new Map();
  for (const run of Object.values(runs))
    for (const [label, list] of run.tops) {
      if (!POOLED.has(label)) continue;
      for (const { e, top } of list)
        for (const { c, judged } of top) {
          if (judged) continue;
          const key = `${e.q}\u0000${e.role}`;
          if (!byQuery.has(key)) byQuery.set(key, { e, names: new Set() });
          byQuery.get(key).names.add(c.name);
        }
    }
  const packets = [...byQuery.values()].map(({ e, names }) => ({
    q: e.q,
    role: e.role,
    queryText: text(byName.get(e.q)),
    reference: Object.fromEntries(e.grades),
    candidates: [...names].sort().map((name) => ({ name, text: text(byName.get(name)) })),
  }));
  await writeFile(opt('--pool'), JSON.stringify(packets, null, 1));
  const n = packets.reduce((s, p) => s + p.candidates.length, 0);
  console.log(`[pool] ${packets.length} queries, ${n} unjudged candidates → ${opt('--pool')}`);
}

// ── Tables ──────────────────────────────────────────────────────────────────
for (const [protocol, run] of Object.entries(runs)) {
  const clusters = run.qs.map(familyOf);
  const base = run.perSystem.get(run.systems[0].label);
  const title =
    protocol === 'owned' ? 'Owned lane (tagger role gate)' : 'Similar strip (no role gate)';
  console.log(`── ${title}: ${run.qs.length} queries, ${new Set(clusters).size} families`);
  const v2 = run.perSystem.get('v2 (held-out fit)');
  const delta = (a, b, key) =>
    fmtDiff(
      a.map((v, i) => v[key] - b[i][key]),
      clusters
    );
  console.log(
    `${'system'.padEnd(26)}${'nDCG@5'.padEnd(24)}${'nDCG@10'.padEnd(24)}${'R@10'.padEnd(24)}${'judged@5'.padEnd(10)}ΔnDCG@5 vs v1 [query CI] fam [family CI]   ΔnDCG@5 vs v2`
  );
  for (const s of run.systems) {
    const r = run.perSystem.get(s.label);
    const vsV1 = s === run.systems[0] ? '' : delta(r, base, 'n5');
    const vsV2 = s.kind === 'v2' && s.label !== 'v2 (held-out fit)' ? delta(r, v2, 'n5') : '';
    console.log(
      `${s.label.padEnd(26)}${fmt(r.map((v) => v.n5)).padEnd(24)}${fmt(r.map((v) => v.n10)).padEnd(24)}${fmt(r.map((v) => v.r10)).padEnd(24)}${mean(
        r.map((v) => v.j5)
      )
        .toFixed(2)
        .padEnd(10)}${vsV1.padEnd(56)}${vsV2}`
    );
  }
  console.log(`ΔnDCG@10 v2 vs v1: ${delta(v2, base, 'n10')}   ΔR@10: ${delta(v2, base, 'r10')}`);
  if (protocol === 'owned') {
    // Cold start: a staple EDHREC's similar lists don't cover, both rankers without them.
    const cold1 = run.perSystem.get('owned-v1 w/o EDHREC');
    const cold2 = run.perSystem.get('v2 minus EDHREC similar');
    console.log(
      `cold start (no EDHREC lists), v2 minus EDHREC vs v1 heuristic: ΔnDCG@5 ${delta(cold2, cold1, 'n5')}`
    );
  }
  console.log('');
}

// Gate recall: how many real substitutes the owned lane's tagger gate lets through at all.
{
  let rel = 0;
  let pass = 0;
  for (const e of evalQueries) {
    const gate = gateFor(byName.get(e.q), e.role, 'owned');
    for (const [n, g] of e.grades) {
      if (g < 2) continue;
      rel++;
      if (gate(byName.get(n))) pass++;
    }
  }
  console.log(
    `[gate] the tagger role gate passes ${pass} of ${rel} grade>=2 substitutes (${((100 * pass) / rel).toFixed(0)}%)\n`
  );
}

// ── Error buckets over each main system's top 5 ────────────────────────────
// A miss is a judged grade 0-1 card in the top 5. Buckets (a miss can fall in
// several; the first match is its primary bucket):
//   polarity         shares a (trigger, effect) shape with the query, opposed side
//   role confusion   the facts give it no counted role/function for the query's role
//   popularity noise on the query's EDHREC similar list (or it on the card's)
//   MV mismatch      2+ mana value apart
//   other            none of the above (a condition, a narrower scope, ...)
const BUCKETS = ['polarity', 'role confusion', 'popularity noise', 'MV mismatch', 'other'];
function bucketsOf(e, c) {
  const q = byName.get(e.q);
  const { x, evidence } = m.features.pairFeatures(q, c, e.role, SRC);
  const out = [];
  if (evidence.polarityClash) out.push('polarity');
  if (x.roleStrength < 0.6) out.push('role confusion');
  if (evidence.similarRank !== null) out.push('popularity noise');
  if (q.mv !== null && c.mv !== null && Math.abs(q.mv - c.mv) >= 2) out.push('MV mismatch');
  return out.length ? out : ['other'];
}
const MAIN = {
  owned: ['owned-v1 (shipped)', 'v2 (held-out fit)'],
  similar: ['similar-v1 (shipped)', 'v2 (held-out fit)'],
};
console.log('── Error buckets: judged grade 0-1 cards in the top 5 (primary / any), and unjudged');
for (const [protocol, run] of Object.entries(runs)) {
  for (const label of MAIN[protocol]) {
    const primary = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    const any = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    let misses = 0;
    let unjudged = 0;
    let slots = 0;
    const listed = [];
    for (const { e, top } of run.tops.get(label)) {
      for (const it of top) {
        slots++;
        if (!it.judged) {
          unjudged++;
          continue;
        }
        if (it.grade >= 2) continue;
        misses++;
        const b = bucketsOf(e, it.c);
        primary[b[0]]++;
        for (const k of b) any[k]++;
        listed.push(`    ${e.q} [${e.role}] → ${it.c.name} (grade ${it.grade}; ${b.join(', ')})`);
      }
    }
    console.log(
      `${protocol.padEnd(8)}${label.padEnd(24)} ${misses} misses in ${slots} slots, ${unjudged} unjudged: ` +
        BUCKETS.map((b) => `${b} ${primary[b]}/${any[b]}`).join(', ')
    );
    if (flag('--errors')) console.log(listed.join('\n'));
  }
}
console.log('');

if (flag('--fit')) {
  console.log(`[fit] λ = ${finalLambda}; weights to ship (ranker.ts SUBSTITUTE_WEIGHTS):`);
  for (const f of FEATURES) console.log(`  ${f}: ${finalWeights[f].toFixed(4)},`);
  const stale = FEATURES.filter(
    (f) => Math.abs(m.ranker.SUBSTITUTE_WEIGHTS[f] - Number(finalWeights[f].toFixed(4))) > 1e-4
  );
  console.log(
    stale.length
      ? `[fit] ranker.ts is STALE on ${stale.join(', ')}: paste the weights above`
      : '[fit] ranker.ts carries these weights'
  );
  console.log('[fit] range across the held-out folds:');
  for (const f of FEATURES) {
    const ws = [...cvFull.weightsByRole.values()].map((w) => w[f]);
    console.log(`  ${f.padEnd(13)} ${Math.min(...ws).toFixed(3)} … ${Math.max(...ws).toFixed(3)}`);
  }
  // The deck-context weight: half the median gap between a query's grade-3
  // and grade-2 substitutes, so a fully supported deck link can reorder
  // within a grade but not jump one.
  const gaps = [];
  for (const e of evalQueries) {
    const s = judgedItems(e).map((it) => ({
      ...it,
      score: dot(finalWeights, featuresFor(e, it.c)),
    }));
    const g3 = s.filter((i) => i.grade === 3).map((i) => i.score);
    const g2 = s.filter((i) => i.grade === 2).map((i) => i.score);
    if (g3.length && g2.length) gaps.push(mean(g3) - mean(g2));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  console.log(
    `[fit] median grade-3 minus grade-2 gap ${median.toFixed(4)} over ${gaps.length} queries → DECK_FIT_WEIGHT ${(median / 2).toFixed(4)}`
  );
  // The Similar strip's floor: the 5th percentile of held-out scores of real
  // substitutes (grade >= 2), so the floor drops at most 1 in 20 of them.
  const held = evalQueries.flatMap((e) =>
    judgedItems(e)
      .filter((it) => it.grade >= 2)
      .map((it) => dot(finalWeights, featuresFor(e, it.c)))
  );
  held.sort((a, b) => a - b);
  const floor = held[Math.floor(held.length * 0.05)];
  const zeros = evalQueries.flatMap((e) =>
    trainItems(e)
      .filter((it) => it.grade === 0)
      .map((it) => dot(finalWeights, featuresFor(e, it.c)))
  );
  console.log(
    `[fit] SIMILAR_FLOOR ${floor.toFixed(4)}: keeps 95% of grade>=2 substitutes, drops ${((100 * zeros.filter((z) => z < floor).length) / zeros.length).toFixed(0)}% of grade-0 cards\n`
  );
}
