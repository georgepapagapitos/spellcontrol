/**
 * The metric on real decks: it must move the right way, clearly, when a
 * manabase gets worse. Every deck is built from real cards (see
 * `__fixtures__/decks.ts`); every run is 2,000 seeded games, where a rate's
 * standard error is about one point, and the margins asserted are several
 * times that.
 */

import { describe, expect, it } from 'vitest';
import { evaluateManabase, type ManaSimResult } from './index';
import {
  brago,
  jodah,
  BRAGO_SPELLS,
  BRAGO_TAPPED_DUALS,
  BRAGO_UNTAPPED_DUALS,
} from './__fixtures__/decks';

const OPTIONS = { games: 2000, seed: 99 };

/** Mean of a per-card rate over spells in a mana-value band, each copy once. */
function bandMean(
  r: ManaSimResult,
  rate: 'onCurve' | 'onCurveGivenMana' | 'nextTurnGivenMana',
  inBand: (mv: number) => boolean
): number {
  let sum = 0;
  let n = 0;
  for (const c of r.cards) {
    const v = c[rate];
    if (v === null || !inBand(c.mv)) continue;
    sum += v * c.copies;
    n += c.copies;
  }
  return sum / n;
}

describe('a tuned five-colour manabase against the same deck on 37 Forests', () => {
  const tuned = evaluateManabase(jodah(), OPTIONS);
  const forests = evaluateManabase(jodah([['Forest', 37]]), OPTIONS);

  it('casts its spells with the right colors far more often', () => {
    expect(tuned.castability.onCurveGivenMana).toBeGreaterThan(0.88);
    expect(forests.castability.onCurveGivenMana).toBeLessThan(0.45);
    expect(tuned.castability.belowKarstenBar + 15).toBeLessThan(
      forests.castability.belowKarstenBar
    );
  });

  it('casts the WUBRG commander on curve only with the fixing', () => {
    const [cmd] = tuned.commanders;
    const [starved] = forests.commanders;
    expect(cmd.name).toBe('Jodah, the Unifier');
    expect(cmd.onCurveGivenMana).toBeGreaterThan(0.9);
    expect(starved.onCurveGivenMana).toBeLessThan(0.05);
    // And it says why: every non-green color is missing.
    for (const c of ['W', 'U', 'B', 'R'] as const) expect(starved.shortBy[c]).toBeGreaterThan(0.05);
    expect(starved.shortBy.G).toBeUndefined();
  });

  it("names the hardest spells in the tuned list and the color they're short of", () => {
    const bolas = tuned.cards.find((c) => c.name === 'Nicol Bolas, Dragon-God');
    expect(bolas?.onCurveGivenMana).toBeLessThan(0.75);
    expect(bolas?.shortBy.B).toBeGreaterThan(0.2);
    // The hardest rows come first.
    const onCurve = tuned.cards.map((c) => c.onCurve ?? 2);
    expect([...onCurve].sort((a, b) => a - b)).toEqual(onCurve);
  });
});

describe('33 against 38 lands in the same Azorius deck', () => {
  // 36 lands is the base list; 38 swaps Mulldrifter and Opposition for a
  // Plains and an Island; 33 swaps two Plains and an Island for Negate,
  // Disenchant and Divination (real cards, same colors).
  const lands38 = evaluateManabase(
    brago(
      BRAGO_UNTAPPED_DUALS,
      { plains: 13, islands: 13 },
      BRAGO_SPELLS.filter((n) => n !== 'Mulldrifter' && n !== 'Opposition')
    ),
    OPTIONS
  );
  const lands33 = evaluateManabase(
    brago(BRAGO_UNTAPPED_DUALS, { plains: 10, islands: 11 }, [
      ...BRAGO_SPELLS,
      'Negate',
      'Disenchant',
      'Divination',
    ]),
    OPTIONS
  );

  it('are both 99 cards', () => {
    expect(lands38.castability.measured + 38).toBe(99);
    expect(lands33.castability.measured + 33).toBe(99);
  });

  it('misses more land drops on 33', () => {
    expect(lands33.screw.missedDropBy3).toBeGreaterThan(lands38.screw.missedDropBy3 + 0.04);
    expect(lands33.screw.missedDropBy4).toBeGreaterThan(lands38.screw.missedDropBy4 + 0.06);
    expect(lands33.landDrops.onCurveRate[5]).toBeLessThan(lands38.landDrops.onCurveRate[5] - 0.05);
  });

  it('floods more on 38', () => {
    expect(lands38.flood.surplusLands).toBeGreaterThan(lands33.flood.surplusLands + 0.01);
    expect(lands38.flood.rate).toBeGreaterThan(lands33.flood.rate);
  });

  it('casts more spells on curve on 38 (mana, not color, is what 33 lacks)', () => {
    expect(lands38.castability.onCurve).toBeGreaterThan((lands33.castability.onCurve ?? 1) + 0.02);
    // Given the mana, colors are equally fine: same dual ratio in both.
    expect(
      Math.abs(
        (lands38.castability.onCurveGivenMana ?? 0) - (lands33.castability.onCurveGivenMana ?? 0)
      )
    ).toBeLessThan(0.02);
  });
});

describe('taplands against untapped duals, same colors, same count', () => {
  const untapped = evaluateManabase(brago(BRAGO_UNTAPPED_DUALS), OPTIONS);
  const tapped = evaluateManabase(brago(BRAGO_TAPPED_DUALS), OPTIONS);

  it('casts early spells on curve clearly less often with taplands', () => {
    const early = (r: ManaSimResult) => bandMean(r, 'onCurve', (mv) => mv <= 3);
    expect(early(untapped)).toBeGreaterThan(early(tapped) + 0.05);
    expect(bandMean(untapped, 'onCurveGivenMana', (mv) => mv <= 3)).toBeGreaterThan(
      bandMean(tapped, 'onCurveGivenMana', (mv) => mv <= 3) + 0.03
    );
  });

  it('has less mana on the early turns', () => {
    for (const turn of [1, 2, 3]) {
      expect(tapped.mana.average[turn]).toBeLessThan(untapped.mana.average[turn] - 0.1);
    }
  });

  it('catches up a turn later: colors given the mana are about even by next turn', () => {
    const late = (r: ManaSimResult) => bandMean(r, 'nextTurnGivenMana', (mv) => mv >= 4);
    expect(Math.abs(late(untapped) - late(tapped))).toBeLessThan(0.02);
  });

  it('keeps land drops the same: the difference is tempo, not screw', () => {
    expect(Math.abs(untapped.screw.missedDropBy3 - tapped.screw.missedDropBy3)).toBeLessThan(0.03);
  });
});
