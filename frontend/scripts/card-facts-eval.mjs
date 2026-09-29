#!/usr/bin/env node
// Scores functional-substitute retrieval against the hand-graded rows in
// src/deck-builder/services/cardFacts/substitutes.fixtures.ts.
//
// For every row graded partial or direct (2-3), in both directions: query with
// card A, score the WHOLE commander-legal universe (A itself held out), and
// ask where B lands. Many cards tie on a coarse tag set ("Destroy target
// creature." is printed dozens of times), so ranks are tie-aware: B's rank is
// the expected rank under a random order within its tie, and recall@k is the
// probability B lands in the top k. Reports recall@5/@10 over those pairs and
// graded nDCG@10 per (query, role) with seeded bootstrap 95% intervals, for:
//   facts        Jaccard over similarityTags
//   facts-idf    IDF-weighted Jaccard over similarityTags
//   facts-idf+R  the same, pool restricted to cards with that role/function
//                at strength >= 0.6 (the role-conditioned query)
//   tagger       Jaccard over the 23 tagger-tags.json buckets (baseline)
//   otag         Jaccard over the full otag-index.json vocabulary (baseline)
//
// Reads public/card-facts.json (run refresh-card-facts.mjs first). Offline.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FRONTEND, importSrc } from './card-facts-lib.mjs';

const [codec, similarity, subs, bench] = await importSrc(
  'deck-builder/services/cardFacts/codec.ts',
  'deck-builder/services/cardFacts/similarity.ts',
  'deck-builder/services/cardFacts/substitutes.fixtures.ts',
  'deck-builder/services/cardFacts/bench.ts'
);
const snapshot = JSON.parse(await readFile(join(FRONTEND, 'public', 'card-facts.json'), 'utf8'));
const facts = snapshot.cards.map((c) => codec.decodeCard(snapshot, c));
const byName = new Map(facts.map((f) => [f.name, f]));

const tagger = JSON.parse(await readFile(join(FRONTEND, 'public', 'tagger-tags.json'), 'utf8'));
const taggerByName = new Map();
for (const [tag, names] of Object.entries(tagger.tags))
  for (const n of names) taggerByName.set(n, [...(taggerByName.get(n) ?? []), tag]);
const otag = JSON.parse(await readFile(join(FRONTEND, 'public', 'otag-index.json'), 'utf8'));

const factTags = new Map(facts.map((f) => [f.oracleId, similarity.similarityTags(f)]));
const idf = similarity.tagIdf(factTags.values());
const tagsFor = {
  facts: (f) => factTags.get(f.oracleId),
  tagger: (f) => taggerByName.get(f.name) ?? [],
  otag: (f) => (otag.cards[f.name] ?? []).map(String),
};
const systems = [
  { label: 'facts', tags: tagsFor.facts, score: similarity.jaccard, role: false },
  {
    label: 'facts-idf',
    tags: tagsFor.facts,
    score: (a, b) => similarity.weightedJaccard(a, b, idf),
    role: false,
  },
  {
    label: 'facts-idf+R',
    tags: tagsFor.facts,
    score: (a, b) => similarity.weightedJaccard(a, b, idf),
    role: true,
  },
  { label: 'tagger', tags: tagsFor.tagger, score: similarity.jaccard, role: false },
  { label: 'otag', tags: tagsFor.otag, score: similarity.jaccard, role: false },
];

const missing = [...new Set(subs.SUBSTITUTES.flatMap((r) => [r.a, r.b]))].filter(
  (n) => !byName.has(n)
);
if (missing.length) console.warn('[eval] not in the snapshot:', missing.join(', '));

const inRole = (f, role) => (f.strengths[role] ?? 0) >= 0.6;

/** name → score for the whole pool (query held out). */
function scores(system, query, role) {
  const q = system.tags(query);
  const out = new Map();
  for (const f of facts) {
    if (f.oracleId === query.oracleId) continue;
    if (role && !inRole(f, role)) continue;
    out.set(f.name, system.score(q, system.tags(f)));
  }
  return out;
}

/** Probability that `target` lands in the top k, ties ordered at random. */
function topK(scoreMap, target, k) {
  const s = scoreMap.get(target);
  if (s === undefined || s === 0) return 0;
  let greater = 0;
  let equal = 0;
  for (const [n, v] of scoreMap) {
    if (n === target) continue;
    if (v > s) greater++;
    else if (v === s) equal++;
  }
  return Math.max(0, Math.min(1, (k - greater) / (equal + 1)));
}

/** Tie-aware graded nDCG@k: expected DCG with ties in random order. */
function ndcg(scoreMap, rel, k = 10) {
  let dcg = 0;
  for (const [name, grade] of Object.entries(rel)) {
    if (grade === 0) continue;
    const s = scoreMap.get(name);
    if (s === undefined || s === 0) continue;
    let greater = 0;
    let equal = 0;
    for (const [n, v] of scoreMap) {
      if (n === name) continue;
      if (v > s) greater++;
      else if (v === s) equal++;
    }
    // Average the discount over every position the tie allows.
    let disc = 0;
    for (let p = greater; p <= greater + equal; p++) if (p < k) disc += 1 / Math.log2(p + 2);
    dcg += ((2 ** grade - 1) * disc) / (equal + 1);
  }
  const ideal = Object.values(rel)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
  return ideal === 0 ? 0 : dcg / ideal;
}

function ci(values, iterations = 1000) {
  const rand = bench.mulberry32(bench.BOOTSTRAP_SEED);
  const means = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < values.length; j++) s += values[Math.floor(rand() * values.length)];
    means.push(s / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iterations * 0.025)], means[Math.floor(iterations * 0.975)]];
}
const fmt = (vals) => {
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const [lo, hi] = ci(vals);
  return `${mean.toFixed(3)} [${lo.toFixed(3)}, ${hi.toFixed(3)}]`;
};

const rows = subs.SUBSTITUTES.filter((r) => byName.has(r.a) && byName.has(r.b));
const pairs = rows
  .filter((r) => r.grade >= 2)
  .flatMap((r) => [
    { q: r.a, t: r.b, role: r.role },
    { q: r.b, t: r.a, role: r.role },
  ]);
const relevance = new Map();
for (const r of rows)
  for (const [q, t] of [
    [r.a, r.b],
    [r.b, r.a],
  ]) {
    const key = `${q}\u0000${r.role}`;
    relevance.set(key, { ...(relevance.get(key) ?? {}), [t]: r.grade });
  }

console.log(
  `[eval] ${rows.length} graded rows, ${pairs.length} held-out query→target pairs, ${facts.length} cards in the pool\n`
);
const results = {};
for (const system of systems) {
  const cache = new Map();
  const get = (q, role) => {
    const key = `${q}\u0000${system.role ? role : ''}`;
    let m = cache.get(key);
    if (!m) cache.set(key, (m = scores(system, byName.get(q), system.role ? role : null)));
    return m;
  };
  const r5 = pairs.map((p) => topK(get(p.q, p.role), p.t, 5));
  const r10 = pairs.map((p) => topK(get(p.q, p.role), p.t, 10));
  const nd = [];
  for (const [key, rel] of relevance) {
    const [q, role] = key.split('\u0000');
    if (Object.values(rel).some((g) => g >= 2)) nd.push(ndcg(get(q, role), rel));
  }
  results[system.label] = { r5, r10, nd };
  console.log(
    `${system.label.padEnd(12)} recall@5 ${fmt(r5)}  recall@10 ${fmt(r10)}  nDCG@10 ${fmt(nd)}`
  );
}
