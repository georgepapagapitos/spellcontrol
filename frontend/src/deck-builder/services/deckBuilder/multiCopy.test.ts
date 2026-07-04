import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

function card(name: string): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line: 'Creature',
    oracle_text: 'A deck can have any number of cards named Persistent Petitioners.',
    color_identity: ['U'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  };
}

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  fetchMultiCopyCardNames: vi.fn(async () => new Map([['Persistent Petitioners', null]])),
  getCardByName: vi.fn(async (name: string) => card(name)),
  getCardPrice: vi.fn(() => null),
}));

vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchAverageDeckMultiCopies: vi.fn(async () => new Map([['Persistent Petitioners', 12]])),
}));

import { resolveMultiCopyCards } from './multiCopy';
import { BudgetTracker } from './budgetTracker';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';

describe('resolveMultiCopyCards', () => {
  it('caps available-only multi-copy additions to free collection copies', async () => {
    const result = await resolveMultiCopyCards(
      ['Persistent Petitioners'],
      'Bruvac the Grandiloquent',
      undefined,
      new Set(),
      100,
      new Set(),
      null,
      null,
      'USD',
      new Set(['Persistent Petitioners']),
      new Map([['Persistent Petitioners', 2]]),
      'available'
    );

    expect(result).toHaveLength(1);
    expect(result[0].copies).toHaveLength(2);
  });

  it('skips available-only multi-copy cards with no free collection copy', async () => {
    const result = await resolveMultiCopyCards(
      ['Persistent Petitioners'],
      'Bruvac the Grandiloquent',
      undefined,
      new Set(),
      100,
      new Set(),
      null,
      null,
      'USD',
      new Set(),
      new Map(),
      'available'
    );

    expect(result).toEqual([]);
  });

  // E79: a per-copy price check alone waves through a card that individually
  // clears maxCardPrice but whose full multi-copy quantity (12 copies here,
  // per the mocked EDHREC average deck) blows the remaining budget.
  it('gates the TOTAL cost of all copies against remaining budget, not per-copy price', async () => {
    vi.mocked(getCardPrice).mockReturnValue('2.00'); // $2/copy * 12 copies = $24
    const tracker = new BudgetTracker(10, 5, 'USD'); // only $10 left

    const result = await resolveMultiCopyCards(
      ['Persistent Petitioners'],
      'Bruvac the Grandiloquent',
      undefined,
      new Set(),
      100,
      new Set(),
      null,
      null,
      'USD',
      undefined,
      undefined,
      'full',
      false,
      tracker,
      false
    );

    expect(result).toEqual([]);
    vi.mocked(getCardPrice).mockReturnValue(null);
  });

  it('still adds the copies when their total fits the remaining budget', async () => {
    vi.mocked(getCardPrice).mockReturnValue('0.50'); // $0.50/copy * 12 copies = $6
    const tracker = new BudgetTracker(100, 5, 'USD');

    const result = await resolveMultiCopyCards(
      ['Persistent Petitioners'],
      'Bruvac the Grandiloquent',
      undefined,
      new Set(),
      100,
      new Set(),
      null,
      null,
      'USD',
      undefined,
      undefined,
      'full',
      false,
      tracker,
      false
    );

    expect(result).toHaveLength(1);
    expect(result[0].copies).toHaveLength(12);
    vi.mocked(getCardPrice).mockReturnValue(null);
  });
});
