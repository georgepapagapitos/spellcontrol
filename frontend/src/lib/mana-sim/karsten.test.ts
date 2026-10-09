/**
 * Validation against Frank Karsten, "How Many Sources Do You Need to
 * Consistently Cast Your Spells? A 2022 Update" (TCGplayer / ChannelFireball,
 * 2022-08-02):
 * https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/
 *
 * His summary table, 99-card column (minimum colored sources to cast on curve
 * "consistently", i.e. at (89 + mana value)% probability):
 *
 *   C    19   1C   19   2C   18   3C   16   4C   15   5C   14
 *   CC   30   1CC  28   2CC  26   3CC  23   4CC  22   5CC  20
 *   CCC  36   1CCC 33   2CCC 30   3CCC 28   4CCC 26
 *   CCCC 39   1CCCC 36
 *
 * The probabilities below are read from the article's full 99-card table
 * ("How-many-sources-99-cards-.png"): P(at least N colored sources by turn M
 * on the play | at least M lands by turn M), in percent, for a cost of mana
 * value M with N pips of one color.
 *
 * His assumptions, quoted, and how `mulligan: 'karsten'` matches them:
 * - "a 99-card deck contains 41 lands": the decks below are S sources of the
 *   color + (41 − S) basics of another color + 58 copies of the card.
 * - "In Commander, there's a free mulligan and a free draw on turn one" (CR
 *   103.4c, 800.7): `freeMulligan` and `drawOnTurnOne` default on.
 * - "we mulligan any free seven-card hand in Commander with zero, one, two,
 *   six or seven lands, any regular seven-card hand with zero, one, six or
 *   seven lands, any six-card hand that after bottoming contains zero, one,
 *   five or six lands, any five-card hand that after bottoming contains zero,
 *   one or five lands and we keep all other hands", bottoming toward three
 *   lands, off-colour lands first: `karstenKeeps` and `bottom` in the engine.
 * - "The only mana sources are lands, and there is no card selection": the
 *   test decks have no ramp and no draw.
 * - "conditional on drawing at least M lands by turn M": the sim's
 *   `onCurveGivenMana`. With untapped basics and one draw a turn, "drew M
 *   lands by turn M" and "made every land drop through M" are the same event,
 *   and re-choosing the drops for the card counts exactly his "at least N
 *   colored sources among the lands drawn".
 *
 * Result (seed 20220802, 20,000 games a cell, all 19 cost shapes at their
 * published minimum and at 15 sources): deviations from his figures run from
 * −0.81 to +1.13 points, the largest 2.7 standard errors, with a mean of
 * +0.01 points and mixed signs. That is simulation noise and no systematic
 * offset, so under his assumptions the simulator is his model. The default
 * (`app`) configuration differs from his table on purpose, and the last
 * block pins down how.
 */

import { describe, expect, it } from 'vitest';
import { evaluateManabase, type ManaSimOptions } from './index';
import { card, cards } from './__fixtures__/decks';

interface Cell {
  cost: string;
  /** Karsten's own example card for the shape (real Oracle data). */
  name: string;
  basic: string;
  /** Published minimum sources and his probability there, then his probability at 15. */
  minimum: [sources: number, percent: number];
  at15: number;
}

const OFF: Record<string, string> = {
  Plains: 'Island',
  Island: 'Mountain',
  Swamp: 'Island',
  Mountain: 'Island',
  Forest: 'Island',
};

const TABLE: Cell[] = [
  { cost: 'C', name: 'Monastery Swiftspear', basic: 'Mountain', minimum: [19, 90.0], at15: 82.1 },
  { cost: '1C', name: 'Ledger Shredder', basic: 'Island', minimum: [19, 92.1], at15: 85.1 },
  { cost: '2C', name: 'Reckless Stormseeker', basic: 'Mountain', minimum: [18, 93.1], at15: 88.2 },
  { cost: '3C', name: 'Collected Company', basic: 'Forest', minimum: [16, 93.1], at15: 91.5 },
  { cost: '4C', name: 'Doubling Season', basic: 'Forest', minimum: [15, 94.3], at15: 94.3 },
  { cost: '5C', name: 'Drowner of Hope', basic: 'Island', minimum: [14, 95.3], at15: 96.4 },
  { cost: 'CC', name: 'Lord of Atlantis', basic: 'Island', minimum: [30, 92.3], at15: 49.2 },
  {
    cost: '1CC',
    name: 'Narset, Parter of Veils',
    basic: 'Island',
    minimum: [28, 93.0],
    at15: 55.8,
  },
  { cost: '2CC', name: 'Wrath of God', basic: 'Plains', minimum: [26, 94.3], at15: 63.7 },
  { cost: '3CC', name: 'Baneslayer Angel', basic: 'Plains', minimum: [23, 94.0], at15: 72.0 },
  { cost: '4CC', name: 'Primeval Titan', basic: 'Forest', minimum: [22, 96.0], at15: 79.3 },
  { cost: '5CC', name: 'Hullbreaker Horror', basic: 'Island', minimum: [20, 96.2], at15: 85.6 },
  { cost: 'CCC', name: 'Goblin Chainwhirler', basic: 'Mountain', minimum: [36, 93.0], at15: 22.4 },
  { cost: '1CCC', name: 'Cryptic Command', basic: 'Island', minimum: [33, 94.0], at15: 29.2 },
  { cost: '2CCC', name: 'Garruk, Primal Hunter', basic: 'Forest', minimum: [30, 94.6], at15: 38.3 },
  { cost: '3CCC', name: 'Massacre Wurm', basic: 'Swamp', minimum: [28, 96.0], at15: 48.2 },
  { cost: '4CCC', name: 'Nyxbloom Ancient', basic: 'Forest', minimum: [26, 96.7], at15: 58.6 },
  { cost: 'CCCC', name: 'Dawn Elemental', basic: 'Plains', minimum: [39, 94.7], at15: 8.5 },
  { cost: '1CCCC', name: 'Unnatural Growth', basic: 'Forest', minimum: [36, 95.6], at15: 13.1 },
];

const KARSTEN: ManaSimOptions = { mulligan: 'karsten', games: 20000, seed: 20220802 };

/** Karsten's test deck: `sources` of the color, the rest of 41 lands off-colour, 58 of the card. */
function testDeck(cell: Cell, sources: number) {
  return {
    commanders: [],
    library: cards([
      [cell.basic, sources],
      [OFF[cell.basic], 41 - sources],
      [cell.name, 58],
    ]),
  };
}

/**
 * The sim's on-curve castability given enough lands, in percent, with its
 * standard error. The conditioning event's count is games × onCurve ÷
 * onCurveGivenMana (onCurve = hits ÷ games, onCurveGivenMana = hits ÷ n).
 */
function simulate(cell: Cell, sources: number, options: ManaSimOptions = KARSTEN) {
  const r = evaluateManabase(testDeck(cell, sources), {
    ...options,
    maxTurn: card(cell.name).cmc,
  });
  const p = r.cards[0].onCurveGivenMana ?? 0;
  const n = (r.games * (r.cards[0].onCurve ?? 0)) / p;
  return { percent: p * 100, se: Math.sqrt((p * (1 - p)) / n) * 100 };
}
const simulated = (cell: Cell, sources: number, options?: ManaSimOptions): number =>
  simulate(cell, sources, options).percent;

/**
 * Within four standard errors of his figure, plus 0.05 for his one-decimal
 * rounding. His tables come from millions of games, so their own noise is
 * negligible; ours is 0.2–0.5 points at 20,000 games. The seed is fixed, so
 * the band is a statement about the model, not a flake risk.
 */
function expectKarsten(cell: Cell, sources: number, published: number): void {
  const { percent, se } = simulate(cell, sources);
  expect(Math.abs(percent - published)).toBeLessThanOrEqual(4 * se + 0.05);
}

describe("Karsten's 2022 99-card table, reproduced", () => {
  it.each(TABLE)('$cost ($name) at its published minimum sources', (cell) => {
    expectKarsten(cell, cell.minimum[0], cell.minimum[1]);
  });

  it.each(TABLE)('$cost ($name) at 15 sources', (cell) => {
    expectKarsten(cell, 15, cell.at15);
  });
});

describe('where the default configuration departs from his table, and why', () => {
  const lord = TABLE[6]; // CC, the steepest early cost
  const swiftspear = TABLE[0];

  it('keeps two-landers his free mulligan throws back, so early pips read a few points lower', () => {
    // The app's keep rule (isKeepableHand) keeps a first seven with two lands
    // that Karsten mulligans for free, and mulligans five-landers he keeps:
    // kept hands hold fewer lands, so fewer colored sources are seen by turn
    // 2. Measured: CC at 20 sources 68.2 (his rule) vs 60.8 (app rule); C at 20
    // sources 91.4 vs 88.1. Later costs converge (2CC at 20: 82.0 vs 81.4).
    const app: ManaSimOptions = { games: 20000, seed: 20220802 };
    const lordGap = simulated(lord, 20) - simulated(lord, 20, app);
    const oneDropGap = simulated(swiftspear, 20) - simulated(swiftspear, 20, app);
    expect(lordGap).toBeGreaterThan(3);
    expect(lordGap).toBeLessThan(12);
    expect(oneDropGap).toBeGreaterThan(1);
    expect(oneDropGap).toBeLessThan(6);
  });

  it('without the free mulligan and turn-1 draw (his pre-2022 model) needs more sources, as he reports', () => {
    // "as a result of incorporating the free mulligan and free draw for
    // Commander, the number of colored sources required ... has decreased
    // ... by as much as three or four." Turning both off drops CC at 20
    // sources by about 11 points, which is three to four sources' worth.
    const old: ManaSimOptions = { ...KARSTEN, freeMulligan: false, drawOnTurnOne: false };
    const drop = simulated(lord, 20) - simulated(lord, 20, old);
    expect(drop).toBeGreaterThan(6);
    const perSource = (simulated(lord, 24) - simulated(lord, 20)) / 4;
    expect(drop / perSource).toBeGreaterThan(2.5);
    expect(drop / perSource).toBeLessThan(5);
  });
});
