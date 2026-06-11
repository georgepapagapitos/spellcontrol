import { describe, it, expect, beforeEach, vi } from 'vitest';

const { hapticsMock } = vi.hoisted(() => ({
  hapticsMock: {
    tap: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    lethal: vi.fn(),
    eliminate: vi.fn(),
  },
}));
vi.mock('../lib/haptics', () => ({ haptics: hapticsMock }));

import { useDecksStore } from './decks';
import { useDeckHistoryStore } from './deck-history';
import type { ScryfallCard } from '@/deck-builder/types';

const sf = (name: string, id = `sf-${name}`): ScryfallCard => ({ name, id }) as ScryfallCard;
const decks = () => useDecksStore.getState();
const history = () => useDeckHistoryStore.getState();
const cardNames = (deckId: string) =>
  decks()
    .decks.find((d) => d.id === deckId)!
    .cards.map((c) => c.card.name);

beforeEach(() => {
  useDecksStore.setState({ decks: [] });
  history().clear();
  hapticsMock.tap.mockClear();
});

describe('deck-history store', () => {
  it('records a single edit and undoes/redoes it', () => {
    const id = decks().createDeck({ source: 'manual', commander: null });
    history().record(id, 'add Sol Ring', () => {
      decks().addCard(id, sf('Sol Ring'));
    });
    expect(cardNames(id)).toEqual(['Sol Ring']);
    expect(history().canUndo(id)).toBe(true);
    expect(history().undoLabel(id)).toBe('add Sol Ring');

    expect(history().undo(id)).toBe(true);
    expect(cardNames(id)).toEqual([]);
    expect(history().canRedo(id)).toBe(true);

    expect(history().redo(id)).toBe(true);
    expect(cardNames(id)).toEqual(['Sol Ring']);
  });

  it('collapses multiple mutations in one record() into a single undo entry', () => {
    const id = decks().createDeck({ source: 'manual', commander: null });
    decks().addCard(id, sf('A'));
    const outSlot = decks().decks[0].cards[0].slotId;

    // A bulk action: remove A and add two cards, all one logical edit.
    history().record(id, 'bulk', () => {
      decks().removeCard(id, outSlot);
      decks().addCard(id, sf('B'));
      decks().addCard(id, sf('C'));
    });
    expect(cardNames(id)).toEqual(['B', 'C']);

    // One undo reverts the whole group.
    expect(history().undo(id)).toBe(true);
    expect(cardNames(id)).toEqual(['A']);
    expect(history().canUndo(id)).toBe(false);
  });

  it('records an atomic swap as one entry that restores the original card', () => {
    const id = decks().createDeck({ source: 'manual', commander: null });
    decks().addCard(id, sf('Lightning Bolt'));
    const outSlot = decks().decks[0].cards[0].slotId;

    history().record(id, 'swap', () => {
      decks().swapCard(id, outSlot, sf('Young Pyromancer'));
    });
    expect(cardNames(id)).toEqual(['Young Pyromancer']);
    history().undo(id);
    expect(cardNames(id)).toEqual(['Lightning Bolt']);
    history().redo(id);
    expect(cardNames(id)).toEqual(['Young Pyromancer']);
  });

  it('a no-op fn records nothing', () => {
    const id = decks().createDeck({ source: 'manual', commander: null });
    history().record(id, 'noop', () => {
      /* no mutation */
    });
    expect(history().canUndo(id)).toBe(false);
  });

  it('begin/commit brackets an async-style edit', () => {
    const id = decks().createDeck({ source: 'manual', commander: null });
    const before = history().begin(id)!;
    decks().addCard(id, sf('Mana Crypt')); // could be after an awaited resolve
    history().commit(id, 'add Mana Crypt', before);
    expect(history().canUndo(id)).toBe(true);
    history().undo(id);
    expect(cardNames(id)).toEqual([]);
  });

  it('a fresh edit clears the redo branch', () => {
    const id = decks().createDeck({ source: 'manual', commander: null });
    history().record(id, 'add A', () => decks().addCard(id, sf('A')));
    history().undo(id);
    expect(history().canRedo(id)).toBe(true);
    history().record(id, 'add B', () => decks().addCard(id, sf('B')));
    expect(history().canRedo(id)).toBe(false);
    expect(cardNames(id)).toEqual(['B']);
  });

  it('invalidate drops a deck stack (stale after a server pull)', () => {
    const id = decks().createDeck({ source: 'manual', commander: null });
    history().record(id, 'add A', () => decks().addCard(id, sf('A')));
    expect(history().canUndo(id)).toBe(true);
    history().invalidate([id]);
    expect(history().canUndo(id)).toBe(false);
  });

  it('ticks the light haptic on a successful undo/redo, but not on a no-op', () => {
    const id = decks().createDeck({ source: 'manual', commander: null });

    // Empty stack: undo/redo refuse and must stay silent.
    expect(history().undo(id)).toBe(false);
    expect(history().redo(id)).toBe(false);
    expect(hapticsMock.tap).not.toHaveBeenCalled();

    history().record(id, 'add A', () => decks().addCard(id, sf('A')));
    expect(history().undo(id)).toBe(true);
    expect(hapticsMock.tap).toHaveBeenCalledTimes(1);
    expect(history().redo(id)).toBe(true);
    expect(hapticsMock.tap).toHaveBeenCalledTimes(2);
  });

  it('keeps per-deck stacks independent', () => {
    const a = decks().createDeck({ name: 'A', source: 'manual', commander: null });
    const b = decks().createDeck({ name: 'B', source: 'manual', commander: null });
    history().record(a, 'add to A', () => decks().addCard(a, sf('X')));
    history().record(b, 'add to B', () => decks().addCard(b, sf('Y')));
    history().undo(a);
    expect(cardNames(a)).toEqual([]);
    expect(cardNames(b)).toEqual(['Y']); // b untouched
  });
});
