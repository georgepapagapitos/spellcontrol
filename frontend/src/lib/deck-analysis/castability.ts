import type { ScryfallCard } from '@/deck-builder/types';
import {
  evaluateManabase,
  MANA_SYMBOLS,
  type CardCastability,
  type ManaSymbol,
} from '@/lib/mana-sim';

/**
 * "Can I cast my spells?" per card, for the Color panel: which spells miss
 * Frank Karsten's bar for having their colors on curve, and which color is
 * to blame.
 *
 * The rate is the simulator's `onCurveGivenMana`: of the games with enough
 * mana on the card's turn, the share that also had the right colors. Not
 * having six lands on turn six is a land-count question, not a color one, so
 * it stays out.
 *
 * A card is listed as under the bar only when the whole 95% interval sits
 * under it. A six-drop is measured only in the games that reached six mana,
 * a few hundred of them, so its point estimate moves a point or two between
 * runs. Measured on a real 100-card list at 500 / 1,000 / 2,000 / 4,000
 * games, the raw "under the bar" count read 13 / 1 / 2 / 5. A list built on
 * point estimates would reshuffle on every edit. Cards under on the point
 * estimate but inside the noise are "at the bar" instead.
 */

export const CASTABILITY_GAMES = 4000;

/** Two-sided 95%. */
const Z = 1.96;

export interface CastabilityRow {
  name: string;
  cost: string;
  mv: number;
  /** P(the colors are there on curve | the mana is there), 0–1. */
  rate: number;
  /** Karsten's bar for this mana value, 0–1. */
  bar: number;
  /** The mana type short most often, with its share of the measured games. */
  short: { symbol: ManaSymbol; share: number } | null;
  commander: boolean;
}

export interface CastabilityReport {
  games: number;
  /** Spells measured, commanders included. */
  measured: number;
  /** The deck's average rate, each copy weighing one. Null when nothing was measured. */
  average: number | null;
  /** Clearly under the bar, largest gap first. */
  under: CastabilityRow[];
  /** Under on the point estimate, within the noise. */
  atBar: CastabilityRow[];
  /** The mana type behind most of `under`; null when nothing is under. */
  tightSymbol: ManaSymbol | null;
}

/** Upper end of the Wilson score interval for `p` measured over `n` trials. */
export function wilsonUpper(p: number, n: number, z = Z): number {
  if (n <= 0) return 1;
  const z2 = z * z;
  const center = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, (center + spread) / (1 + z2 / n));
}

/**
 * Games behind a card's `onCurveGivenMana`, recovered from the rates the
 * engine reports: onCurve = hits ÷ games and onCurveGivenMana = hits ÷ n.
 * The engine's Karsten test reads its standard error the same way.
 */
function samplesOf(row: CardCastability, games: number): number {
  const given = row.onCurveGivenMana ?? 0;
  if (given <= 0) return games;
  return (games * (row.onCurve ?? 0)) / given;
}

function toRow(row: CardCastability, commander: boolean): CastabilityRow {
  let short: CastabilityRow['short'] = null;
  for (const symbol of MANA_SYMBOLS) {
    const share = row.shortBy[symbol] ?? 0;
    if (share > 0 && (!short || share > short.share)) short = { symbol, share };
  }
  return {
    name: row.name,
    cost: row.cost,
    mv: row.mv,
    rate: row.onCurveGivenMana ?? 0,
    bar: row.karstenBar,
    short,
    commander,
  };
}

const pct = (x: number): number => Math.round(x * 100);

/**
 * Commander text that changes what spells cost: blitz (Henzie, "its mana cost
 * minus {2}"), a flat reduction, "less to cast". The simulator pays printed
 * costs, so the panel names the commander in its scope line.
 */
const COST_CHANGE = /\bblitz\b|\bcosts? \{[^}]+\} less\b|\bless to cast\b/i;

/** The first commander whose text changes spell costs, by name; null when none does. */
export function costChangingCommander(commanders: readonly ScryfallCard[]): string | null {
  for (const c of commanders) {
    const text = c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '';
    if (COST_CHANGE.test(text)) return c.name;
  }
  return null;
}

/**
 * Simulate the deck and sort its spells against the bar. `library` holds one
 * entry per copy, commanders excluded.
 */
export function analyzeCastability(
  commanders: readonly ScryfallCard[],
  library: readonly ScryfallCard[],
  games = CASTABILITY_GAMES
): CastabilityReport {
  const result = evaluateManabase({ commanders, library }, { games });
  const measuredRows = [
    ...result.commanders.map((r) => ({ r, commander: true })),
    ...result.cards.map((r) => ({ r, commander: false })),
  ].filter(({ r }) => r.onCurveGivenMana !== null);

  const under: CastabilityRow[] = [];
  const atBar: CastabilityRow[] = [];
  for (const { r, commander } of measuredRows) {
    const rate = r.onCurveGivenMana ?? 0;
    if (rate >= r.karstenBar) continue;
    const row = toRow(r, commander);
    // Rounded equal reads as "95% · needs 95%": a failure that looks like a
    // bug. And a shortfall inside the interval may not be there at all.
    const clear =
      pct(rate) < pct(r.karstenBar) && wilsonUpper(rate, samplesOf(r, result.games)) < r.karstenBar;
    (clear ? under : atBar).push(row);
  }
  under.sort((a, b) => b.bar - b.rate - (a.bar - a.rate) || a.name.localeCompare(b.name));
  atBar.sort((a, b) => a.name.localeCompare(b.name));

  // The type behind the shortfall: each listed card's short shares, summed.
  const blame = new Map<ManaSymbol, number>();
  for (const row of under) {
    if (row.short)
      blame.set(row.short.symbol, (blame.get(row.short.symbol) ?? 0) + row.short.share);
  }
  let tightSymbol: ManaSymbol | null = null;
  for (const [symbol, weight] of blame) {
    if (!tightSymbol || weight > (blame.get(tightSymbol) ?? 0)) tightSymbol = symbol;
  }

  return {
    games: result.games,
    measured: measuredRows.length,
    average: result.castability.onCurveGivenMana,
    under,
    atBar,
    tightSymbol,
  };
}
