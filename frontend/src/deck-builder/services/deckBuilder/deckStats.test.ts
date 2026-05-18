import { describe, it, expect } from 'vitest';
import { calculateStats } from './deckStats';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Test Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

function categories(
  partial: Partial<Record<DeckCategory, ScryfallCard[]>>
): Record<DeckCategory, ScryfallCard[]> {
  return {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
    ...partial,
  };
}

describe('calculateStats', () => {
  it('counts total cards across every category', () => {
    const stats = calculateStats(
      categories({
        creatures: [makeCard(), makeCard()],
        lands: [makeCard({ type_line: 'Land', colors: [] })],
      })
    );
    expect(stats.totalCards).toBe(3);
  });

  it('excludes lands from the mana curve and average CMC', () => {
    const stats = calculateStats(
      categories({
        creatures: [makeCard({ cmc: 2 }), makeCard({ cmc: 4 })],
        lands: [makeCard({ cmc: 0, type_line: 'Land', colors: [] })],
      })
    );
    expect(stats.averageCmc).toBe(3); // (2 + 4) / 2, land ignored
    expect(stats.manaCurve[2]).toBe(1);
    expect(stats.manaCurve[4]).toBe(1);
    expect(stats.manaCurve[0]).toBeUndefined();
  });

  it('caps the mana curve bucket at 7+', () => {
    const stats = calculateStats(
      categories({ creatures: [makeCard({ cmc: 9 }), makeCard({ cmc: 12 })] })
    );
    expect(stats.manaCurve[7]).toBe(2);
  });

  it('buckets colorless cards under "C"', () => {
    const stats = calculateStats(
      categories({ ramp: [makeCard({ colors: [], type_line: 'Artifact' })] })
    );
    expect(stats.colorDistribution['C']).toBe(1);
  });

  it('classifies type distribution by front face', () => {
    const stats = calculateStats(
      categories({
        creatures: [makeCard({ type_line: 'Creature' })],
        singleRemoval: [makeCard({ type_line: 'Instant', colors: ['U'] })],
        lands: [makeCard({ type_line: 'Land', colors: [] })],
      })
    );
    expect(stats.typeDistribution['Creature']).toBe(1);
    expect(stats.typeDistribution['Instant']).toBe(1);
    expect(stats.typeDistribution['Land']).toBe(1);
  });

  it('counts an MDFC land toward both its front-face type and Land', () => {
    const mdfc = makeCard({
      type_line: 'Creature // Land',
      card_faces: [
        { name: 'Front', type_line: 'Creature' },
        { name: 'Back', type_line: 'Land' },
      ],
      isMdfcLand: true,
      colors: ['G'],
    });
    const stats = calculateStats(categories({ creatures: [mdfc] }));
    expect(stats.typeDistribution['Creature']).toBe(1);
    expect(stats.typeDistribution['Land']).toBe(1);
  });
});
