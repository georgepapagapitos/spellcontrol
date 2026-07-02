import { describe, it, expect, beforeEach } from 'vitest';
import { useDecksStore, newDeckCard, selectDeck, effectiveBracket, type DeckCard } from './decks';
import { useToastsStore } from './toasts';
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
  useToastsStore.getState().clear();
});

const undoToast = () => useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');

describe('effectiveBracket', () => {
  it('prefers the manual override over the auto estimate', () => {
    expect(
      effectiveBracket({
        bracketOverride: 5,
        bracketEstimation: { bracket: 3 } as never,
      })
    ).toBe(5);
  });

  it('falls back to the auto estimate when no override is set', () => {
    expect(
      effectiveBracket({ bracketOverride: null, bracketEstimation: { bracket: 2 } as never })
    ).toBe(2);
    expect(effectiveBracket({ bracketEstimation: { bracket: 4 } as never })).toBe(4);
  });

  it('is undefined when neither override nor estimate exists', () => {
    expect(effectiveBracket({})).toBeUndefined();
    expect(effectiveBracket({ bracketOverride: null })).toBeUndefined();
  });

  it('createDeck defaults bracketOverride to null', () => {
    const id = store().createDeck({ source: 'manual', commander: null });
    expect(selectDeck(id)(useDecksStore.getState())?.bracketOverride).toBeNull();
  });
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
        targetBracket: 'all',
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

  it('updateDeck with silent=true does not bump updatedAt (background analysis writes)', () => {
    const id = store().createDeck({ source: 'manual', commander: null });
    const before = store().decks[0].updatedAt;
    store().updateDeck(id, { deckGrade: { letter: 'A' } as never }, true);
    const d = store().decks[0];
    expect(d.deckGrade).toEqual({ letter: 'A' });
    expect(d.updatedAt).toBe(before);
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

  it('deleteDeck offers an Undo toast that restores the deck', () => {
    const a = store().createDeck({ name: 'A', source: 'manual', commander: null });
    store().deleteDeck(a);
    const t = undoToast();
    expect(t?.message).toBe('Deleted A');
    t!.onAction!();
    expect(store().decks.find((d) => d.id === a)?.name).toBe('A');
  });

  it('deleteDeck is a no-op (no toast) for an unknown id', () => {
    store().createDeck({ name: 'A', source: 'manual', commander: null });
    store().deleteDeck('nope');
    expect(store().decks).toHaveLength(1);
    expect(undoToast()).toBeUndefined();
  });

  it('deleteAllDecks empties the list', () => {
    store().createDeck({ source: 'manual', commander: null });
    store().createDeck({ source: 'manual', commander: null });
    store().deleteAllDecks();
    expect(store().decks).toEqual([]);
  });

  it('deleteAllDecks offers an Undo toast that restores every deck', () => {
    store().createDeck({ name: 'A', source: 'manual', commander: null });
    store().createDeck({ name: 'B', source: 'manual', commander: null });
    store().deleteAllDecks();
    const t = undoToast();
    expect(t?.message).toBe('Deleted 2 decks');
    t!.onAction!();
    expect(
      store()
        .decks.map((d) => d.name)
        .sort()
    ).toEqual(['A', 'B']);
  });

  it('deleteAllDecks on an empty list does nothing and shows no toast', () => {
    store().deleteAllDecks();
    expect(undoToast()).toBeUndefined();
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

  it('updateCardPrinting binds the given copy when one is passed', () => {
    const slotId = store().addCard(id, sfCard('Sol Ring', 'sf-1'), 'copy-1');
    store().updateCardPrinting(id, slotId, sfCard('Sol Ring', 'sf-2'), 'copy-2');
    const slot = store().decks[0].cards[0];
    expect(slot.card.id).toBe('sf-2');
    expect(slot.allocatedCopyId).toBe('copy-2');
  });

  it('replaceCards swaps the whole main list', () => {
    store().addCard(id, sfCard('Sol Ring'));
    store().replaceCards(id, [deckCard('Plains'), deckCard('Island')]);
    expect(store().decks[0].cards.map((c) => c.card.name)).toEqual(['Plains', 'Island']);
  });
});

describe('useDecksStore — swapCard (atomic)', () => {
  let id: string;
  beforeEach(() => {
    id = store().createDeck({ source: 'manual', commander: null });
  });

  it('removes the out-slot and adds the in-card in one update, returning the new id', () => {
    const outSlot = store().addCard(id, sfCard('Lightning Bolt'), 'copy-old');
    store().addCard(id, sfCard('Mountain'));
    const newSlot = store().swapCard(id, outSlot, sfCard('Young Pyromancer'), 'copy-new');
    const names = store().decks[0].cards.map((c) => c.card.name);
    expect(names).toContain('Young Pyromancer');
    expect(names).not.toContain('Lightning Bolt');
    expect(names).toContain('Mountain'); // untouched
    const added = store().decks[0].cards.find((c) => c.slotId === newSlot)!;
    expect(added.card.name).toBe('Young Pyromancer');
    expect(added.allocatedCopyId).toBe('copy-new');
    expect(added.addedAt).toBeGreaterThan(0);
  });

  it('keeps the deck card-count stable across the swap (no transient state)', () => {
    const outSlot = store().addCard(id, sfCard('A'));
    store().addCard(id, sfCard('B'));
    expect(store().decks[0].cards).toHaveLength(2);
    store().swapCard(id, outSlot, sfCard('C'));
    expect(store().decks[0].cards).toHaveLength(2);
  });

  it('is a no-op (returns empty id) when the out-slot is missing', () => {
    store().addCard(id, sfCard('A'));
    const result = store().swapCard(id, 'missing-slot', sfCard('C'));
    expect(result).toBe('');
    expect(store().decks[0].cards.map((c) => c.card.name)).toEqual(['A']);
  });

  it('is a no-op for an unknown deck', () => {
    const result = store().swapCard('nope', 'slot', sfCard('C'));
    expect(result).toBe('');
  });
});

describe('useDecksStore — replaceDeck (undo/redo restore)', () => {
  it('restores a prior snapshot wholesale while preserving the live id', () => {
    const id = store().createDeck({ name: 'Original', source: 'manual', commander: null });
    store().addCard(id, sfCard('Sol Ring'));
    const before = structuredClone(store().decks[0]);

    // Mutate away from the snapshot.
    store().addCard(id, sfCard('Mana Crypt'));
    store().renameDeck(id, 'Changed');
    expect(store().decks[0].cards).toHaveLength(2);

    // Restore the snapshot.
    store().replaceDeck(id, before);
    const d = store().decks[0];
    expect(d.id).toBe(id);
    expect(d.name).toBe('Original');
    expect(d.cards.map((c) => c.card.name)).toEqual(['Sol Ring']);
  });

  it('is a no-op for an unknown deck id', () => {
    store().createDeck({ name: 'Keep', source: 'manual', commander: null });
    const ghost = structuredClone(store().decks[0]);
    store().replaceDeck('not-here', { ...ghost, id: 'not-here', name: 'Ghost' });
    expect(store().decks.map((d) => d.name)).toEqual(['Keep']);
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

describe('persist v4 → v5 migration', () => {
  // Exercises the zustand `migrate` function for the bracketLevel → targetBracket
  // rename. Calls it via the persist API so the test breaks if the migration is
  // accidentally removed or its version gate slips.
  const migrate = useDecksStore.persist.getOptions().migrate!;

  it('renames generationContext.bracketLevel to targetBracket, preserving the value', () => {
    const v4State = {
      decks: [
        {
          id: 'd1',
          generationContext: {
            selectedThemes: [],
            bracketLevel: 3,
            landCount: 37,
            collectionMode: false,
          },
        },
        {
          id: 'd2',
          generationContext: {
            selectedThemes: [],
            bracketLevel: 'all',
            landCount: 36,
            collectionMode: true,
          },
        },
      ],
    };
    const migrated = migrate(v4State, 4) as { decks: Array<Record<string, unknown>> };
    const gc1 = migrated.decks[0].generationContext as Record<string, unknown>;
    const gc2 = migrated.decks[1].generationContext as Record<string, unknown>;
    expect(gc1).not.toHaveProperty('bracketLevel');
    expect(gc1.targetBracket).toBe(3);
    expect(gc1.landCount).toBe(37);
    expect(gc2.targetBracket).toBe('all');
    expect(gc2.collectionMode).toBe(true);
  });

  it('leaves decks alone when generationContext is null', () => {
    const v4State = { decks: [{ id: 'd1', generationContext: null }] };
    const migrated = migrate(v4State, 4) as { decks: Array<Record<string, unknown>> };
    expect(migrated.decks[0].generationContext).toBeNull();
  });

  it('leaves decks alone when generationContext lacks bracketLevel', () => {
    const v4State = {
      decks: [
        {
          id: 'd1',
          generationContext: { selectedThemes: [], landCount: 37, collectionMode: false },
        },
      ],
    };
    const migrated = migrate(v4State, 4) as { decks: Array<Record<string, unknown>> };
    const gc = migrated.decks[0].generationContext as Record<string, unknown>;
    expect(gc).not.toHaveProperty('targetBracket');
    expect(gc.landCount).toBe(37);
  });

  it('is a no-op when the persisted version is already at v5', () => {
    const v5State = {
      decks: [
        {
          id: 'd1',
          generationContext: {
            selectedThemes: [],
            targetBracket: 4,
            landCount: 37,
            collectionMode: false,
          },
        },
      ],
    };
    const migrated = migrate(v5State, 5) as { decks: Array<Record<string, unknown>> };
    const gc = migrated.decks[0].generationContext as Record<string, unknown>;
    expect(gc.targetBracket).toBe(4);
    expect(gc).not.toHaveProperty('bracketLevel');
  });
});
