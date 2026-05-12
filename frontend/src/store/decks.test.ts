import { describe, it, expect, beforeEach } from 'vitest';
import { useDecksStore, type Deck, type DeckCard } from './decks';
import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';

function enriched(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
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

function sfCard(name: string, id = 'sf-1'): ScryfallCard {
  return { name, id } as ScryfallCard;
}

function slot(name: string, allocatedCopyId: string | null, scryfallId = 'sf-1'): DeckCard {
  return {
    slotId: `slot-${name}-${Math.random().toString(36).slice(2, 6)}`,
    card: sfCard(name, scryfallId),
    allocatedCopyId,
  };
}

function baseDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useDecksStore.setState({ decks: [], hydrated: true });
});

describe('remapAllocations', () => {
  it('remaps allocated slots to new copyIds by card name', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'old-copy-1', 'sf-1')],
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'new-copy-1', name: 'Sol Ring', scryfallId: 'sf-1' }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBe('new-copy-1');
  });

  it('nulls allocation when card is not in new collection', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'old-copy-1')],
        }),
      ],
    });

    useDecksStore.getState().remapAllocations([]);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBeNull();
  });

  it('allocates unallocated slots when a matching card exists in collection', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', null)],
        }),
      ],
    });

    const newCollection = [enriched({ copyId: 'new-copy-1' })];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBe('new-copy-1');
  });

  it('leaves unallocated slots null when card is not in collection', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Mana Crypt', null)],
        }),
      ],
    });

    const newCollection = [enriched({ copyId: 'new-copy-1', name: 'Sol Ring' })];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBeNull();
  });

  it('re-allocates after collection delete and reimport', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'old-copy-1')],
        }),
      ],
    });

    // Step 1: collection deleted — remap against empty nulls all allocations
    useDecksStore.getState().remapAllocations([]);
    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBeNull();

    // Step 2: new collection imported — should re-allocate
    const freshCollection = [enriched({ copyId: 'fresh-copy', name: 'Sol Ring' })];
    useDecksStore.getState().remapAllocations(freshCollection);
    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('fresh-copy');
  });

  it('avoids double-claiming the same copy across decks', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          id: 'd1',
          cards: [slot('Sol Ring', 'old-1')],
        }),
        baseDeck({
          id: 'd2',
          name: 'Deck 2',
          cards: [slot('Sol Ring', 'old-2')],
        }),
      ],
    });

    const newCollection = [enriched({ copyId: 'only-copy', name: 'Sol Ring' })];
    useDecksStore.getState().remapAllocations(newCollection);

    const [d1, d2] = useDecksStore.getState().decks;
    expect(d1.cards[0].allocatedCopyId).toBe('only-copy');
    expect(d2.cards[0].allocatedCopyId).toBeNull();
  });

  it('prefers same printing when multiple copies exist', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          cards: [slot('Sol Ring', 'old-1', 'sf-ONE')],
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'cmr-copy', name: 'Sol Ring', scryfallId: 'sf-CMR', purchasePrice: 1 }),
      enriched({ copyId: 'one-copy', name: 'Sol Ring', scryfallId: 'sf-ONE', purchasePrice: 50 }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.cards[0].allocatedCopyId).toBe('one-copy');
  });

  it('remaps commander and partner commander allocations', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          commander: sfCard('Atraxa', 'sf-atraxa'),
          commanderAllocatedCopyId: 'old-cmd',
          partnerCommander: sfCard('Thrasios', 'sf-thrasios'),
          partnerCommanderAllocatedCopyId: 'old-partner',
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'new-cmd', name: 'Atraxa', scryfallId: 'sf-atraxa' }),
      enriched({ copyId: 'new-partner', name: 'Thrasios', scryfallId: 'sf-thrasios' }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.commanderAllocatedCopyId).toBe('new-cmd');
    expect(deck.partnerCommanderAllocatedCopyId).toBe('new-partner');
  });

  it('remaps sideboard allocations', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          sideboard: [slot('Swords to Plowshares', 'old-sb-1', 'sf-stp')],
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'new-sb', name: 'Swords to Plowshares', scryfallId: 'sf-stp' }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const deck = useDecksStore.getState().decks[0];
    expect(deck.sideboard[0].allocatedCopyId).toBe('new-sb');
  });

  it('handles mixed allocated and unallocated across multiple decks', () => {
    useDecksStore.setState({
      decks: [
        baseDeck({
          id: 'd1',
          cards: [slot('Sol Ring', 'old-sr'), slot('Mana Crypt', null)],
        }),
        baseDeck({
          id: 'd2',
          name: 'Deck 2',
          cards: [slot('Lightning Bolt', 'old-bolt')],
        }),
      ],
    });

    const newCollection = [
      enriched({ copyId: 'new-sr', name: 'Sol Ring' }),
      enriched({ copyId: 'new-bolt', name: 'Lightning Bolt', scryfallId: 'sf-bolt' }),
    ];
    useDecksStore.getState().remapAllocations(newCollection);

    const [d1, d2] = useDecksStore.getState().decks;
    expect(d1.cards[0].allocatedCopyId).toBe('new-sr');
    expect(d1.cards[1].allocatedCopyId).toBeNull();
    expect(d2.cards[0].allocatedCopyId).toBe('new-bolt');
  });
});
