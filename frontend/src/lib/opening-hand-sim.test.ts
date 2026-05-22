import { describe, expect, it } from 'vitest';
import { isKeepableHand, simulateOpeningHands, type SimCard } from './opening-hand-sim';

const land = (colors: string[] = []): SimCard => ({
  isLand: true,
  cmc: 0,
  role: null,
  colors,
});
const spell = (cmc: number, role: SimCard['role'] = null): SimCard => ({
  isLand: false,
  cmc,
  role,
  colors: [],
});

/** Build a library of `lands` lands plus `spells` two-drop spells. */
function library(lands: number, spells: number, role: SimCard['role'] = null): SimCard[] {
  return [
    ...Array.from({ length: lands }, () => land()),
    ...Array.from({ length: spells }, () => spell(2, role)),
  ];
}

describe('isKeepableHand', () => {
  it('keeps a hand with 3 lands and an early play', () => {
    expect(isKeepableHand([land(), land(), land(), spell(2), spell(5), spell(6), spell(7)])).toBe(
      true
    );
  });

  it('mulligans a one-land hand', () => {
    expect(
      isKeepableHand([land(), spell(2), spell(2), spell(2), spell(2), spell(2), spell(2)])
    ).toBe(false);
  });

  it('mulligans a flooded six-land hand', () => {
    expect(isKeepableHand([land(), land(), land(), land(), land(), land(), spell(2)])).toBe(false);
  });

  it('counts ramp as a mana source', () => {
    // 1 land + 2 ramp = 3 effective sources, with an early play.
    const hand = [
      land(),
      spell(2, 'ramp'),
      spell(2, 'ramp'),
      spell(3),
      spell(7),
      spell(8),
      spell(9),
    ];
    expect(isKeepableHand(hand)).toBe(true);
  });

  it('mulligans when there is no castable early play', () => {
    expect(isKeepableHand([land(), land(), land(), spell(5), spell(6), spell(7), spell(8)])).toBe(
      false
    );
  });
});

describe('simulateOpeningHands', () => {
  it('is deterministic for a fixed seed', () => {
    const lib = library(38, 60);
    const a = simulateOpeningHands(lib, { iterations: 200, seed: 42 });
    const b = simulateOpeningHands(lib, { iterations: 200, seed: 42 });
    expect(a).toEqual(b);
  });

  it('histogram sums to the iteration count', () => {
    const result = simulateOpeningHands(library(38, 60), { iterations: 500, seed: 1 });
    const total = result.landHistogram.reduce((s, n) => s + n, 0);
    expect(total).toBe(500);
    expect(result.landHistogram).toHaveLength(8); // indices 0..7
  });

  it('reports every rate within [0, 1]', () => {
    const r = simulateOpeningHands(library(38, 60), { iterations: 300, seed: 7 });
    for (const rate of [
      r.keepableRate,
      r.keepableWithinMulligansRate,
      r.rampRate,
      r.screwRate,
      r.floodRate,
    ]) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it('mulligans only ever raise the keepable rate', () => {
    const r = simulateOpeningHands(library(38, 60), { iterations: 400, seed: 9, mulliganDepth: 3 });
    expect(r.keepableWithinMulligansRate).toBeGreaterThanOrEqual(r.keepableRate);
  });

  it('never keeps an all-land library (no early play exists)', () => {
    const r = simulateOpeningHands(library(99, 0), { iterations: 100, seed: 3 });
    expect(r.keepableRate).toBe(0);
    expect(r.keepableWithinMulligansRate).toBe(0);
    expect(r.floodRate).toBe(1); // 7 lands every time
    expect(r.avgLands).toBe(7);
  });

  it('always floods nothing for a landless library', () => {
    const r = simulateOpeningHands(library(0, 99), { iterations: 100, seed: 3 });
    expect(r.screwRate).toBe(1); // 0 lands every time
    expect(r.floodRate).toBe(0);
    expect(r.avgLands).toBe(0);
  });

  it('detects ramp in the opening hand', () => {
    // Half the deck is ramp — most openers should contain at least one.
    const lib = library(38, 60, 'ramp');
    const r = simulateOpeningHands(lib, { iterations: 300, seed: 5 });
    expect(r.rampRate).toBeGreaterThan(0.5);
  });

  it('returns a zeroed result when the library is smaller than a hand', () => {
    const r = simulateOpeningHands(library(2, 2), { iterations: 100, seed: 1 });
    expect(r.avgLands).toBe(0);
    expect(r.keepableRate).toBe(0);
    expect(r.landHistogram.every((n) => n === 0)).toBe(true);
  });

  it('tallies land colour identity per land-count bucket', () => {
    // An all-green-land library: every hand draws 7 green lands, so the only
    // populated bucket is 7 and it holds 7 × iterations green shares.
    const greenLands = Array.from({ length: 99 }, () => land(['G']));
    const r = simulateOpeningHands(greenLands, { iterations: 100, seed: 2 });
    expect(r.landColorByCount[7]).toEqual({ G: 700 });
    expect(r.landColorByCount[6]).toBeUndefined();
  });

  it('gives a dual land one share to each of its colours', () => {
    const dualLands = Array.from({ length: 99 }, () => land(['G', 'W']));
    const r = simulateOpeningHands(dualLands, { iterations: 50, seed: 4 });
    expect(r.landColorByCount[7]).toEqual({ G: 350, W: 350 });
  });

  it('files colourless lands under the C key', () => {
    const r = simulateOpeningHands(
      Array.from({ length: 99 }, () => land()),
      { iterations: 40, seed: 6 }
    );
    expect(r.landColorByCount[7]).toEqual({ C: 280 });
  });
});
