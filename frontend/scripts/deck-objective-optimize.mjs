#!/usr/bin/env node
// Runs the whole-deck search (deckObjective/optimizer.ts) on every generator
// deck in a LIVE_GEN panel directory and writes the optimized decks as panel
// dumps in the harness's own format (deckObjective/panelRewrite.ts), so a
// ship gate (ship-gate.js, prescan.py) can compare optimizer output against
// generator output unchanged.
//
//   node scripts/deck-objective-optimize.mjs --panel <generator dumps> --out <dir>
//
// Per deck: the context is the dump's own (its EDHREC page, role targets,
// pacing, combo set, collection), the seed is the generator's deck, and the
// candidates are the page's cards plus, for a collection build, the owned
// cards, plus the identity's basics. Card records come from Scryfall's
// oracle_cards bulk file (a candidate's price is that file's printing, where
// the generator priced the cheapest printing it found). Deterministic.
//
// Options: --bulk, --http-cache, --live, --owned, --only (as the evaluator),
//   --max-swaps <n> (25), --max-evals <n> (300), --min-gain <x> (0.1),
//   --report <file> (default <out>/optimizer-report.json)

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_HTTP_CACHE,
  DEFAULT_OWNED,
  installNetwork,
  liftPools,
  loadHarness,
  pageRows,
  readOwned,
  resolveCards,
} from './deck-objective-lib.mjs';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name) => argv.includes(name);
if (!opt('--panel') || !opt('--out')) {
  console.error('usage: deck-objective-optimize.mjs --panel <generator dumps> --out <dir>');
  process.exit(2);
}
const PANEL = resolve(opt('--panel'));
const OUT = resolve(opt('--out'));
const ONLY = opt('--only')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OPTIONS = {
  maxSwaps: opt('--max-swaps') ? Number(opt('--max-swaps')) : undefined,
  maxEvaluations: opt('--max-evals') ? Number(opt('--max-evals')) : undefined,
  minGain: opt('--min-gain') ? Number(opt('--min-gain')) : undefined,
};
for (const k of Object.keys(OPTIONS)) if (OPTIONS[k] === undefined) delete OPTIONS[k];

const net = installNetwork({
  httpCache: resolve(opt('--http-cache') ?? DEFAULT_HTTP_CACHE),
  live: flag('--live'),
  owner: 'deck-objective-optimize',
});
const H = await loadHarness();
const OWNED = readOwned(resolve(opt('--owned') ?? DEFAULT_OWNED));
const BASICS = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

const files = readdirSync(PANEL)
  .filter((f) => f.endsWith('.json') && f !== 'summary.json')
  .filter((f) => !ONLY || ONLY.some((o) => f.includes(o)))
  .sort();
const decks = [];
for (const f of files) {
  const dump = JSON.parse(readFileSync(join(PANEL, f), 'utf8'));
  decks.push({ slug: f.replace(/\.json$/, ''), dump, page: await pageRows(H, dump) });
}

// One bulk pass for every deck: its cards, its page, its owned pool, basics.
const names = new Set(Object.values(BASICS));
const required = new Set();
const rankNames = new Set();
for (const d of decks) {
  for (const n of [d.dump.commander, ...(d.dump.partner ? [d.dump.partner] : [])]) {
    names.add(n);
    required.add(n);
  }
  for (const c of H.dumpCards(d.dump)) {
    names.add(c.name);
    required.add(c.name);
  }
  for (const n of d.page.rows.keys()) {
    names.add(n);
    rankNames.add(n);
  }
  if (d.dump.customization.collectionMode) for (const n of OWNED) names.add(n);
}
const { byName, rank, bulkFile } = await resolveCards(H, {
  names,
  rankNames,
  required,
  bulkPath: opt('--bulk'),
});
console.log(`[optimize] ${decks.length} decks from ${PANEL}; cards from ${bulkFile}`);

mkdirSync(OUT, { recursive: true });
const report = [];
for (const d of decks) {
  const { dump, page } = d;
  const seed = H.deckFromDump(dump, byName);
  const commanders = seed.commanders.map((c) => c.name);
  const cz = dump.customization;
  const owned = cz.collectionMode ? OWNED : undefined;
  const candidateNames = new Set([
    ...page.rows.keys(),
    ...(owned ? [...owned] : []),
    ...dump.colorIdentity.map((c) => BASICS[c]).filter(Boolean),
  ]);
  if (dump.colorIdentity.length === 0) candidateNames.add('Wastes');
  const candidates = [...candidateNames]
    .map((n) => H.resolveName(byName, n))
    .filter((c) => c && c.legalities?.commander === 'legal');
  const ctx = H.createObjectiveContext({
    colorIdentity: dump.colorIdentity,
    customization: cz,
    edhrec: page.rows,
    roleTargets: dump.roleTargets ?? {},
    pacing: dump.detectedPacing,
    combos: H.combosOf(dump),
    liftPools: await liftPools(
      H,
      net,
      commanders,
      seed.cards.map((c) => c.name)
    ),
    globalRank: rank,
    ownedNames: owned,
  });
  const result = H.optimizeDeck(seed, candidates, ctx, OPTIONS);
  const out = H.rewriteDump(dump, result, ctx);
  writeFileSync(join(OUT, `${d.slug}.json`), JSON.stringify(out, null, 2));
  const line = {
    slug: d.slug,
    before: result.seedScore.total,
    after: result.score.total,
    swaps: result.swaps.map((s) => ({
      summary: s.summary,
      kind: s.kind,
      reasons: s.reasons
        .slice(0, 4)
        .map(
          (r) => `${r.name} ${r.term} ${r.value >= 0 ? '+' : ''}${r.value.toFixed(2)}: ${r.note}`
        ),
    })),
    violations: result.score.violations,
    seedViolations: result.seedScore.violations,
    evaluations: result.evaluations,
    stoppedBy: result.stoppedBy,
    candidates: candidates.length,
    ms: result.ms,
  };
  report.push(line);
  console.log(
    `\n${d.slug}: ${line.before.toFixed(2)} -> ${line.after.toFixed(2)} (${result.swaps.length} swaps, ` +
      `${(result.ms / 1000).toFixed(1)} s, ${result.evaluations.full} full / ${result.evaluations.fast} fast evaluations, ` +
      `${candidates.length} candidates, stopped by ${result.stoppedBy})`
  );
  for (const s of line.swaps) {
    console.log(`  ${s.kind.padEnd(7)} ${s.summary}`);
    for (const r of s.reasons) console.log(`            ${r}`);
  }
  if (line.violations.length)
    console.log(`  ! still infeasible: ${line.violations.map((v) => v.check).join(', ')}`);
}
const reportFile = resolve(opt('--report') ?? join(OUT, 'optimizer-report.json'));
writeFileSync(reportFile, JSON.stringify(report, null, 1));
const total = report.reduce((s, r) => s + r.ms, 0);
console.log(
  `\n[optimize] ${report.length} decks, ${report.reduce((s, r) => s + r.swaps.length, 0)} swaps, ` +
    `${(total / 1000).toFixed(0)} s total (median ${(report.map((r) => r.ms).sort((a, b) => a - b)[report.length >> 1] / 1000).toFixed(1)} s); ` +
    `HTTP cache ${net.stats.hits} hits, ${net.stats.misses} misses; report ${reportFile}`
);
net.release();
