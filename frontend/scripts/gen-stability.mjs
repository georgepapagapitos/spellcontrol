#!/usr/bin/env node
// Generation stability harness (board E1061).
//
// Regenerates the 15-deck panel from recorded EDHREC/Scryfall data under
// controlled perturbations and reports, per deck, how far each perturbed deck
// moved from the unperturbed one: cards changed, staples lost, and which late
// pass made each difference. A change to the candidate pool has rerouted the
// late passes into staple losses on decks it never targeted (E1052); this is the
// measure for any fix to that.
//
//   node scripts/gen-stability.mjs run    --out DIR [--cache DIR] [--only a,b] [--runs ref,rerun,...]
//   node scripts/gen-stability.mjs report --out DIR [--runs ...] [--bar 40]
//
// `run` writes DIR/<label>/*.json (the live panel's dumps) one label at a time,
// each in its own vitest process (the EDHREC client keeps pages in memory, so a
// second pass in one process would not see the perturbation). It needs the live
// panel's usual env (it sets NODE_ENV/LIVE_GEN itself) and, on a shared machine,
// the live lock:
//   bash .claude/skills/deckgen-eval-gate/scripts/live-lock.sh <owner> node scripts/gen-stability.mjs run ...
// With --cache the pages replay from disk, so the runs differ only by the
// perturbation. A full run is 5 labels x ~3.5 minutes.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  STAPLE_BAR,
  deckChurn,
  finalNames,
  formatTable,
  marginRead,
} from './gen-stability-lib.mjs';

/** label -> LIVE_GEN_PERTURB. `ref` is what every other label is compared to. */
export const RUNS = {
  ref: 'none',
  rerun: 'none',
  // a tail card seated at the page's lowest inclusion (the floor holds still); some decks seat it as filler
  poolTail: 'add:Ornithopter@floor',
  // a card the format bans, at the floor: filtered before any pick and the page floor does not move
  poolBanned: 'add:Black Lotus@floor',
  // the same banned card at 1%: only the page floor drops
  floorDrop: 'add:Black Lotus@1',
  // the tail card at 1%: the floor drops and some decks seat the card
  tail1pct: 'add:Ornithopter@1',
  // E1052's case: a 36% blue instant, so only blue decks have a reason to move
  targeted: 'add:Anticipate@36@instants',
  shuffle: 'shuffle:11',
  seed: 'seed:7',
  // EDHREC's day-to-day drift: every card's inclusion moved by up to +-1 point
  drift: 'drift:1@1',
};

const TEST = 'src/deck-builder/services/deckBuilder/deckGenerator.live.test.ts';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

function run(opts) {
  const out = resolve(opts.out);
  const labels = (opts.runs ?? Object.keys(RUNS).join(',')).split(',');
  for (const label of labels) {
    const perturb = RUNS[label];
    if (perturb === undefined) throw new Error(`unknown run "${label}"`);
    const dir = join(out, label);
    mkdirSync(dir, { recursive: true });
    console.log(`=== ${label} (${perturb}) ===`);
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      LIVE_GEN: '1',
      LIVE_GEN_OUTDIR: dir,
      LIVE_GEN_PERTURB: perturb,
      ...(opts.cache ? { LIVE_GEN_HTTP_CACHE: resolve(opts.cache) } : {}),
      ...(opts.only ? { LIVE_GEN_ONLY: opts.only } : {}),
    };
    const r = spawnSync(
      './node_modules/.bin/vitest',
      ['run', '--mode', 'production', '--disableConsoleIntercept', TEST],
      { env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 }
    );
    writeFileSync(join(out, `${label}.log`), `${r.stdout}\n${r.stderr}`);
    const n = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'summary.json').length
      : 0;
    console.log(`    exit ${r.status}, ${n} decks`);
    if (r.status !== 0 || n === 0)
      throw new Error(`${label} panel failed; see ${out}/${label}.log`);
  }
}

function load(dir) {
  const decks = {};
  for (const f of readdirSync(dir))
    if (f.endsWith('.json') && f !== 'summary.json')
      decks[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return decks;
}

function report(opts) {
  const out = resolve(opts.out);
  const bar = Number(opts.bar ?? STAPLE_BAR);
  const ref = load(join(out, 'ref'));
  const labels = (opts.runs ?? Object.keys(RUNS).join(',')).split(',').filter((l) => l !== 'ref');
  const result = { bar, perturbations: {}, margins: {} };
  for (const slug of Object.keys(ref)) result.margins[slug] = marginRead(ref[slug]);
  for (const label of labels) {
    const dir = join(out, label);
    if (!existsSync(dir)) continue;
    const runs = load(dir);
    const rows = [];
    for (const slug of Object.keys(ref)) {
      if (!runs[slug]) continue;
      rows.push({ slug, ...deckChurn(ref[slug], runs[slug], bar) });
    }
    const total = (f) => rows.reduce((s, r) => s + f(r), 0);
    const summary = {
      perturb: RUNS[label],
      decks: rows.length,
      decksChanged: rows.filter((r) => r.changed > 0).length,
      cardsChanged: total((r) => r.changed),
      preLateCardsChanged: total((r) => r.preLateChanged),
      staplesLost: total((r) => r.staplesLost.length),
      staplesLostNet: total((r) => r.staplesLostNet.length),
      byWhy: rows.reduce((m, r) => {
        for (const [k, v] of Object.entries(r.byWhy)) m[k] = (m[k] ?? 0) + v;
        return m;
      }, {}),
      rows,
    };
    result.perturbations[label] = summary;
    console.log(
      formatTable(
        rows,
        `\n## ${label} (${RUNS[label]}) vs ref: ${summary.decksChanged}/${summary.decks} decks changed, ${summary.cardsChanged} cards, ${summary.staplesLost} staples >= ${bar}% dropped (${summary.staplesLostNet} with nothing as well played in their place), pre-late cards changed ${summary.preLateCardsChanged}`
      )
    );
  }
  const slugs = Object.keys(ref);
  console.log(
    `\n## ref: ${slugs.length} decks, ${slugs.reduce((s, k) => s + finalNames(ref[k]).size, 0)} cards`
  );
  writeFileSync(join(out, 'stability.json'), JSON.stringify(result, null, 2));
  console.log(`wrote ${join(out, 'stability.json')}`);
}

const [cmd] = process.argv.slice(2);
const opts = args(process.argv.slice(3));
if (!opts.out || !['run', 'report'].includes(cmd)) {
  console.error(
    'usage: gen-stability.mjs run|report --out DIR [--cache DIR] [--only a,b] [--runs ref,rerun,...] [--bar 40]'
  );
  process.exit(2);
}
(cmd === 'run' ? run : report)(opts);
