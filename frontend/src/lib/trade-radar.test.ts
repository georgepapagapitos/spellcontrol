import { describe, it, expect } from 'vitest';
import { buildTradeRadar, buildWantRadar } from './trade-radar';
import { groupOwnedForTrade } from './trade-picker';
import type { FriendCard } from './cube/pool';
import type { EnrichedCard, ListDef, ListEntry } from '../types';

function friendCard(overrides: Partial<FriendCard> & { name: string }): FriendCard {
  return {
    oracleId: '',
    colors: [],
    cmc: 0,
    typeLine: 'Artifact',
    ...overrides,
  };
}

let entryCounter = 0;
function entry(overrides: Partial<ListEntry> & { name: string }): ListEntry {
  return {
    id: `e${entryCounter++}`,
    scryfallId: 'sf',
    setCode: 'tst',
    collectorNumber: '1',
    finish: 'nonfoil',
    quantity: 1,
    ...overrides,
  };
}

function list(name: string, entries: ListEntry[], order = 0): ListDef {
  return { id: `list-${name}`, name, entries, order, createdAt: 0, updatedAt: 0 };
}

describe('buildTradeRadar', () => {
  it('matches by oracleId when the entry carries one', () => {
    const friend = [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })];
    const lists = [list('Wants', [entry({ name: 'sol ring (misnamed)', oracleId: 'o-sol' })])];
    const matches = buildTradeRadar(lists, friend);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ name: 'Sol Ring', quantity: 1, listNames: ['Wants'] });
  });

  it('falls back to a case-insensitive name match without an oracleId', () => {
    const friend = [friendCard({ name: 'Lightning Bolt', oracleId: 'o-bolt' })];
    const lists = [list('Wants', [entry({ name: 'lightning BOLT' })])];
    expect(buildTradeRadar(lists, friend)).toHaveLength(1);
  });

  it('returns no match for cards the friend does not own', () => {
    const friend = [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })];
    const lists = [list('Wants', [entry({ name: 'Black Lotus', oracleId: 'o-lotus' })])];
    expect(buildTradeRadar(lists, friend)).toEqual([]);
  });

  it('aggregates the same card across lists — quantity summed, list names deduped in order', () => {
    const friend = [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })];
    const lists = [
      list('Commander wants', [
        entry({ name: 'Sol Ring', oracleId: 'o-sol', quantity: 2 }),
        entry({ name: 'Sol Ring', oracleId: 'o-sol' }),
      ]),
      list('Cube wants', [entry({ name: 'Sol Ring', oracleId: 'o-sol' })]),
    ];
    const matches = buildTradeRadar(lists, friend);
    expect(matches).toHaveLength(1);
    expect(matches[0].quantity).toBe(4);
    expect(matches[0].listNames).toEqual(['Commander wants', 'Cube wants']);
  });

  it('keeps the lowest target price across matching entries', () => {
    const friend = [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })];
    const lists = [
      list('A', [entry({ name: 'Sol Ring', oracleId: 'o-sol', targetPrice: 8 })]),
      list('B', [entry({ name: 'Sol Ring', oracleId: 'o-sol', targetPrice: 5 })]),
      list('C', [entry({ name: 'Sol Ring', oracleId: 'o-sol' })]),
    ];
    expect(buildTradeRadar(lists, friend)[0].targetPrice).toBe(5);
  });

  it('leaves targetPrice undefined when no entry sets one', () => {
    const friend = [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })];
    const lists = [list('A', [entry({ name: 'Sol Ring', oracleId: 'o-sol' })])];
    expect(buildTradeRadar(lists, friend)[0].targetPrice).toBeUndefined();
  });

  it('carries the currency of the winning target price', () => {
    const friend = [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })];
    const lists = [
      list('A', [entry({ name: 'Sol Ring', oracleId: 'o-sol', targetPrice: 8 })]),
      list('B', [entry({ name: 'Sol Ring', oracleId: 'o-sol', targetPrice: 5, currency: 'EUR' })]),
    ];
    const m = buildTradeRadar(lists, friend)[0];
    expect(m.targetPrice).toBe(5);
    expect(m.currency).toBe('EUR');
  });

  it('sorts matches by name and handles empty inputs', () => {
    const friend = [
      friendCard({ name: 'Zur the Enchanter', oracleId: 'o-zur' }),
      friendCard({ name: 'Arcane Signet', oracleId: 'o-sig' }),
    ];
    const lists = [
      list('Wants', [
        entry({ name: 'Zur the Enchanter', oracleId: 'o-zur' }),
        entry({ name: 'Arcane Signet', oracleId: 'o-sig' }),
      ]),
    ];
    expect(buildTradeRadar(lists, friend).map((m) => m.name)).toEqual([
      'Arcane Signet',
      'Zur the Enchanter',
    ]);
    expect(buildTradeRadar([], friend)).toEqual([]);
    expect(buildTradeRadar(lists, [])).toEqual([]);
  });

  it('floors non-positive or fractional quantities at 1', () => {
    const friend = [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })];
    const lists = [list('A', [entry({ name: 'Sol Ring', oracleId: 'o-sol', quantity: 0 })])];
    expect(buildTradeRadar(lists, friend)[0].quantity).toBe(1);
  });

  it('skips tracking lists — owned catalogues are not wants', () => {
    const friend = [friendCard({ name: 'Sol Ring', oracleId: 'o-sol' })];
    const tracking: ListDef = {
      ...list('Eligible commanders', [entry({ name: 'Sol Ring', oracleId: 'o-sol' })]),
      kind: 'tracking',
    };
    expect(buildTradeRadar([tracking], friend)).toEqual([]);
    // The same entries on a want list (explicit or default) still match.
    const want: ListDef = { ...tracking, kind: 'want' };
    expect(buildTradeRadar([want], friend)).toHaveLength(1);
  });
});

function owned(over: Partial<EnrichedCard> & { copyId: string; name: string }): EnrichedCard {
  return {
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: 'scry-default',
    purchasePrice: 0,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    ...over,
  } as EnrichedCard;
}

describe('buildWantRadar', () => {
  it('matches by oracleId and reports owned + spare counts', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol' }),
      owned({ copyId: 'b', name: 'Sol Ring', oracleId: 'o-sol' }),
    ]);
    const matches = buildWantRadar(
      [{ name: 'sol ring (their casing)', oracleId: 'o-sol' }],
      lines,
      new Map([['Sol Ring', 1]])
    );
    expect(matches).toEqual([{ name: 'Sol Ring', oracleId: 'o-sol', owned: 2, spare: 1 }]);
  });

  it('still matches a card with every copy committed — spare 0, not dropped', () => {
    const lines = groupOwnedForTrade([owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol' })]);
    const matches = buildWantRadar([{ name: 'Sol Ring', oracleId: 'o-sol' }], lines, new Map());
    expect(matches).toEqual([{ name: 'Sol Ring', oracleId: 'o-sol', owned: 1, spare: 0 }]);
  });

  it('falls back to a case-insensitive name match when either side lacks an oracleId', () => {
    const lines = groupOwnedForTrade([owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol' })]);
    expect(buildWantRadar([{ name: 'SOL RING', oracleId: '' }], lines, new Map())).toHaveLength(1);

    const legacyLines = groupOwnedForTrade([owned({ copyId: 'a', name: 'Sol Ring' })]);
    const matches = buildWantRadar(
      [{ name: 'sol ring', oracleId: 'o-sol' }],
      legacyLines,
      new Map()
    );
    expect(matches).toEqual([{ name: 'Sol Ring', oracleId: '', owned: 1, spare: 0 }]);
  });

  it('never surfaces a proxy — groupOwnedForTrade drops them before we index', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'a', name: 'Black Lotus', oracleId: 'o-lotus', proxy: true }),
    ]);
    expect(
      buildWantRadar([{ name: 'Black Lotus', oracleId: 'o-lotus' }], lines, new Map())
    ).toEqual([]);
  });

  it('emits one row per card even when the friend wants it from several lists', () => {
    const lines = groupOwnedForTrade([owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol' })]);
    const matches = buildWantRadar(
      [
        { name: 'Sol Ring', oracleId: 'o-sol' },
        { name: 'Sol Ring', oracleId: 'o-sol' },
      ],
      lines,
      new Map()
    );
    expect(matches).toHaveLength(1);
  });

  it('sorts spare-first, then by name — the cards you can hand over lead', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'a', name: 'Arcane Signet', oracleId: 'o-sig' }),
      owned({ copyId: 'b', name: 'Sol Ring', oracleId: 'o-sol' }),
      owned({ copyId: 'c', name: 'Zur the Enchanter', oracleId: 'o-zur' }),
    ]);
    const matches = buildWantRadar(
      [
        { name: 'Arcane Signet', oracleId: 'o-sig' },
        { name: 'Sol Ring', oracleId: 'o-sol' },
        { name: 'Zur the Enchanter', oracleId: 'o-zur' },
      ],
      lines,
      new Map([
        ['Sol Ring', 2],
        ['Zur the Enchanter', 1],
      ])
    );
    expect(matches.map((m) => m.name)).toEqual(['Sol Ring', 'Zur the Enchanter', 'Arcane Signet']);
  });

  it('handles empty inputs on either side', () => {
    const lines = groupOwnedForTrade([owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol' })]);
    expect(buildWantRadar([], lines, new Map())).toEqual([]);
    expect(buildWantRadar([{ name: 'Sol Ring', oracleId: 'o-sol' }], [], new Map())).toEqual([]);
  });
});
