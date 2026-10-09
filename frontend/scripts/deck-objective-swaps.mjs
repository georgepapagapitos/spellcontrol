#!/usr/bin/env node
// Adversarial validation of the whole-deck search: every swap the optimizer
// made in a gated panel, labeled from the gate's own verdicts, replayed one
// at a time against the generator's deck and judged by the CURRENT objective
// and acceptance rule (optimizer.ts judgeSwap). A good search refuses the
// swaps the gate called bad and keeps the rest.
//
//   node scripts/deck-objective-swaps.mjs --verdicts <gate output .json> \
//     --baseline <generator dumps> --treatment <optimizer dumps> [--json <out>]
//
// Labels (extraction documented here, applied mechanically, no hand edits):
// a swap is BAD when any of
//   lost    the per-deck differ lists a card it took out in payoffsLost: each
//           entry reads "<card>[ + <card>] -> replaced by ...", and the names
//           before the arrow (parentheticals dropped) are matched against the
//           swap's `out`;
//   reason  a differ trust issue calls one of its stated reasons false: the
//           issue mentions "reason" and one of false / untrue / stretch /
//           overstated / inflated / loose / misread / "does not describe" /
//           "not a protection", and it points at this swap by number ("swap
//           #3", "swap 14": differs counted buildReport.optimizerSwaps from 1
//           in one deck and from 0 in another, so of the two candidates the
//           one whose cards the issue names), by quoting one of its reason
//           strings, or by naming both a card it took out and one it put in;
//   critic  a blind critic's flaw mentions the optimizer and names a card
//           the swap took out.
// Every other swap is UNFLAGGED: the differ read the whole diff and did not
// object to it. That is weaker than "good", and the metrics say so.
//
// Metrics: bad swaps refused (the search should not make them), unflagged
// swaps kept, and their mean (balanced agreement). Each swap is judged on
// the generator's deck alone (not in the search's order), so a label can be
// checked without replaying the search.
//
// Options: --bulk, --http-cache, --owned (as the other scripts), --only,
//   --rule legacy (judge by the first gate's rule instead of the trust region).

import { readFileSync, writeFileSync } from 'node:fs';
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
for (const req of ['--verdicts', '--baseline', '--treatment']) {
  if (!opt(req)) {
    console.error(
      'usage: deck-objective-swaps.mjs --verdicts <gate .json> --baseline <dir> --treatment <dir>'
    );
    process.exit(2);
  }
}
// --rule legacy: the first gate's acceptance (no trust region, a 0.1 margin),
// to separate what the objective's terms changed from what the rule did.
const LEGACY = opt('--rule') === 'legacy';
const ONLY = opt('--only')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const FALSE_CLAIM =
  /(false|untrue|stretch|overstat|inflated|\bloose\b|misread|does not describe|doesn't describe|not a protection)/i;

/** The gate's result object: the workflow output wraps it in `result`. */
function readVerdicts(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return raw.result ?? raw;
}

/** Names before "-> replaced by" in a payoffsLost entry. */
export function lostNames(entry) {
  const m = /^(.+?)\s*->\s*replaced by/.exec(entry);
  if (!m) return [];
  return m[1]
    .replace(/\([^)]*\)/g, '')
    .split(' + ')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Swap indices (0-based) a trust issue points at. */
function swapsNamedBy(issue, swaps) {
  const out = new Set();
  const refs = [...issue.matchAll(/\bswap\s*#?\s*(\d+)/gi)];
  refs.forEach((m, k) => {
    // Differs number swaps from 1 or from 0 (both happened in one gate), so
    // "swap N" is the Nth or the (N+1)th, whichever the passage about it
    // (from its sentence to the next swap reference) names a card of.
    const start = Math.max(0, issue.lastIndexOf('. ', m.index) + 1);
    const sentence = issue.slice(start, refs[k + 1]?.index ?? issue.length);
    const n = Number(m[1]);
    // A card may be named short ("Liliana's" for Liliana, Dreadhorde General).
    const named = (name) => sentence.includes(name) || sentence.includes(name.split(',')[0]);
    const hit = [n - 1, n].find(
      (i) => i >= 0 && i < swaps.length && [...swaps[i].in, ...swaps[i].out].some(named)
    );
    if (hit !== undefined) out.add(hit);
  });
  swaps.forEach((s, i) => {
    // A quoted reason: the note after "(term ±x.xx): ".
    const quoted = (s.reasons ?? []).some((r) => {
      const note = r.slice(r.indexOf('): ') + 3, r.indexOf('): ') + 28);
      return note.length >= 20 && issue.includes(note);
    });
    if (quoted && [...s.in, ...s.out].some((n) => issue.includes(n))) out.add(i);
    if (s.out.some((n) => issue.includes(n)) && s.in.some((n) => issue.includes(n))) out.add(i);
  });
  return out;
}

export function labelSwaps(verdict, critic, swaps) {
  const lost = new Set((verdict.payoffsLost ?? []).flatMap(lostNames));
  const reasonIssues = (verdict.trustIssues ?? []).filter(
    (t) => /reason/i.test(t) && FALSE_CLAIM.test(t)
  );
  const falseReason = new Set(reasonIssues.flatMap((t) => [...swapsNamedBy(t, swaps)]));
  const criticText = (critic?.flaws ?? []).filter((f) => /optimi[sz]er/i.test(f)).join('\n');
  return swaps.map((s, i) => {
    const why = [];
    if (s.out.some((n) => lost.has(n))) why.push('lost');
    if (falseReason.has(i)) why.push('reason');
    if (s.out.some((n) => criticText.includes(n))) why.push('critic');
    return { label: why.length ? 'bad' : 'unflagged', why };
  });
}

const net = installNetwork({
  httpCache: resolve(opt('--http-cache') ?? DEFAULT_HTTP_CACHE),
  live: false,
  owner: 'deck-objective-swaps',
});
const H = await loadHarness();
const G = readVerdicts(resolve(opt('--verdicts')));
const TREATMENT = resolve(opt('--treatment'));
const { runs, bulkFile } = await loadPanelRuns(H, net, {
  panel: resolve(opt('--baseline')),
  only: ONLY ?? G.verdicts.map((v) => v.deck),
  owned: readOwned(resolve(opt('--owned') ?? DEFAULT_OWNED)),
  bulk: opt('--bulk'),
});
console.log(`[swaps] ${runs.length} decks; cards from ${bulkFile}; rule ${LEGACY ? 'legacy' : 'trust region'}`);
const RULE = LEGACY ? { trust: false, minGain: 0.1 } : { trust: { roleOf: H.countedRoleOf } };

const rows = [];
for (const run of runs) {
  const verdict = G.verdicts.find((v) => v.deck === run.slug);
  if (!verdict) continue;
  const critic = (G.scores ?? []).find((s) => s.deck === run.slug);
  const treated = JSON.parse(readFileSync(join(TREATMENT, `${run.slug}.json`), 'utf8'));
  const swaps = treated.buildReport?.optimizerSwaps ?? [];
  const labels = labelSwaps(verdict, critic, swaps);
  swaps.forEach((s, i) => {
    const ins = s.in.map((n) => H.resolveName(run.byName, n));
    const row = {
      deck: run.slug,
      verdict: verdict.verdict,
      out: s.out,
      in: s.in,
      ...labels[i],
      gateDelta: s.delta,
    };
    if (ins.some((c) => !c) || s.out.some((n) => !run.seed.cards.some((c) => c.name === n))) {
      // A swap that only makes sense after an earlier one (its out-card came
      // in by a previous swap) can't be judged on the generator's deck.
      rows.push({ ...row, judged: false });
      return;
    }
    const j = H.judgeSwap(run.seed, s.out, ins, run.ctx, RULE);
    rows.push({
      ...row,
      judged: true,
      delta: Math.round(j.delta * 100) / 100,
      accepted: j.accepted,
      refusal: j.refusal,
    });
  });
}

const judged = rows.filter((r) => r.judged);
const bad = judged.filter((r) => r.label === 'bad');
const unflagged = judged.filter((r) => r.label === 'unflagged');
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
const badRefused = bad.filter((r) => !r.accepted).length;
const keptUnflagged = unflagged.filter((r) => r.accepted).length;
console.log(
  `\n${rows.length} swaps, ${judged.length} judgeable on the generator's deck; ` +
    `${bad.length} bad (${['lost', 'reason', 'critic'].map((w) => `${w} ${bad.filter((r) => r.why.includes(w)).length}`).join(', ')}), ${unflagged.length} unflagged`
);
console.log(`bad refused       ${pct(badRefused, bad.length)}  (${badRefused}/${bad.length})`);
console.log(
  `unflagged kept    ${pct(keptUnflagged, unflagged.length)}  (${keptUnflagged}/${unflagged.length})`
);
const balanced =
  bad.length && unflagged.length ? (badRefused / bad.length + keptUnflagged / unflagged.length) / 2 : 0;
console.log(`balanced          ${(100 * balanced).toFixed(1)}%`);
for (const r of judged) {
  const mark = r.label === 'bad' ? (r.accepted ? 'MISS' : 'ok  ') : r.accepted ? 'ok  ' : 'lost';
  console.log(
    `  ${mark} ${r.label.padEnd(9)} ${r.deck.padEnd(40)} ${r.out.join(' + ')} -> ${r.in.join(' + ')}` +
      `  Δ ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2)}${r.refusal ? `  (${r.refusal})` : ''}${r.why.length ? `  [${r.why.join(',')}]` : ''}`
  );
}
if (opt('--json')) {
  writeFileSync(
    resolve(opt('--json')),
    JSON.stringify({ rows, badRefused, keptUnflagged, balanced }, null, 1)
  );
}
net.release();
