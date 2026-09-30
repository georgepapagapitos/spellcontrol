/**
 * The calibration report: every number the benchmark gates on, as text. Printed
 * by `npm run calibrate` (CALIBRATION_REPORT=1), never by a plain test run.
 */
import { floorOf, type BracketEstimation } from '../index';
import {
  agreement,
  disagreementCause,
  type Agreement,
  type Bench,
  type CorpusDeck,
  type Interval,
} from './benchmark';

export interface Row {
  deck: CorpusDeck;
  est: BracketEstimation;
}

export function runCorpus(bench: Bench, decks: readonly CorpusDeck[]): Row[] {
  return decks.map((deck) => ({ deck, est: bench.estimate(bench.state(deck)) }));
}

export interface SetReport {
  set: string;
  agreement: Agreement;
  buckets: Record<string, string[]>;
}

export function reportSet(set: string, rows: readonly Row[]): SetReport {
  const mine = rows.filter((r) => r.deck.set === set);
  const buckets: Record<string, string[]> = {};
  for (const { deck, est } of mine) {
    if (est.bracket === deck.label) continue;
    const cause = disagreementCause(deck, est, deck.label);
    (buckets[cause] ??= []).push(`${deck.name}: ${est.bracket} vs ${deck.label}`);
  }
  return {
    set,
    agreement: agreement(mine.map((r) => ({ label: r.deck.label, predicted: r.est.bracket }))),
    buckets,
  };
}

/** Ours against ScrollVault's precon brackets, with every disagreement bucketed. */
export function reportScrollVault(rows: readonly Row[]): SetReport {
  const mine = rows.filter((r) => r.deck.scrollvault);
  const buckets: Record<string, string[]> = {};
  for (const { deck, est } of mine) {
    const sv = deck.scrollvault!.bracket;
    if (est.bracket === sv) continue;
    const cause = disagreementCause(deck, est, sv, 'scrollvault');
    (buckets[cause] ??= []).push(
      `${deck.name}: ours ${est.bracket}, ScrollVault ${sv}, label ${deck.label} (${deck.scrollvault!.url})`
    );
  }
  return {
    set: 'scrollvault',
    agreement: agreement(
      mine.map((r) => ({ label: r.deck.scrollvault!.bracket, predicted: r.est.bracket }))
    ),
    buckets,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (i: Interval) => `[${pct(i.low)}, ${pct(i.high)}]`;

export function formatSet(r: SetReport): string {
  const a = r.agreement;
  const lines = [
    `## ${r.set}: ${a.exact}/${a.n} exact (${pct(a.exact / a.n)}, bootstrap ${ci(a.exactBootstrap)}), ${a.withinOne}/${a.n} within one`,
    '',
    '| label | n | exact | rate | bootstrap 95% | Wilson 95% |',
    '|---|---|---|---|---|---|',
    ...a.perLabel.map(
      (c) =>
        `| B${c.label} | ${c.n} | ${c.exact} | ${pct(c.rate)} | ${ci(c.bootstrap)} | ${ci(c.wilson)} |`
    ),
    '',
    'Confusion (rows: label, columns: estimate)',
    '',
    '| | B1 | B2 | B3 | B4 | B5 |',
    '|---|---|---|---|---|---|',
    ...Object.entries(a.confusion).map(
      ([label, row]) => `| B${label} | ${[1, 2, 3, 4, 5].map((p) => row[p] ?? 0).join(' | ')} |`
    ),
  ];
  const causes = Object.entries(r.buckets).sort((x, y) => y[1].length - x[1].length);
  if (causes.length) {
    lines.push('', 'Disagreements by cause');
    for (const [cause, decks] of causes) {
      lines.push('', `- ${cause} (${decks.length})`, ...decks.map((d) => `  - ${d}`));
    }
  }
  return lines.join('\n');
}

/** Where every precon's estimate comes from, for the soft-score headroom check. */
export function softHeadroom(rows: readonly Row[], set: string): { max: number; deck: string } {
  let max = -1;
  let deck = '';
  for (const r of rows) {
    if (r.deck.set !== set || r.est.bracket > floorOf(r.est.hardFloors)) continue;
    if (r.est.softScore > max) [max, deck] = [r.est.softScore, r.deck.name];
  }
  return { max, deck };
}
