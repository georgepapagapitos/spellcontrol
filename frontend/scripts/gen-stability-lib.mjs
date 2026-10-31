// Pure analysis for the generation stability harness (board E1061, gen-stability.mjs).
//
// Input: two panel dumps of one deck, a reference run and a perturbed run of the
// same code and data (deckGenerator.live.test.ts writes them; LIVE_GEN_PERTURB
// changes one input of the second). Output: how many cards moved, how many
// staples the perturbed run lost, and which late pass made each difference.

/** The late passes in the order generateDeck runs them (coherence/combo audit, budget, surplus, search). */
export const PASSES = [
  'coherenceRepairs',
  'budgetRepairs',
  'surplusConversions',
  'wholeDeckSearchSwaps',
];
export const SHORT = {
  coherenceRepairs: 'coherence',
  budgetRepairs: 'budget',
  surplusConversions: 'surplus',
  wholeDeckSearchSwaps: 'search',
};
/** A staple: played in at least this percent of the commander's decks (staple-loss.py's bar). */
export const STAPLE_BAR = 40;
/** deckObjective/judge.ts MIN_GAIN, for the near-margin read. */
export const MIN_GAIN = 0.3;

/** Card names of the final 99. */
export function finalNames(dump) {
  return new Set(Object.values(dump.decklist).flatMap((cards) => cards.map((c) => c.name)));
}

/** name -> play rate, from the final deck's own figures and the swap table. */
export function inclusionOf(dump) {
  const out = { ...(dump.swapInclusion ?? {}) };
  Object.assign(out, dump.swapInclusionBudget ?? {});
  for (const cards of Object.values(dump.decklist))
    for (const c of cards) if (c.edhrec_inclusion != null) out[c.name] = c.edhrec_inclusion;
  return out;
}

/** The late-pass swaps in run order: [{pass, cut, added}]. */
export function passRows(dump) {
  const report = dump.buildReport ?? {};
  return PASSES.flatMap((pass) =>
    (report[pass] ?? []).map((r) => ({ pass, cut: r.cut, added: r.added }))
  );
}

/**
 * The deck before any late pass: the final deck with every swap undone, last
 * first. Approximate (a card swapped in and out again nets to nothing, which
 * is right; a swap the report omits is invisible), but it is the same
 * approximation on both sides of a comparison.
 */
export function preLateNames(dump) {
  const names = finalNames(dump);
  for (const r of passRows(dump).reverse()) {
    if (r.added) names.delete(r.added);
    if (r.cut) names.add(r.cut);
  }
  return names;
}

/** staple-loss.py's definition: a late-pass cut played in STAPLE_BAR%+ that is not in the final deck and went to a less-played card. */
export function stapleLosses(dump, bar = STAPLE_BAR) {
  const final = finalNames(dump);
  const incl = inclusionOf(dump);
  const out = [];
  for (const r of passRows(dump)) {
    if (!r.cut || final.has(r.cut)) continue;
    const ci = incl[r.cut];
    if (ci == null || ci < bar) continue;
    const ai = incl[r.added];
    if (ai == null || ai < ci)
      out.push({ pass: r.pass, cut: r.cut, cutIncl: ci, added: r.added, addedIncl: ai ?? null });
  }
  return out;
}

/** The pass (or 'picking') behind a card being in one run and not the other. */
function whyDropped(name, run, runPre) {
  const cutBy = passRows(run).find((r) => r.cut === name);
  if (cutBy) return `${SHORT[cutBy.pass]} cut it`;
  if (!runPre.has(name)) return 'earlier';
  return 'unattributed';
}
function whyGained(name, ref, run, refPre) {
  const addedBy = passRows(run).find((r) => r.added === name);
  if (addedBy) return `${SHORT[addedBy.pass]} added it`;
  const refCut = passRows(ref).find((r) => r.cut === name);
  if (refCut) return `ref ${SHORT[refCut.pass]} cut it`;
  if (!refPre.has(name)) return 'earlier';
  return 'unattributed';
}

/**
 * Churn of `run` against `ref` for one deck.
 * `dropped` = in ref's final 99 and not in run's; `gained` = the reverse.
 */
export function deckChurn(ref, run, bar = STAPLE_BAR) {
  const rf = finalNames(ref);
  const nf = finalNames(run);
  const rPre = preLateNames(ref);
  const nPre = preLateNames(run);
  const incl = { ...inclusionOf(run), ...inclusionOf(ref) };
  const dropped = [...rf].filter((n) => !nf.has(n)).sort();
  const gained = [...nf].filter((n) => !rf.has(n)).sort();
  const row = (n, why) => ({ name: n, incl: incl[n] ?? null, why });
  const droppedRows = dropped.map((n) => row(n, whyDropped(n, run, nPre)));
  const gainedRows = gained.map((n) => row(n, whyGained(n, ref, run, rPre)));
  const staplesLost = droppedRows.filter((r) => r.incl != null && r.incl >= bar);
  const preLateChanged = [...rPre].filter((n) => !nPre.has(n)).length;
  const byWhy = {};
  for (const r of [...droppedRows, ...gainedRows]) byWhy[r.why] = (byWhy[r.why] ?? 0) + 1;
  return {
    changed: dropped.length,
    preLateChanged,
    staplesLost,
    dropped: droppedRows,
    gained: gainedRows,
    byWhy,
    search: searchDivergence(ref, run),
    refStapleLosses: stapleLosses(ref, bar).length,
    runStapleLosses: stapleLosses(run, bar).length,
  };
}

/** Whole-deck search swaps (kept and undone) within `band` of MIN_GAIN, from the dump's searchTrace. */
export function marginRead(dump, band = MIN_GAIN) {
  const t = dump.searchTrace;
  if (!t) return null;
  const kept = (t.swaps ?? []).filter((s) => s.kind === 'improve' || s.kind === 'combo');
  const near = kept.filter((s) => s.delta < MIN_GAIN + band);
  return {
    swaps: (t.swaps ?? []).length,
    nearMargin: near.length,
    undone: (t.undone ?? []).length,
    stoppedBy: t.stoppedBy,
    deltas: (t.swaps ?? []).map((s) => Math.round(s.delta * 100) / 100),
  };
}

/**
 * How the whole-deck search's swap lists compare: the swaps (out -> in) that
 * both made, those only one made, and the smallest gain among the swaps kept,
 * which says how close to MIN_GAIN the search was working.
 */
export function searchDivergence(ref, run) {
  const rs = ref.searchTrace?.swaps;
  const ns = run.searchTrace?.swaps;
  if (!rs || !ns) return null;
  const key = (s) => `${s.out.join('+')}>${s.in.join('+')}`;
  const rk = new Set(rs.map(key));
  const nk = new Set(ns.map(key));
  let first = 0;
  while (first < rs.length && first < ns.length && key(rs[first]) === key(ns[first])) first++;
  return {
    both: rs.filter((s) => nk.has(key(s))).length,
    refOnly: rs.filter((s) => !nk.has(key(s))).map(key),
    runOnly: ns.filter((s) => !rk.has(key(s))).map(key),
    firstDivergence: first,
    refStopped: ref.searchTrace.stoppedBy,
    runStopped: run.searchTrace.stoppedBy,
  };
}

/** One line per deck: the compact table the CLI prints. */
export function formatTable(rows, label) {
  const head = ['deck', 'changed', 'preLate', 'staples', 'by pass'];
  const lines = [`${label}`, head.join('\t')];
  for (const r of rows) {
    const why = Object.entries(r.byWhy)
      .map(([k, v]) => `${k} x${v}`)
      .join('; ');
    lines.push(
      [
        r.slug,
        r.changed,
        r.preLateChanged,
        r.staplesLost.map((s) => s.name).join(', ') || '-',
        why || '-',
      ].join('\t')
    );
  }
  return lines.join('\n');
}
