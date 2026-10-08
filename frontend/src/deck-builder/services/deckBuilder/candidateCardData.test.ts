// Guard (T171 lane M): the rows Coach may suggest carry the price and rarity
// the deck's settings are checked against, and a colorless land's fixing is
// recorded as none, not unknown (Karn's Bastion was offered as the cheaper
// swap for Indatha Triome because "unknown" passes the budget lane's fixing
// floor). Real cards (Scryfall 2026-09-29).
import { describe, it, expect, vi } from 'vitest';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import type { RecommendedCard } from './deckAnalyzer';
import { COACH_CARDS as COACH_BASE } from './__fixtures__/coach-cards.fixtures';
import landFixture from '@/lib/mana-sim/__fixtures__/land-abilities.fixture.json';

// E585: Power Depot's {T} mana is {C}; its any-colour mana is artifact-only.
const COACH_CARDS: Record<string, ScryfallCard> = {
  ...Object.fromEntries((landFixture.cards as unknown as ScryfallCard[]).map((c) => [c.name, c])),
  ...COACH_BASE,
};

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardsByNames: vi.fn(async (names: string[]) => {
    const out = new Map<string, ScryfallCard>();
    for (const n of names) if (COACH_CARDS[n]) out.set(n, { ...COACH_CARDS[n] });
    return out;
  }),
}));

import { enrichRecommendationPrices, stampCandidateCardData } from './candidateCardData';

const resolve = async (names: string[]) => {
  const out = new Map<string, ScryfallCard>();
  for (const n of names) if (COACH_CARDS[n]) out.set(n, { ...COACH_CARDS[n] });
  return out;
};

describe('stampCandidateCardData', () => {
  it('stamps price and rarity on gap rows and returns the loose names', async () => {
    const gaps: GapAnalysisCard[] = [
      { name: 'Swords to Plowshares', price: null, inclusion: 60, synergy: 0, typeLine: 'Instant' },
      { name: 'Not A Card', price: null, inclusion: 10, synergy: 0, typeLine: 'Instant' },
    ];
    const loose = await stampCandidateCardData(
      { gaps, loose: ['Beast Within', 'Also Not A Card'], inclusionOf: () => 22 },
      resolve
    );
    expect(gaps[0]).toMatchObject({ price: '1.02', rarity: 'uncommon' });
    expect(gaps[1]).toMatchObject({ price: null });
    expect(gaps[1].rarity).toBeUndefined();
    expect(loose).toEqual({
      'Beast Within': {
        price: COACH_CARDS['Beast Within'].prices?.usd,
        rarity: 'uncommon',
        inclusion: 22,
      },
    });
  });

  it('keeps a price the row already had', async () => {
    const gaps: GapAnalysisCard[] = [
      {
        name: 'Swords to Plowshares',
        price: '0.99',
        inclusion: 60,
        synergy: 0,
        typeLine: 'Instant',
      },
    ];
    await stampCandidateCardData({ gaps }, resolve);
    expect(gaps[0].price).toBe('0.99');
  });
});

describe('enrichRecommendationPrices', () => {
  it("records a colorless land's fixing as none, so the budget floor can reject it", async () => {
    const recs = [
      { name: "Karn's Bastion", inclusion: 60, primaryType: 'Land' },
      { name: 'Overgrown Tomb', inclusion: 40, primaryType: 'Land' },
    ] as RecommendedCard[];
    await enrichRecommendationPrices(recs);
    expect(recs[0].producedColors).toEqual([]);
    expect(recs[1].producedColors?.sort()).toEqual(['B', 'G']);
  });

  it('reads a land the way it taps: Power Depot and Springjack Pasture fix nothing, City of Brass keeps five', async () => {
    const recs = [
      { name: 'Power Depot', inclusion: 30, primaryType: 'Land' },
      { name: 'Springjack Pasture', inclusion: 30, primaryType: 'Land' },
      { name: 'City of Brass', inclusion: 30, primaryType: 'Land' },
    ] as RecommendedCard[];
    await enrichRecommendationPrices(recs);
    expect(recs[0].producedColors).toEqual([]);
    expect(recs[1].producedColors).toEqual([]);
    expect(recs[2].producedColors?.sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
  });
});
