/**
 * The castability half of a finished run: per-card and deck-level rates from
 * the counts the game loop kept. Split out of `./engine.ts` to keep that file
 * under the size ratchet.
 */

import { karstenBar, type CostStat } from './engine-helpers';
import {
  MANA_SYMBOLS,
  type CardCastability,
  type ManaCard,
  type ManaCost,
  type ManaSimResult,
  type ManaSymbol,
} from './types';

interface Inputs {
  costStats: readonly CostStat[];
  cards: readonly ManaCard[];
  /** Copies in the library, by card id. */
  copies: ReadonlyMap<number, number>;
  /** Cost id by card id (-1 for a card with no cost to measure). */
  cardCost: readonly number[];
  commanders: readonly ManaCard[];
  commanderCost: readonly number[];
  probes: readonly ManaCost[];
  probeCost: readonly number[];
  games: number;
  maxTurn: number;
}

export function castabilityOf(inp: Inputs): {
  rows: CardCastability[];
  probes: CardCastability[];
  commanderRows: CardCastability[];
  castability: ManaSimResult['castability'];
} {
  const { costStats, cards, copies, cardCost, commanders, commanderCost, games, maxTurn } = inp;
  const rateOf = (n: number, d: number): number | null => (d > 0 ? n / d : null);

  const castRow = (name: string, cost: ManaCost, sid: number, n: number): CardCastability => {
    const s = costStats[sid];
    const measuredOn = s.onTurn <= maxTurn;
    const measuredNext = s.onTurn + 1 <= maxTurn;
    const shortBy: Partial<Record<ManaSymbol, number>> = {};
    for (let b = 0; b < 6; b++) {
      if (s.short[b] > 0) shortBy[MANA_SYMBOLS[b]] = s.short[b] / s.onEnough;
    }
    return {
      name,
      mv: cost.mv,
      cost: cost.text,
      copies: n,
      karstenBar: karstenBar(cost.mv),
      onCurve: measuredOn ? s.on / games : null,
      onCurveGivenMana: measuredOn ? rateOf(s.on, s.onEnough) : null,
      nextTurn: measuredNext ? s.next / games : null,
      nextTurnGivenMana: measuredNext ? rateOf(s.next, s.nextEnough) : null,
      shortBy,
    };
  };

  const rows: CardCastability[] = [];
  for (const [id, n] of copies) {
    if (cardCost[id] >= 0)
      rows.push(castRow(cards[id].name, cards[id].cost as ManaCost, cardCost[id], n));
  }
  rows.sort(
    (a, b) => (a.onCurve ?? 2) - (b.onCurve ?? 2) || a.mv - b.mv || a.name.localeCompare(b.name)
  );

  const mean = (pick: (r: CardCastability) => number | null): number | null => {
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const v = pick(r);
      if (v === null) continue;
      sum += v * r.copies;
      n += r.copies;
    }
    return n > 0 ? sum / n : null;
  };
  let measured = 0;
  let below = 0;
  for (const r of rows) {
    if (r.onCurve === null) continue;
    measured += r.copies;
    if (r.onCurveGivenMana !== null && r.onCurveGivenMana < r.karstenBar) below += r.copies;
  }

  const probes = inp.probes.map((cost, i) => castRow(cost.text, cost, inp.probeCost[i], 0));

  return {
    rows,
    probes,
    commanderRows: commanders.flatMap((c, i) =>
      c.cost ? [castRow(c.name, c.cost, commanderCost[i], 1)] : []
    ),
    castability: {
      onCurve: mean((r) => r.onCurve),
      onCurveGivenMana: mean((r) => r.onCurveGivenMana),
      nextTurn: mean((r) => r.nextTurn),
      nextTurnGivenMana: mean((r) => r.nextTurnGivenMana),
      measured,
      belowKarstenBar: below,
    },
  };
}
