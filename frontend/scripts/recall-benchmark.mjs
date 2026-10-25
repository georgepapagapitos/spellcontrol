#!/usr/bin/env node
// Held-out card-recovery benchmark (roadmap item 0.1, board E1038).
//
// For each deck of a corpus (the official precons and EDHTop16 cEDH lists in
// packages/deck-metrics/calibration/fixtures/corpus.json, deduplicated at
// Jaccard > 0.9), hide k cards (random, and role-stratified), hand each ranker
// the commander plus the remaining cards, have it score the FULL commander-
// legal pool for the color identity (Scryfall oracle_cards, never sampled
// negatives), and report recall@10/20, nDCG@20 and MRR split into head and
// tail by the hidden card's play rate on the commander's EDHREC page, plus the
// tail share of the top 20 and the Jaccard of the completed deck to EDHREC's
// average deck.
//
// Rankers (baselines first):
//   random            seeded shuffle, the floor
//   edhrec-inclusion  raw play rate on the commander's EDHREC page
//   edhrec-synergy    EDHREC's synergy figure on that page
//   gen-priority      the generator's pick scorer, calculateCardPriority (Balanced)
//   lift              aggregateLiftCandidates over six context cards' EDHREC
//                     card-page lift pools (the existing lift scoring, liftSynergy.ts)
//
// Data: EDHREC pages come from an on-disk cache (default
// node_modules/.cache/recall-benchmark, gitignored). Without --live a cache
// miss skips the deck (and says so); with --live a miss is fetched once,
// serially, 1.5 s apart, with User-Agent spellcontrol-eval/1.0, then cached.
// Scryfall's bulk file goes through card-facts-lib's cache (one download).
// mtgo.com, MTGGoldfish and mtgdecks are never touched.
//
//   node scripts/recall-benchmark.mjs --limit 40                 # cached only
//   node scripts/recall-benchmark.mjs --limit 40 --live          # fill the cache
//   --seed 1 --k 5 --trials 3 --context 6 --sets precon,cedh --cache <dir> --bulk <file>
//
// Not a CI gate: it sits in front of the deckgen-eval-gate critics as a cheap
// mechanical first look. Offline once the cache is warm.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FRONTEND, ensureBulk, importSrc, streamBulk } from './card-facts-lib.mjs';
import {
  dedupeByJaccard,
  hashSeed,
  jaccard,
  meanMetrics,
  nameKey,
  pickRandom,
  pickRoleStratified,
  queryMetrics,
  rankPool,
  rng,
  shuffled,
  splitByPopularity,
  tailShare,
} from './recall-benchmark-lib.mjs';

const { values: opt } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    limit: { type: 'string', default: '40' },
    k: { type: 'string', default: '5' },
    trials: { type: 'string', default: '3' },
    context: { type: 'string', default: '6' },
    sets: { type: 'string', default: 'precon,cedh' },
    cache: {
      type: 'string',
      default: join(FRONTEND, 'node_modules', '.cache', 'recall-benchmark'),
    },
    bulk: { type: 'string' },
    live: { type: 'boolean', default: false },
    delay: { type: 'string', default: '1500' },
  },
});
const SEED = Number(opt.seed);
const LIMIT = Number(opt.limit);
const K = Number(opt.k);
const TRIALS = Number(opt.trials);
const CONTEXT = Number(opt.context);
const DELAY = Number(opt.delay);
const SETS = new Set(opt.sets.split(','));
const TAIL_BELOW = 10; // percent of the commander's decks
const BASE = 'https://json.edhrec.com';

const CORPUS = resolve(
  FRONTEND,
  '..',
  'packages',
  'deck-metrics',
  'calibration',
  'fixtures',
  'corpus.json'
);

// ── EDHREC fetch with an on-disk cache ───────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastFetch = 0;
const stats = { cached: 0, fetched: 0, missing: 0, skippedOffline: 0 };

/** JSON for an EDHREC path, or null (404 or, offline, not cached). */
async function edhrec(path, cacheFile) {
  const file = join(opt.cache, cacheFile);
  if (existsSync(file)) {
    stats.cached++;
    const body = JSON.parse(await readFile(file, 'utf8'));
    return body.missing ? null : body;
  }
  if (!opt.live) {
    stats.skippedOffline++;
    return null;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastFetch + DELAY - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetch = Date.now();
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'User-Agent': 'spellcontrol-eval/1.0', Accept: 'application/json' },
    });
    if (res.status === 404 || res.status === 403) {
      await writeCache(file, { missing: true });
      stats.missing++;
      return null;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const body = await res.json();
    await writeCache(file, body);
    stats.fetched++;
    return body;
  }
  throw new Error(`${path}: gave up after retries`);
}
async function writeCache(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(body));
  await rename(`${file}.tmp`, file);
}

// ── app code, through Vite's module runner ───────────────────────────────────
const [edhrecClient, pageCache, picking, liftMod] = await importSrc(
  'deck-builder/services/edhrec/client.ts',
  'deck-builder/services/edhrec/commander-page-cache.ts',
  'deck-builder/services/deckBuilder/cardPicking.ts',
  'deck-builder/services/deckBuilder/liftSynergy.ts'
);
const { parseCardLiftPool } = edhrecClient;
// The app's EDHREC parser logs every list at debug level in Node; mute it.
const parseEdhrecResponse = (...args) => {
  const { log, debug, info } = console;
  console.log = console.debug = console.info = () => {};
  try {
    return edhrecClient.parseEdhrecResponse(...args);
  } finally {
    Object.assign(console, { log, debug, info });
  }
};
const { formatCommanderNameForUrl, getPartnerSlugs } = pageCache;
const { calculateCardPriority } = picking;
const { aggregateLiftCandidates } = liftMod;

// ── Scryfall: the legal universe with color identity ────────────────────────
const bulk = await ensureBulk({ explicit: opt.bulk, offline: !opt.live });
const cardByKey = new Map(); // nameKey -> { name, ci:Set, basic }
for await (const c of streamBulk(bulk.path)) {
  if (c.legalities?.commander !== 'legal') continue;
  const typeLine = c.type_line ?? '';
  cardByKey.set(nameKey(c.name), {
    name: c.name,
    ci: new Set(c.color_identity ?? []),
    basic: typeLine.includes('Basic Land'),
  });
}
const poolCache = new Map(); // "WUBRG-subset" -> Map(key -> name)
function legalPool(ci) {
  const id = [...ci].sort().join('');
  let pool = poolCache.get(id);
  if (!pool) {
    pool = [];
    for (const [key, c] of cardByKey) {
      if (c.basic) continue;
      let ok = true;
      for (const col of c.ci) if (!ci.has(col)) ok = false;
      if (ok) pool.push(key);
    }
    poolCache.set(id, pool);
  }
  return pool;
}

// ── corpus ───────────────────────────────────────────────────────────────────
const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
const roleIndex = new Map(Object.entries(corpus.cards).map(([n, v]) => [nameKey(n), v[2]]));

const allDecks = corpus.decks
  .filter((d) => SETS.has(d.set))
  .map((d) => {
    const keys = new Set();
    for (const n of Object.keys(d.cards)) {
      const c = cardByKey.get(nameKey(n));
      if (c?.basic) continue;
      keys.add(nameKey(n));
    }
    return { ...d, keys };
  })
  .sort((a, b) => (a.id < b.id ? -1 : 1));
const deduped = dedupeByJaccard(allDecks, 0.9);
const sample = shuffled(deduped, rng(SEED)).slice(0, LIMIT);

// ── per-commander EDHREC data ────────────────────────────────────────────────
const commanderData = new Map(); // commander key -> { cards: Map(key->EDHRECCard), avg:Set|null } | null
async function loadCommander(names) {
  const id = names.join('+');
  if (commanderData.has(id)) return commanderData.get(id);
  const slugs =
    names.length > 1 ? getPartnerSlugs(names[0], names[1]) : [formatCommanderNameForUrl(names[0])];
  let page = null;
  let slug = slugs[0];
  for (const s of slugs) {
    page = await edhrec(`/pages/commanders/${s}.json`, `commanders/${s}.json`);
    if (page) {
      slug = s;
      break;
    }
  }
  let out = null;
  if (page) {
    const parsed = parseEdhrecResponse(page, `bench-${slug}`);
    const cards = new Map();
    const lists = parsed.cardlists;
    for (const c of [...lists.allNonLand, ...lists.lands]) {
      const key = nameKey(c.name);
      const prev = cards.get(key);
      if (!prev || c.inclusion > prev.inclusion) cards.set(key, c);
    }
    const avgPage = await edhrec(`/pages/average-decks/${slug}.json`, `average-decks/${slug}.json`);
    const avgRows = avgPage ? edhrecClient.parseAverageDeckQuantities(avgPage) : null;
    const avg = avgRows
      ? new Set(
          avgRows
            .map(([n]) => nameKey(n))
            .filter((k) => k && !cardByKey.get(k)?.basic && cardByKey.has(k))
        )
      : null;
    out = { cards, avg };
  }
  commanderData.set(id, out);
  return out;
}

async function liftPoolFor(name) {
  const slug = formatCommanderNameForUrl(name);
  const page = await edhrec(`/pages/cards/${slug}.json`, `cards/${slug}.json`);
  return page ? parseCardLiftPool(page) : null;
}

// ── queries ──────────────────────────────────────────────────────────────────
const RANKERS = ['random', 'edhrec-inclusion', 'edhrec-synergy', 'gen-priority', 'lift'];
const MODES = ['random', 'role'];
// results[mode][ranker][bucket] -> per-query metric rows
const results = {};
for (const m of MODES) {
  results[m] = {};
  for (const r of RANKERS) results[m][r] = { all: [], head: [], tail: [] };
}
const extra = {}; // ranker -> { tail: [], jac: [] }
for (const r of RANKERS) extra[r] = { tail: [], jac: [] };
const refJaccard = [];
const poolSizes = [];
const notes = { decks: 0, skippedNoData: [], droppedHidden: 0, queries: 0, noLift: 0 };

for (const deck of sample) {
  const names = deck.commanders;
  const cmdKeys = names.map(nameKey);
  const cmdCards = cmdKeys.map((k) => cardByKey.get(k));
  if (cmdCards.some((c) => !c)) {
    notes.skippedNoData.push(`${deck.name} (commander not in Scryfall universe)`);
    continue;
  }
  const data = await loadCommander(names);
  if (!data) {
    notes.skippedNoData.push(`${deck.name} (no EDHREC page cached)`);
    continue;
  }
  const ci = new Set(cmdCards.flatMap((c) => [...c.ci]));
  const pool = legalPool(ci).filter((k) => !cmdKeys.includes(k));
  const inPool = new Set(pool);
  const deckKeys = [...deck.keys].filter((k) => inPool.has(k) && !cmdKeys.includes(k));
  notes.droppedHidden += deck.keys.size - deckKeys.length;
  if (deckKeys.length < K + CONTEXT + 10) {
    notes.skippedNoData.push(`${deck.name} (too few legal nonbasic cards)`);
    continue;
  }
  const seedBase = hashSeed(`${SEED}|${deck.id}`);

  // Hidden sets first, so the lift context is never a hidden card.
  const plans = [];
  for (const mode of MODES) {
    for (let t = 0; t < TRIALS; t++) {
      const r = rng(hashSeed(`${seedBase}|${mode}|${t}`));
      const hidden =
        mode === 'random'
          ? pickRandom(deckKeys, K, r)
          : pickRoleStratified(deckKeys, K, (k) => roleIndex.get(k), r);
      plans.push({ mode, t, hidden: new Set(hidden) });
    }
  }
  const everHidden = new Set(plans.flatMap((p) => [...p.hidden]));
  const contextNames = shuffled(
    deckKeys.filter((k) => !everHidden.has(k)),
    rng(hashSeed(`${seedBase}|ctx`))
  );
  const seedPools = new Map();
  for (const k of contextNames) {
    if (seedPools.size >= CONTEXT) break;
    const pageName = cardByKey.get(k).name;
    const lp = await liftPoolFor(pageName);
    if (lp && lp.length) seedPools.set(pageName, lp);
  }
  const liftScores = new Map();
  if (seedPools.size === 0) notes.noLift++;
  else {
    for (const c of aggregateLiftCandidates(seedPools, {
      excludeNames: new Set([...names, ...seedPools.keys()]),
    }))
      liftScores.set(nameKey(c.name), c.clusterScore);
  }

  const popularity = (k) => data.cards.get(k)?.inclusion ?? 0;
  const scorers = {
    random: () => 0,
    'edhrec-inclusion': (k) => data.cards.get(k)?.inclusion ?? -1,
    'edhrec-synergy': (k) => data.cards.get(k)?.synergy ?? -2,
    'gen-priority': (k) => {
      const c = data.cards.get(k);
      return c ? calculateCardPriority(c, 0.5) : -1;
    },
    lift: (k) => liftScores.get(k) ?? 0,
  };

  if (data.avg) {
    refJaccard.push(jaccard(new Set([...deckKeys, ...cmdKeys]), data.avg));
  }

  for (const { mode, t, hidden } of plans) {
    const given = new Set(deckKeys.filter((k) => !hidden.has(k)));
    const candidates = pool.filter((k) => !given.has(k));
    poolSizes.push(candidates.length);
    const { head, tail } = splitByPopularity([...hidden], popularity, TAIL_BELOW);
    notes.queries++;
    for (const ranker of RANKERS) {
      const ranking = rankPool(
        candidates,
        scorers[ranker],
        rng(hashSeed(`${seedBase}|${mode}|${t}|${ranker}`))
      );
      const bucket = results[mode][ranker];
      bucket.all.push(queryMetrics(ranking, hidden));
      bucket.head.push(queryMetrics(ranking, head));
      bucket.tail.push(queryMetrics(ranking, tail));
      if (mode === 'random') {
        extra[ranker].tail.push(tailShare(ranking, popularity, 20, TAIL_BELOW));
        if (data.avg) {
          const completed = new Set([...given, ...cmdKeys, ...ranking.slice(0, K)]);
          extra[ranker].jac.push(jaccard(completed, data.avg));
        }
      }
    }
  }
  notes.decks++;
}

// ── report ───────────────────────────────────────────────────────────────────
const f = (x) => (x === undefined ? '    -' : x.toFixed(3).padStart(5));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined);
console.log(
  `recall-benchmark seed=${SEED} k=${K} trials=${TRIALS} context=${CONTEXT} sets=${opt.sets} ` +
    `tail<${TAIL_BELOW}%`
);
console.log(
  `corpus: ${allDecks.length} decks in sets, ${deduped.length} after Jaccard>0.9 dedupe, ` +
    `${sample.length} sampled, ${notes.decks} scored, ${notes.queries} queries per ranker ` +
    `(${MODES.length} modes x ${TRIALS} trials)`
);
console.log(
  `pool: mean ${Math.round(mean(poolSizes) ?? 0)} candidates ranked per query (full legal pool); ` +
    `hidden cards outside the legal pool dropped: ${notes.droppedHidden} (incl. basics excluded earlier)`
);
console.log(
  `EDHREC pages: ${stats.cached} cache hits, ${stats.fetched} fetched, ${stats.missing} 404, ` +
    `${stats.skippedOffline} not cached (offline)`
);
if (notes.noLift) console.log(`decks with no usable lift context: ${notes.noLift}`);
if (notes.skippedNoData.length)
  console.log(
    `skipped decks (${notes.skippedNoData.length}): ${notes.skippedNoData.slice(0, 6).join('; ')}${notes.skippedNoData.length > 6 ? '; ...' : ''}`
  );
if (refJaccard.length)
  console.log(
    `reference: the real deck vs EDHREC average deck, mean Jaccard ${f(mean(refJaccard))}`
  );

for (const mode of MODES) {
  console.log(`\n== hide ${K}, ${mode === 'random' ? 'random' : 'role-stratified'} ==`);
  console.log(
    'ranker            bucket  queries  recall@10  recall@20  ndcg@20    mrr   tail@20  jac-avg'
  );
  for (const ranker of RANKERS) {
    for (const bucket of ['all', 'head', 'tail']) {
      const m = meanMetrics(results[mode][ranker][bucket]);
      const showExtra = bucket === 'all' && mode === 'random';
      console.log(
        `${ranker.padEnd(17)} ${bucket.padEnd(6)} ${String(m.queries).padStart(7)}  ` +
          `${f(m['recall@10']).padStart(9)}  ${f(m['recall@20']).padStart(9)}  ` +
          `${f(m['ndcg@20']).padStart(7)}  ${f(m.mrr)}  ` +
          `${(showExtra ? f(mean(extra[ranker].tail)) : '    -').padStart(7)}  ` +
          `${(showExtra ? f(mean(extra[ranker].jac)) : '    -').padStart(7)}`
      );
    }
  }
}
console.log(
  '\nhead/tail: the hidden card is tail when its play rate on the commander page is below ' +
    `${TAIL_BELOW}% (absent counts as 0). A bucket row only counts queries that hid at least one ` +
    'card of that bucket. tail@20 and jac-avg are measured on the random-hide queries.'
);
