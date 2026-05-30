import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { RecommendedCard } from './deckAnalyzer';

// Mock only getCardsByNames; keep the rest of the client real (the helper also
// uses getFrontFaceTypeLine).
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => {
  const actual = await orig<typeof import('@/deck-builder/services/scryfall/client')>();
  return {
    ...actual,
    getCardsByNames: vi.fn(async (names: string[]) => {
      const map = new Map<string, ScryfallCard>();
      for (const n of names) {
        if (n === 'Priced Creature') {
          map.set(n, {
            name: n,
            cmc: 4,
            type_line: 'Legendary Creature — Elf',
            prices: { usd: '2.50' },
          } as unknown as ScryfallCard);
        }
      }
      return map;
    }),
  };
});

import { enrichRecommendationPrices } from './commanderDeckAnalysis';

const rec = (over: Partial<RecommendedCard>): RecommendedCard =>
  ({
    name: 'x',
    inclusion: 30,
    synergy: 0,
    fillsDeficit: false,
    primaryType: 'Unknown',
    ...over,
  }) as RecommendedCard;

describe('enrichRecommendationPrices', () => {
  it('backfills price, cmc and primaryType from Scryfall when missing', async () => {
    const recs = [rec({ name: 'Priced Creature', primaryType: 'Unknown' })];
    await enrichRecommendationPrices(recs);
    expect(recs[0].price).toBe('2.50');
    expect(recs[0].cmc).toBe(4);
    // Supertype ("Legendary") stripped → first real type word.
    expect(recs[0].primaryType).toBe('Creature');
  });

  it('leaves already-populated fields untouched and no-ops when nothing is missing', async () => {
    const recs = [rec({ name: 'Priced Creature', price: '9.99', cmc: 1, primaryType: 'Artifact' })];
    await enrichRecommendationPrices(recs);
    expect(recs[0]).toMatchObject({ price: '9.99', cmc: 1, primaryType: 'Artifact' });
  });

  it('leaves a rec untouched when Scryfall has no match', async () => {
    const recs = [rec({ name: 'Unknown Card' })];
    await enrichRecommendationPrices(recs);
    expect(recs[0].price).toBeUndefined();
    expect(recs[0].cmc).toBeUndefined();
  });
});
