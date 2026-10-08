#!/usr/bin/env node
// Runs the whole-deck search (deckObjective/optimizer.ts) on every generator
// deck in a LIVE_GEN panel directory and writes the optimized decks as panel
// dumps in the harness's own format (deckObjective/panelRewrite.ts), for a
// quick offline look at what a search would change. Run the panel with
// LIVE_GEN_OPTIMIZER=0 first: the generator searches by default now, and this
// script wants the decks as they were before the swaps.
//
// NOT FOR GATING: a rewritten dump keeps the generator's notes for the deck
// before the swaps. Gate the search with ordinary panels (it is on by default), where it
// runs inside generation and the generator writes the report for the final
// list (customization.wholeDeckSearch).
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
// Options: --weights term=w,term=w (objective term weights, default all 1), --bulk, --http-cache, --live, --owned, --only (as the evaluator),
//   --max-swaps <n> (5), --max-evals <n> (300), --min-gain <x> (0.3),
//   --report <file> (default <out>/optimizer-report.json)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_HTTP_CACHE,
  DEFAULT_OWNED,
  installNetwork,
  loadHarness,
  loadPanelRuns,
  readOwned,
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
const { runs, bulkFile } = await loadPanelRuns(H, net, {
  panel: PANEL,
  only: ONLY,
  owned: OWNED,
  bulk: opt('--bulk'),
  weights: opt('--weights')
    ? Object.fromEntries(
        opt('--weights')
          .split(',')
          .map((kv) => kv.split('='))
          .map(([k, v]) => [k, Number(v)])
      )
    : undefined,
});
console.log(`[optimize] ${runs.length} decks from ${PANEL}; cards from ${bulkFile}`);

mkdirSync(OUT, { recursive: true });
const report = [];
for (const d of runs) {
  const { dump, seed, candidates, ctx } = d;
  const result = H.optimizeDeck(seed, candidates, ctx, {
    ...OPTIONS,
    // The trust region's role floors count roles the way the deck report does.
    trust: { roleOf: H.countedRoleOf },
  });
  const out = H.rewriteDump(dump, result, ctx);
  writeFileSync(join(OUT, `${d.slug}.json`), JSON.stringify(out, null, 2));
  const line = {
    slug: d.slug,
    before: result.seedScore.total,
    after: result.score.total,
    swaps: result.swaps.map((s) => ({
      summary: s.summary,
      kind: s.kind,
      delta: s.delta,
      reasons: s.reasons
        .slice(0, 4)
        .map(
          (r) => `${r.name} ${r.term} ${r.value >= 0 ? '+' : ''}${r.value.toFixed(2)}: ${r.note}`
        ),
    })),
    undone: result.undone,
    refusals: result.refusals,
    unverified: result.unverified,
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
  for (const u of result.undone)
    console.log(`  undone  ${u.in.join(' + ')} for ${u.out.join(' + ')}: ${u.why}`);
  if (Object.keys(result.refusals).length)
    console.log(
      `  refused by the trust region: ${Object.entries(result.refusals)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')}`
    );
  for (const u of result.unverified)
    console.log(`  dropped reason ${u.name} (${u.term}): ${u.note}; ${u.problem}`);
  if (line.violations.length)
    console.log(`  ! still infeasible: ${line.violations.map((v) => v.check).join(', ')}`);
}
const reportFile = resolve(opt('--report') ?? join(OUT, 'optimizer-report.json'));
writeFileSync(reportFile, JSON.stringify(report, null, 1));
const total = report.reduce((s, r) => s + r.ms, 0);
const deltas = report.flatMap((r) => r.swaps.map((s) => s.delta)).sort((a, b) => a - b);
const q = (f) =>
  deltas.length
    ? deltas[Math.min(deltas.length - 1, Math.floor(f * deltas.length))].toFixed(2)
    : 'n/a';
console.log(
  `\n[optimize] swap gain in the final deck: n ${deltas.length}, min ${q(0)}, p25 ${q(0.25)}, median ${q(0.5)}, p75 ${q(0.75)}, max ${q(0.9999)}; ` +
    `swaps per deck ${report.map((r) => r.swaps.length).join(' ')}`
);
console.log(
  `\n[optimize] ${report.length} decks, ${report.reduce((s, r) => s + r.swaps.length, 0)} swaps, ` +
    `${(total / 1000).toFixed(0)} s total (median ${(report.map((r) => r.ms).sort((a, b) => a - b)[report.length >> 1] / 1000).toFixed(1)} s); ` +
    `HTTP cache ${net.stats.hits} hits, ${net.stats.misses} misses; report ${reportFile}`
);
net.release();
