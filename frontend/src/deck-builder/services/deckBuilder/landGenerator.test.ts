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
});
