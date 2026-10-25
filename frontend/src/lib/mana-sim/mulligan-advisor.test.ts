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
import { wilsonInterval } from './turn-distribution';
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
  "Sphinx's Revelation",
  'Sun Titan',
  'Consecrated Sphinx',
  'Dream Trawler',
  'Brainstorm',
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

  it('a two-lander of top-end cards is a keep that says it is close', () => {
    const a = advise(BORDERLINE_TWO);
    expect(a.verdict).toBe('keep');
    expect(a.close).toBe(true);
    // The weak spot is in the numbers: the land drops, behind a fresh seven's.
    expect(a.hand.landsBy4.p).toBeLessThan(a.mull7.landsBy4.p);
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

/** P(at least `need` of `draws` cards are lands) from a library of `n` with `lands` lands. */
function atLeast(need: number, draws: number, n: number, lands: number): number {
  const choose = (a: number, b: number) => {
    let r = 1;
    for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1);
    return r;
  };
  let p = 0;
  for (let j = Math.max(need, 0); j <= draws; j++)
    p += (choose(lands, j) * choose(n - lands, draws - j)) / choose(n, draws);
  return p;
}

describe('the dealt hand is played against the closed form', () => {
  // 36 Islands and 63 Counterspells: a land is a land, so every land drop by
  // turn 4 is "at least 4 - L lands in the four draws of turns 1 to 4" (the
  // goldfish draws on turn 1, as in multiplayer Commander) from the 92 cards
  // that are left. Counterspell is the only spell, and it is never a land.
  const cards = [
    ...Array.from({ length: 36 }, () => drawCard('Island')),
    ...Array.from({ length: 63 }, () => drawCard('Counterspell')),
  ];
  const mana = buildManaDeck(
    [],
    toClockLibrary(cards).map((c) => c.mana!)
  );

  for (const held of [0, 1, 2, 3]) {
    it(`a hand with ${held} lands makes four land drops by turn 4 as often as the hypergeometric says`, () => {
      const hand = [...Array(held).fill('Island'), ...Array(7 - held).fill('Counterspell')];
      const games = 6000;
      let hit = 0;
      simulateManaDeck(mana, {
        games,
        seed: 5,
        maxTurn: 4,
        opening: { hand, bottom: 0 },
        onGame: (g) => (hit += g.drops[4] >= 4 ? 1 : 0),
      });
      const exact = atLeast(4 - held, 4, 92, 36 - held);
      const { lo, hi } = wilsonInterval(hit, games);
      expect(exact).toBeGreaterThanOrEqual(lo);
      expect(exact).toBeLessThanOrEqual(hi);
    });
  }

  it('a fresh seven needs the same four lands in eleven cards', () => {
    const games = 6000;
    let hit = 0;
    simulateManaDeck(mana, {
      games,
      seed: 5,
      maxTurn: 4,
      opening: { bottom: 0 },
      onGame: (g) => (hit += g.drops[4] >= 4 ? 1 : 0),
    });
    const { lo, hi } = wilsonInterval(hit, games);
    const exact = atLeast(4, 11, 99, 36);
    expect(exact).toBeGreaterThanOrEqual(lo);
    expect(exact).toBeLessThanOrEqual(hi);
  });
});

describe('a mulligan to six', () => {
  it('casts fewer spells by turn 6 than a free mulligan, and never makes more land drops', () => {
    const a = simulateMulliganAdvice({
      commanders,
      library,
      hand: GOOD_KEEP,
      path: null,
      runs: 5000,
    });
    expect(a.mull6.spellsBy6.mean).toBeLessThan(a.mull7.spellsBy6.mean);
    // London bottoms a spell, not a land, so the land drops are the free mulligan's.
    expect(a.mull6.landsBy4.p).toBeLessThanOrEqual(a.mull7.landsBy4.hi);
    expect(a.mull6.castBy3.p).toBeLessThanOrEqual(a.mull7.castBy3.hi);
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
    spellsBy6: { mean: 6, lo: 5.9, hi: 6.1 },
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
