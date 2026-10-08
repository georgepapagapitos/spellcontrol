#!/usr/bin/env node
// E516: fit the whole-deck objective's term weights so real decklists outscore
// perturbed copies of themselves, and report held-out accuracy against the
// hand weights (all ones), ablations and per-source results.
//
//   node scripts/deck-objective-fit.mjs pairs  [--sources a,b] [--swaps 3,8] [--per-mode 2] [--limit N]
//   node scripts/deck-objective-fit.mjs report [--pairs <file>]
//
// `pairs` scores every corpus deck and its perturbed copies under ONE context
// (the commander's EDHREC page, replayed from the shared HTTP cache) and
// writes one row per pair to <corpus>/pairs.jsonl: the per-term VALUE deltas
// (real minus perturbed). `report` fits and prints. Offline: the HTTP cache
// and the Scryfall bulk file only.
//
// Perturbation (decklist-corpus-lib chooseSwaps): k non-land cards out, k
// same-role same-kind (creature or not) cards from the commander's page in.
//   random   drawn in proportion to EDHREC inclusion (plausible, may downgrade)
//   matched  inclusion within 5 points of the card replaced, so the quality
//            prior can't decide the pair alone
// Terms the corpus can't exercise (combos, lift, ownership: no combo list or
// card pages are fed in) show as inert and keep the prior weight.

// MEASURED 2026-10-08 (main 822dc133; 668 decks, 5,425 pairs, 183 commanders; corpus and
// pairs live outside the repo in C:/Users/georg/dev/.decklist-corpus). Grouped 5-fold by
// commander, share of pairs the real deck wins (hand weights = all ones):
//   pooled          68.4% hand, 71.4% fitted (+3.0 pts, CI 2.3..3.7)
//   edhrec-average  84.5% -> 89.0%   (circular: the quality term IS the page's inclusion)
//   edhtop16        66.6% -> 70.2%   (cEDH lists against the commander's cEDH page)
//   spellcontrol    41.1% -> 60.7%   (precons: the hand weights are below chance)
// The fit's one consistent move is signature x2 (E510 synergy strength), with interaction,
// curve and winline lower; the interaction and curve cuts match what cEDH lists do, so they
// are not evidence for brackets 1-3. Offline search with signature = 2 on the 15 standard
// decks changed 15 of 69 swaps, all sideways. Nothing shipped on this: agreement on
// non-adversarial pairs does not validate weights for search (E513).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_HTTP_CACHE,
  DEV_ROOT,
  installNetwork,
  loadHarness,
  resolveCards as resolveBulk,
} from './deck-objective-lib.mjs';
import { chooseSwaps, rng, straight } from './decklist-corpus-lib.mjs';

const argv = process.argv.slice(2);
const command = argv[0];
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const CORPUS = resolve(opt('--corpus', join(DEV_ROOT, '.decklist-corpus')));
const PAIRS = resolve(opt('--pairs', join(CORPUS, 'pairs.jsonl')));
const BULK = opt(
  '--bulk',
  join(DEV_ROOT, '.coach-eval-corpus/bulk/oracle-cards-20260929090156.jsonl.gz')
);

const readJsonl = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

const BASICS = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

// ── pairs ──────────────────────────────────────────────────────────────────
async function runPairs() {
  const sources = opt('--sources', 'edhrec-average,edhtop16,spellcontrol').split(',');
  const swapSizes = opt('--swaps', '3,8').split(',').map(Number);
  const perMode = Number(opt('--per-mode', '2'));
  const limit = Number(opt('--limit', '100000'));
  const net = installNetwork({ httpCache: DEFAULT_HTTP_CACHE, live: false, owner: 'fit' });
  const H = await loadHarness();

  // A few commanders dominate a tournament scrape (one pod meta, 165 lists): cap the decks per
  // commander per source so the fit sees commanders, not one metagame.
  const maxPer = Number(opt('--max-per-commander', '8'));
  const perCmdr = new Map();
  const decks = sources
    .flatMap((f) => readJsonl(join(CORPUS, `${f}.jsonl`)))
    .filter((d) => {
      const key = `${d.source}|${d.commander}`;
      const n = perCmdr.get(key) ?? 0;
      perCmdr.set(key, n + 1);
      return n < maxPer;
    })
    .slice(0, limit);
  // Pages: the bracket page a deck belongs to (EDHREC average decks) or the
  // commander's cEDH page for a tournament list, else the base page.
  const pageOf = async (d) => {
    const tries =
      d.source === 'edhtop16'
        ? [5, undefined]
        : d.source === 'edhrec-average' && d.bracket
          ? [d.bracket, undefined]
          : [undefined];
    for (const b of tries) {
      try {
        const data = await H.fetchCommanderData(d.commander, undefined, b);
        const rows = H.edhrecRowsFrom(data);
        if (rows.size > 50) return { data, rows, bracket: b ?? 0 };
      } catch {
        // next rung
      }
    }
    return null;
  };
  const withPage = [];
  for (const d of decks) {
    if (d.partner) continue;
    const page = await pageOf(d);
    if (page) withPage.push({ d, page });
  }
  console.log(`[fit] ${decks.length} corpus decks, ${withPage.length} with a cached page`);

  const names = new Set(Object.values(BASICS));
  const rankNames = new Set();
  for (const { d, page } of withPage) {
    names.add(d.commander);
    for (const c of d.cards) names.add(c.name);
    for (const n of page.rows.keys()) {
      names.add(n);
      rankNames.add(n);
    }
  }
  const { byName, rank } = await resolveBulk(H, {
    names,
    rankNames,
    required: new Set(),
    bulkPath: BULK,
  });

  const done = new Set(readJsonl(PAIRS).map((r) => r.deckId));
  const out = [];
  let skipped = 0;
  for (const { d, page } of withPage) {
    const deckId = `${d.source}|${d.commander}|${d.bracket}|${d.cards.length}|${d.standing ?? ''}`;
    if (done.has(deckId)) continue;
    const cmdr = H.resolveName(byName, d.commander);
    if (!cmdr) {
      skipped++;
      continue;
    }
    const identity = new Set(cmdr.color_identity ?? []);
    // Expand to one entry per copy; drop unresolved names, skip a deck losing more than 3.
    let missing = 0;
    const cards = [];
    for (const { name, qty } of d.cards) {
      if (straight(name) === straight(d.commander)) continue;
      const c = H.resolveName(byName, name);
      if (!c) {
        missing += qty;
        continue;
      }
      for (let i = 0; i < qty; i++) cards.push(c);
    }
    if (missing > 3) {
      skipped++;
      continue;
    }
    // Sources that list each name once lose their basics' counts: pad to 99
    // with the identity's basics in equal shares (the same cards in every copy
    // of the deck, so the padding cancels in a pair).
    const pad = [...identity].map((c) => BASICS[c]).filter(Boolean);
    if (pad.length === 0) pad.push('Wastes');
    for (let i = 0; cards.length < 99 && cards.length > 40; i++) {
      const b = H.resolveName(byName, pad[i % pad.length]);
      if (!b) break;
      cards.push(b);
    }
    const real = { commanders: [cmdr], cards };
    const rows = page.rows;
    const inclOf = (c) =>
      rows.get(c.name)?.inclusion ?? rows.get(c.name.split(' // ')[0])?.inclusion ?? 0;
    const kind = (c) => {
      const role = H.countedRoleOf(c) ?? 'none';
      const tl = (c.card_faces?.[0]?.type_line ?? c.type_line ?? '').toLowerCase();
      return `${role}/${tl.includes('creature') ? 'c' : 'n'}`;
    };
    const isLand = (c) => /\bland\b/i.test(c.card_faces?.[0]?.type_line ?? c.type_line ?? '');
    const inDeck = new Set(cards.map((c) => c.name));
    const removable = [
      ...new Map(cards.filter((c) => !isLand(c)).map((c) => [c.name, c])).values(),
    ].map((c) => ({ name: c.name, role: kind(c), incl: inclOf(c) }));
    const candidates = [];
    for (const [n, row] of rows) {
      const c = H.resolveName(byName, n);
      if (!c || inDeck.has(c.name) || isLand(c) || c.legalities?.commander !== 'legal') continue;
      if (!(c.color_identity ?? []).every((x) => identity.has(x))) continue;
      candidates.push({ name: c.name, role: kind(c), incl: row.inclusion });
    }
    const ctx = H.createObjectiveContext({
      colorIdentity: [...identity],
      customization: {},
      edhrec: rows,
      roleTargets: H.computeEdhrecRoleTargets(page.data),
      roleOf: H.countedRoleOf,
      pacing: page.data.stats?.manaCurve
        ? H.estimatePacingFromStats(page.data.stats.manaCurve)
        : undefined,
      globalRank: rank,
      slotOrder: cards.map((c) => c.name),
    });
    const realScore = H.scoreDeck(real, ctx);
    const rand = rng([...deckId].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7));
    for (const mode of ['random', 'matched']) {
      for (const k of swapSizes) {
        for (let rep = 0; rep < perMode; rep++) {
          const swaps = chooseSwaps({ removable, candidates, k, mode, rand });
          if (swaps.length < k) continue;
          const outSet = new Map(swaps.map((s) => [s.out, s.in]));
          const used = new Set();
          const perturbed = cards.map((c) => {
            const repl = outSet.get(c.name);
            if (!repl || used.has(c.name)) return c;
            used.add(c.name);
            return H.resolveName(byName, repl);
          });
          // A name that appears twice (a basic never swaps; a multi-copy card might) swaps one copy only.
          const score = H.scoreDeck({ commanders: [cmdr], cards: perturbed }, ctx);
          const x = {};
          for (const key of H.TERM_KEYS)
            x[key] = realScore.terms[key].value - score.terms[key].value;
          out.push({
            deckId,
            source: d.source,
            commander: d.commander,
            bracket: d.bracket,
            pageBracket: page.bracket,
            deckWeight: d.weight ?? 1,
            mode,
            k,
            realTotal: realScore.total,
            swaps,
            x,
          });
        }
      }
    }
    if (out.length >= 200) {
      writeFileSync(PAIRS, out.map((r) => JSON.stringify(r)).join('\n') + '\n', { flag: 'a' });
      out.length = 0;
    }
  }
  if (out.length)
    writeFileSync(PAIRS, out.map((r) => JSON.stringify(r)).join('\n') + '\n', { flag: 'a' });
  console.log(
    `[fit] pairs written to ${PAIRS} (skipped ${skipped} decks); cache ${JSON.stringify(net.stats)}`
  );
}

// ── report ─────────────────────────────────────────────────────────────────
async function runReport() {
  installNetwork({ httpCache: DEFAULT_HTTP_CACHE, live: false, owner: 'fit' });
  const H = await loadHarness();
  const KEYS = H.TERM_KEYS;
  const rows = readJsonl(PAIRS);
  // Pooled weight: a tournament list counts 0.25 below bracket 4 (page is the cEDH page here,
  // but the pooled model serves all brackets). Seeded subsample, so it is a deck-level weight.
  const keep = rng(99);
  const sample = (r) => r.deckWeight >= 1 || keep() < r.deckWeight;
  const ex = (r) => ({ x: r.x, group: r.commander });
  const stats = {};
  for (const k of KEYS) {
    const v = rows.map((r) => r.x[k]);
    stats[k] = {
      nonzero: v.filter((x) => Math.abs(x) > 1e-9).length / v.length,
      mean: v.reduce((s, x) => s + x, 0) / v.length,
      pos: v.filter((x) => x > 1e-9).length / v.length,
      neg: v.filter((x) => x < -1e-9).length / v.length,
    };
  }
  const live = KEYS.filter((k) => stats[k].nonzero > 0.02);
  const inert = KEYS.filter((k) => !live.includes(k));
  console.log(`pairs: ${rows.length}; commanders: ${new Set(rows.map((r) => r.commander)).size}`);
  console.log(`live terms (${live.length}): ${live.join(', ')}`);
  console.log(`inert terms (kept at prior weight 1, not fit): ${inert.join(', ') || 'none'}`);
  console.log(
    '\nper-term pair stats (share of pairs where the real deck is ahead / behind / equal on the term)'
  );
  for (const k of KEYS)
    console.log(
      `  ${k.padEnd(12)} ahead ${(100 * stats[k].pos).toFixed(1).padStart(5)}%  behind ${(100 * stats[k].neg).toFixed(1).padStart(5)}%  mean ${stats[k].mean.toFixed(3)}`
    );

  const handW = Object.fromEntries(KEYS.map((k) => [k, 1]));
  const slices = {
    'all (pooled, tournament x0.25)': (r) => sample(r),
    'edhrec-average': (r) => r.source === 'edhrec-average',
    'edhtop16 (cEDH, bracket-5 page)': (r) => r.source === 'edhtop16',
    'spellcontrol (public + precons)': (r) => r.source.startsWith('spellcontrol'),
    'independent (edhtop16 + spellcontrol)': (r) => r.source !== 'edhrec-average',
    'mode random': (r) => r.mode === 'random' && sample(r),
    'mode matched (inclusion-neutral)': (r) => r.mode === 'matched' && sample(r),
  };
  console.log(
    '\nheld-out (5-fold, grouped by commander) accuracy: share of pairs the real deck wins'
  );
  console.log(
    'slice'.padEnd(40) +
      'n'.padStart(6) +
      'hand'.padStart(8) +
      'fitted'.padStart(8) +
      '  paired diff (95% CI)   logloss hand->fit'
  );
  const fits = {};
  for (const [name, pred] of Object.entries(slices)) {
    const sub = rows.filter(pred).map(ex);
    if (sub.length < 30) {
      console.log(`${name.padEnd(40)}${String(sub.length).padStart(6)}  (too few)`);
      continue;
    }
    const rep = H.heldOut(sub, live);
    const diffs = rep.pairs.map(([h, f]) => f - h);
    const [lo, hi] = H.bootstrapCI(diffs, (s) => s.reduce((a, b) => a + b, 0) / s.length, {
      seed: 5,
      reps: 2000,
    });
    const d = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    console.log(
      `${name.padEnd(40)}${String(rep.n).padStart(6)}${(100 * rep.hand).toFixed(1).padStart(7)}%${(100 * rep.fitted).toFixed(1).padStart(7)}%  ${(100 * d).toFixed(1)} pts (${(100 * lo).toFixed(1)}..${(100 * hi).toFixed(1)})   ${rep.handLogLoss.toFixed(3)} -> ${rep.fittedLogLoss.toFixed(3)}`
    );
    fits[name] = H.fitPairWeights(sub, live, H.pickLambda(sub, live));
  }
  console.log('\nfitted weights (mean-normalised; hand = 1 each)');
  for (const [name, w] of Object.entries(fits))
    console.log(`  ${name}\n    ` + live.map((k) => `${k} ${w[k].toFixed(2)}`).join('  '));

  // Transfer: weights fitted on one source, scored on another. A signal that is about decks,
  // not about one source's quirks, carries across; the source-specific ones flip.
  const SOURCES = ['edhrec-average', 'edhtop16', 'spellcontrol'];
  const bySource = (src) => rows.filter((r) => r.source.startsWith(src)).map(ex);
  console.log(
    '\ntransfer: accuracy on the TEST source of weights fitted on the TRAIN source (hand in brackets)'
  );
  for (const train of SOURCES) {
    const tr = bySource(train);
    const w = H.fitPairWeights(tr, live, H.pickLambda(tr, live));
    const cells = SOURCES.filter((t) => t !== train).map((test) => {
      const te = bySource(test);
      return `${test}: ${(100 * H.pairAccuracy(te, w)).toFixed(1)}% (${(100 * H.pairAccuracy(te, handW)).toFixed(1)}%)`;
    });
    console.log(`  train ${train.padEnd(15)} -> ${cells.join('   ')}`);
  }

  // One knob: the signature weight alone (every other term at the hand weight). The fit's
  // largest move; if it carries the gain, a single-term proposal is the smallest one to test.
  console.log(
    '\none knob: signature weight s, all other terms 1 (no fit; accuracy of the real deck winning)'
  );
  console.log('  s     ' + SOURCES.map((x) => x.padEnd(16)).join(''));
  for (const sw of [1, 1.5, 2, 3, 5]) {
    const w = { ...handW, signature: sw };
    console.log(
      `  ${String(sw).padEnd(6)}` +
        SOURCES.map((src) =>
          `${(100 * H.pairAccuracy(bySource(src), w)).toFixed(1)}%`.padEnd(16)
        ).join('')
    );
  }

  // Ablations on the pooled, independent-aware slice: accuracy under the hand weights with a term
  // removed, a term alone, and the held-out fit without the term.
  const pooled = rows.filter((r) => sample(r)).map(ex);
  console.log('\nablations on the pooled slice (hand weights = 1 on live terms)');
  console.log(
    'term'.padEnd(14) +
      'hand w/o term'.padStart(15) +
      'term alone'.padStart(12) +
      'fit w/o term (held-out)'.padStart(26)
  );
  const base = H.pairAccuracy(pooled, handW);
  console.log(`${'(all terms)'.padEnd(14)}${(100 * base).toFixed(1).padStart(14)}%`);
  for (const k of live) {
    const without = { ...handW, [k]: 0 };
    const alone = Object.fromEntries(KEYS.map((x) => [x, x === k ? 1 : 0]));
    const rest = live.filter((x) => x !== k);
    const rep = H.heldOut(pooled, rest);
    console.log(
      `${k.padEnd(14)}${(100 * H.pairAccuracy(pooled, without)).toFixed(1).padStart(14)}%${(100 * H.pairAccuracy(pooled, alone)).toFixed(1).padStart(11)}%${(100 * rep.fitted).toFixed(1).padStart(25)}%`
    );
  }
}

if (command === 'pairs') await runPairs();
else if (command === 'report') await runReport();
else {
  console.error('usage: deck-objective-fit.mjs pairs|report [options]');
  process.exit(2);
}
