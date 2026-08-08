import { describe, it, expect } from 'vitest';
import { groupOwnedForTrade, filterOwnedLines, toTradeCard, toRequestedCard } from './trade-picker';
import type { EnrichedCard } from '../types';

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

describe('groupOwnedForTrade', () => {
  it('stacks printings of the same card into one line', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
      owned({ copyId: 'b', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-lcc' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].copies).toHaveLength(2);
  });

  it('excludes proxies — a proxy is not the card', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'real', name: 'Sol Ring', oracleId: 'o-sol' }),
      owned({ copyId: 'fake', name: 'Mana Crypt', oracleId: 'o-crypt', proxy: true }),
    ]);
    expect(lines.map((l) => l.name)).toEqual(['Sol Ring']);
  });

  it('keeps a legacy copy with no oracleId tradeable, keyed by name', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'legacy', name: 'Sol Ring', oracleId: undefined }),
      owned({ copyId: 'legacy2', name: 'sol ring', oracleId: undefined }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].copies).toHaveLength(2);
  });

  it('sorts by name', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'a', name: 'Zur', oracleId: 'o-zur' }),
      owned({ copyId: 'b', name: 'Arcane Signet', oracleId: 'o-sig' }),
    ]);
    expect(lines.map((l) => l.name)).toEqual(['Arcane Signet', 'Zur']);
  });
});

describe('filterOwnedLines', () => {
  const lines = groupOwnedForTrade([
    owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol' }),
    owned({ copyId: 'b', name: 'Arcane Signet', oracleId: 'o-sig' }),
  ]);

  it('matches a case-insensitive substring', () => {
    expect(filterOwnedLines(lines, 'sig').map((l) => l.name)).toEqual(['Arcane Signet']);
  });

  it('returns everything for a blank query', () => {
    expect(filterOwnedLines(lines, '   ')).toHaveLength(2);
  });
});

describe('toTradeCard', () => {
  const line = groupOwnedForTrade([
    owned({
      copyId: 'a',
      name: 'Sol Ring',
      oracleId: 'o-sol',
      scryfallId: 'scry-c21',
      finish: 'foil',
      condition: 'lp',
      language: 'ja',
    }),
    owned({ copyId: 'b', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-lcc' }),
  ])[0];

  it('names the exact copies going, with their printing detail', () => {
    const card = toTradeCard(line, 1);
    expect(card.quantity).toBe(1);
    expect(card.copies).toEqual([
      { scryfallId: 'scry-c21', finish: 'foil', condition: 'lp', language: 'ja' },
    ]);
  });

  it('omits condition and language when the copy has none', () => {
    const card = toTradeCard(line, 2);
    expect(card.copies[1]).toEqual({ scryfallId: 'scry-lcc', finish: 'nonfoil' });
  });

  it('clamps a quantity beyond what is owned', () => {
    const card = toTradeCard(line, 99);
    expect(card.quantity).toBe(2);
    expect(card.copies).toHaveLength(2);
  });
});

describe('toRequestedCard', () => {
  it('stays oracle-level — the friend resolves printings when they accept', () => {
    const card = toRequestedCard({ oracleId: 'o-rhystic', name: 'Rhystic Study' }, 2);
    expect(card).toEqual({
      oracleId: 'o-rhystic',
      name: 'Rhystic Study',
      quantity: 2,
      copies: [],
    });
  });
});
