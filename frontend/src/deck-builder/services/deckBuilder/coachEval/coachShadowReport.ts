/**
 * The shadow comparison's numbers (E540 S4), from the per-deck records
 * coachShadow.ts writes. Pure: records in, tables out.
 *
 * Per deck, two lists on each surface the user meets:
 *  - legacy: the feed or the Cuts lane in today's order;
 *  - objective: the same rows in the order the whole-deck objective gives
 *    them (accepted by gain, then refused, then unscored in legacy order), and
 *    `objective-drop`, the same with the refused rows removed (what S5 would
 *    show if it filtered).
 * The labelled decks (the gates' critics and differs, E539) give precision@k
 * of the cut lists and recall@k of the feed against them; every deck gives the
 * refusal and disagreement numbers.
 */
import { objectiveOrder } from '@/lib/coach/coach-move-score';
import {
  bootstrapMean,
  bootstrapPairedDelta,
  formatInterval,
  precisionAtK,
  recallAtK,
  type Interval,
} from './coachMetrics';
import type { ShadowRecord, ShadowRow } from './coachShadow';

export type Variant = 'legacy' | 'objective' | 'objective-drop';
const VARIANTS: Variant[] = ['legacy', 'objective', 'objective-drop'];

const isRefused = (r: ShadowRow) => r.score.status === 'scored' && !r.score.accepted;

/** One surface's rows (callers pass a single surface) in an order: legacy position, the objective's, or the objective's without refused rows. */
export function orderedNames(rows: readonly ShadowRow[], variant: Variant): string[] {
  const legacy = [...rows].sort((a, b) => a.position - b.position);
  if (variant === 'legacy') return legacy.map((r) => r.name);
  const order = objectiveOrder(legacy.map((r) => r.score)).map((i) => legacy[i]);
  return (variant === 'objective' ? order : order.filter((r) => !isRefused(r))).map((r) => r.name);
}

const surfaceRows = (rec: ShadowRecord, surface: ShadowRow['surface']) =>
  rec.rows.filter((r) => r.surface === surface);

export function feedNames(rec: ShadowRecord, variant: Variant): string[] {
  return orderedNames(surfaceRows(rec, 'feed'), variant);
}
export function cutNames(rec: ShadowRecord, variant: Variant): string[] {
  return orderedNames(surfaceRows(rec, 'cuts'), variant);
}

const BASIC = /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest|Wastes)$/;

/** A refusal with the cards named in it and its numbers taken out, so like reasons count together. */
export function refusalBucket(row: ShadowRow): string {
  const s = row.score;
  if (s.status !== 'scored' || s.accepted) return 'accepted';
  let r = s.refusal ?? 'refused';
  // Coach's own land upgrades swap a basic out; the protection set holds basics as commander staples.
  if (s.move.out.some((n) => BASIC.test(n)) && /staple/.test(r))
    return 'a basic land held as a staple';
  for (const n of [row.name, row.inName, ...s.move.out, ...s.move.in])
    if (n) r = r.split(n).join('<card>');
  if (/^gains /.test(r)) return 'gain below the margin';
  if (/^rests on/.test(r)) return 'rests on a claim the cards do not bear out';
  return r.replace(/\d+(\.\d+)?/g, 'N');
}

export interface ShadowNumbers {
  decks: number;
  /** Decks the objective could not be built for, by reason. */
  noObjective: Record<string, number>;
  rows: { total: number; scored: number; unscored: number; accepted: number; refused: number };
  unscoredByReason: Record<string, number>;
  /** Of the rows a user sees in the top 10 of each surface. */
  shown: {
    rows: number;
    scored: number;
    refused: number;
    refusedShare: Interval;
    refusedByReason: Record<string, number>;
    refusedByLane: Record<string, { shown: number; refused: number }>;
  };
  cutPrecision: Record<Variant, { p5: Interval; p10: Interval }>;
  addRecall: Record<
    string,
    Record<Variant, { r5: Interval; r10: Interval }> & {
      delta: Record<Exclude<Variant, 'legacy'>, { r5: Interval; r10: Interval }>;
    }
  >;
  cutPrecisionDelta: Record<Exclude<Variant, 'legacy'>, { p5: Interval; p10: Interval }>;
  labelledDecks: number;
  scoreMs: Interval;
  /** Rows the objective puts in a surface's top 5 that legacy has past its top 10. */
  buried: Disagreement[];
  /** Legacy's top 5 the objective refuses, the largest negative gains first. */
  refusedTop: Disagreement[];
}

export interface Disagreement {
  group: string;
  deck: string;
  surface: string;
  lane: string;
  type: string;
  name: string;
  inName: string | null;
  legacyPosition: number;
  objectivePosition: number;
  delta: number | null;
  refusal: string | null;
  pairedWith: string | null;
  topTerms: [string, number][];
  inclusion: number | null;
}

const SHOWN = 10;

function disagreements(rec: ShadowRecord): { buried: Disagreement[]; refusedTop: Disagreement[] } {
  const buried: Disagreement[] = [];
  const refusedTop: Disagreement[] = [];
  for (const surface of ['feed', 'cuts'] as const) {
    const legacy = surfaceRows(rec, surface).sort((a, b) => a.position - b.position);
    const obj = objectiveOrder(legacy.map((r) => r.score)).map((i) => legacy[i]);
    const make = (r: ShadowRow, objectivePosition: number): Disagreement => {
      const s = r.score;
      return {
        group: rec.group,
        deck: rec.deck,
        surface,
        lane: r.lane,
        type: r.type,
        name: r.name,
        inName: r.inName,
        legacyPosition: r.position,
        objectivePosition,
        delta: s.status === 'scored' ? s.delta : null,
        refusal: s.status === 'scored' ? s.refusal : null,
        pairedWith:
          s.status === 'scored' && s.move.out.length + s.move.in.length > 0
            ? `${s.move.out.join(' + ') || '(open slot)'} -> ${s.move.in.join(' + ') || '(cut)'}`
            : null,
        topTerms: s.status === 'scored' ? s.topTerms : [],
        inclusion: r.inclusion,
      };
    };
    obj.slice(0, 5).forEach((r, i) => {
      if (r.score.status === 'scored' && r.score.accepted && r.position >= SHOWN)
        buried.push(make(r, i));
    });
    legacy.slice(0, 5).forEach((r) => {
      if (isRefused(r)) refusedTop.push(make(r, obj.indexOf(r)));
    });
  }
  return { buried, refusedTop };
}

/** The numbers for a set of shadow records. */
export function shadowNumbers(records: readonly ShadowRecord[]): ShadowNumbers {
  const ok = records.filter((r) => !r.error);
  const noObjective: Record<string, number> = {};
  for (const r of ok)
    if (r.objective !== 'ok') noObjective[r.objective] = (noObjective[r.objective] ?? 0) + 1;
  const all = ok.flatMap((r) => r.rows);
  const unscoredByReason: Record<string, number> = {};
  for (const r of all)
    if (r.score.status === 'unscored')
      unscoredByReason[r.score.reason] = (unscoredByReason[r.score.reason] ?? 0) + 1;
  const scoredRows = all.filter((r) => r.score.status === 'scored');
  const rows = {
    total: all.length,
    scored: scoredRows.length,
    unscored: all.length - scoredRows.length,
    accepted: scoredRows.filter((r) => !isRefused(r)).length,
    refused: scoredRows.filter(isRefused).length,
  };

  const shownRows = ok.flatMap((rec) =>
    (['feed', 'cuts'] as const).flatMap((s) =>
      surfaceRows(rec, s)
        .filter((r) => r.position < SHOWN)
        .map((r) => ({ rec, r }))
    )
  );
  const shownScored = shownRows.filter((x) => x.r.score.status === 'scored');
  const refusedByReason: Record<string, number> = {};
  const refusedByLane: Record<string, { shown: number; refused: number }> = {};
  for (const { r } of shownRows) {
    const lane = (refusedByLane[`${r.surface}:${r.lane}`] ??= { shown: 0, refused: 0 });
    lane.shown++;
    if (isRefused(r)) {
      lane.refused++;
      const b = refusalBucket(r);
      refusedByReason[b] = (refusedByReason[b] ?? 0) + 1;
    }
  }
  const perDeckRefusedShare = ok.map((rec) => {
    const s = shownRows.filter((x) => x.rec === rec && x.r.score.status === 'scored');
    return s.length === 0 ? null : s.filter((x) => isRefused(x.r)).length / s.length;
  });

  const labelled = ok.filter((r) => r.labels && r.objective === 'ok');
  const weak = (r: ShadowRecord) => r.labels?.weak ?? [];
  const withWeak = labelled.filter((r) => weak(r).length > 0);
  const cutPrecision = {} as ShadowNumbers['cutPrecision'];
  const cutVals = {} as Record<Variant, { p5: (number | null)[]; p10: (number | null)[] }>;
  for (const v of VARIANTS) {
    cutVals[v] = {
      p5: withWeak.map((r) => precisionAtK(cutNames(r, v), weak(r), 5)),
      p10: withWeak.map((r) => precisionAtK(cutNames(r, v), weak(r), 10)),
    };
    cutPrecision[v] = { p5: bootstrapMean(cutVals[v].p5), p10: bootstrapMean(cutVals[v].p10) };
  }
  const cutPrecisionDelta = {} as ShadowNumbers['cutPrecisionDelta'];
  for (const v of ['objective', 'objective-drop'] as const) {
    cutPrecisionDelta[v] = {
      p5: bootstrapPairedDelta(cutVals.legacy.p5, cutVals[v].p5),
      p10: bootstrapPairedDelta(cutVals.legacy.p10, cutVals[v].p10),
    };
  }

  const labelSets: Record<string, (r: ShadowRecord) => string[]> = {
    'named missing': (r) => r.labels?.missing ?? [],
    'lost premium': (r) => r.labels?.lostPremium ?? [],
    'missing + lost premium': (r) => [
      ...new Set([...(r.labels?.missing ?? []), ...(r.labels?.lostPremium ?? [])]),
    ],
  };
  const addRecall: ShadowNumbers['addRecall'] = {};
  for (const [name, labelsOf] of Object.entries(labelSets)) {
    const having = labelled.filter((r) => labelsOf(r).length > 0);
    const vals = {} as Record<Variant, { r5: (number | null)[]; r10: (number | null)[] }>;
    const entry = { delta: {} } as ShadowNumbers['addRecall'][string];
    for (const v of VARIANTS) {
      vals[v] = {
        r5: having.map((r) => recallAtK(feedNames(r, v), labelsOf(r), 5)),
        r10: having.map((r) => recallAtK(feedNames(r, v), labelsOf(r), 10)),
      };
      entry[v] = { r5: bootstrapMean(vals[v].r5), r10: bootstrapMean(vals[v].r10) };
    }
    for (const v of ['objective', 'objective-drop'] as const) {
      entry.delta[v] = {
        r5: bootstrapPairedDelta(vals.legacy.r5, vals[v].r5),
        r10: bootstrapPairedDelta(vals.legacy.r10, vals[v].r10),
      };
    }
    addRecall[name] = entry;
  }

  const found = ok.map(disagreements);
  const byGain = (a: Disagreement, b: Disagreement) => (b.delta ?? 0) - (a.delta ?? 0);
  return {
    decks: ok.length,
    noObjective,
    rows,
    unscoredByReason,
    shown: {
      rows: shownRows.length,
      scored: shownScored.length,
      refused: shownScored.filter((x) => isRefused(x.r)).length,
      refusedShare: bootstrapMean(perDeckRefusedShare),
      refusedByReason,
      refusedByLane,
    },
    cutPrecision,
    addRecall,
    cutPrecisionDelta,
    labelledDecks: labelled.length,
    scoreMs: bootstrapMean(ok.filter((r) => r.objective === 'ok').map((r) => r.scoreMs)),
    buried: found.flatMap((f) => f.buried).sort(byGain),
    refusedTop: found.flatMap((f) => f.refusedTop).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)),
  };
}

const kv = (o: Record<string, number>) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join('; ') || 'none';

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/** The comparison as markdown. */
export function shadowMarkdown(title: string, n: ShadowNumbers): string {
  const f = (iv: Interval) => formatInterval(iv);
  const parts: string[] = [`## ${title}`];
  parts.push(
    `${n.decks} decks. Objective could not be built for: ${kv(n.noObjective)}.\n\n` +
      `Rows: ${n.rows.total} total, ${n.rows.scored} scored (${n.rows.accepted} accepted, ${n.rows.refused} refused), ` +
      `${n.rows.unscored} unscored. Unscored by reason: ${kv(n.unscoredByReason)}.\n\n` +
      `Scoring time per deck (ms): ${f(n.scoreMs)}.`
  );
  const share =
    n.shown.scored === 0 ? 'n/a' : `${((100 * n.shown.refused) / n.shown.scored).toFixed(1)}%`;
  parts.push(
    `### Refusals among the rows a user sees (top ${SHOWN} of the feed and of the Cuts lane)\n\n` +
      `${n.shown.rows} shown, ${n.shown.scored} scored, ${n.shown.refused} refused (${share} of scored; per-deck ${f(n.shown.refusedShare)}).\n\n` +
      `By reason: ${kv(n.shown.refusedByReason)}.\n\n` +
      table(
        ['Surface:lane', 'Shown', 'Refused'],
        Object.entries(n.shown.refusedByLane)
          .sort((a, b) => b[1].shown - a[1].shown)
          .map(([k, v]) => [k, String(v.shown), String(v.refused)])
      )
  );
  parts.push(
    `### Cut precision against critic-named weak cards (${n.labelledDecks} labelled decks)\n\n` +
      table(
        ['Cuts lane order', 'P@5', 'P@10'],
        VARIANTS.map((v) => [v, f(n.cutPrecision[v].p5), f(n.cutPrecision[v].p10)])
      ) +
      '\n\nPaired delta (variant minus legacy):\n\n' +
      table(
        ['Variant', 'P@5', 'P@10'],
        (['objective', 'objective-drop'] as const).map((v) => [
          v,
          f(n.cutPrecisionDelta[v].p5),
          f(n.cutPrecisionDelta[v].p10),
        ])
      )
  );
  parts.push(
    '### Add recall in the feed\n\n' +
      table(
        ['Labels', 'Order', 'R@5', 'R@10', 'R@5 minus legacy', 'R@10 minus legacy'],
        Object.entries(n.addRecall).flatMap(([k, e]) =>
          VARIANTS.map((v) => [
            k,
            v,
            f(e[v].r5),
            f(e[v].r10),
            v === 'legacy' ? '' : f(e.delta[v].r5),
            v === 'legacy' ? '' : f(e.delta[v].r10),
          ])
        )
      )
  );
  const dis = (d: Disagreement) =>
    `${d.group}/${d.deck}: ${d.surface} ${d.type} ${d.name}${d.inName ? ` (for ${d.inName})` : ''}, ` +
    `legacy #${d.legacyPosition + 1}, objective #${d.objectivePosition + 1}, gain ${d.delta?.toFixed(2) ?? 'n/a'}` +
    `${d.refusal ? `, refused: ${d.refusal}` : ''}${d.pairedWith ? `, judged as ${d.pairedWith}` : ''}`;
  parts.push(
    `### Rows the objective ranks in its top 5 that legacy buries past ${SHOWN} (${n.buried.length}; largest gains)\n\n` +
      n.buried
        .slice(0, 15)
        .map((d) => `- ${dis(d)}`)
        .join('\n')
  );
  parts.push(
    `### Legacy's top 5 that the objective refuses (${n.refusedTop.length}; most negative first)\n\n` +
      n.refusedTop
        .slice(0, 15)
        .map((d) => `- ${dis(d)}`)
        .join('\n')
  );
  return parts.join('\n\n');
}
