import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

// Preserve real pure helpers (getCardPrice/getFrontFaceTypeLine drive deckFilters);
// only searchCards is stubbed so we can drive fillWithScryfall deterministically.
const searchCards = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  searchCards: (...args: unknown[]) => searchCards(...args),
}));

import { fillWithScryfall } from './scryfallFill';

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

beforeEach(() => searchCards.mockReset());

describe('fillWithScryfall', () => {
  it('short-circuits without searching when count <= 0', async () => {
    const out = await fillWithScryfall('t:land', [], 0, new Set());
    expect(out).toEqual([]);
    expect(searchCards).not.toHaveBeenCalled();
  });

  it('respects count, skips used/banned, and records picked names', async () => {
    searchCards.mockResolvedValue({
      data: [sc({ name: 'A' }), sc({ name: 'Used' }), sc({ name: 'Banned' }), sc({ name: 'B' })],
    });
    const used = new Set<string>(['Used']);
    const out = await fillWithScryfall('t:creature', [], 2, used, new Set(['Banned']));
    expect(out.map((c) => c.name)).toEqual(['A', 'B']);
    expect(used.has('A')).toBe(true);
    expect(used.has('B')).toBe(true);
  });

  it('appends rarity / cmc / arena / user filters onto the query', async () => {
    searchCards.mockResolvedValue({ data: [] });
    await fillWithScryfall(
      'base',
      [],
      3,
      new Set(),
      new Set(),
      null,
      'rare',
      4,
      null,
      undefined,
      'USD',
      true,
      'set:mkm'
    );
    const sentQuery = searchCards.mock.calls[0][0] as string;
    expect(sentQuery).toContain('base');
    expect(sentQuery).toContain('r<=rare');
    expect(sentQuery).toContain('cmc<=4');
    expect(sentQuery).toContain('game:arena');
    expect(sentQuery).toContain('set:mkm');
  });
});
