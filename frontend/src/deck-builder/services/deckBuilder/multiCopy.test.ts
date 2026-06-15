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
});
