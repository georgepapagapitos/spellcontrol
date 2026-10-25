import { describe, expect, it } from 'vitest';
import { buildManaDeck } from './index';
import { simulateManaDeck } from './engine';
import { toClockLibrary } from './hand-classify';
import {
  adviseMulligan,
  DEVELOPED_SPELLS,
  MULLIGAN_MARGIN,
  PATH_INFORMATIVE,
  simulateMulliganAdvice,
  type AdvisorInput,
  type OpeningOdds,
  type Rate,
} from './mulligan-advisor';
import { mulliganAdviceAsync, adviceKey } from './use-mulligan-advice';
import { drawCard } from './__fixtures__/draw-cards';
import { brago, BRAGO_UNTAPPED_DUALS } from './__fixtures__/decks';

/** Real Azorius list from the fixtures; the hands below are real cards of it. */
const deck = brago(BRAGO_UNTAPPED_DUALS);
const library = toClockLibrary(deck.library).map((c) => c.mana!);
const commanders = toClockLibrary(deck.commanders).map((c) => c.mana!);
const advise = (hand: string[], runs = 1500) =>
  simulateMulliganAdvice({ commanders, library, hand, path: null, runs });

const ZERO_LANDS = [
  'Swords to Plowshares',
  'Path to Exile',
  'Counterspell',
  'Wrath of God',
  'Rhystic Study',
  'Lyra Dawnbringer',
  'Sun Titan',
];
const SEVEN_LANDS = ['Plains', 'Island', 'Plains', 'Island', 'Command Tower', 'Plains', 'Island'];
const GOOD_KEEP = [
  'Plains',
  'Island',
  'Hallowed Fountain',
  'Sol Ring',
  'Rhystic Study',
  'Swords to Plowshares',
  'Thraben Inspector',
];
const BORDERLINE_TWO = [
  'Plains',
  'Island',
  'Brainstorm',
  'Counterspell',
  'Thraben Inspector',
  'Sun Titan',
  'Rhystic Study',
];

describe('a dealt hand, played on', () => {
  it('a hand with no land is a clear mulligan, on the development metric', () => {
    const a = advise(ZERO_LANDS);
    expect(a.verdict).toBe('mulligan');
    expect(a.close).toBe(false);
    expect(a.metric).toBe('developed');
    expect(a.hand.landsBy4.p).toBeLessThan(0.1);
    expect(a.hand.castBy3.p).toBeLessThan(0.8);
    expect(a.mull7.developed.p - a.hand.developed.p).toBeGreaterThan(0.4);
  });

  it('seven lands is a mulligan too: flooding fails the same metric', () => {
    const a = advise(SEVEN_LANDS);
    expect(a.verdict).toBe('mulligan');
    // Every land drop is made, and it is still the worse hand.
    expect(a.hand.landsBy4.p).toBe(1);
    expect(a.hand.developed.p).toBeLessThan(a.mull7.developed.p - MULLIGAN_MARGIN);
  });

  it('three lands, a rock and cheap plays is a keep', () => {
    const a = advise(GOOD_KEEP);
    expect(a.verdict).toBe('keep');
    expect(a.hand.developed.p).toBeGreaterThan(0.95);
    expect(a.edge).toBeLessThan(-MULLIGAN_MARGIN);
  });

  it('a two-lander of cheap cards is a keep that says it is close', () => {
    const a = advise(BORDERLINE_TWO);
    expect(a.verdict).toBe('keep');
    expect(a.close).toBe(true);
    // The weak spot is named in the numbers: the fourth land.
    expect(a.hand.landsBy4.p).toBeLessThan(a.mull7.landsBy4.p / 2);
  });

  it('carries the run count and a Wilson interval on every rate', () => {
    const a = advise(GOOD_KEEP, 800);
    for (const o of [a.hand, a.mull7, a.mull6]) {
      expect(o.runs).toBe(800);
      for (const r of [o.castBy3, o.landsBy4, o.developed]) {
        expect(r.lo).toBeLessThanOrEqual(r.p);
        expect(r.hi).toBeGreaterThanOrEqual(r.p);
      }
    }
    expect(a.hand.path).toBeNull();
  });

  it('is deterministic, and the order of the hand is not part of it', () => {
    expect(advise(GOOD_KEEP, 300)).toEqual(advise([...GOOD_KEEP].reverse(), 300));
  });
});

describe('the opening option of the engine', () => {
  const mana = buildManaDeck(commanders, library);

  it('plays the dealt cards, not a fresh shuffle', () => {
    let firstTurnCasts = 0;
    simulateManaDeck(mana, {
      games: 50,
      seed: 4,
      maxTurn: 2,
      opening: { hand: SEVEN_LANDS, bottom: 0 },
      onGame: (g) => (firstTurnCasts += g.casts[1]),
    });
    // Seven lands cast nothing on turn 1 unless the draw is a one-drop.
    const fresh = { casts: 0 };
    simulateManaDeck(mana, {
      games: 50,
      seed: 4,
      maxTurn: 2,
      onGame: (g) => (fresh.casts += g.casts[1]),
    });
    expect(firstTurnCasts).toBeLessThan(fresh.casts);
  });

  it('bottoms the cards it is told to, London-style', () => {
    const size = (bottom: number) =>
      simulateManaDeck(mana, { games: 40, seed: 2, opening: { bottom } }).mulligan.avgKeptSize;
    expect(size(0)).toBe(7);
    expect(size(1)).toBe(6);
    expect(size(2)).toBe(5);
  });

  it('reports every turn of every game to onGame', () => {
    const rows: number[] = [];
    simulateManaDeck(mana, {
      games: 25,
      seed: 1,
      maxTurn: 6,
      onGame: (g) => rows.push(g.casts.length * 100 + g.drops.length),
    });
    expect(rows).toHaveLength(25);
    expect(new Set(rows)).toEqual(new Set([707]));
  });
});

describe('with a win path', () => {
  const cards = [
    ...Array.from({ length: 6 }, () => drawCard("Thassa's Oracle")),
    ...Array.from({ length: 36 }, () => drawCard('Island')),
    ...Array.from({ length: 57 }, () => drawCard('Counterspell')),
  ];
  const lib = toClockLibrary(cards).map((c) => c.mana!);
  const path = { assembly: [{ names: ["Thassa's Oracle"], need: 1 }], tutors: [] };
  const input = (hand: string[]): AdvisorInput => ({
    commanders: [],
    library: lib,
    hand,
    path,
    runs: 800,
  });

  it('decides on the path when it comes together often enough, priced by turn 6', () => {
    const a = simulateMulliganAdvice(input(Array(7).fill('Counterspell')));
    expect(a.metric).toBe('path');
    expect(a.hand.path!.p).toBeLessThan(a.mull7.path!.p);
    expect(a.edge).toBeGreaterThan(0);
  });

  it('keeps a hand that already holds the piece and the mana', () => {
    const hand = [
      "Thassa's Oracle",
      'Island',
      'Island',
      'Island',
      'Counterspell',
      'Counterspell',
      'Island',
    ];
    const a = simulateMulliganAdvice(input(hand));
    expect(a.metric).toBe('path');
    expect(a.hand.path!.p).toBeGreaterThan(0.95);
    expect(a.verdict).toBe('keep');
  });

  it('async slices give the numbers of the synchronous run', async () => {
    const i = input([
      'Island',
      'Island',
      "Thassa's Oracle",
      'Counterspell',
      'Counterspell',
      'Island',
      'Island',
    ]);
    const sync = simulateMulliganAdvice(i);
    const sliced = await mulliganAdviceAsync(i);
    expect(sliced).toEqual(sync);
    // And a second ask is the cached answer.
    expect(await mulliganAdviceAsync(i)).toBe(sliced);
    expect(adviceKey(i)).toBe(adviceKey({ ...i, hand: [...i.hand].reverse() }));
  });
});

describe('the recommendation rule', () => {
  const rate = (p: number, half = 0.02): Rate => ({ p, lo: p - half, hi: p + half });
  const odds = (developed: number, path: number | null = null, half?: number): OpeningOdds => ({
    runs: 2000,
    castBy3: rate(0.9),
    landsBy4: rate(0.5),
    developed: rate(developed, half),
    path: path === null ? null : rate(path, half),
  });

  it('mulligans when a fresh seven is ahead by the margin and clear of the noise', () => {
    const a = adviseMulligan(odds(0.5), odds(0.5 + MULLIGAN_MARGIN + 0.01), odds(0.8));
    expect(a.verdict).toBe('mulligan');
    expect(a.metric).toBe('developed');
    expect(a.close).toBe(false);
  });

  it('keeps below the margin, and calls it close', () => {
    const a = adviseMulligan(odds(0.5), odds(0.5 + MULLIGAN_MARGIN - 0.01), odds(0.8));
    expect(a.verdict).toBe('keep');
    expect(a.close).toBe(true);
  });

  it('keeps when the gap is real but inside the noise', () => {
    const a = adviseMulligan(odds(0.5, null, 0.06), odds(0.58, null, 0.06), odds(0.8));
    expect(a.edge).toBeGreaterThan(MULLIGAN_MARGIN);
    expect(a.verdict).toBe('keep');
    expect(a.close).toBe(true);
  });

  it('keeps clearly when the hand is the better one', () => {
    const a = adviseMulligan(odds(0.9), odds(0.7), odds(0.7));
    expect(a.verdict).toBe('keep');
    expect(a.close).toBe(false);
  });

  it('uses the win path only when either side reaches the informative floor', () => {
    const low = PATH_INFORMATIVE - 0.01;
    expect(adviseMulligan(odds(0.5, 0.0), odds(0.9, low), odds(0.9, low)).metric).toBe('developed');
    const a = adviseMulligan(odds(0.9, 0.0), odds(0.5, PATH_INFORMATIVE), odds(0.5, 0.1));
    expect(a.metric).toBe('path');
    expect(a.verdict).toBe('mulligan');
  });

  it('names the development bar it measures', () => {
    expect(DEVELOPED_SPELLS).toBe(4);
  });
});
