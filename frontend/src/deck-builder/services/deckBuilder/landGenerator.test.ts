import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

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
  getFrontFaceTypeLine: vi.fn((c: ScryfallCard) => c.type_line),
  searchCards: vi.fn(async () => ({ data: [] })),
}));

vi.mock('@/deck-builder/services/tagger/client', () => ({
  isTapland: vi.fn(() => false),
}));

import { countColorPips, generateLands } from './landGenerator';
import {
  getCardsByNames,
  getCachedCard,
  getCardByName,
} from '@/deck-builder/services/scryfall/client';

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
