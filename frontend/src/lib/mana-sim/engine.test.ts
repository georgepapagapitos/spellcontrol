import { describe, expect, it } from 'vitest';
import { librarySeed } from './opening-hand-sim';
import {
  buildManaDeck,
  classifyManaCard,
  compileManaDeck,
  evaluateManabase,
  identityMask,
  simulateManaDeck,
  type ManaSimOptions,
} from './index';
import { brago, card, cards, jodah, BRAGO_UNTAPPED_DUALS } from './__fixtures__/decks';

type List = Parameters<typeof cards>[0];
const deckOf = (library: List, commanders: string[] = []) => ({
  commanders: commanders.map(card),
  library: cards(library),
});
const run = (library: List, options: ManaSimOptions = {}, commanders: string[] = []) =>
  evaluateManabase(deckOf(library, commanders), { games: 1500, seed: 7, ...options });
const row = (r: ReturnType<typeof run>, name: string) => {
  const found = r.cards.find((c) => c.name === name);
  if (!found) throw new Error(`no row for ${name}`);
  return found;
};

describe('determinism', () => {
  it('gives the same numbers for the same list in any order', () => {
    const deck = jodah();
    const a = evaluateManabase(deck, { games: 300 });
    const b = evaluateManabase({ ...deck, library: [...deck.library].reverse() }, { games: 300 });
    expect(b).toEqual(a);
    expect(a.seed).toBe(librarySeed([...deck.commanders, ...deck.library]));
  });

  it('ignores partner order', () => {
    const library = jodah().library.filter(
      (c) => c.name !== 'Thrasios, Triton Hero' && c.name !== 'Tymna the Weaver'
    );
    const [thrasios, tymna] = [card('Thrasios, Triton Hero'), card('Tymna the Weaver')];
    const a = evaluateManabase({ commanders: [thrasios, tymna], library }, { games: 300 });
    const b = evaluateManabase({ commanders: [tymna, thrasios], library }, { games: 300 });
    expect(b).toEqual(a);
    expect(a.commanders.map((c) => c.name)).toEqual(['Thrasios, Triton Hero', 'Tymna the Weaver']);
    expect(a.commanders.every((c) => (c.onCurveGivenMana ?? 0) > 0.8)).toBe(true);
  });

  it('moves with the seed', () => {
    const deck = brago(BRAGO_UNTAPPED_DUALS);
    expect(evaluateManabase(deck, { games: 300, seed: 1 })).not.toEqual(
      evaluateManabase(deck, { games: 300, seed: 2 })
    );
  });

  it('reuses classified cards through buildManaDeck', () => {
    const input = brago(BRAGO_UNTAPPED_DUALS);
    const id = identityMask(input.commanders);
    const byName = new Map(input.library.map((c) => [c.name, classifyManaCard(c, id)]));
    const deck = buildManaDeck(
      input.commanders.map((c) => classifyManaCard(c, id)),
      input.library.map((c) => byName.get(c.name)!)
    );
    expect(simulateManaDeck(deck, { games: 200, seed: 3 })).toEqual(
      simulateManaDeck(compileManaDeck(input), { games: 200, seed: 3 })
    );
  });
});

describe('result shape', () => {
  const r = run(
    [
      ['Plains', 40],
      ['Wrath of God', 20],
      ['Swords to Plowshares', 20],
      ['Ornithopter', 10],
      ['Ancestral Vision', 9],
    ],
    { maxTurn: 3 }
  );

  it('reports per-turn arrays through maxTurn', () => {
    expect(r.maxTurn).toBe(3);
    expect(r.landDrops.hitRate).toHaveLength(4);
    expect(r.mana.average).toHaveLength(4);
    expect(r.landDrops.hitRate[0]).toBe(0);
  });

  it('leaves costs past maxTurn unmeasured, and skips cards with no cost', () => {
    expect(row(r, 'Wrath of God')).toMatchObject({ onCurve: null, nextTurn: null });
    expect(r.cards.find((c) => c.name === 'Ancestral Vision')).toBeUndefined();
    expect(r.castability.measured).toBe(30);
  });

  it('casts a zero-cost card on turn 1, always', () => {
    expect(row(r, 'Ornithopter')).toMatchObject({ onCurve: 1, onCurveGivenMana: 1, nextTurn: 1 });
  });

  it("states Karsten's bar per mana value", () => {
    expect(row(r, 'Swords to Plowshares').karstenBar).toBeCloseTo(0.9);
    expect(row(r, 'Wrath of God').karstenBar).toBeCloseTo(0.93);
    expect(row(r, 'Ornithopter').karstenBar).toBeCloseTo(0.9);
  });

  it('has null averages when nothing is measurable', () => {
    const lands = run([['Island', 99]]);
    expect(lands.castability).toMatchObject({ onCurve: null, measured: 0, belowKarstenBar: 0 });
    expect(lands.commanders).toEqual([]);
  });
});

describe('mulligans', () => {
  const spells: List = [
    ['Swords to Plowshares', 30],
    ['Wrath of God', 30],
  ];

  it('shares kept sizes out to 1 and keeps sevens most of the time', () => {
    const r = run([['Plains', 39], ...spells]);
    const total = Object.values(r.mulligan.keptSizeShare).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
    expect(r.mulligan.keepRate7).toBeGreaterThan(0.6);
    expect(r.mulligan.avgKeptSize).toBeGreaterThan(6.5);
  });

  it('keeps smaller hands without the free mulligan', () => {
    const free = run([['Plains', 39], ...spells]);
    const counted = run([['Plains', 39], ...spells], { freeMulligan: false });
    expect(counted.mulligan.avgKeptSize).toBeLessThan(free.mulligan.avgKeptSize - 0.1);
    expect(counted.mulligan.keepRate7).toBeCloseTo(free.mulligan.keepRate7, 1);
  });

  it("goes down to four under Karsten's rule for a land-flooded list", () => {
    const r = run(
      [
        ['Plains', 80],
        ['Swords to Plowshares', 19],
      ],
      { mulligan: 'karsten' }
    );
    expect(r.mulligan.keptSizeShare[4]).toBeGreaterThan(0.02);
    expect(r.mulligan.keptSizeShare[3]).toBeUndefined();
  });

  it('honours a mulligan depth of zero', () => {
    const r = run(
      [
        ['Plains', 80],
        ['Swords to Plowshares', 19],
      ],
      { mulliganDepth: 0 }
    );
    expect(r.mulligan.avgKeptSize).toBe(7);
  });
});

describe('turn structure options', () => {
  const oneDrops: List = [
    ['Mountain', 15],
    ['Island', 26],
    ['Monastery Swiftspear', 58],
  ];

  it('is worse on turn 1 without the multiplayer turn-1 draw', () => {
    const draw = row(run(oneDrops), 'Monastery Swiftspear').onCurveGivenMana ?? 0;
    const noDraw =
      row(run(oneDrops, { drawOnTurnOne: false }), 'Monastery Swiftspear').onCurveGivenMana ?? 0;
    expect(noDraw).toBeLessThan(draw - 0.02);
  });

  it('reads bond lands as tapped with one opponent', () => {
    const list: List = [
      ['Sea of Clouds', 38],
      ['Swords to Plowshares', 61],
    ];
    expect(run(list).mana.average[1]).toBeGreaterThan(0.9);
    expect(run(list, { opponents: 1 }).mana.average[1]).toBe(0);
  });
});

describe('land mechanics', () => {
  const shredders: List = [['Ledger Shredder', 58]];

  it('counts a fetch as a source of what it can fetch', () => {
    const fetches = run([['Mountain', 25], ['Flooded Strand', 10], ['Island', 6], ...shredders]);
    const islands = run([['Mountain', 25], ['Island', 16], ...shredders]);
    const f = row(fetches, 'Ledger Shredder').onCurveGivenMana ?? 0;
    const i = row(islands, 'Ledger Shredder').onCurveGivenMana ?? 0;
    expect(Math.abs(f - i)).toBeLessThan(0.03);
  });

  it('never fetches the same card twice: fetches share the library', () => {
    // Fifteen Strands and one Island: however many Strands are in hand, only
    // one of them can become an Island, so {U}{U} is out of reach.
    const lords: List = [['Lord of Atlantis', 58]];
    const dry = run([['Mountain', 25], ['Flooded Strand', 15], ['Island', 1], ...lords]);
    const wet = run([['Mountain', 25], ['Flooded Strand', 10], ['Island', 6], ...lords]);
    expect(row(dry, 'Lord of Atlantis').onCurveGivenMana ?? 1).toBeLessThan(0.02);
    expect(row(wet, 'Lord of Atlantis').onCurveGivenMana ?? 0).toBeGreaterThan(0.3);
  });

  it('fetches typed duals with typed fetches, and only basics with basic fetches', () => {
    const typed = run([
      ['Mountain', 20],
      ['Polluted Delta', 10],
      ['Watery Grave', 11],
      ...shredders,
    ]);
    const basic = run([
      ['Mountain', 20],
      ['Prismatic Vista', 10],
      ['Watery Grave', 11],
      ...shredders,
    ]);
    // Prismatic Vista can only find Mountains here, so it adds no blue.
    expect(row(typed, 'Ledger Shredder').onCurveGivenMana ?? 0).toBeGreaterThan(
      (row(basic, 'Ledger Shredder').onCurveGivenMana ?? 1) + 0.1
    );
  });

  it('plays a tapped fetch as a tapped land on turn 1', () => {
    const vista = run([
      ['Island', 20],
      ['Prismatic Vista', 10],
      ['Mountain', 11],
      ['Monastery Swiftspear', 58],
    ]);
    const wilds = run([
      ['Island', 20],
      ['Evolving Wilds', 10],
      ['Mountain', 11],
      ['Monastery Swiftspear', 58],
    ]);
    expect(wilds.mana.average[1]).toBeLessThan(vista.mana.average[1] - 0.1);
  });

  it('bounces a land with a Karoo and still makes two mana from it', () => {
    const karoos = run([
      ['Forest', 28],
      ['Simic Growth Chamber', 10],
      ['Beast Within', 61],
    ]);
    const forests = run([
      ['Forest', 38],
      ['Beast Within', 61],
    ]);
    // Fewer lands on the battlefield, for about the same mana: each Karoo
    // returned a land and taps for two.
    expect(karoos.landDrops.avgLandsInPlay[7]).toBeLessThan(
      forests.landDrops.avgLandsInPlay[7] - 0.3
    );
    expect(karoos.mana.average[7]).toBeGreaterThan(karoos.landDrops.avgLandsInPlay[6] + 0.3);
    expect(Math.abs(karoos.mana.average[7] - forests.mana.average[7])).toBeLessThan(0.8);
  });

  it('lets a lone Karoo return itself', () => {
    const r = run([
      ['Simic Growth Chamber', 40],
      ['Beast Within', 59],
    ]);
    expect(r.mana.average[3]).toBe(0);
    expect(r.landDrops.hitRate[3]).toBeGreaterThan(0.9);
  });

  it('waits for five lands before Temple of the False God taps', () => {
    const temples = run([
      ['Temple of the False God', 20],
      ['Wastes', 18],
      ['Thought-Knot Seer', 61],
    ]);
    const wastes = run([
      ['Wastes', 38],
      ['Thought-Knot Seer', 61],
    ]);
    expect(temples.mana.average[3]).toBeLessThan(wastes.mana.average[3] - 0.5);
    expect(temples.mana.average[8]).toBeGreaterThan(wastes.mana.average[8]);
    expect(row(temples, 'Thought-Knot Seer').onCurveGivenMana).toBeGreaterThan(0.9);
  });

  it('reads fast lands as early lands and slow lands as late ones', () => {
    const fast = run([
      ['Seachrome Coast', 38],
      ['Swords to Plowshares', 61],
    ]);
    const slow = run([
      ['Deserted Beach', 38],
      ['Swords to Plowshares', 61],
    ]);
    expect(fast.mana.average[1]).toBeGreaterThan(0.9);
    expect(slow.mana.average[1]).toBe(0);
    expect(fast.mana.average[6]).toBeLessThan(slow.mana.average[6]);
  });

  it('untaps check lands, tango lands and snarls once their condition holds', () => {
    // A curve that wants every mana, so the policy never has a free turn to
    // spend on a tapped land.
    const curve: List = [
      ['Swords to Plowshares', 15],
      ['Wall of Omens', 15],
      ['Banishing Light', 16],
      ['Wrath of God', 15],
    ];
    for (const dual of ['Glacial Fortress', 'Prairie Stream', 'Port Town']) {
      const alone = run([[dual, 38], ...curve]);
      const withBasics = run([[dual, 19], ['Plains', 19], ...curve]);
      expect(alone.mana.average[4], dual).toBeLessThan(withBasics.mana.average[4] - 0.3);
    }
  });

  it('untaps a legendary-condition land once a legendary creature is down', () => {
    const commander = ['Sisay, Weatherlight Captain'];
    const r = run(
      [
        ['Minas Tirith', 38],
        ['Swords to Plowshares', 61],
      ],
      {},
      commander
    );
    const plains = run(
      [
        ['Plains', 38],
        ['Swords to Plowshares', 61],
      ],
      {},
      commander
    );
    // Tapped until Sisay lands (turn 4 at the earliest off tapped lands)...
    expect(r.mana.average[1]).toBe(0);
    expect(r.mana.average[3]).toBeLessThan(plains.mana.average[3] - 0.7);
    // ...then every new one enters untapped and the gap closes.
    expect(r.mana.average[7]).toBeGreaterThan(plains.mana.average[7] - 0.35);
  });

  it('chooses the colour a Thriving land or Pathway makes as it enters', () => {
    const r = run(
      [
        ['Thriving Isle', 19],
        ['Island', 19],
        ['Wrath of God', 61],
      ],
      {},
      ['Jodah, the Unifier']
    );
    // In a five-colour deck Thriving Isle could name any of four colours; it
    // names white, the one the Wraths need, or they could never be cast.
    expect(row(r, 'Wrath of God').nextTurnGivenMana ?? 0).toBeGreaterThan(0.5);
    const path = run(
      [
        ['Hengegate Pathway', 38],
        ['Absorb', 61],
      ],
      {},
      ['Brago, King Eternal']
    );
    expect(row(path, 'Absorb').onCurveGivenMana ?? 0).toBeGreaterThan(0.9);
  });

  it('plays a spell//land MDFC as the land drop when no land is in hand', () => {
    const r = run([
      ['Bala Ged Recovery', 40],
      ['Beast Within', 59],
    ]);
    expect(r.landDrops.hitRate[2]).toBeGreaterThan(0.9);
    expect(row(r, 'Bala Ged Recovery // Bala Ged Sanctuary').mv).toBe(3);
  });

  it('ignores a land that makes no mana for castability', () => {
    const r = run([
      ['Maze of Ith', 20],
      ['Forest', 18],
      ['Beast Within', 61],
    ]);
    expect(r.landDrops.hitRate[1]).toBeGreaterThan(0.9);
    expect(row(r, 'Beast Within').onCurveGivenMana).toBe(1);
  });
});

describe('ramp', () => {
  const base: List = [
    ['Forest', 36],
    ['Beast Within', 43],
  ];
  const withRamp = (name: string, n = 20) => run([...base, [name, n]]);
  const plain = run([...base, ['Eternal Witness', 20]]);

  it('adds a rock the turn it is cast', () => {
    expect(withRamp('Sol Ring').mana.average[2]).toBeGreaterThan(plain.mana.average[2] + 0.5);
  });

  it('adds a dork from the next turn', () => {
    const elves = withRamp('Llanowar Elves');
    expect(elves.mana.average[2]).toBeGreaterThan(plain.mana.average[2] + 0.3);
  });

  it('spends Mana Vault once', () => {
    const vault = withRamp('Mana Vault');
    const ring = withRamp('Sol Ring');
    expect(vault.mana.average[2]).toBeGreaterThan(plain.mana.average[2] + 0.5);
    // Sol Ring keeps giving; a spent Vault is gone.
    expect(vault.mana.average[8]).toBeLessThan(ring.mana.average[8] - 0.5);
  });

  it('puts lands in with land searches, tapped or not, and to hand', () => {
    for (const name of [
      'Cultivate',
      "Nature's Lore",
      'Harrow',
      'Explosive Vegetation',
      'Wood Elves',
    ]) {
      expect(withRamp(name).landDrops.avgLandsInPlay[6], name).toBeGreaterThan(
        plain.landDrops.avgLandsInPlay[6] + 0.3
      );
    }
  });

  it('makes Treasures that count as any colour', () => {
    // White comes only from Big Score's Treasures: cast on turn 4, they pay
    // Baneslayer's {W}{W} on turn 5.
    const r = run([
      ['Mountain', 36],
      ['Big Score', 30],
      ['Baneslayer Angel', 33],
    ]);
    expect(r.mana.average[5]).toBeGreaterThan(4);
    expect(row(r, 'Baneslayer Angel').onCurve ?? 0).toBeGreaterThan(0.05);
  });

  it('picks the colour of a choose-a-colour rock', () => {
    const r = run(
      [
        ['Plains', 36],
        ['Coldsteel Heart', 30],
        ['Rhystic Study', 33],
      ],
      {},
      ['Brago, King Eternal']
    );
    // Blue comes only from Hearts, so it must name blue.
    expect(row(r, 'Rhystic Study').onCurve ?? 0).toBeGreaterThan(0.1);
  });
});

describe('screw and flood', () => {
  it('floods a land-heavy list and starves a land-light one', () => {
    const heavy = run([
      ['Plains', 60],
      ['Swords to Plowshares', 39],
    ]);
    const light = run([
      ['Plains', 25],
      ['Swords to Plowshares', 74],
    ]);
    expect(heavy.flood.surplusLands).toBeGreaterThan(0.2);
    expect(heavy.flood.rate).toBeGreaterThan(0.05);
    expect(heavy.flood.rate).toBeLessThanOrEqual(heavy.flood.surplusLands);
    expect(light.screw.missedDropBy4).toBeGreaterThan(heavy.screw.missedDropBy4 + 0.3);
    expect(light.screw.missedDropBy3).toBeLessThanOrEqual(light.screw.missedDropBy4);
  });
});
