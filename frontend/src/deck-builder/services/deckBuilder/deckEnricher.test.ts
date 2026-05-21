import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enrichDeckCards } from './deckEnricher';
import type { EDHRECCard, EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';

// Stub only the two network fetchers; keep every other export real so
// deckGenerator (which also imports from this module) still resolves.
vi.mock('@/deck-builder/services/edhrec/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCommanderData: vi.fn(),
  fetchPartnerCommanderData: vi.fn(),
}));

import {
  fetchCommanderData,
  fetchPartnerCommanderData,
} from '@/deck-builder/services/edhrec/client';

const mockFetchCommander = vi.mocked(fetchCommanderData);
const mockFetchPartner = vi.mocked(fetchPartnerCommanderData);

function card(name: string, typeLine: string, cmc = 2): ScryfallCard {
  return { name, id: name, type_line: typeLine, cmc } as ScryfallCard;
}

function edhrecCard(name: string, inclusion: number): EDHRECCard {
  return { name, sanitized: name, primary_type: 'creature', inclusion, num_decks: 100 };
}

function commanderData(nonLand: EDHRECCard[]): EDHRECCommanderData {
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 100,
      deckSize: 99,
      manaCurve: { 2: 10 },
      typeDistribution: {
        creature: 30,
        instant: 5,
        sorcery: 5,
        artifact: 5,
        enchantment: 5,
        land: 37,
        planeswalker: 2,
        battle: 0,
      },
      landDistribution: { basic: 20, nonbasic: 17, total: 37 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: nonLand,
    },
    similarCommanders: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrichDeckCards', () => {
  it('sorts cards into categories by type line', async () => {
    const result = await enrichDeckCards(
      [
        card('Forest', 'Basic Land — Forest', 0),
        card('Grizzly Bears', 'Creature — Bear'),
        card('Teferi', 'Legendary Planeswalker — Teferi', 4),
        card('Opt', 'Instant', 1),
      ],
      99
    );
    expect(result.categories.lands.map((c) => c.name)).toEqual(['Forest']);
    expect(result.categories.creatures.map((c) => c.name)).toEqual(['Grizzly Bears']);
    expect(result.categories.utility.map((c) => c.name)).toEqual(['Teferi']);
    expect(result.categories.synergy.map((c) => c.name)).toEqual(['Opt']);
  });

  it('returns role targets scaled to the deck size', async () => {
    const result = await enrichDeckCards([card('Bear', 'Creature — Bear')], 99);
    expect(result.roleTargets).toBeDefined();
    expect(Object.keys(result.roleCounts)).toEqual(['ramp', 'removal', 'boardwipe', 'cardDraw']);
  });

  it('does not build inclusion/relevancy maps without a commander name', async () => {
    const result = await enrichDeckCards([card('Bear', 'Creature — Bear')], 99);
    expect(result.cardInclusionMap).toBeUndefined();
    expect(result.cardRelevancyMap).toBeUndefined();
    expect(mockFetchCommander).not.toHaveBeenCalled();
  });

  it('builds inclusion + relevancy maps and a deck score from EDHREC data', async () => {
    mockFetchCommander.mockResolvedValue(
      commanderData([edhrecCard('Grizzly Bears', 40), edhrecCard('Opt', 25)])
    );
    const result = await enrichDeckCards(
      [card('Grizzly Bears', 'Creature — Bear'), card('Opt', 'Instant', 1)],
      99,
      undefined,
      'Some Commander'
    );
    expect(mockFetchCommander).toHaveBeenCalledWith('Some Commander');
    expect(result.cardInclusionMap).toEqual({ 'Grizzly Bears': 40, Opt: 25 });
    expect(result.deckScore).toBe(65);
    expect(result.cardRelevancyMap).toBeDefined();
  });

  it('uses the partner endpoint when a partner commander is given', async () => {
    mockFetchPartner.mockResolvedValue(commanderData([edhrecCard('Grizzly Bears', 10)]));
    await enrichDeckCards([card('Grizzly Bears', 'Creature — Bear')], 99, undefined, 'A', 'B');
    expect(mockFetchPartner).toHaveBeenCalledWith('A', 'B');
    expect(mockFetchCommander).not.toHaveBeenCalled();
  });

  it('skips the maps gracefully when the EDHREC fetch fails', async () => {
    mockFetchCommander.mockRejectedValue(new Error('edhrec down'));
    const result = await enrichDeckCards(
      [card('Bear', 'Creature — Bear')],
      99,
      undefined,
      'Some Commander'
    );
    // Categorization still succeeds; only the optional maps are missing.
    expect(result.categories.creatures).toHaveLength(1);
    expect(result.cardInclusionMap).toBeUndefined();
  });
});
