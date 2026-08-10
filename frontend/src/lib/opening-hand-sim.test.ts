import { describe, expect, it } from 'vitest';
import {
  isKeepableHand,
  simulateAssemblyClock,
  simulateLandDropCurve,
  simulateOpeningHands,
  type ClockCard,
  type SimCard,
} from './opening-hand-sim';

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

  it('counts castable ramp as a mana source', () => {
    // 2 lands + a 2-mana rock (castable: cmc 2 <= 2 lands) = 3 effective.
    const hand = [land(), land(), spell(2, 'ramp'), spell(3), spell(7), spell(8), spell(9)];
    expect(isKeepableHand(hand)).toBe(true);
  });

  it('ignores ramp the hand cannot cast (2-mana rock, one land)', () => {
    // 1 land + two 2-mana rocks: neither rock is castable on one land, so
    // effective sources stays at 1 → mulligan.
    const hand = [
      land(),
      spell(2, 'ramp'),
      spell(2, 'ramp'),
      spell(3),
      spell(7),
      spell(8),
      spell(9),
    ];
    expect(isKeepableHand(hand)).toBe(false);
  });

  it('keeps a one-land hand rescued by a one-mana rock (Sol Ring)', () => {
    // 1 land + a 1-mana rock (cmc 1 <= 1 land) = 2 effective, rock is the early play.
    const hand = [land(), spell(1, 'ramp'), spell(5), spell(6), spell(7), spell(8), spell(9)];
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

describe('simulateLandDropCurve', () => {
  it('is deterministic for a fixed seed', () => {
    const lib = library(38, 60);
    const a = simulateLandDropCurve(lib, { iterations: 200, seed: 42 });
    const b = simulateLandDropCurve(lib, { iterations: 200, seed: 42 });
    expect(a).toEqual(b);
  });

  it('reports 100% on curve every turn for an all-land library', () => {
    const r = simulateLandDropCurve(library(99, 0), { iterations: 50, seed: 1 });
    expect(r.onCurveRate.slice(1)).toEqual([1, 1, 1, 1, 1]);
  });

  it('reports 0% on curve every turn for a landless library', () => {
    const r = simulateLandDropCurve(library(0, 99), { iterations: 50, seed: 1 });
    expect(r.onCurveRate.slice(1)).toEqual([0, 0, 0, 0, 0]);
  });

  it('reports every rate within [0, 1]', () => {
    const r = simulateLandDropCurve(library(38, 60), { iterations: 300, seed: 7 });
    for (const rate of r.onCurveRate) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it('respects a custom maxTurn', () => {
    const r = simulateLandDropCurve(library(38, 60), { iterations: 50, seed: 2, maxTurn: 3 });
    expect(r.onCurveRate).toHaveLength(4); // index 0 unused + turns 1..3
    expect(r.maxTurn).toBe(3);
  });

  it('returns a zeroed result when the library is smaller than a hand', () => {
    const r = simulateLandDropCurve(library(2, 2), { iterations: 50, seed: 1 });
    expect(r.onCurveRate.slice(1).every((n) => n === 0)).toBe(true);
  });
});

describe('simulateAssemblyClock', () => {
  const clockCard = (name: string, cmc = 2, role: SimCard['role'] = null): ClockCard => ({
    name,
    cmc,
    isLand: false,
    role,
    colors: [],
  });
  const clockLand = (i: number): ClockCard => ({
    name: `Land ${i}`,
    cmc: 0,
    isLand: true,
    role: null,
    colors: [],
  });

  /**
   * A 99-card library: the given named cards (two-drops by default), 37 lands,
   * and 3-drop filler. The land count is load-bearing now that the clock has to
   * pay for what it draws — a landless pile never casts anything.
   */
  function namedLibrary(
    named: ReadonlyArray<ClockCard | string>,
    size = 99,
    lands = 37
  ): ClockCard[] {
    const cards: ClockCard[] = named.map((n) => (typeof n === 'string' ? clockCard(n) : n));
    for (let i = 0; i < lands; i++) cards.push(clockLand(i));
    while (cards.length < size) cards.push(clockCard(`Filler ${cards.length}`, 3));
    return cards.slice(0, size);
  }

  it('is deterministic for a fixed seed', () => {
    const lib = namedLibrary(['A', 'B']);
    const spec = [{ names: ['A', 'B'], need: 2 }];
    const a = simulateAssemblyClock(lib, spec, { iterations: 300, seed: 42 });
    const b = simulateAssemblyClock(lib, spec, { iterations: 300, seed: 42 });
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });

  it('assembles on turn 1 when every library card satisfies the option', () => {
    // need 1 of a free spell that is every card — the opener always holds it,
    // and at 0 mana the turn-1 land drop is enough to cast it.
    const lib = Array.from({ length: 99 }, () => clockCard('Lab Man', 0));
    const r = simulateAssemblyClock(lib, [{ names: ['Lab Man'], need: 1 }], {
      iterations: 100,
      seed: 1,
    });
    expect(r).toEqual({ iterations: 100, typicalTurn: 1, p90Turn: 1 });
  });

  /** 8 copies each of A and B, so the pieces arrive early and MANA is what
   *  binds the clock — with 1-of pieces the draw walk dominates and cost is
   *  invisible (which is itself correct: you can't be mana-screwed on turn 60). */
  const densePieces = (cmc: number) => [
    ...Array.from({ length: 8 }, () => clockCard('A', cmc)),
    ...Array.from({ length: 8 }, () => clockCard('B', cmc)),
  ];

  it('prices the pieces: an expensive combo clocks later than a cheap one', () => {
    // Same shuffle sequence, same positions — only the mana values differ.
    const spec = [{ names: ['A', 'B'], need: 2 }];
    const cheap = simulateAssemblyClock(namedLibrary(densePieces(1)), spec, {
      iterations: 300,
      seed: 21,
    })!;
    const pricey = simulateAssemblyClock(namedLibrary(densePieces(8)), spec, {
      iterations: 300,
      seed: 21,
    })!;
    expect(cheap.typicalTurn).toBeLessThan(pricey.typicalTurn);
  });

  it('card draw accelerates the clock (same seed, same card positions)', () => {
    // One-card-per-turn is what dominates a sparse plan's clock, so a draw
    // package has to move the median — see the +2 cards note in the sim.
    const withDraw = namedLibrary([
      ...densePieces(2),
      ...Array.from({ length: 12 }, (_, i) => clockCard(`Cantrip ${i}`, 2, 'cardDraw')),
    ]);
    const withoutDraw = withDraw.map((c) => (c.role === 'cardDraw' ? { ...c, role: null } : c));
    const spec = [{ names: ['A', 'B'], need: 2 }];
    const drawn = simulateAssemblyClock(withDraw, spec, { iterations: 300, seed: 6 })!;
    const flat = simulateAssemblyClock(withoutDraw, spec, { iterations: 300, seed: 6 })!;
    expect(drawn.typicalTurn).toBeLessThan(flat.typicalTurn);
  });

  it('ramp accelerates the clock (same seed, same card positions)', () => {
    const withRamp = namedLibrary(
      [
        ...densePieces(6),
        ...Array.from({ length: 12 }, (_, i) => clockCard(`Rock ${i}`, 2, 'ramp')),
      ],
      99,
      35
    );
    const withoutRamp = withRamp.map((c) => (c.role === 'ramp' ? { ...c, role: null } : c));
    const spec = [{ names: ['A', 'B'], need: 2 }];
    const ramped = simulateAssemblyClock(withRamp, spec, { iterations: 300, seed: 8 })!;
    const flat = simulateAssemblyClock(withoutRamp, spec, { iterations: 300, seed: 8 })!;
    expect(ramped.typicalTurn).toBeLessThan(flat.typicalTurn);
  });

  it('reports turn 1 for a zero-need option (commander-only combo)', () => {
    const r = simulateAssemblyClock(namedLibrary(['A']), [{ names: [], need: 0 }], {
      iterations: 50,
      seed: 1,
    });
    expect(r).toEqual({ iterations: 50, typicalTurn: 1, p90Turn: 1 });
  });

  it('returns null when no option is viable', () => {
    // Named pieces absent from the library (stale analysis after an edit).
    const r = simulateAssemblyClock(namedLibrary([]), [{ names: ['A', 'B'], need: 2 }], {
      iterations: 50,
      seed: 1,
    });
    expect(r).toBeNull();
  });

  it('drops an option whose remaining present names cannot meet need, keeps viable ones', () => {
    // First option lost a piece (B missing); second is intact — clock still runs.
    const lib = namedLibrary(['A', 'C']);
    const r = simulateAssemblyClock(
      lib,
      [
        { names: ['A', 'B'], need: 2 },
        { names: ['C'], need: 1 },
      ],
      { iterations: 200, seed: 7 }
    );
    expect(r).not.toBeNull();
    // A single specific card in a 99-card library: median draw position ~50,
    // i.e. well past the opening hand — sanity-check the turn is substantial.
    expect(r!.typicalTurn).toBeGreaterThan(10);
  });

  it('duplicate copies of one name only count once toward need', () => {
    // 4 copies of A but the option needs 2 DISTINCT names — only A present → not viable.
    const lib = namedLibrary(['A', 'A', 'A', 'A']);
    const r = simulateAssemblyClock(lib, [{ names: ['A', 'B'], need: 2 }], {
      iterations: 50,
      seed: 1,
    });
    expect(r).toBeNull();
  });

  it('p90 is never earlier than the median', () => {
    const lib = namedLibrary(['A', 'B', 'C', 'D']);
    const r = simulateAssemblyClock(lib, [{ names: ['A', 'B', 'C', 'D'], need: 2 }], {
      iterations: 500,
      seed: 3,
    });
    expect(r!.p90Turn).toBeGreaterThanOrEqual(r!.typicalTurn);
  });

  it('an added easier option can only speed the clock up (same seed)', () => {
    const lib = namedLibrary(['A', 'B', 'C']);
    const hard = [{ names: ['A', 'B'], need: 2 }];
    const withEasy = [...hard, { names: ['C'], need: 1 }];
    const slow = simulateAssemblyClock(lib, hard, { iterations: 300, seed: 11 })!;
    const fast = simulateAssemblyClock(lib, withEasy, { iterations: 300, seed: 11 })!;
    // Identical shuffle sequence per iteration; completion is a per-run min
    // over options, so every percentile is monotonically ≤.
    expect(fast.typicalTurn).toBeLessThanOrEqual(slow.typicalTurn);
    expect(fast.p90Turn).toBeLessThanOrEqual(slow.p90Turn);
  });

  it('a denser strategic pool assembles faster than a sparse one (same seed)', () => {
    const sparse = simulateAssemblyClock(
      namedLibrary(['A', 'B', 'C', 'D']),
      [{ names: ['A', 'B', 'C', 'D'], need: 4 }],
      { iterations: 300, seed: 5 }
    )!;
    const denseNames = Array.from({ length: 20 }, (_, i) => `P${i}`);
    const dense = simulateAssemblyClock(
      namedLibrary(denseNames),
      [{ names: denseNames, need: 4 }],
      { iterations: 300, seed: 5 }
    )!;
    expect(dense.typicalTurn).toBeLessThan(sparse.typicalTurn);
  });

  it('wildcards substitute for missing pieces and speed the clock (same seed)', () => {
    const tutors = Array.from({ length: 8 }, (_, i) => `Tutor ${i}`);
    const lib = namedLibrary(['A', 'B', ...tutors]);
    const spec = [{ names: ['A', 'B'], need: 2 }];
    const raw = simulateAssemblyClock(lib, spec, { iterations: 300, seed: 13 })!;
    const tutored = simulateAssemblyClock(lib, spec, {
      iterations: 300,
      seed: 13,
      wildcards: tutors,
    })!;
    // Identical shuffles; wildcards only ever relax the completion condition.
    expect(tutored.typicalTurn).toBeLessThan(raw.typicalTurn);
    expect(tutored.p90Turn).toBeLessThanOrEqual(raw.p90Turn);
  });

  it('a tutor fetches to hand, so what it finds still has to be cast', () => {
    // Tutor-dense library: the opener nearly always holds two tutors, yet the
    // clock is never turn 1 — casting tutor + piece twice costs real mana.
    const tutors = Array.from({ length: 40 }, (_, i) => `Tutor ${i}`);
    const lib = namedLibrary([...tutors.map((t) => clockCard(t, 2)), 'A', 'B']);
    const r = simulateAssemblyClock(lib, [{ names: ['A', 'B'], need: 2 }], {
      iterations: 300,
      seed: 4,
      wildcards: tutors,
    })!;
    expect(r.typicalTurn).toBeGreaterThan(1);
    // …but a tutor wall still gets there fast — that's the point of pricing
    // them rather than dropping them (raw draw math clocks this ~turn 30).
    expect(r.typicalTurn).toBeLessThan(10);
  });

  it('a wildcard that is also an option piece counts once, as the piece', () => {
    // 'A' is both piece and (mis-)listed wildcard: drawing A must not count
    // twice and finish a need-2 option alone.
    const lib = namedLibrary(['A', 'B']);
    const r = simulateAssemblyClock(lib, [{ names: ['A', 'B'], need: 2 }], {
      iterations: 300,
      seed: 13,
      wildcards: ['A'],
    })!;
    const raw = simulateAssemblyClock(lib, [{ names: ['A', 'B'], need: 2 }], {
      iterations: 300,
      seed: 13,
    })!;
    expect(r).toEqual(raw);
  });

  it('respects a custom hand size', () => {
    // Whole library in hand from the start, and both pieces free → turn 1.
    const lib = namedLibrary([clockCard('A', 0), clockCard('B', 0)], 10, 4);
    const r = simulateAssemblyClock(lib, [{ names: ['A', 'B'], need: 2 }], {
      iterations: 50,
      seed: 2,
      handSize: 10,
    });
    expect(r!.typicalTurn).toBe(1);
    expect(r!.p90Turn).toBe(1);
  });
});
