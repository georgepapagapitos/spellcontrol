import { describe, expect, it } from 'vitest';
import { summarizeCostBasis } from './cost-basis';
import type { EnrichedCard } from '../types';

function card(over: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'Sol Ring',
    setCode: 'C21',
    setName: 'Commander 2021',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sid',
    purchasePrice: 10,
    sourceCategory: '',
    sourceFormat: 'manabox',
    finish: 'nonfoil',
    foil: false,
    ...over,
  };
}

describe('summarizeCostBasis', () => {
  it('sums basis and market over copies with both values', () => {
    const s = summarizeCostBasis(
      [
        card({ acquiredPrice: 4, purchasePrice: 10 }),
        card({ acquiredPrice: 6, purchasePrice: 15 }),
      ],
      'USD'
    );
    expect(s).toEqual({ covered: 2, total: 2, basis: 10, market: 25, gain: 15 });
  });

  it('reports a loss as a negative gain', () => {
    const s = summarizeCostBasis([card({ acquiredPrice: 30, purchasePrice: 12 })], 'USD');
    expect(s.gain).toBe(-18);
  });

  // The headline trap: without these exclusions a mostly-uncovered collection
  // reports its entire market value as profit.
  it('excludes copies with no recorded basis instead of treating them as free', () => {
    const s = summarizeCostBasis(
      [card({ acquiredPrice: 4, purchasePrice: 10 }), card({ purchasePrice: 500 })],
      'USD'
    );
    expect(s.covered).toBe(1);
    expect(s.total).toBe(2);
    expect(s.gain).toBe(6);
  });

  it('treats a zero basis as unrecorded, not as a free acquisition', () => {
    const s = summarizeCostBasis([card({ acquiredPrice: 0, purchasePrice: 500 })], 'USD');
    expect(s).toMatchObject({ covered: 0, basis: 0, market: 0, gain: 0 });
  });

  it('excludes unpriced printings so a missing market price is not a total loss', () => {
    const s = summarizeCostBasis([card({ acquiredPrice: 25, purchasePrice: 0 })], 'USD');
    expect(s).toMatchObject({ covered: 0, gain: 0 });
  });

  it('counts only copies whose basis currency matches the active currency', () => {
    const cards = [
      card({ acquiredPrice: 4, purchasePrice: 10 }),
      card({ acquiredPrice: 100, purchasePrice: 10, acquiredCurrency: 'EUR' }),
    ];
    expect(summarizeCostBasis(cards, 'USD')).toMatchObject({ covered: 1, basis: 4 });
    expect(summarizeCostBasis(cards, 'EUR')).toMatchObject({ covered: 1, basis: 100 });
  });

  it('treats an absent basis currency as USD', () => {
    const cards = [card({ acquiredPrice: 4, purchasePrice: 10 })];
    expect(summarizeCostBasis(cards, 'USD').covered).toBe(1);
    expect(summarizeCostBasis(cards, 'EUR').covered).toBe(0);
  });

  it('returns an empty summary for an empty collection', () => {
    expect(summarizeCostBasis([], 'USD')).toEqual({
      covered: 0,
      total: 0,
      basis: 0,
      market: 0,
      gain: 0,
    });
  });
});
