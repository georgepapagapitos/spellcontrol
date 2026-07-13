import { describe, it, expect, vi } from 'vitest';
import { saveGeneratedDeck } from './save-generated-deck';
import type { EnrichedCard } from '../types';
import type { Deck, DeckCard } from '../store/decks';
import type {
  Customization,
  DeckCategory,
  GeneratedDeck,
  ScryfallCard,
} from '@/deck-builder/types';

// ── Fixtures — mirror the shapes in allocations.test.ts / buildReport.test.ts
// so this file doesn't invent a third dialect of "fake card". ────────────────

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

function scryfallCard(name: string, id = `id-${name}`): ScryfallCard {
  return {
    id,
    oracle_id: `oracle-${name}`,
    name,
    cmc: 2,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
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

function generatedDeck(overrides: Partial<GeneratedDeck> = {}): GeneratedDeck {
  return {
    commander: null,
    partnerCommander: null,
    categories: categories({}),
    stats: {
      totalCards: 0,
      averageCmc: 0,
      manaCurve: {},
      colorDistribution: {},
      typeDistribution: {},
    },
    ...overrides,
  } as GeneratedDeck;
}

function customization(overrides: Partial<Customization> = {}): Customization {
  return {
    targetBracket: 3,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    ...overrides,
  } as Customization;
}

function deckFixture(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    format: 'commander',
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

type CreateDeckInput = Parameters<
  ReturnType<typeof import('../store/decks').useDecksStore.getState>['createDeck']
>[0];
type CreateDeckFn = ReturnType<
  typeof import('../store/decks').useDecksStore.getState
>['createDeck'];

/**
 * Fake `createDeck` that records the input it would have persisted, so
 * `saveGeneratedDeck`'s allocation/conflict logic is exercised without
 * touching the real (IndexedDB-backed) decks store. `.calls[n]` holds the
 * nth invocation's input — a plain array, not a getter, so it's safe to read
 * after the call regardless of how the caller destructures the return value.
 */
function fakeCreateDeck(): { createDeck: CreateDeckFn; calls: CreateDeckInput[] } {
  const calls: CreateDeckInput[] = [];
  const createDeck = vi.fn((input: CreateDeckInput) => {
    calls.push(input);
    return `new-deck-id-${calls.length}`;
  });
  return { createDeck: createDeck as unknown as CreateDeckFn, calls };
}

describe('saveGeneratedDeck', () => {
  it('does not double-claim a copyId when the same name appears twice in one deck', () => {
    const collection = [card({ copyId: 'copy-rg', name: 'Rampant Growth' })];
    const generated = generatedDeck({
      categories: categories({
        ramp: [scryfallCard('Rampant Growth'), scryfallCard('Rampant Growth')],
      }),
    });
    const { createDeck, calls } = fakeCreateDeck();

    saveGeneratedDeck(generated, customization(), [], [], collection, createDeck);

    const captured = calls[0];
    const rampCards = captured.cards!.filter((c) => c.card.name === 'Rampant Growth');
    expect(rampCards).toHaveLength(2);
    const allocated = rampCards.filter((c) => c.allocatedCopyId != null);
    expect(allocated).toHaveLength(1);
    expect(allocated[0].allocatedCopyId).toBe('copy-rg');
    // The second copy is owned-by-name but every physical copy is now claimed
    // by the first slot — that's a within-deck conflict, same bucket as a
    // cross-deck one.
    expect(captured.buildReport?.claimedConflicts).toBe(1);
  });

  it("leaves the contested slot unbound on a second save that sees the first save's allocations", () => {
    const collection = [card({ copyId: 'copy-sol', name: 'Sol Ring' })];

    const firstGenerated = generatedDeck({
      categories: categories({ ramp: [scryfallCard('Sol Ring')] }),
    });
    const first = fakeCreateDeck();
    saveGeneratedDeck(firstGenerated, customization(), [], [], collection, first.createDeck);
    expect(first.calls[0].cards![0].allocatedCopyId).toBe('copy-sol');
    expect(first.calls[0].buildReport?.claimedConflicts).toBeUndefined();

    // The first "deck" now exists in the world — feed it back in as existingDecks.
    const persistedFirstDeck = deckFixture({
      id: 'deck-1',
      cards: first.calls[0].cards as DeckCard[],
    });

    const secondGenerated = generatedDeck({
      categories: categories({ ramp: [scryfallCard('Sol Ring')] }),
    });
    const second = fakeCreateDeck();
    saveGeneratedDeck(
      secondGenerated,
      customization(),
      [],
      [persistedFirstDeck],
      collection,
      second.createDeck
    );

    expect(second.calls[0].cards![0].allocatedCopyId).toBeNull();
    expect(second.calls[0].buildReport?.claimedConflicts).toBe(1);
  });

  it('allocates commander and partner copies alongside mainboard cards', () => {
    const collection = [
      card({ copyId: 'copy-cmd', name: 'Commander A' }),
      card({ copyId: 'copy-partner', name: 'Partner B' }),
      card({ copyId: 'copy-creature', name: 'Some Creature' }),
    ];
    const generated = generatedDeck({
      commander: scryfallCard('Commander A'),
      partnerCommander: scryfallCard('Partner B'),
      categories: categories({ creatures: [scryfallCard('Some Creature')] }),
    });
    const { createDeck, calls } = fakeCreateDeck();

    saveGeneratedDeck(generated, customization(), [], [], collection, createDeck);

    const captured = calls[0];
    expect(captured.commanderAllocatedCopyId).toBe('copy-cmd');
    expect(captured.partnerCommanderAllocatedCopyId).toBe('copy-partner');
    expect(captured.cards![0].allocatedCopyId).toBe('copy-creature');
    expect(captured.buildReport?.claimedConflicts).toBeUndefined();
  });

  it('leaves unowned cards unbound with no conflict reported', () => {
    const collection: EnrichedCard[] = [];
    const generated = generatedDeck({
      categories: categories({ creatures: [scryfallCard('Nonexistent Card')] }),
    });
    const { createDeck, calls } = fakeCreateDeck();

    saveGeneratedDeck(generated, customization(), [], [], collection, createDeck);

    const captured = calls[0];
    expect(captured.cards![0].allocatedCopyId).toBeNull();
    // Not owned at all — this is the 'unowned' case, distinct from a
    // claimed-elsewhere conflict, so it must not inflate claimedConflicts.
    expect(captured.buildReport?.claimedConflicts).toBeUndefined();
  });
});
