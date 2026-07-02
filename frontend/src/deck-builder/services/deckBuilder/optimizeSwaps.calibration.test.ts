import { describe, it, expect } from 'vitest';
import {
  analyzeDeck,
  computeOptimizeSwaps,
  countBasicFetchers,
  computeBasicFloor,
} from './deckAnalyzer';
import { buildCardInclusionMap, buildCardSynergyMap } from './commanderDeckAnalysis';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';

// Cards under test (no tagger data loaded in unit env → getCardRole returns
// null, so these are treated as roleless general-cut candidates unless we set
// deckRole). Inclusion/synergy come from the EDHREC fixture below.
const STAPLE = 'Staple Payoff'; // 40% inclusion — a near-staple, must NOT be cut
const FRINGE = 'Fringe Jank'; // 3% inclusion, no synergy — genuinely cuttable
const NARROW = 'Narrow Payoff'; // 12% inclusion but high synergy — must NOT be cut

function edhrec(): EDHRECCommanderData {
  const card = (name: string, inclusion: number, synergy = 0) => ({
    name,
    sanitized: name,
    primary_type: 'Creature',
    inclusion,
    synergy,
    num_decks: 0,
  });
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 1000,
      deckSize: 99,
      manaCurve: {},
      typeDistribution: {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 0,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 35, nonbasic: 2, total: 37 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: [card(STAPLE, 40, 0), card(FRINGE, 3, 0), card(NARROW, 12, 0.6)],
    },
    similarCommanders: [],
  };
}

const spell = (name: string): ScryfallCard =>
  ({
    name,
    cmc: 3,
    type_line: 'Creature',
    prices: {},
    color_identity: [],
    keywords: [],
  }) as unknown as ScryfallCard;
const forest = (): ScryfallCard =>
  ({
    name: 'Forest',
    cmc: 0,
    type_line: 'Basic Land — Forest',
    prices: {},
    color_identity: ['G'],
    keywords: [],
  }) as unknown as ScryfallCard;

type LiftSignal = NonNullable<Parameters<typeof computeOptimizeSwaps>[10]>;

function runOptimizeSwaps(
  withSynergyGuard: boolean,
  loadBearing?: Set<string>,
  liftSignal?: LiftSignal
) {
  const spells = [spell(STAPLE), spell(FRINGE), spell(NARROW)];
  const lands = Array.from({ length: 36 }, forest);
  const cards = [...spells, ...lands];
  const names = cards.map((c) => c.name);
  const data = edhrec();
  const inclusionMap = buildCardInclusionMap(data, names);
  const synergyMap = buildCardSynergyMap(data, names);
  // Generous role targets so nothing reads as "excess role" — isolates the
  // general (inclusion/synergy) cut path under test.
  const roleTargets = { ramp: 10, removal: 10, boardwipe: 3, cardDraw: 10 };
  const roleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  const analysis = analyzeDeck(data, cards, roleCounts, roleTargets, 99, inclusionMap);
  return computeOptimizeSwaps(
    analysis,
    cards,
    inclusionMap,
    'Some Commander',
    undefined,
    new Set<string>(),
    new Set<string>(),
    undefined,
    withSynergyGuard ? synergyMap : undefined,
    loadBearing,
    liftSignal
  );
}

function runOptimize(withSynergyGuard: boolean, loadBearing?: Set<string>) {
  return new Set(runOptimizeSwaps(withSynergyGuard, loadBearing).removals.map((r) => r.name));
}

describe('computeOptimizeSwaps — Commander cut calibration', () => {
  it('does not cut a 40%-inclusion near-staple as "low inclusion"', () => {
    const cut = runOptimize(true);
    expect(cut.has(STAPLE)).toBe(false);
  });

  it('still cuts a genuinely fringe (<8%) roleless card', () => {
    const cut = runOptimize(true);
    expect(cut.has(FRINGE)).toBe(true);
  });

  it('protects a fringe card flagged load-bearing by the native synergy engine', () => {
    // FRINGE (3% inclusion, no role/synergy) is cut by default…
    expect(runOptimize(true).has(FRINGE)).toBe(true);
    // …but not when the synergy engine marks it load-bearing for an invested axis.
    expect(runOptimize(true, new Set([FRINGE])).has(FRINGE)).toBe(false);
  });

  it('protects a low-inclusion but high-synergy payoff via the synergy guard', () => {
    const guarded = runOptimize(true);
    expect(guarded.has(NARROW)).toBe(false);
    // Without the synergy map, the same 12%-inclusion card is cut — proving the
    // guard (not the inclusion floor) is what spares it.
    const unguarded = runOptimize(false);
    expect(unguarded.has(NARROW)).toBe(true);
  });
});

describe('computeOptimizeSwaps — off-package lift signal (E71 Phase 4)', () => {
  const liftEntry = (liftedBy: string[]) => ({ clusterScore: 100, liftedBy });

  it('never cuts a card co-played with 2+ of the deck’s key cards', () => {
    // FRINGE (3% inclusion, roleless) is cut by default (proven above) — a
    // 2-seed lift cluster link protects it, same rank as the synergy guards.
    const swaps = runOptimizeSwaps(true, undefined, {
      index: new Map([[FRINGE.toLowerCase(), liftEntry(['Some Commander', STAPLE])]]),
      seedCount: 3,
    });
    expect(swaps.removals.some((r) => r.name === FRINGE)).toBe(false);
  });

  it('a single co-play link is not protection, and having a link means not off-package', () => {
    const swaps = runOptimizeSwaps(true, undefined, {
      index: new Map([[FRINGE.toLowerCase(), liftEntry(['Some Commander'])]]),
      seedCount: 3,
    });
    const fringe = swaps.removals.find((r) => r.name === FRINGE);
    expect(fringe).toBeDefined();
    expect(fringe?.reasonCategory).toBe('low-synergy');
  });

  it('flags a trusted no-link card as off-package and explains it', () => {
    const swaps = runOptimizeSwaps(true, undefined, { index: new Map(), seedCount: 3 });
    const fringe = swaps.removals.find((r) => r.name === FRINGE);
    expect(fringe?.reasonCategory).toBe('off-package');
    expect(fringe?.reason).toContain('no co-play links');
  });

  it('stays silent below the seed floor — absence of data is not evidence', () => {
    const swaps = runOptimizeSwaps(true, undefined, { index: new Map(), seedCount: 2 });
    const fringe = swaps.removals.find((r) => r.name === FRINGE);
    expect(fringe).toBeDefined();
    expect(fringe?.reasonCategory).toBe('low-synergy');
  });

  it('no lift signal leaves the cut list identical to before the feature', () => {
    const withUndefined = runOptimizeSwaps(true).removals.map((r) => `${r.name}:${r.reason}`);
    const baseline = runOptimizeSwaps(true, undefined, undefined).removals.map(
      (r) => `${r.name}:${r.reason}`
    );
    expect(withUndefined).toEqual(baseline);
  });
});

describe('countBasicFetchers / computeBasicFloor (E71 Phase 5)', () => {
  const withOracle = (oracle_text: string): ScryfallCard =>
    ({
      name: oracle_text.slice(0, 20),
      cmc: 3,
      type_line: 'Sorcery',
      oracle_text,
      prices: {},
      color_identity: ['G'],
      keywords: [],
    }) as unknown as ScryfallCard;

  it('detects Cultivate-style and Evolving Wilds-style basic tutoring', () => {
    const cultivate = withOracle(
      'Search your library for up to two basic land cards, reveal those cards, and put one onto the battlefield tapped.'
    );
    const wilds = withOracle('Search your library for a basic land card.');
    expect(countBasicFetchers([cultivate, wilds])).toBe(2);
  });

  it('does not count non-basic land tutors', () => {
    const woodElves = withOracle('Search your library for a Forest card.'); // any Forest, not basic-only
    const tutor = withOracle('Search your library for a card.');
    expect(countBasicFetchers([woodElves, tutor])).toBe(0);
  });

  it('floor is max(2, two per fetcher)', () => {
    expect(computeBasicFloor(0)).toBe(2);
    expect(computeBasicFloor(1)).toBe(2);
    expect(computeBasicFloor(3)).toBe(6);
  });
});

describe('computeOptimizeSwaps — oversupplied-basic cuts (E71 Phase 5)', () => {
  const gSpell = (name: string): ScryfallCard =>
    ({
      name,
      cmc: 2,
      type_line: 'Creature',
      mana_cost: '{G}{G}',
      prices: {},
      color_identity: ['G'],
      keywords: [],
    }) as unknown as ScryfallCard;
  const basic = (name: string, color: string): ScryfallCard =>
    ({
      name,
      cmc: 0,
      type_line: `Basic Land — ${name}`,
      prices: {},
      color_identity: [color],
      keywords: [],
    }) as unknown as ScryfallCard;
  const utilityLand = (name: string): ScryfallCard =>
    ({
      name,
      cmc: 0,
      type_line: 'Land',
      oracle_text: '{T}: Add {C}.',
      prices: {},
      color_identity: [],
      keywords: [],
    }) as unknown as ScryfallCard;

  function runLandOptimize(cards: ScryfallCard[]) {
    const names = cards.map((c) => c.name);
    const data = edhrec();
    const inclusionMap = buildCardInclusionMap(data, names);
    const roleTargets = { ramp: 10, removal: 10, boardwipe: 3, cardDraw: 10 };
    const roleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    const analysis = analyzeDeck(data, cards, roleCounts, roleTargets, 99, inclusionMap);
    return computeOptimizeSwaps(
      analysis,
      cards,
      inclusionMap,
      'Some Commander',
      undefined,
      new Set<string>(),
      new Set<string>()
    );
  }

  it('cuts overserved-color basics by pip demand, sparing the demanded color and utility lands', () => {
    // All pips are G, but 18 of 43 basics are Islands — Islands are the cut,
    // Forests and the colorless utility land are not.
    const cards = [
      ...Array.from({ length: 3 }, (_, i) => gSpell(`G Spell ${i}`)),
      ...Array.from({ length: 24 }, () => basic('Forest', 'G')),
      ...Array.from({ length: 18 }, () => basic('Island', 'U')),
      utilityLand('Command Beacon'),
    ];
    const swaps = runLandOptimize(cards);
    const island = swaps.removals.find((r) => r.name === 'Island');
    expect(island?.reasonCategory).toBe('oversupplied-basic');
    expect(island?.reason).toContain('Oversupplied basic');
    expect(swaps.removals.some((r) => r.name === 'Forest')).toBe(false);
    expect(swaps.removals.some((r) => r.name === 'Command Beacon')).toBe(false);
  });

  it('never cuts basics below the basic-fetcher floor', () => {
    // Only 4 basics (all off-color Islands) + enough fetchers for a floor of 4:
    // despite the excess lands, no basic is suggested.
    const fetcher = (i: number): ScryfallCard =>
      ({
        name: `Fetcher ${i}`,
        cmc: 3,
        type_line: 'Sorcery',
        mana_cost: '{G}{G}',
        oracle_text: 'Search your library for a basic land card.',
        prices: {},
        color_identity: ['G'],
        keywords: [],
      }) as unknown as ScryfallCard;
    const cards = [
      ...Array.from({ length: 2 }, (_, i) => fetcher(i)),
      gSpell('G Spell'),
      ...Array.from({ length: 4 }, () => basic('Island', 'U')),
      ...Array.from({ length: 39 }, (_, i) => utilityLand(`Utility ${i}`)),
    ];
    const swaps = runLandOptimize(cards);
    expect(swaps.removals.some((r) => r.reasonCategory === 'oversupplied-basic')).toBe(false);
  });
});

describe('computeOptimizeSwaps — net-zero color rebalance', () => {
  const uSpell = (name: string): ScryfallCard =>
    ({
      name,
      cmc: 2,
      type_line: 'Creature',
      mana_cost: '{U}{U}',
      prices: {},
      color_identity: ['U'],
      keywords: [],
    }) as unknown as ScryfallCard;
  const wSpell = (name: string): ScryfallCard =>
    ({
      name,
      cmc: 2,
      type_line: 'Creature',
      mana_cost: '{1}{W}',
      prices: {},
      color_identity: ['W'],
      keywords: [],
    }) as unknown as ScryfallCard;
  const basic = (name: string, color: string): ScryfallCard =>
    ({
      name,
      cmc: 0,
      type_line: `Basic Land — ${name}`,
      prices: {},
      color_identity: [color],
      keywords: [],
    }) as unknown as ScryfallCard;

  function runLandOptimize(cards: ScryfallCard[]) {
    const names = cards.map((c) => c.name);
    const data = edhrec();
    const inclusionMap = buildCardInclusionMap(data, names);
    const roleTargets = { ramp: 10, removal: 10, boardwipe: 3, cardDraw: 10 };
    const roleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    const analysis = analyzeDeck(data, cards, roleCounts, roleTargets, 99, inclusionMap);
    return computeOptimizeSwaps(
      analysis,
      cards,
      inclusionMap,
      'Some Commander',
      undefined,
      new Set<string>(),
      new Set<string>()
    );
  }

  it('proposes one basic-for-basic swap when a color is short and another hoards basics', () => {
    // Pips lean hard blue, but the manabase is Plains-heavy at a NORMAL land
    // count (no excess-land pass): expect cut Plains + add Island, both tagged
    // color-rebalance, phrased as a swap pair.
    const cards = [
      ...Array.from({ length: 55 }, (_, i) => uSpell(`U Spell ${i}`)),
      ...Array.from({ length: 6 }, (_, i) => wSpell(`W Spell ${i}`)),
      ...Array.from({ length: 32 }, () => basic('Plains', 'W')),
      ...Array.from({ length: 5 }, () => basic('Island', 'U')),
    ];
    const swaps = runLandOptimize(cards);
    const cut = swaps.removals.find((r) => r.reasonCategory === 'color-rebalance');
    const add = swaps.additions.find((a) => a.reasonCategory === 'color-rebalance');
    expect(cut?.name).toBe('Plains');
    expect(cut?.reason).toContain('Swap for an Island'); // phrased as a pair, not a bare cut
    expect(add?.name).toBe('Island');
    expect(add?.reason).toContain('short on sources');
  });

  it('stays silent when colors are balanced, and defers to the excess-land pass', () => {
    // Balanced WU deck at a normal land count → no rebalance rows. Single
    // pips at mv4 so neither color trips the pacing-aware shortfall bar.
    const mid = (name: string, sym: string): ScryfallCard =>
      ({
        name,
        cmc: 4,
        type_line: 'Creature',
        mana_cost: `{3}{${sym}}`,
        prices: {},
        color_identity: [sym],
        keywords: [],
      }) as unknown as ScryfallCard;
    const balanced = [
      ...Array.from({ length: 30 }, (_, i) => mid(`U Spell ${i}`, 'U')),
      ...Array.from({ length: 31 }, (_, i) => mid(`W Spell ${i}`, 'W')),
      ...Array.from({ length: 19 }, () => basic('Plains', 'W')),
      ...Array.from({ length: 18 }, () => basic('Island', 'U')),
    ];
    expect(
      runLandOptimize(balanced).removals.some((r) => r.reasonCategory === 'color-rebalance')
    ).toBe(false);

    // Way over the land target → the oversupplied-basic pass owns it; the
    // rebalance pass must not double-propose cuts of the same basics.
    const excess = [
      ...Array.from({ length: 45 }, (_, i) => uSpell(`U Spell ${i}`)),
      ...Array.from({ length: 49 }, () => basic('Plains', 'W')),
      ...Array.from({ length: 5 }, () => basic('Island', 'U')),
    ];
    expect(
      runLandOptimize(excess).removals.some((r) => r.reasonCategory === 'color-rebalance')
    ).toBe(false);
  });
});
