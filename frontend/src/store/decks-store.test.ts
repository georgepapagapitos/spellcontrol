import { describe, it, expect, beforeEach } from 'vitest';
import { useDecksStore, newDeckCard, selectDeck, type DeckCard } from './decks';
import type { ScryfallCard } from '@/deck-builder/types';

function sfCard(name: string, id = 'sf-1'): ScryfallCard {
  return { name, id } as ScryfallCard;
}

function deckCard(name: string, id = 'sf-1'): DeckCard {
  return newDeckCard(sfCard(name, id));
}

const store = () => useDecksStore.getState();

beforeEach(() => {
  useDecksStore.setState({ decks: [] });
});

describe('useDecksStore — createDeck', () => {
  it('creates a manual deck with defaults and prepends it', () => {
    const id = store().createDeck({ source: 'manual', commander: null });
    const decks = store().decks;
    expect(decks).toHaveLength(1);
    expect(decks[0].id).toBe(id);
    expect(decks[0].name).toBe('Untitled deck');
    expect(decks[0].format).toBe('commander');
    expect(decks[0].cards).toEqual([]);
    expect(decks[0].color).toMatch(/^#/);
  });

  it('derives the deck name from the commander before the first comma', () => {
    store().createDeck({
      source: 'manual',
      commander: sfCard('Korvold, Fae-Cursed King'),
    });
    expect(store().decks[0].name).toBe('Korvold');
  });

  it('keeps an explicit name, format, and generation context', () => {
    store().createDeck({
      name: 'My Deck',
      format: 'standard',
      source: 'generated',
      commander: null,
      generationContext: {
        selectedThemes: [],
        bracketLevel: 'all',
        landCount: 37,
        collectionMode: false,
      },
    });
    const d = store().decks[0];
    expect(d.name).toBe('My Deck');
    expect(d.format).toBe('standard');
    expect(d.source).toBe('generated');
    expect(d.generationContext?.landCount).toBe(37);
  });

  it('prepends newer decks ahead of older ones', () => {
    const first = store().createDeck({ name: 'First', source: 'manual', commander: null });
    const second = store().createDeck({ name: 'Second', source: 'manual', commander: null });
    expect(store().decks.map((d) => d.id)).toEqual([second, first]);
  });
});

describe('useDecksStore — update / rename / delete', () => {
  it('updateDeck merges updates and bumps updatedAt', () => {
    const id = store().createDeck({ source: 'manual', commander: null });
    const before = store().decks[0].updatedAt;
    store().updateDeck(id, { name: 'Renamed', color: '#abcdef' });
    const d = store().decks[0];
    expect(d.name).toBe('Renamed');
    expect(d.color).toBe('#abcdef');
    expect(d.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('updateDeck leaves other decks untouched', () => {
    const a = store().createDeck({ name: 'A', source: 'manual', commander: null });
    store().createDeck({ name: 'B', source: 'manual', commander: null });
    store().updateDeck(a, { name: 'A2' });
    expect(store().decks.find((d) => d.id === a)?.name).toBe('A2');
    expect(store().decks.find((d) => d.name === 'B')).toBeDefined();
  });

  it('renameDeck changes only the name', () => {
    const id = store().createDeck({ name: 'Old', source: 'manual', commander: null });
    store().renameDeck(id, 'New');
    expect(store().decks[0].name).toBe('New');
  });

  it('deleteDeck removes the matching deck', () => {
    const a = store().createDeck({ name: 'A', source: 'manual', commander: null });
    store().createDeck({ name: 'B', source: 'manual', commander: null });
    store().deleteDeck(a);
    expect(store().decks.map((d) => d.name)).toEqual(['B']);
  });

  it('deleteAllDecks empties the list', () => {
    store().createDeck({ source: 'manual', commander: null });
    store().createDeck({ source: 'manual', commander: null });
    store().deleteAllDecks();
    expect(store().decks).toEqual([]);
  });
});

describe('useDecksStore — duplicateDeck', () => {
  it('returns null for an unknown deck id', () => {
    expect(store().duplicateDeck('nope')).toBeNull();
  });

  it('deep-clones a deck, resets allocations, and renames it', () => {
    const id = store().createDeck({
      name: 'Original',
      source: 'manual',
      commander: sfCard('Atraxa'),
      commanderAllocatedCopyId: 'copy-x',
      cards: [{ ...deckCard('Sol Ring'), allocatedCopyId: 'copy-y' }],
      sideboard: [deckCard('Swamp')],
    });
    const copyId = store().duplicateDeck(id);
    expect(copyId).not.toBeNull();
    const copy = store().decks.find((d) => d.id === copyId)!;
    expect(copy.name).toBe('Original (copy)');
    expect(copy.commanderAllocatedCopyId).toBeNull();
    expect(copy.cards[0].allocatedCopyId).toBeNull();
    expect(copy.cards[0].slotId).not.toBe(store().decks.find((d) => d.id === id)!.cards[0].slotId);
    expect(copy.sideboard).toHaveLength(1);
  });
});

describe('useDecksStore — card mutations', () => {
  let id: string;
  beforeEach(() => {
    id = store().createDeck({ source: 'manual', commander: null });
  });

  it('addCard appends a slot and returns its id', () => {
    const slotId = store().addCard(id, sfCard('Sol Ring'));
    const d = store().decks[0];
    expect(d.cards).toHaveLength(1);
    expect(d.cards[0].slotId).toBe(slotId);
    expect(d.cards[0].allocatedCopyId).toBeNull();
    expect(d.cards[0].addedAt).toBeGreaterThan(0);
  });

  it('addCard carries an allocated copy id when given', () => {
    store().addCard(id, sfCard('Sol Ring'), 'copy-1');
    expect(store().decks[0].cards[0].allocatedCopyId).toBe('copy-1');
  });

  it('removeCard drops the matching slot', () => {
    const slotId = store().addCard(id, sfCard('Sol Ring'));
    store().addCard(id, sfCard('Swamp'));
    store().removeCard(id, slotId);
    expect(store().decks[0].cards.map((c) => c.card.name)).toEqual(['Swamp']);
  });

  it('setCardAllocation updates the slot binding', () => {
    const slotId = store().addCard(id, sfCard('Sol Ring'));
    store().setCardAllocation(id, slotId, 'copy-9');
    expect(store().decks[0].cards[0].allocatedCopyId).toBe('copy-9');
    store().setCardAllocation(id, slotId, null);
    expect(store().decks[0].cards[0].allocatedCopyId).toBeNull();
  });

  it('updateCardPrinting swaps the card and clears the allocation', () => {
    const slotId = store().addCard(id, sfCard('Sol Ring', 'sf-1'), 'copy-1');
    store().updateCardPrinting(id, slotId, sfCard('Sol Ring', 'sf-2'));
    const slot = store().decks[0].cards[0];
    expect(slot.card.id).toBe('sf-2');
    expect(slot.allocatedCopyId).toBeNull();
  });

  it('replaceCards swaps the whole main list', () => {
    store().addCard(id, sfCard('Sol Ring'));
    store().replaceCards(id, [deckCard('Plains'), deckCard('Island')]);
    expect(store().decks[0].cards.map((c) => c.card.name)).toEqual(['Plains', 'Island']);
  });
});

describe('useDecksStore — sideboard and zones', () => {
  let id: string;
  beforeEach(() => {
    id = store().createDeck({ source: 'manual', commander: null });
  });

  it('addSideboardCard / removeSideboardCard manage the sideboard', () => {
    const slotId = store().addSideboardCard(id, sfCard('Negate'), 'copy-2');
    expect(store().decks[0].sideboard[0].allocatedCopyId).toBe('copy-2');
    store().removeSideboardCard(id, slotId);
    expect(store().decks[0].sideboard).toEqual([]);
  });

  it('moveBetweenZones moves a card from main to sideboard', () => {
    const slotId = store().addCard(id, sfCard('Counterspell'));
    store().moveBetweenZones(id, slotId, 'main');
    expect(store().decks[0].cards).toHaveLength(0);
    expect(store().decks[0].sideboard.map((c) => c.card.name)).toEqual(['Counterspell']);
  });

  it('moveBetweenZones moves a card from sideboard to main', () => {
    const slotId = store().addSideboardCard(id, sfCard('Duress'));
    store().moveBetweenZones(id, slotId, 'side');
    expect(store().decks[0].sideboard).toHaveLength(0);
    expect(store().decks[0].cards.map((c) => c.card.name)).toEqual(['Duress']);
  });

  it('moveBetweenZones is a no-op for an unknown slot', () => {
    store().addCard(id, sfCard('Counterspell'));
    store().moveBetweenZones(id, 'missing-slot', 'main');
    expect(store().decks[0].cards).toHaveLength(1);
    expect(store().decks[0].sideboard).toHaveLength(0);
  });
});

describe('useDecksStore — commander setters', () => {
  let id: string;
  beforeEach(() => {
    id = store().createDeck({ source: 'manual', commander: null });
  });

  it('setCommander assigns the commander and its allocation', () => {
    store().setCommander(id, sfCard('Atraxa'), 'copy-c');
    const d = store().decks[0];
    expect(d.commander?.name).toBe('Atraxa');
    expect(d.commanderAllocatedCopyId).toBe('copy-c');
  });

  it('setCommander can clear the commander', () => {
    store().setCommander(id, sfCard('Atraxa'), 'copy-c');
    store().setCommander(id, null);
    const d = store().decks[0];
    expect(d.commander).toBeNull();
    expect(d.commanderAllocatedCopyId).toBeNull();
  });

  it('setPartnerCommander assigns the partner slot', () => {
    store().setPartnerCommander(id, sfCard('Tymna'), 'copy-p');
    const d = store().decks[0];
    expect(d.partnerCommander?.name).toBe('Tymna');
    expect(d.partnerCommanderAllocatedCopyId).toBe('copy-p');
  });
});

describe('decks helpers', () => {
  it('newDeckCard builds a slot with a fresh id and timestamp', () => {
    const a = newDeckCard(sfCard('Sol Ring'));
    const b = newDeckCard(sfCard('Sol Ring'), 'copy-1');
    expect(a.slotId).not.toBe(b.slotId);
    expect(a.allocatedCopyId).toBeNull();
    expect(b.allocatedCopyId).toBe('copy-1');
    expect(a.addedAt).toBeGreaterThan(0);
  });

  it('selectDeck returns a selector that finds a deck by id', () => {
    const id = store().createDeck({ name: 'Pick me', source: 'manual', commander: null });
    expect(selectDeck(id)(useDecksStore.getState())?.name).toBe('Pick me');
    expect(selectDeck('missing')(useDecksStore.getState())).toBeNull();
    expect(selectDeck(undefined)(useDecksStore.getState())).toBeNull();
  });
});
