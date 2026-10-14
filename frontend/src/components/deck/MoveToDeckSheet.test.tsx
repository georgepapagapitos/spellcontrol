// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MoveToDeckSheet } from './MoveToDeckSheet';
import { useDecksStore, type Deck } from '@/store/decks';
import type { DeckFormat, ScryfallCard } from '@/deck-builder/types';

const card = (name: string): ScryfallCard => ({ oracle_id: name, name }) as unknown as ScryfallCard;

const deck = (
  id: string,
  name: string,
  opts: { format?: DeckFormat; commander?: string; cards?: string[]; updatedAt?: number } = {}
): Deck =>
  ({
    id,
    name,
    format: opts.format ?? 'commander',
    source: 'manual',
    commander: opts.commander ? card(opts.commander) : null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: (opts.cards ?? []).map((n, i) => ({
      slotId: `${id}-${i}`,
      card: card(n),
      allocatedCopyId: null,
    })),
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#000',
    createdAt: 0,
    updatedAt: opts.updatedAt ?? 0,
  }) as Deck;

const current = deck('cur', 'Current', { cards: ['Ruby Medallion'] });

function renderSheet() {
  return render(
    <MoveToDeckSheet
      card={card('Ruby Medallion')}
      currentDeck={current}
      collectionCards={[]}
      ownershipFor={() => 'owned'}
      freeCountFor={() => 0}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

/** Deck names in row order, read from each row's button label. */
const rowNames = () =>
  within(screen.getByRole('list'))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label')!.replace('Move Ruby Medallion to ', ''));

beforeEach(() => {
  localStorage.clear();
  useDecksStore.setState({
    hydrated: true,
    decks: [
      current,
      deck('a', 'Monster Tron', { format: 'modern', updatedAt: 1 }),
      deck('b', 'Queen Marchesa', { commander: 'Queen Marchesa', updatedAt: 3 }),
      deck('c', 'Zo-Zu', {
        commander: 'Zo-Zu the Punisher',
        cards: ['Ruby Medallion'],
        updatedAt: 2,
      }),
    ],
  });
});

describe('MoveToDeckSheet deck list', () => {
  it('lists every other deck, most recently edited first by default', () => {
    renderSheet();
    expect(rowNames()).toEqual(['Queen Marchesa', 'Zo-Zu', 'Monster Tron']);
  });

  it('keeps the sort the user picked last time', () => {
    localStorage.setItem('move-to-deck-sort', JSON.stringify({ field: 'name', dir: 'asc' }));
    renderSheet();
    expect(rowNames()).toEqual(['Monster Tron', 'Queen Marchesa', 'Zo-Zu']);
  });

  it('searches deck names and commanders', () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText('Search decks by name or commander'), {
      target: { value: 'punisher' },
    });
    expect(rowNames()).toEqual(['Zo-Zu']);
  });

  it('filters by format, and unpressing the chip brings every deck back', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Modern' }));
    expect(rowNames()).toEqual(['Monster Tron']);
    fireEvent.click(screen.getByRole('button', { name: 'Commander' }));
    expect(rowNames()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Commander' }));
    fireEvent.click(screen.getByRole('button', { name: 'Modern' }));
    expect(rowNames()).toHaveLength(3);
  });

  it('says so when nothing matches and offers to clear the search', () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText('Search decks by name or commander'), {
      target: { value: 'nothing like this' },
    });
    expect(screen.getByText('No deck matches that.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(rowNames()).toHaveLength(3);
  });

  it('marks a deck that already runs the card', () => {
    renderSheet();
    const zozu = screen.getByRole('button', { name: 'Move Ruby Medallion to Zo-Zu' });
    expect(within(zozu).getByText('Has 1')).toBeTruthy();
    const tron = screen.getByRole('button', { name: 'Move Ruby Medallion to Monster Tron' });
    expect(within(tron).queryByText(/^Has/)).toBeNull();
  });
});
