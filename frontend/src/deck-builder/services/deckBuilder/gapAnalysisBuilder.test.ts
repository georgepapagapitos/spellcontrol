import { describe, it, expect, vi } from 'vitest';
import type { EDHRECCard, EDHRECCommanderData } from '@/deck-builder/types';

// Tagger data isn't loaded in the test env, so getCardRole() would always
// return null. Mock it so we can assert role/roleLabel enrichment.
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: (name: string) => {
    if (name === 'Sol Ring') return 'ramp';
    if (name === 'Swords to Plowshares') return 'removal';
    return null;
  },
}));

import { buildGapAnalysis } from './gapAnalysisBuilder';

function card(name: string, inclusion: number, over: Partial<EDHRECCard> = {}): EDHRECCard {
  return {
    name,
    sanitized: name,
    primary_type: 'Creature',
    inclusion,
    num_decks: 0,
    ...over,
  };
}

function edhrec(allNonLand: EDHRECCard[]): EDHRECCommanderData {
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 0,
      deckSize: 99,
      manaCurve: {},
      typeDistribution: {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 0,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 0, nonbasic: 0, total: 0 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand,
    },
    similarCommanders: [],
  };
}

describe('buildGapAnalysis', () => {
  it('ranks by inclusion descending', () => {
    const data = edhrec([card('Low', 10), card('High', 90), card('Mid', 50)]);
    const result = buildGapAnalysis(data, []);
    expect(result.map((c) => c.name)).toEqual(['High', 'Mid', 'Low']);
  });

  it('excludes cards already in the deck (commander included)', () => {
    const data = edhrec([
      card('Sol Ring', 90),
      card('Rhystic Study', 60),
      card('Cyclonic Rift', 50),
    ]);
    const result = buildGapAnalysis(data, ['Sol Ring', 'Krenko, Mob Boss']);
    expect(result.map((c) => c.name)).toEqual(['Rhystic Study', 'Cyclonic Rift']);
  });

  it('matches DFC front-face names against the deck list', () => {
    const data = edhrec([card('Esika, God of the Tree', 70), card('Other Card', 40)]);
    // Deck has the full DFC name; EDHREC lists the front face only.
    const result = buildGapAnalysis(data, ['Esika, God of the Tree // The Prismatic Bridge']);
    expect(result.map((c) => c.name)).toEqual(['Other Card']);
  });

  it('skips basic lands', () => {
    const data = edhrec([card('Forest', 99), card('Sol Ring', 90)]);
    const result = buildGapAnalysis(data, []);
    expect(result.map((c) => c.name)).toEqual(['Sol Ring']);
  });

  it('respects the limit', () => {
    const data = edhrec([card('A', 90), card('B', 80), card('C', 70), card('D', 60)]);
    const result = buildGapAnalysis(data, [], { limit: 2 });
    expect(result.map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('returns nothing for a non-positive limit', () => {
    const data = edhrec([card('A', 90)]);
    expect(buildGapAnalysis(data, [], { limit: 0 })).toEqual([]);
  });

  it('enriches role and roleLabel from the tagger', () => {
    const data = edhrec([
      card('Sol Ring', 90),
      card('Swords to Plowshares', 80),
      card('Mystery', 70),
    ]);
    const result = buildGapAnalysis(data, []);
    expect(result[0]).toMatchObject({ name: 'Sol Ring', role: 'ramp', roleLabel: 'Ramp' });
    expect(result[1]).toMatchObject({
      name: 'Swords to Plowshares',
      role: 'removal',
      roleLabel: 'Removal',
    });
    expect(result[2].role).toBeUndefined();
    expect(result[2].roleLabel).toBeUndefined();
  });

  it('carries price, synergy, cmc, type, and image from the EDHREC card', () => {
    const data = edhrec([
      card('Sol Ring', 90, {
        synergy: 0.42,
        cmc: 1,
        primary_type: 'Artifact',
        prices: { tcgplayer: { price: 1.23 } },
        image_uris: [{ normal: 'https://img/sol-ring.jpg' }],
      }),
    ]);
    const [g] = buildGapAnalysis(data, []);
    expect(g).toMatchObject({
      price: '1.23',
      synergy: 0.42,
      cmc: 1,
      typeLine: 'Artifact',
      imageUrl: 'https://img/sol-ring.jpg',
    });
  });

  it('falls back to cardkingdom price, then null', () => {
    const data = edhrec([
      card('CK Only', 90, { prices: { cardkingdom: { price: 2.5 } } }),
      card('No Price', 80),
    ]);
    const result = buildGapAnalysis(data, []);
    expect(result.find((c) => c.name === 'CK Only')?.price).toBe('2.50');
    expect(result.find((c) => c.name === 'No Price')?.price).toBeNull();
  });

  it('marks isOwned only when a collection is provided', () => {
    const data = edhrec([card('Sol Ring', 90), card('Rhystic Study', 60)]);
    const owned = buildGapAnalysis(data, [], { collectionNames: new Set(['Sol Ring']) });
    expect(owned.find((c) => c.name === 'Sol Ring')?.isOwned).toBe(true);
    expect(owned.find((c) => c.name === 'Rhystic Study')?.isOwned).toBe(false);

    const noCollection = buildGapAnalysis(data, []);
    expect(noCollection[0].isOwned).toBeUndefined();
  });

  describe('liftIndex (E71 slice 2)', () => {
    it('an absent liftIndex leaves output identical to inclusion-only ranking', () => {
      const data = edhrec([card('High', 90), card('Low', 10)]);
      const withIndex = buildGapAnalysis(data, []);
      const withoutIndex = buildGapAnalysis(data, [], { liftIndex: undefined });
      expect(withIndex).toEqual(withoutIndex);
      expect(withIndex.map((c) => c.name)).toEqual(['High', 'Low']);
      expect(withIndex.every((c) => c.liftedBy === undefined)).toBe(true);
    });

    it('breaks an EXACT inclusion tie by clusterScore, and attaches liftedBy', () => {
      const data = edhrec([card('Low Lift', 50), card('High Lift', 50)]);
      const liftIndex = new Map([['high lift', { clusterScore: 10, liftedBy: ['Sol Ring'] }]]);
      const result = buildGapAnalysis(data, [], { liftIndex });
      expect(result.map((c) => c.name)).toEqual(['High Lift', 'Low Lift']);
      expect(result.find((c) => c.name === 'High Lift')?.liftedBy).toEqual(['Sol Ring']);
      expect(result.find((c) => c.name === 'Low Lift')?.liftedBy).toBeUndefined();
    });

    it('never outranks a strictly higher-inclusion card, even with a huge clusterScore', () => {
      const data = edhrec([card('Staple', 90), card('Fringe', 5)]);
      const liftIndex = new Map([['fringe', { clusterScore: 999, liftedBy: ['Cmd'] }]]);
      const result = buildGapAnalysis(data, [], { liftIndex });
      expect(result.map((c) => c.name)).toEqual(['Staple', 'Fringe']);
    });
  });
});
