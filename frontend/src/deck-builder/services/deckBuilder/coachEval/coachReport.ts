/**
 * The Coach evaluation's numbers (E538, E539), from the per-deck records the
 * live harness writes. Pure: records in, tables out.
 *
 * A record's lists are names in the order the user meets them. Cut lists
 * are scored with precision@k against the critics' weak cards; add lists with
 * recall@k against the cards the critics named as missing and the premium
 * cards the differs saw lost. "Reachable" recall only counts labels some Coach
 * surface named anywhere, which separates ranking from coverage.
 */
import {
  bootstrapMean,
  bootstrapPairedDelta,
  formatInterval,
  nameKey,
  precisionAtK,
  recallAtK,
  type Interval,
} from './coachMetrics';
import type { Violation } from './applyCoachMoves';

/** Every ranked list one Coach pass produced for a deck. */
export interface SurfaceLists {
  /** The "Cuts" chip in rank order. */
  cutsLane: string[];
  /** Cut rows by their source engine (optimize reason category, misfit, bracket-fit). */
  cutsBySurface: Record<string, string[]>;
  /** Outgoing cards of the feed's swap rows, feed order. */
  swapOuts: string[];
  /** The replace-when-full prompt's first cut for each of the top feed adds. */
  replaceCuts: string[];
  /** Cards cut when the top moves were applied. */
  appliedCuts: string[];
  /** Incoming cards in the order the user meets them (hero, then feed). */
  feedAdds: string[];
  /** Incoming cards per surface, each in its own order. */
  addsBySurface: Record<string, string[]>;
  /** Every incoming card any surface named, untruncated. */
  universeAdds: string[];
}

export interface AuditedMove {
  surface: string;
  type: string;
  name: string;
  cut?: string;
  violations: Violation[];
  /** The cut is a staple: ≥40% on the commander page, a Game Changer, or a watchlist premium. */
  cutsStaple?: boolean;
  /** The incoming card isn't on the commander page and fits no invested engine axis. */
  offPlan?: boolean;
}

export interface BenchRecord {
  gate: string;
  deck: string;
  deckSize: number;
  labels: { weak: string[]; missing: string[]; lostPremium: string[]; replacedBy: string[] };
  post: SurfaceLists;
  /** The same deck with E510's ordering subtracted (synergy as EDHREC's subtraction). */
  pre?: SurfaceLists;
  audit: AuditedMove[];
  /** The Next-best-move "Reinforce the plan" card, post and pre E510. */
  nbmStrategy?: { post: string | null; pre: string | null };
}

export interface AdviseRecord {
  panel: string;
  deck: string;
  applied: { surface: string; type: string; added?: string; cut?: string; cutSource?: string }[];
  skipped: { surface: string; violations: Violation[] }[];
  /** Feed rows by tier on the generator's own output, and the hero's rows. */
  tiers: { t1: number; t2: number; t3: number; cuts: number; nbmCardMoves: number };
  highConfidence: number;
  /** Applied moves the second Coach pass proposes to undo. */
  reversed: { move: string; how: string }[];
  audit: AuditedMove[];
  priceBefore: number;
  priceAfter: number;
  /** Applied cuts that were staples (≥40% on the page, a Game Changer, a watchlist premium). */
  appliedStapleCuts: string[];
  /** Cards one applied move added and a later one in the same session cut again. */
  selfReversed: string[];
  bracketBefore: number | null;
  bracketAfter: number | null;
  error?: string;
}

type Row = { label: string; cells: string[] };

/** A reversal the user only meets through the replace-when-full prompt. */
export const IMPLICIT_REVERSAL = 'second pass cuts it to make room';

function table(head: string[], rows: Row[]): string {
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows) lines.push(`| ${r.label} | ${r.cells.join(' | ')} |`);
  return lines.join('\n');
}

const union = (...lists: string[][]) => [...new Set(lists.flat())];

function perDeck<T>(records: readonly BenchRecord[], f: (r: BenchRecord) => T): T[] {
  return records.map(f);
}

export interface BenchNumbers {
  cutPrecision: Record<string, { p5: Interval; p10: Interval }>;
  randomCutPrecision: Interval;
  addRecall: Record<
    string,
    { r5: Interval; r10: Interval; r5Reachable: Interval; coverage: Interval }
  >;
  surfaceAdds: Record<string, { r10: Interval; p10: Interval; decks: number }>;
  surfaceCuts: Record<string, { p5: Interval; p10: Interval }>;
  e510: Record<string, { post: Interval; pre: Interval; delta: Interval }>;
  e510Changed: { hiddenGems: number; nbmStrategy: number; decks: number };
  errors: Record<string, number>;
  audited: number;
}

/** The benchmark tables' numbers (E539). */
export function benchNumbers(records: readonly BenchRecord[]): BenchNumbers {
  const weak = (r: BenchRecord) => r.labels.weak;
  const cutLists: Record<string, (r: BenchRecord) => string[]> = {
    'Cuts lane': (r) => r.post.cutsLane,
    'Swap rows (outgoing)': (r) => r.post.swapOuts,
    'Replace-when-full first cut': (r) => r.post.replaceCuts,
    'Cuts made applying top 5': (r) => r.post.appliedCuts,
  };
  const cutPrecision: BenchNumbers['cutPrecision'] = {};
  for (const [name, list] of Object.entries(cutLists)) {
    const withLabels = records.filter((r) => weak(r).length > 0);
    cutPrecision[name] = {
      p5: bootstrapMean(perDeck(withLabels, (r) => precisionAtK(list(r), weak(r), 5))),
      p10: bootstrapMean(perDeck(withLabels, (r) => precisionAtK(list(r), weak(r), 10))),
    };
  }
  const randomCutPrecision = bootstrapMean(
    records.filter((r) => weak(r).length > 0).map((r) => weak(r).length / r.deckSize)
  );

  const labelSets: Record<string, (r: BenchRecord) => string[]> = {
    'named missing': (r) => r.labels.missing,
    'lost premium': (r) => r.labels.lostPremium,
    'missing + lost premium': (r) => union(r.labels.missing, r.labels.lostPremium),
  };
  const addRecall: BenchNumbers['addRecall'] = {};
  for (const [name, labels] of Object.entries(labelSets)) {
    const withLabels = records.filter((r) => labels(r).length > 0);
    const reachable = (r: BenchRecord) => {
      const u = new Set(r.post.universeAdds.map(nameKey));
      return labels(r).filter((n) => u.has(nameKey(n)));
    };
    addRecall[name] = {
      r5: bootstrapMean(perDeck(withLabels, (r) => recallAtK(r.post.feedAdds, labels(r), 5))),
      r10: bootstrapMean(perDeck(withLabels, (r) => recallAtK(r.post.feedAdds, labels(r), 10))),
      r5Reachable: bootstrapMean(
        perDeck(withLabels, (r) => recallAtK(r.post.feedAdds, reachable(r), 5))
      ),
      coverage: bootstrapMean(perDeck(withLabels, (r) => reachable(r).length / labels(r).length)),
    };
  }

  const allLabels = (r: BenchRecord) => union(r.labels.missing, r.labels.lostPremium);
  const surfaces = new Set(records.flatMap((r) => Object.keys(r.post.addsBySurface)));
  const surfaceAdds: BenchNumbers['surfaceAdds'] = {};
  for (const s of [...surfaces].sort()) {
    const having = records.filter(
      (r) => (r.post.addsBySurface[s]?.length ?? 0) > 0 && allLabels(r).length > 0
    );
    surfaceAdds[s] = {
      r10: bootstrapMean(having.map((r) => recallAtK(r.post.addsBySurface[s], allLabels(r), 10))),
      p10: bootstrapMean(
        having.map((r) => precisionAtK(r.post.addsBySurface[s], allLabels(r), 10))
      ),
      decks: having.length,
    };
  }
  const cutSurfaces = new Set(records.flatMap((r) => Object.keys(r.post.cutsBySurface)));
  const surfaceCuts: BenchNumbers['surfaceCuts'] = {};
  for (const s of [...cutSurfaces].sort()) {
    const having = records.filter(
      (r) => (r.post.cutsBySurface[s]?.length ?? 0) > 0 && weak(r).length > 0
    );
    surfaceCuts[s] = {
      p5: bootstrapMean(having.map((r) => precisionAtK(r.post.cutsBySurface[s], weak(r), 5))),
      p10: bootstrapMean(having.map((r) => precisionAtK(r.post.cutsBySurface[s], weak(r), 10))),
    };
  }

  // E510 retro: the same metric on the same decks, E510's ordering vs the
  // subtraction it replaced.
  const paired = records.filter((r) => r.pre && allLabels(r).length > 0);
  const e510Metric = (
    f: (lists: SurfaceLists, labels: string[]) => number | null
  ): { post: Interval; pre: Interval; delta: Interval } => {
    const post = paired.map((r) => f(r.post, allLabels(r)));
    const pre = paired.map((r) => f(r.pre!, allLabels(r)));
    return {
      post: bootstrapMean(post),
      pre: bootstrapMean(pre),
      delta: bootstrapPairedDelta(pre, post),
    };
  };
  const gems = (l: SurfaceLists) => l.addsBySurface['hidden-gems'] ?? [];
  const e510 = {
    'Hidden gems R@5': e510Metric((l, lab) => recallAtK(gems(l), lab, 5)),
    'Hidden gems R@10': e510Metric((l, lab) => recallAtK(gems(l), lab, 10)),
    'Hidden gems P@10': e510Metric((l, lab) => precisionAtK(gems(l), lab, 10)),
    'Coach feed R@10': e510Metric((l, lab) => recallAtK(l.feedAdds, lab, 10)),
    'Next best move names a labelled card': e510Metric((l, lab) => {
      const named = l.addsBySurface['nbm'] ?? [];
      if (named.length === 0) return null;
      const want = new Set(lab.map(nameKey));
      return named.some((n) => want.has(nameKey(n))) ? 1 : 0;
    }),
  };
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x, i) => nameKey(x) === nameKey(b[i]));
  const e510Changed = {
    hiddenGems: records.filter((r) => r.pre && !same(gems(r.post), gems(r.pre))).length,
    nbmStrategy: records.filter(
      (r) => r.nbmStrategy && (r.nbmStrategy.post ?? '') !== (r.nbmStrategy.pre ?? '')
    ).length,
    decks: records.filter((r) => r.pre).length,
  };

  const errors: Record<string, number> = {};
  let audited = 0;
  for (const r of records) {
    for (const m of r.audit) {
      audited++;
      for (const v of m.violations) errors[v] = (errors[v] ?? 0) + 1;
      if (m.cutsStaple) errors['cuts-staple'] = (errors['cuts-staple'] ?? 0) + 1;
      if (m.offPlan) errors['off-plan'] = (errors['off-plan'] ?? 0) + 1;
    }
  }
  return {
    cutPrecision,
    randomCutPrecision,
    addRecall,
    surfaceAdds,
    surfaceCuts,
    e510,
    e510Changed,
    errors,
    audited,
  };
}

/** The benchmark as markdown tables. */
export function benchMarkdown(n: BenchNumbers): string {
  const f = (iv: Interval) => formatInterval(iv);
  const parts: string[] = [];
  parts.push(
    '### Cut precision against critic-named weak cards\n\n' +
      table(
        ['List', 'P@5', 'P@10'],
        Object.entries(n.cutPrecision).map(([k, v]) => ({ label: k, cells: [f(v.p5), f(v.p10)] }))
      ) +
      `\n\nRandom-cut baseline (weak cards / deck size): ${f(n.randomCutPrecision)}`
  );
  parts.push(
    '### Add recall (hero then feed, the order a user meets them)\n\n' +
      table(
        ['Labels', 'R@5', 'R@10', 'R@5 reachable', 'Coverage (any surface)'],
        Object.entries(n.addRecall).map(([k, v]) => ({
          label: k,
          cells: [f(v.r5), f(v.r10), f(v.r5Reachable), f(v.coverage)],
        }))
      )
  );
  parts.push(
    '### Per surface, adds (labels: missing + lost premium)\n\n' +
      table(
        ['Surface', 'R@10', 'P@10', 'Decks'],
        Object.entries(n.surfaceAdds).map(([k, v]) => ({
          label: k,
          cells: [f(v.r10), f(v.p10), String(v.decks)],
        }))
      )
  );
  parts.push(
    '### Per surface, cuts (labels: weak)\n\n' +
      table(
        ['Surface', 'P@5', 'P@10'],
        Object.entries(n.surfaceCuts).map(([k, v]) => ({ label: k, cells: [f(v.p5), f(v.p10)] }))
      )
  );
  parts.push(
    '### E510 retro (post = shipped ratio ordering, pre = subtraction)\n\n' +
      table(
        ['Metric', 'Post', 'Pre', 'Post − pre (paired)'],
        Object.entries(n.e510).map(([k, v]) => ({
          label: k,
          cells: [f(v.post), f(v.pre), f(v.delta)],
        }))
      ) +
      `\n\nDecks whose hidden gems changed: ${n.e510Changed.hiddenGems}/${n.e510Changed.decks}; ` +
      `whose Next-best-move strategy card changed: ${n.e510Changed.nbmStrategy}/${n.e510Changed.decks}.`
  );
  parts.push(
    `### Error buckets over ${n.audited} audited moves (top 10 per deck, as shown)\n\n` +
      table(
        ['Bucket', 'Moves'],
        Object.entries(n.errors)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => ({ label: k, cells: [String(v)] }))
      )
  );
  return parts.join('\n\n');
}

export interface AdviseNumbers {
  decks: number;
  failed: number;
  applied: number;
  appliedBySurface: Record<string, number>;
  skippedByViolation: Record<string, number>;
  highConfidencePerDeck: Interval;
  tier1PerDeck: Interval;
  tier2PerDeck: Interval;
  reversalRate: Interval;
  /** Only the second pass's own claims: a cut row, a swap out, or an add back. */
  explicitReversalRate: Interval;
  decksWithReversal: number;
  appliedStapleCuts: number;
  selfReversed: number;
  priceDelta: Interval;
  bracketUp: number;
  errors: Record<string, number>;
  audited: number;
}

/** Self-consistency, ping-pong and application numbers for one panel (E538). */
export function adviseNumbers(records: readonly AdviseRecord[]): AdviseNumbers {
  const ok = records.filter((r) => !r.error);
  const appliedBySurface: Record<string, number> = {};
  const skippedByViolation: Record<string, number> = {};
  const errors: Record<string, number> = {};
  let audited = 0;
  for (const r of ok) {
    for (const a of r.applied) appliedBySurface[a.surface] = (appliedBySurface[a.surface] ?? 0) + 1;
    for (const s of r.skipped)
      for (const v of s.violations) skippedByViolation[v] = (skippedByViolation[v] ?? 0) + 1;
    for (const m of r.audit) {
      audited++;
      for (const v of m.violations) errors[v] = (errors[v] ?? 0) + 1;
      if (m.cutsStaple) errors['cuts-staple'] = (errors['cuts-staple'] ?? 0) + 1;
      if (m.offPlan) errors['off-plan'] = (errors['off-plan'] ?? 0) + 1;
    }
  }
  return {
    decks: records.length,
    failed: records.length - ok.length,
    applied: ok.reduce((s, r) => s + r.applied.length, 0),
    appliedBySurface,
    skippedByViolation,
    highConfidencePerDeck: bootstrapMean(ok.map((r) => r.highConfidence)),
    tier1PerDeck: bootstrapMean(ok.map((r) => r.tiers.t1)),
    tier2PerDeck: bootstrapMean(ok.map((r) => r.tiers.t2)),
    reversalRate: bootstrapMean(
      ok.map((r) => (r.applied.length === 0 ? null : r.reversed.length / r.applied.length))
    ),
    explicitReversalRate: bootstrapMean(
      ok.map((r) =>
        r.applied.length === 0
          ? null
          : r.reversed.filter((x) => x.how !== IMPLICIT_REVERSAL).length / r.applied.length
      )
    ),
    decksWithReversal: ok.filter((r) => r.reversed.length > 0).length,
    appliedStapleCuts: ok.reduce((s, r) => s + r.appliedStapleCuts.length, 0),
    selfReversed: ok.reduce((s, r) => s + r.selfReversed.length, 0),
    priceDelta: bootstrapMean(ok.map((r) => r.priceAfter - r.priceBefore)),
    bracketUp: ok.filter(
      (r) => r.bracketBefore != null && r.bracketAfter != null && r.bracketAfter > r.bracketBefore
    ).length,
    errors,
    audited,
  };
}

export function adviseMarkdown(panel: string, n: AdviseNumbers): string {
  const f = (iv: Interval) => formatInterval(iv);
  const kv = (o: Record<string, number>) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ') || 'none';
  return [
    `### ${panel}: ${n.decks} decks (${n.failed} failed)`,
    `- Applied ${n.applied} moves. By surface: ${kv(n.appliedBySurface)}.`,
    `- Skipped for breaking the deck's settings: ${kv(n.skippedByViolation)}.`,
    `- High-confidence (tier 1–2) moves on the generator's own output, per deck: ${f(n.highConfidencePerDeck)} (tier 1 ${f(n.tier1PerDeck)}, tier 2 ${f(n.tier2PerDeck)}).`,
    `- Ping-pong, share of applied moves the second Coach pass undoes: ${f(n.reversalRate)} (by its own cut, swap or add-back rows alone: ${f(n.explicitReversalRate)}); decks with any reversal: ${n.decksWithReversal}.`,
    `- Staples cut while applying: ${n.appliedStapleCuts}. Cards added then cut again by a later move in the same session: ${n.selfReversed}.`,
    `- Price change per deck (USD): ${f(n.priceDelta)}. Decks whose estimated bracket rose: ${n.bracketUp}.`,
    `- Error buckets over ${n.audited} audited moves (top 10 as shown): ${kv(n.errors)}.`,
  ].join('\n');
}
