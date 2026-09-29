#!/usr/bin/env node
// Scores LIVE_GEN panel dumps with the whole-deck objective
// (src/deck-builder/services/deckBuilder/deckObjective) so a deck-generation
// gate can be prescreened mechanically before any critic is spent, and
// validates the objective against labelled gate runs.
//
//   node scripts/deck-objective-eval.mjs score \
//     --baseline <dir> --treatment <dir> [--verdicts <gate output json>]
//   node scripts/deck-objective-eval.mjs validate \
//     --gate E509=<root>,<verdicts json> --gate E510=<root>,<verdicts json>
//
// A panel directory holds one JSON per deck (deckGenerator.live.test.ts);
// `score` pairs the two directories by file name and prints, per deck, the
// score delta (treatment − baseline), each term's share of it, and the cards
// behind the biggest terms. A `validate` root holds baseline/ and treatment/;
// its verdicts file is the ship-gate workflow's output ({ result: { verdicts,
// scores } }). Deterministic: a fixed goldfish seed (--seed, default the
// objective's) and a seeded bootstrap.
//
// Data, all local by default:
//   --bulk <file>        Scryfall oracle_cards .jsonl.gz for full oracle text
//                        (dumps carry a 140-character snippet). Default: the
//                        newest in node_modules/.cache/card-facts.
//   --http-cache <dir>   the LIVE_GEN_HTTP_CACHE the panels ran with: EDHREC
//                        commander/theme pages and card pages are replayed from
//                        it. Default ../../.deckgen-http-cache (the shared one).
//   --live               fetch cache misses (EDHREC only) under the shared
//                        live lock (../../.deckgen-live.lock), writing the
//                        cache as the harness does. Without it a miss is an
//                        error for a page and "no lift pool" for a card page.
//   --owned <file>       owned names for collection rows (default: the
//                        harness's owned-collection fixture).
//   --json <file>        also write every score to a JSON file.
//   --only <a,b>         restrict to decks whose file name contains a substring.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FRONTEND, ensureBulk, streamBulk } from './card-facts-lib.mjs';

// ── Arguments ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const command = argv[0];
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const opts = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const flag = (name) => argv.includes(name);

if (command !== 'score' && command !== 'validate') {
  console.error(
    'usage: deck-objective-eval.mjs score --baseline <dir> --treatment <dir> [--verdicts <file>]\n' +
      '       deck-objective-eval.mjs validate --gate NAME=<root>,<verdicts> [--gate ...]'
  );
  process.exit(2);
}

const DEV_ROOT = resolve(FRONTEND, '..', '..');
const HTTP_CACHE = resolve(opt('--http-cache') ?? join(DEV_ROOT, '.deckgen-http-cache'));
const LIVE = flag('--live');
const LOCK = join(DEV_ROOT, '.deckgen-live.lock');
const SEED = opt('--seed') ? Number(opt('--seed')) : undefined;
const ONLY = opt('--only')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OWNED_FILE = resolve(
  opt('--owned') ??
    join(
      FRONTEND,
      'src',
      'deck-builder',
      'services',
      'deckBuilder',
      '__fixtures__',
      'owned-collection.fixture.json'
    )
);

// ── Network: replay the panels' HTTP cache; live only under the lock ──────
let lockHeld = false;
function acquireLock() {
  if (lockHeld) return;
  // Same protocol as the lanes' shell loop: mkdir is atomic.
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);
    }
  }
  writeFileSync(join(LOCK, 'owner'), 'deck-objective-eval');
  lockHeld = true;
  process.on('exit', () => rmSync(LOCK, { recursive: true, force: true }));
}

const stats = { hits: 0, misses: 0, live: 0 };
const realFetch = globalThis.fetch;
const taggerJson = readFileSync(join(FRONTEND, 'public', 'tagger-tags.json'), 'utf8');
globalThis.fetch = async (input, init) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.endsWith('/tagger-tags.json')) return new Response(taggerJson, { status: 200 });
  // The harness is imported in production mode, so the client calls the real
  // host; a dev-mode import would call the dev proxy path, keyed the same way.
  if (url.startsWith('/edhrec-api'))
    url = `https://json.edhrec.com${url.slice('/edhrec-api'.length)}`;
  const key = createHash('sha1')
    .update(`${init?.method ?? 'GET'} ${url} ${typeof init?.body === 'string' ? init.body : ''}`)
    .digest('hex');
  const file = join(HTTP_CACHE, `${key}.json`);
  if (existsSync(file)) {
    stats.hits++;
    const hit = JSON.parse(readFileSync(file, 'utf8'));
    return new Response(hit.body, { status: hit.status });
  }
  stats.misses++;
  if (!LIVE) return new Response('{"error":"not in the HTTP cache"}', { status: 404 });
  acquireLock();
  stats.live++;
  const res = await realFetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'User-Agent': 'SpellControl-DeckObjective/1.0' },
  });
  if (res.ok || res.status === 404) {
    const body = await res.text();
    mkdirSync(HTTP_CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify({ status: res.status, body }));
    return new Response(body, { status: res.status });
  }
  return res;
};
const cacheHas = (url) =>
  existsSync(join(HTTP_CACHE, `${createHash('sha1').update(`GET ${url} `).digest('hex')}.json`));

// ── The objective, in ONE module graph (harness.ts says why) ──────────────
// card-facts-lib's importSrc aliases only deck-metrics; the objective's graph
// reaches the other two shared packages too (through the Scryfall client), and
// their ESM dist is bundler-only, so all three resolve to source here.
async function importHarness() {
  // Vite derives import.meta.env.DEV from NODE_ENV, not the mode alone.
  process.env.NODE_ENV = 'production';
  const { runnerImport } = await import('vite');
  const pkg = (name) => join(FRONTEND, '..', 'packages', name, 'src', 'index.ts');
  const config = {
    configFile: false,
    root: FRONTEND,
    logLevel: 'error',
    // Production: the clients call the real API hosts (not the dev proxy) and
    // the logger's debug chatter stays quiet, as in the shipped app.
    mode: 'production',
    resolve: {
      alias: {
        '@spellcontrol/deck-metrics': pkg('deck-metrics'),
        '@spellcontrol/binder-routing': pkg('binder-routing'),
        '@spellcontrol/game-core': pkg('game-core'),
        '@': join(FRONTEND, 'src'),
      },
    },
  };
  const entry = join(
    FRONTEND,
    'src',
    'deck-builder',
    'services',
    'deckBuilder',
    'deckObjective',
    'harness.ts'
  );
  return (await runnerImport(entry, config)).module;
}
const H = await importHarness();
H.setCardFactsSnapshot(
  JSON.parse(readFileSync(join(FRONTEND, 'public', 'card-facts.json'), 'utf8'))
);
await H.loadTaggerData();
if (!H.hasTaggerData()) throw new Error('tagger snapshot did not load');
const ownedFile = JSON.parse(readFileSync(OWNED_FILE, 'utf8'));
const OWNED = new Set(Array.isArray(ownedFile) ? ownedFile : ownedFile.names);

// ── Panels ─────────────────────────────────────────────────────────────────
function loadPairs(baselineDir, treatmentDir) {
  const files = readdirSync(baselineDir)
    .filter((f) => f.endsWith('.json') && f !== 'summary.json')
    .filter((f) => existsSync(join(treatmentDir, f)))
    .filter((f) => !ONLY || ONLY.some((o) => f.includes(o)))
    .sort();
  return files.map((f) => ({
    slug: f.replace(/\.json$/, ''),
    base: JSON.parse(readFileSync(join(baselineDir, f), 'utf8')),
    treat: JSON.parse(readFileSync(join(treatmentDir, f), 'utf8')),
  }));
}

/**
 * Full Scryfall records for every name the pairs mention, and the global
 * EDHREC rank of every card on their pages (the off-page quality fallback), in
 * one bulk pass. Call after `attachPages`.
 */
async function resolveCards(pairs) {
  const want = new Set();
  const front = (n) => n.split(' // ')[0];
  for (const p of pairs) {
    for (const d of [p.base, p.treat]) {
      const names = [
        d.commander,
        ...(d.partner ? [d.partner] : []),
        ...H.dumpCards(d).map((c) => c.name),
      ];
      for (const n of names) want.add(H.straightQuotes(n));
    }
  }
  const wantFront = new Set([...want].map(front));
  const pageNames = new Set(pairs.flatMap((p) => [...p.page.rows.keys()]));
  const rank = new Map();
  const bulk = await ensureBulk({ explicit: opt('--bulk'), offline: true });
  const byName = new Map();
  const byFront = new Map();
  // Tokens, emblems and art cards share names with real cards (a "Llanowar
  // Elves" token exists); keep playable cards, commander-legal first.
  const better = (prev, c) =>
    !prev || (prev.legalities?.commander !== 'legal' && c.legalities?.commander === 'legal');
  for await (const c of streamBulk(bulk.path)) {
    if (/token|emblem|art_series/.test(c.layout ?? '')) continue;
    if (c.edhrec_rank && (pageNames.has(c.name) || pageNames.has(front(c.name)))) {
      rank.set(c.name, c.edhrec_rank);
      rank.set(front(c.name), c.edhrec_rank);
    }
    if (want.has(c.name)) {
      if (better(byName.get(c.name), c)) byName.set(c.name, c);
    } else if (wantFront.has(front(c.name)) && better(byFront.get(front(c.name)), c)) {
      byFront.set(front(c.name), c);
    }
  }
  for (const [k, c] of byFront) if (!byName.has(k)) byName.set(k, c);
  const missing = [...want].filter((n) => !byName.has(n) && !byName.has(front(n)));
  if (missing.length) throw new Error(`not in ${bulk.file}: ${missing.join(', ')}`);
  return { byName, rank, bulkFile: bulk.file };
}

/** Each pair's EDHREC page, read once from the baseline's settings. */
async function attachPages(pairs) {
  for (const p of pairs) p.page = await pageRows(p.base);
}

async function pageRows(dump) {
  const page = H.dumpPage(dump);
  const attempts = [];
  if (page.partner) {
    if (page.theme)
      attempts.push(() =>
        H.fetchPartnerThemeData(
          page.commander,
          page.partner,
          page.theme,
          page.budgetOption,
          page.targetBracket
        )
      );
    attempts.push(() =>
      H.fetchPartnerCommanderData(
        page.commander,
        page.partner,
        page.budgetOption,
        page.targetBracket
      )
    );
  } else {
    if (page.theme)
      attempts.push(() =>
        H.fetchCommanderThemeData(page.commander, page.theme, page.budgetOption, page.targetBracket)
      );
    attempts.push(() =>
      H.fetchCommanderData(page.commander, page.budgetOption, page.targetBracket)
    );
  }
  // The generator falls back to the base page when a filtered page is missing.
  attempts.push(() => H.fetchCommanderData(page.commander));
  let lastError;
  for (const [i, attempt] of attempts.entries()) {
    try {
      const data = await attempt();
      const rows = H.edhrecRowsFrom(data);
      if (rows.size > 0) return { rows, fallback: i > 0 && i === attempts.length - 1 };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`no EDHREC page for ${dump.commander}: ${lastError?.message ?? 'empty'}`);
}

async function liftPools(commanders, shared) {
  const pools = new Map();
  const seeds = [...new Set([...commanders, ...shared])];
  for (const name of seeds) {
    const url = `https://json.edhrec.com/pages/cards/${H.formatCommanderNameForUrl(name)}.json`;
    const isCommander = commanders.includes(name);
    if (!cacheHas(url) && !(LIVE && isCommander)) continue;
    const pool = await H.fetchCardLiftPool(name);
    if (pool.length) pools.set(name, pool);
  }
  return pools;
}

/** Score one baseline/treatment pair under one shared context. */
async function evaluatePair(pair, byName, rank, weights) {
  const { base, treat, page } = pair;
  const baseDeck = H.deckFromDump(base, byName);
  const treatDeck = H.deckFromDump(treat, byName);
  const baseNames = new Set(baseDeck.cards.map((c) => c.name));
  const shared = [...new Set(treatDeck.cards.map((c) => c.name))].filter(
    (n) => baseNames.has(n) && !/^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(n)
  );
  const commanders = baseDeck.commanders.map((c) => c.name);
  const cz = base.customization;
  const ctx = H.createObjectiveContext({
    colorIdentity: base.colorIdentity,
    customization: cz,
    edhrec: page.rows,
    roleTargets: base.roleTargets ?? {},
    pacing: base.detectedPacing,
    combos: H.combosOf(base, treat),
    liftPools: await liftPools(commanders, shared),
    globalRank: rank,
    ownedNames: cz.collectionMode ? OWNED : undefined,
    manaSim: SEED === undefined ? undefined : { seed: SEED },
    weights,
  });
  const t0 = performance.now();
  const baseScore = H.scoreDeck(baseDeck, ctx);
  const t1 = performance.now();
  const treatScore = H.scoreDeck(treatDeck, ctx);
  const t2 = performance.now();
  const notes = [];
  if (page.fallback) notes.push('scored against the base page (filtered page missing)');
  if (JSON.stringify(base.roleTargets) !== JSON.stringify(treat.roleTargets))
    notes.push(
      `role targets differ: ${JSON.stringify(base.roleTargets)} vs ${JSON.stringify(treat.roleTargets)}`
    );
  return {
    slug: pair.slug,
    ctx,
    baseDeck,
    treatDeck,
    base: baseScore,
    treat: treatScore,
    ms: [t1 - t0, t2 - t1],
    notes,
  };
}

// ── Reporting ──────────────────────────────────────────────────────────────
const f2 = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
const TERM_KEYS = H.TERM_KEYS;

function cardChanges(r) {
  const count = (cards) => {
    const m = new Map();
    for (const c of cards) m.set(c.name, (m.get(c.name) ?? 0) + 1);
    return m;
  };
  const b = count(r.baseDeck.cards);
  const t = count(r.treatDeck.cards);
  const removed = [...b].flatMap(([n, k]) => Array(Math.max(0, k - (t.get(n) ?? 0))).fill(n));
  const added = [...t].flatMap(([n, k]) => Array(Math.max(0, k - (b.get(n) ?? 0))).fill(n));
  return { removed, added };
}

function printPair(r, verdict) {
  const d = r.treat.total - r.base.total;
  const lex = H.compareScores(r.treat, r.base);
  const feas = `${H.infeasibility(r.base)}→${H.infeasibility(r.treat)}`;
  console.log(
    `\n${r.slug}  Δ ${f2(d)}  (base ${r.base.total.toFixed(2)} → ${r.treat.total.toFixed(2)})  ` +
      `constraints ${feas}${verdict ? `  differ: ${verdict}` : ''}${lex !== 0 && Math.sign(lex) !== Math.sign(d) ? '  [constraint decides]' : ''}`
  );
  const deltas = H.termDeltas(r.treat, r.base);
  console.log(
    '  ' +
      TERM_KEYS.filter((k) => Math.abs(deltas[k]) >= 0.005)
        .map((k) => `${k} ${f2(deltas[k])}`)
        .join('  ')
  );
  const { removed, added } = cardChanges(r);
  const q = (name) => {
    const card = [...r.baseDeck.cards, ...r.treatDeck.cards].find((c) => c.name === name);
    return card ? r.ctx.qualityOf(card).note : '';
  };
  if (removed.length) console.log(`  out: ${removed.map((n) => `${n} [${q(n)}]`).join('; ')}`);
  if (added.length) console.log(`  in:  ${added.map((n) => `${n} [${q(n)}]`).join('; ')}`);
  for (const v of r.treat.violations)
    console.log(`  ! ${v.check}: ${v.detail} ${v.cards.slice(0, 6).join(', ')}`);
  for (const n of r.notes) console.log(`  note: ${n}`);
}

function readVerdicts(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const result = raw.result ?? raw;
  return {
    verdicts: new Map((result.verdicts ?? []).map((v) => [v.deck, v])),
    critic: new Map((result.scores ?? []).map((s) => [s.deck, s.score])),
  };
}

const labelOf = (v) => (v?.verdict === 'improved' ? 1 : v?.verdict === 'regressed' ? -1 : 0);

function agreementLine(label, deltas) {
  const n = deltas.length;
  const a = H.agreement(deltas);
  const [lo, hi] = H.bootstrapCI(deltas, (s) => H.agreement(s), { seed: 7 });
  const k = deltas.reduce((s, p) => s + H.hit(p), 0);
  const p = H.binomialTwoSided(Math.round(k), n);
  return `${label.padEnd(34)} ${(100 * a).toFixed(1).padStart(5)}%  (${k}/${n})  95% CI ${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%  p=${p.toFixed(3)}`;
}

// ── score ──────────────────────────────────────────────────────────────────
async function runScore() {
  const baseline = resolve(opt('--baseline'));
  const treatment = resolve(opt('--treatment'));
  const pairs = loadPairs(baseline, treatment);
  if (pairs.length === 0) throw new Error('no deck appears in both panels');
  await attachPages(pairs);
  const { byName, rank, bulkFile } = await resolveCards(pairs);
  const labels = opt('--verdicts') ? readVerdicts(resolve(opt('--verdicts'))) : null;
  console.log(
    `[objective] ${pairs.length} decks; cards from ${bulkFile}; HTTP cache ${HTTP_CACHE}`
  );
  const results = [];
  for (const pair of pairs) {
    const r = await evaluatePair(pair, byName, rank);
    results.push(r);
    printPair(r, labels?.verdicts.get(r.slug)?.verdict);
  }
  const deltas = results.map((r) => r.treat.total - r.base.total);
  console.log(
    `\n[objective] Δ>0 on ${deltas.filter((d) => d > 0).length}/${deltas.length} decks, median Δ ${f2([...deltas].sort((a, b) => a - b)[deltas.length >> 1])}`
  );
  const regress = results.filter((r) => H.compareScores(r.treat, r.base) < 0).map((r) => r.slug);
  console.log(
    `[objective] prescreen: ${regress.length} decks score worse: ${regress.join(', ') || 'none'}`
  );
  if (labels) {
    const labelled = results
      .map((r) => ({ r, y: labelOf(labels.verdicts.get(r.slug)) }))
      .filter((x) => x.y !== 0);
    console.log(
      agreementLine(
        'agreement with the differ',
        labelled.map(({ r, y }) => ({ delta: r.treat.total - r.base.total, label: y }))
      )
    );
  }
  const ms = results.flatMap((r) => r.ms).sort((a, b) => a - b);
  console.log(
    `[objective] scoreDeck median ${ms[ms.length >> 1].toFixed(0)} ms, max ${ms.at(-1).toFixed(0)} ms; HTTP cache ${stats.hits} hits, ${stats.misses} misses, ${stats.live} live`
  );
  if (opt('--json')) writeJson(resolve(opt('--json')), results);
}

function writeJson(path, results) {
  const out = results.map((r) => ({
    slug: r.slug,
    base: summarize(r.base),
    treat: summarize(r.treat),
    ms: r.ms,
    notes: r.notes,
  }));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out, null, 1));
  console.log(`[objective] wrote ${path}`);
}

function summarize(score) {
  return {
    total: score.total,
    violations: score.violations,
    terms: Object.fromEntries(
      Object.entries(score.terms).map(([k, t]) => [
        k,
        {
          value: t.value,
          contribution: t.contribution,
          summary: t.detail.summary,
          cards: t.detail.cards.slice(0, 12),
        },
      ])
    ),
  };
}

// ── validate ───────────────────────────────────────────────────────────────
function parseGates() {
  return opts('--gate').map((spec) => {
    const eq = spec.indexOf('=');
    const name = spec.slice(0, eq);
    // A comma, not a colon: Windows paths carry a drive colon.
    const [root, verdicts] = spec.slice(eq + 1).split(',');
    if (eq <= 0 || !root || !verdicts)
      throw new Error(`bad --gate ${spec}; want NAME=<root>,<verdicts>`);
    return { name, root: resolve(root), verdictsFile: resolve(verdicts) };
  });
}

/** Names mentioned in a payoffsLost line, matched against a card set (full or front face). */
function mentioned(text, names) {
  const hits = [];
  for (const n of names) {
    const front = n.split(' // ')[0];
    const i = text.indexOf(n) >= 0 ? text.indexOf(n) : text.indexOf(front);
    if (i >= 0) hits.push({ n, i });
  }
  return hits.sort((a, b) => a.i - b.i).map((h) => h.n);
}

function swapScore(r, outName, inName) {
  const cards = [...r.treatDeck.cards];
  const i = cards.findIndex((c) => c.name === outName);
  const add = r.baseDeck.cards.find((c) => c.name === inName);
  if (i < 0 || !add) return null;
  cards[i] = add;
  return H.scoreDeck({ commanders: r.treatDeck.commanders, cards }, r.ctx);
}

async function runValidate() {
  const gates = parseGates();
  if (gates.length === 0) throw new Error('validate needs at least one --gate');
  const all = [];
  for (const g of gates) {
    const pairs = loadPairs(join(g.root, 'baseline'), join(g.root, 'treatment'));
    await attachPages(pairs);
    const { byName, rank, bulkFile } = await resolveCards(pairs);
    const labels = readVerdicts(g.verdictsFile);
    console.log(`\n[objective] gate ${g.name}: ${pairs.length} pairs, cards from ${bulkFile}`);
    const results = [];
    for (const pair of pairs) {
      const r = await evaluatePair(pair, byName, rank);
      const v = labels.verdicts.get(r.slug);
      r.verdict = v;
      r.y = labelOf(v);
      r.critic = labels.critic.get(r.slug);
      r.x = H.valueDeltas(r.treat, r.base);
      results.push(r);
      printPair(r, v?.verdict ?? 'unlabelled');
    }
    all.push({ gate: g, results });
  }

  const labelled = (results) => results.filter((r) => r.y !== 0);
  const prior = Object.fromEntries(TERM_KEYS.map((k) => [k, 1]));
  const deltasWith = (results, w) =>
    labelled(results).map((r) => ({ delta: H.weightedDelta(r.x, w), label: r.y }));
  const lexWith = (results, w) =>
    labelled(results).map((r) => {
      const ib = H.infeasibility(r.base);
      const it = H.infeasibility(r.treat);
      return { delta: it !== ib ? ib - it : H.weightedDelta(r.x, w), label: r.y };
    });

  console.log('\n══ Agreement with the differ, prior weights (every term at 1) ══');
  for (const { gate, results } of all) {
    console.log(agreementLine(`${gate.name} score only`, deltasWith(results, prior)));
    console.log(agreementLine(`${gate.name} constraints first`, lexWith(results, prior)));
  }
  if (all.length >= 2) {
    const every = all.flatMap(({ results }) => results);
    console.log(agreementLine('pooled score only', deltasWith(every, prior)));
    console.log(agreementLine('pooled constraints first', lexWith(every, prior)));
  }

  console.log('\n══ Single-term agreement (sign of that term alone; 0 counts half) ══');
  for (const k of TERM_KEYS) {
    const line = all
      .map(({ gate, results }) => {
        const d = labelled(results).map((r) => ({ delta: r.x[k], label: r.y }));
        return `${gate.name} ${(100 * H.agreement(d)).toFixed(0)}%`;
      })
      .join('  ');
    console.log(`  ${k.padEnd(12)} ${line}`);
  }

  console.log('\n══ Ablation: prior weights with one term removed ══');
  for (const k of TERM_KEYS) {
    const w = { ...prior, [k]: 0 };
    const line = all
      .map(
        ({ gate, results }) =>
          `${gate.name} ${(100 * H.agreement(deltasWith(results, w))).toFixed(0)}%`
      )
      .join('  ');
    console.log(`  without ${k.padEnd(12)} ${line}`);
  }

  if (all.length >= 2) {
    console.log('\n══ Cross-set: fit weights on one gate, test on the other ══');
    for (const train of all) {
      const examples = labelled(train.results).map((r) => ({ x: r.x, y: r.y }));
      const fit = H.fitWeights(examples, TERM_KEYS);
      console.log(
        `fit on ${train.gate.name}: λ=${fit.lambda}, LOO ${(100 * fit.looAgreement).toFixed(0)}%, weights ` +
          TERM_KEYS.map((k) => `${k} ${fit.weights[k].toFixed(2)}`).join(', ')
      );
      for (const test of all) {
        if (test === train) continue;
        console.log(
          agreementLine(
            `  → on ${test.gate.name} score only`,
            deltasWith(test.results, fit.weights)
          )
        );
        console.log(
          agreementLine(
            `  → on ${test.gate.name} constraints first`,
            lexWith(test.results, fit.weights)
          )
        );
      }
    }
    const pooled = all.flatMap(({ results }) => labelled(results).map((r) => ({ x: r.x, y: r.y })));
    const fit = H.fitWeights(pooled, TERM_KEYS);
    console.log(
      `pooled fit (reported AFTER the cross-set numbers): λ=${fit.lambda}, LOO ${(100 * fit.looAgreement).toFixed(1)}% on ${pooled.length}, weights ` +
        TERM_KEYS.map((k) => `${k} ${fit.weights[k].toFixed(2)}`).join(', ')
    );
  }

  console.log('\n══ Critic scores (treatment decks only) ══');
  for (const { gate, results } of all) {
    const rows = results.filter((r) => typeof r.critic === 'number');
    const pooledRho = H.spearman(
      rows.map((r) => r.treat.total),
      rows.map((r) => r.critic)
    );
    // Totals are only comparable within one context family, so also rank
    // within each commander and average (weighted by pair count).
    const byCmd = new Map();
    for (const r of rows) {
      const key = r.baseDeck.commanders.map((c) => c.name).join('+');
      byCmd.set(key, [...(byCmd.get(key) ?? []), r]);
    }
    let wsum = 0;
    let rho = 0;
    for (const group of byCmd.values()) {
      if (group.length < 3) continue;
      const s = H.spearman(
        group.map((r) => r.treat.total),
        group.map((r) => r.critic)
      );
      if (!Number.isFinite(s)) continue;
      rho += s * group.length;
      wsum += group.length;
    }
    const deltaRho = H.spearman(
      rows.map((r) => r.treat.total - r.base.total),
      rows.map((r) => r.critic)
    );
    console.log(
      `${gate.name}: Spearman(score, critic) pooled ${pooledRho.toFixed(2)} (n=${rows.length}); within-commander ${wsum ? (rho / wsum).toFixed(2) : 'n/a'} (n=${wsum}); Spearman(Δscore, critic) ${deltaRho.toFixed(2)}`
    );
  }

  console.log(
    '\n══ Named payoff losses: does the score prefer the lost card over its replacement, in the treatment deck? ══'
  );
  let named = 0;
  let wins = 0;
  let fallbackNamed = 0;
  let fallbackWins = 0;
  for (const { gate, results } of all) {
    for (const r of results) {
      const lost = r.verdict?.payoffsLost ?? [];
      if (!lost.length) continue;
      const { removed, added } = cardChanges(r);
      for (const line of lost) {
        const out = mentioned(line, [...new Set(removed)])[0];
        if (!out) continue;
        const outCard = r.baseDeck.cards.find((c) => c.name === out);
        const isLand = /\bLand\b/.test(outCard.card_faces?.[0]?.type_line ?? outCard.type_line);
        let ins = mentioned(line, [...new Set(added)]);
        const explicit = ins.length > 0;
        if (!explicit) {
          ins = [...new Set(added)].filter((n) => {
            const c = r.treatDeck.cards.find((x) => x.name === n);
            return /\bLand\b/.test(c.card_faces?.[0]?.type_line ?? c.type_line) === isLand;
          });
        }
        for (const inn of ins) {
          const s = swapScore(r, inn, out);
          if (!s) continue;
          const d = s.total - r.treat.total;
          const good = d > 0;
          if (explicit) {
            named++;
            wins += good ? 1 : 0;
          } else {
            fallbackNamed++;
            fallbackWins += good ? 1 : 0;
          }
          if (!good || explicit) {
            const td = H.termDeltas(s, r.treat);
            console.log(
              `  ${good ? 'ok ' : 'MISS'} ${gate.name} ${r.slug}: ${out} over ${inn}${explicit ? '' : ' (unnamed replacement)'} Δ ${f2(d)}  ` +
                TERM_KEYS.filter((k) => Math.abs(td[k]) >= 0.01)
                  .map((k) => `${k} ${f2(td[k])}`)
                  .join(' ')
            );
          }
        }
      }
    }
  }
  console.log(
    `named replacements: the lost card wins ${wins}/${named}; against every same-slot-type added card: ${fallbackWins}/${fallbackNamed}`
  );

  const ms = all.flatMap(({ results }) => results.flatMap((r) => r.ms)).sort((a, b) => a - b);
  console.log(
    `\n[objective] scoreDeck over ${ms.length} decks: median ${ms[ms.length >> 1].toFixed(0)} ms, p90 ${ms[Math.floor(ms.length * 0.9)].toFixed(0)} ms, max ${ms.at(-1).toFixed(0)} ms; HTTP cache ${stats.hits} hits, ${stats.misses} misses, ${stats.live} live`
  );
  if (opt('--json'))
    writeJson(
      resolve(opt('--json')),
      all.flatMap(({ results }) => results)
    );
}

try {
  if (command === 'score') await runScore();
  else await runValidate();
} finally {
  if (lockHeld) rmSync(LOCK, { recursive: true, force: true });
}
