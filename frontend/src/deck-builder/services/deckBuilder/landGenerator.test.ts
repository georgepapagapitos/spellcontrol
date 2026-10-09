import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';

function card(name: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 0,
    type_line: 'Basic Land',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  };
}

function sc(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  CHANNEL_LANDS: {},
  getCardsByNames: vi.fn(async () => new Map()),
  upgradeCardPrintings: vi.fn(async () => {}),
  isChannelLand: vi.fn(() => false),
  isMdfcLand: vi.fn(() => false),
  getCardByName: vi.fn(async (name: string) => card(name)),
  getCachedCard: vi.fn((name: string) => card(name)),
  getCardPrice: vi.fn(() => null),
  getFrontFaceTypeLine: vi.fn((c: ScryfallCard) => c.card_faces?.[0]?.type_line ?? c.type_line),
  searchCards: vi.fn(async () => ({ data: [] })),
  // Without it the merit widen threw inside its try and never ran here.
  commanderSearchIdentity: vi.fn((identity: string[]) => identity),
}));

vi.mock('@/deck-builder/services/tagger/client', () => ({
  isTapland: vi.fn(() => false),
}));

import { countColorPips, generateLands } from './landGenerator';
import {
  getCardsByNames,
  getCachedCard,
  getCardByName,
  getCardPrice,
  searchCards,
} from '@/deck-builder/services/scryfall/client';

const REAL = new Map<string, ScryfallCard>(
  (
    JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          '__fixtures__',
          'invariant-cards.fixture.json'
        ),
        'utf8'
      )
    ) as { cards: ScryfallCard[] }
  ).cards.map((c) => [c.name, c])
);
const real = (name: string): ScryfallCard => structuredClone(REAL.get(name)!);

/** generateLands with everything past `maxCardPrice` at its default. */
function landsFor(
  edhrecLands: EDHRECCard[],
  colorIdentity: string[],
  count: number,
  basicCount: number,
  maxCardPrice: number | null
) {
  return generateLands(
    edhrecLands,
    colorIdentity,
    count,
    new Set(),
    basicCount,
    99,
    [],
    undefined,
    new Set(),
    maxCardPrice
  );
}

describe('countColorPips', () => {
  it('counts colored mana symbols, ignoring generic', () => {
    const pips = countColorPips([sc({ mana_cost: '{2}{G}{G}{U}' })]);
    expect(pips).toEqual({ G: 2, U: 1 });
  });

  it('counts every color in a hybrid symbol', () => {
    const pips = countColorPips([sc({ mana_cost: '{W/U}{2/R}{G/P}' })]);
    expect(pips).toEqual({ W: 1, U: 1, R: 1, G: 1 });
  });

  it('aggregates across both faces of a double-faced card', () => {
    const dfc = sc({
      mana_cost: undefined,
      card_faces: [
        { name: 'Front', type_line: 'Creature', mana_cost: '{B}{B}' },
        { name: 'Back', type_line: 'Creature', mana_cost: '{R}' },
      ],
    });
    expect(countColorPips([dfc])).toEqual({ B: 2, R: 1 });
  });

  it('returns an empty record for cards with no mana cost', () => {
    expect(countColorPips([sc({ mana_cost: undefined })])).toEqual({});
  });

  it('sums pips across the whole card list', () => {
    const pips = countColorPips([sc({ mana_cost: '{G}' }), sc({ mana_cost: '{G}{W}' })]);
    expect(pips).toEqual({ G: 2, W: 1 });
  });
});

describe('generateLands', () => {
  it('enforces the game-changer cap on lands and flags a picked GC land', async () => {
    const fotd = sc({ name: 'Field of the Dead', type_line: 'Land', cmc: 0 });
    const edhrecLands = [
      {
        name: 'Field of the Dead',
        sanitized: 'field-of-the-dead',
        primary_type: 'Land',
        inclusion: 60,
        num_decks: 1000,
      },
    ];

    // Cap already spent → the GC land must NOT slip in through the land phase.
    vi.mocked(getCardsByNames).mockResolvedValueOnce(new Map([['Field of the Dead', fotd]]));
    const gatesBlocked = {
      gameChangerNames: new Set(['Field of the Dead']),
      gameChangerCount: { value: 0 },
      maxGameChangers: 0,
    };
    const blocked = await generateLands(
      edhrecLands,
      ['W'],
      3,
      new Set(),
      2,
      99,
      [],
      undefined,
      new Set(),
      null,
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      false,
      '',
      undefined,
      'full',
      100,
      false,
      false,
      'balanced',
      undefined,
      undefined,
      gatesBlocked
    );
    expect(blocked.map((c) => c.name)).not.toContain('Field of the Dead');
    expect(gatesBlocked.gameChangerCount.value).toBe(0);

    // Cap open → picked, FLAGGED, and counted against the shared running total.
    vi.mocked(getCardsByNames).mockResolvedValueOnce(new Map([['Field of the Dead', fotd]]));
    const gatesOpen = {
      gameChangerNames: new Set(['Field of the Dead']),
      gameChangerCount: { value: 0 },
      maxGameChangers: 2,
    };
    const allowed = await generateLands(
      edhrecLands,
      ['W'],
      3,
      new Set(),
      2,
      99,
      [],
      undefined,
      new Set(),
      null,
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      false,
      '',
      undefined,
      'full',
      100,
      false,
      false,
      'balanced',
      undefined,
      undefined,
      gatesOpen
    );
    const picked = allowed.find((c) => c.name === 'Field of the Dead');
    expect(picked?.isGameChanger).toBe(true);
    expect(gatesOpen.gameChangerCount.value).toBe(1);
  });

  // E-arena-leak: nonbasic utility/storage lands (e.g. Dreadship Reef) come
  // straight from the EDHREC per-commander cardlist — LIVE-CONFIRMED shipping
  // under arenaOnly with games: ['paper', 'mtgo']. The higher-inclusion
  // off-Arena land must be skipped in favor of the on-Arena one.
  it('skips a nonbasic land not available on Arena under arenaOnly', async () => {
    const offArena = sc({
      name: 'Dreadship Reef',
      type_line: 'Land',
      cmc: 0,
      games: ['paper', 'mtgo'],
    });
    const onArena = sc({
      name: 'Reliquary Tower',
      type_line: 'Land',
      cmc: 0,
      games: ['paper', 'arena'],
    });
    const edhrecLands = [
      {
        name: 'Dreadship Reef',
        sanitized: 'dreadship-reef',
        primary_type: 'Land',
        inclusion: 80,
        num_decks: 1000,
      },
      {
        name: 'Reliquary Tower',
        sanitized: 'reliquary-tower',
        primary_type: 'Land',
        inclusion: 40,
        num_decks: 1000,
      },
    ];
    vi.mocked(getCardsByNames).mockResolvedValueOnce(
      new Map([
        ['Dreadship Reef', offArena],
        ['Reliquary Tower', onArena],
      ])
    );
    const lands = await generateLands(
      edhrecLands,
      ['W'],
      1,
      new Set(),
      0,
      99,
      [],
      undefined,
      new Set(),
      null,
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      true // arenaOnly
    );
    const names = lands.map((c) => c.name);
    expect(names).not.toContain('Dreadship Reef');
    expect(names).toContain('Reliquary Tower');
  });

  it('boosts lands covering the deck’s weighted color demand over off-color utility', async () => {
    // Equal inclusion; the colorless utility land is listed FIRST (wins any tie).
    const wLand = sc({ name: 'Rustvale Bridge', type_line: 'Land', produced_mana: ['W'] });
    const utility = sc({ name: 'Detection Tower', type_line: 'Land', produced_mana: ['C'] });
    vi.mocked(getCardsByNames).mockResolvedValueOnce(
      new Map([
        ['Detection Tower', utility],
        ['Rustvale Bridge', wLand],
      ])
    );
    const edhrecLands = ['Detection Tower', 'Rustvale Bridge'].map((name) => ({
      name,
      sanitized: name.toLowerCase(),
      primary_type: 'Land',
      inclusion: 50,
      num_decks: 1000,
    }));
    const lands = await generateLands(
      edhrecLands,
      ['W'],
      2,
      new Set(),
      1,
      99,
      [sc({ name: 'Adanto Vanguard', mana_cost: '{W}{W}', cmc: 2 })],
      undefined,
      new Set(),
      null,
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      false,
      '',
      undefined,
      'full'
    );
    // One nonbasic slot: the W-producing land must beat the off-color utility.
    expect(lands.map((c) => c.name)).toContain('Rustvale Bridge');
    expect(lands.map((c) => c.name)).not.toContain('Detection Tower');
  });

  it('E118: withholds merit fixing credit when the deck has no unmet color need', async () => {
    // Equal inclusion; the tapped 2-color gate is listed FIRST (wins any tie),
    // so only the merit boost can decide the single nonbasic slot.
    const bgGate = sc({
      name: 'Golgari Guildgate',
      type_line: 'Land — Gate',
      produced_mana: ['B', 'G'],
      oracle_text: 'Golgari Guildgate enters the battlefield tapped.\n{T}: Add {B} or {G}.',
    });
    const utility = sc({
      name: 'Grim Backwoods',
      type_line: 'Land',
      produced_mana: ['C'],
      oracle_text: '{T}: Add {C}.\n{2}, {T}, Sacrifice a creature: Draw a card.',
    });
    const edhrecLands = ['Golgari Guildgate', 'Grim Backwoods'].map((name) => ({
      name,
      sanitized: name.toLowerCase(),
      primary_type: 'Land',
      inclusion: 50,
      num_decks: 1000,
    }));
    const asMap = () =>
      new Map([
        ['Golgari Guildgate', bgGate],
        ['Grim Backwoods', utility],
      ]);

    // Zero colored pips (rocks only) → no color still needs sources → the
    // gate's 2-color fixing merit is withheld and the utility land's
    // colorless+upside merit wins the slot.
    const rocks = Array.from({ length: 3 }, (_, i) =>
      sc({
        name: `Rock ${i}`,
        type_line: 'Artifact',
        mana_cost: '{2}',
        cmc: 2,
        produced_mana: ['B', 'G'],
        oracle_text: '{T}: Add {B} or {G}.',
      })
    );
    vi.mocked(getCardsByNames).mockResolvedValueOnce(asMap());
    const covered = await generateLands(edhrecLands, ['B', 'G'], 2, new Set(), 1, 99, rocks);
    expect(covered.map((c) => c.name)).toContain('Grim Backwoods');
    expect(covered.map((c) => c.name)).not.toContain('Golgari Guildgate');

    // Control: real B/G pip demand with no assured sources → both colors still
    // need fixing → the gate's full fixing merit (+ color-demand boost) wins.
    const pipCards = Array.from({ length: 10 }, (_, i) =>
      sc({ name: `Creature ${i}`, mana_cost: '{B}{G}', cmc: 3 })
    );
    vi.mocked(getCardsByNames).mockResolvedValueOnce(asMap());
    const needed = await generateLands(edhrecLands, ['B', 'G'], 2, new Set(), 1, 99, pipCards);
    expect(needed.map((c) => c.name)).toContain('Golgari Guildgate');
    expect(needed.map((c) => c.name)).not.toContain('Grim Backwoods');
  });

  it('caps basic lands to available free copies in available-only mode', async () => {
    const lands = await generateLands(
      [],
      ['W'],
      5,
      new Set(),
      5,
      99,
      [],
      undefined,
      new Set(),
      null,
      null,
      null,
      null,
      new Set(['Plains']),
      new Map([['Plains', 1]]),
      'USD',
      false,
      '',
      undefined,
      'available'
    );

    expect(lands.map((c) => c.name)).toEqual(['Plains']);
  });

  it('splits basics by weighted residual demand — early double-pips pull sources, splash keeps a floor', async () => {
    // W: two {W}{W} two-drops (weighted 6.5) · U: one {4}{U} five-drop (1.0).
    const nonland = [
      sc({ name: 'Knight of the White Orchid', mana_cost: '{W}{W}', cmc: 2 }),
      sc({ name: 'Adanto Vanguard', mana_cost: '{W}{W}', cmc: 2 }),
      sc({ name: 'Late Blue', mana_cost: '{4}{U}', cmc: 5 }),
    ];
    const lands = await generateLands([], ['W', 'U'], 6, new Set(), 6, 99, nonland);
    const names = lands.map((c) => c.name);
    // Command Tower auto-adds for 2+ colors, leaving 5 basic slots: W-heavy
    // early demand takes 3, but the U splash keeps its 2-source floor (the old
    // raw-pip split would have given U a single Island).
    expect(names.filter((n) => n === 'Plains')).toHaveLength(3);
    expect(names.filter((n) => n === 'Island')).toHaveLength(2);
    expect(names).toContain('Command Tower');
  });

  // E-arena-leak: Command Tower is auto-added with NO legality check at all —
  // LIVE-CONFIRMED a brawl (60-card) build could ship a not-legal-in-brawl
  // named staple. mtgFormat must thread through to this pick.
  it('skips Command Tower when it is not legal in the active format', async () => {
    vi.mocked(getCardByName).mockImplementationOnce(async (name: string) => ({
      ...card(name),
      legalities: { commander: 'legal', brawl: 'not_legal' },
    }));
    const lands = await generateLands(
      [],
      ['W', 'U'],
      2,
      new Set(),
      0,
      99,
      [],
      undefined,
      new Set(),
      null,
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      false,
      '',
      undefined,
      'full',
      100,
      false,
      false,
      'balanced',
      undefined,
      undefined,
      undefined,
      null,
      'brawl'
    );
    expect(lands.map((c) => c.name)).not.toContain('Command Tower');
  });

  it('splits basics across owned printings by available count (largest group first)', async () => {
    const lands = await generateLands(
      [],
      ['G'],
      5,
      new Set(),
      5,
      99,
      [], // no non-land cards → even split, single color gets all 5
      undefined,
      new Set(),
      null,
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      false,
      '',
      undefined,
      'full',
      100,
      false,
      false,
      'balanced',
      undefined,
      new Map([
        [
          'Forest',
          [
            { scryfallId: 'sf-A', set: 'A', collectorNumber: '1', setName: 'A', count: 3 },
            { scryfallId: 'sf-B', set: 'B', collectorNumber: '2', setName: 'B', count: 2 },
          ],
        ],
      ])
    );

    expect(lands.map((c) => c.id)).toEqual(['sf-A', 'sf-A', 'sf-A', 'sf-B', 'sf-B']);
    // set/collector_number track the stamped printing so the deck view groups them.
    expect(lands.map((c) => c.set)).toEqual(['A', 'A', 'A', 'B', 'B']);
  });

  it('reallocates a color whose basic fetch fails twice to an already-fetched basic, still hitting count exactly', async () => {
    // Island is never cached and always throws — simulates the fetch failure
    // that used to silently drop that color's whole allocation (Fix 1
    // hardening, iter-6 Slice B).
    vi.mocked(getCachedCard).mockImplementation((name: string) =>
      name === 'Island' ? undefined : card(name)
    );
    vi.mocked(getCardByName).mockImplementation(async (name: string) => {
      if (name === 'Island') throw new Error('scryfall down');
      return card(name);
    });

    try {
      // Command Tower auto-adds (2+ colors, format 99), leaving 3 basic
      // slots split W=2/U=1 with no pip demand (even split, W first).
      const lands = await generateLands([], ['W', 'U'], 4, new Set(), 4, 99, []);

      expect(lands).toHaveLength(4); // full count delivered despite Island failing both attempts
      expect(lands.filter((c) => c.name === 'Island')).toHaveLength(0);
      expect(lands.filter((c) => c.name === 'Command Tower')).toHaveLength(1);
      // U's would-be Island count (1) reallocates onto Plains, the first
      // basic that fetched successfully: 2 (own) + 1 (reallocated) = 3.
      expect(lands.filter((c) => c.name === 'Plains')).toHaveLength(3);
    } finally {
      vi.mocked(getCachedCard).mockImplementation((name: string) => card(name));
      vi.mocked(getCardByName).mockImplementation(async (name: string) => card(name));
    }
  });
});

describe('generateLands hard gates on real cards', () => {
  const realPrices = (c: ScryfallCard, currency?: 'USD' | 'EUR') =>
    (currency === 'EUR' ? c.prices?.eur : c.prices?.usd) ?? null;

  // E526: the stress row "atraxa impossible" (maxCardPrice 0.5, arenaOnly)
  // shipped Command Tower at $0.56. Its named pick checked legality alone.
  it('holds Command Tower to the max card price', async () => {
    vi.mocked(getCardPrice).mockImplementation(realPrices);
    vi.mocked(getCardByName).mockImplementation(async (name: string) =>
      name === 'Command Tower' ? real('Command Tower') : card(name)
    );
    try {
      const capped = await landsFor([], ['W', 'U', 'B', 'G'], 4, 0, 0.5);
      expect(capped.map((c) => c.name)).not.toContain('Command Tower');
      const roomy = await landsFor([], ['W', 'U', 'B', 'G'], 4, 0, 0.6);
      expect(roomy.map((c) => c.name)).toContain('Command Tower');
    } finally {
      vi.mocked(getCardPrice).mockImplementation(() => null);
      vi.mocked(getCardByName).mockImplementation(async (name: string) => card(name));
    }
  });

  // E525: the merit widen's `t:land (o:{W} ...)` query matches Legion's
  // Landing, whose back face is a white-producing land. The front face is an
  // enchantment, so it is not a land drop.
  it('never seats a card from the merit widen whose front face is not a land', async () => {
    vi.mocked(getCardsByNames).mockResolvedValueOnce(
      new Map([['Seat of the Synod', real('Seat of the Synod')]])
    );
    vi.mocked(searchCards).mockResolvedValueOnce({
      data: [real("Legion's Landing // Adanto, the First Fort"), real('Seat of the Synod')],
    } as Awaited<ReturnType<typeof searchCards>>);
    const edhrecLands: EDHRECCard[] = [
      {
        name: 'Seat of the Synod',
        sanitized: 'seat-of-the-synod',
        primary_type: 'Land',
        inclusion: 40,
        num_decks: 1000,
      },
    ];
    const lands = await landsFor(edhrecLands, ['W', 'U'], 3, 1, null);
    const names = lands.map((c) => c.name);
    expect(names).toContain('Seat of the Synod');
    expect(names).not.toContain("Legion's Landing // Adanto, the First Fort");
  });
});

describe('E585: a 40%+ staple keeps its slot when its paid color no longer counts', () => {
  it('seats Phyrexian Tower (41.8% on Meren) over Exotic Orchard (22.7%)', async () => {
    const fx = JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          'deckObjective',
          '__fixtures__',
          'objective.fixture.json'
        ),
        'utf8'
      )
    ) as {
      cards: ScryfallCard[];
      merenPage: Record<string, { inclusion: number; num_decks: number }>;
    };
    const byName = new Map(fx.cards.map((c) => [c.name, c]));
    const names = ['Exotic Orchard', 'Phyrexian Tower'];
    vi.mocked(getCardsByNames).mockResolvedValueOnce(
      new Map(names.map((n) => [n, structuredClone(byName.get(n)!)]))
    );
    const edhrecLands = names.map((name) => ({
      name,
      sanitized: name.toLowerCase(),
      primary_type: 'Land',
      inclusion: fx.merenPage[name].inclusion,
      num_decks: fx.merenPage[name].num_decks,
    }));
    const lands = await generateLands(
      edhrecLands,
      ['B', 'G'],
      2,
      new Set(),
      1,
      99,
      [sc({ name: 'Costly Plunder', mana_cost: '{B}{B}{B}{B}{G}', cmc: 5 })],
      undefined,
      new Set(),
      null
    );
    expect(lands.map((c) => c.name)).toContain('Phyrexian Tower');
    expect(lands.map((c) => c.name)).not.toContain('Exotic Orchard');
  });
});
