// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InlineCardSearch } from './InlineCardSearch';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';

/**
 * The results stack holds at most 60 cards, and before board E341 it never
 * said so: picking a tag with 976 cards on /tags rendered ten tiles under
 * "Show 10 more · 50 not shown", a line that counts the fetched-but-hidden
 * rows and therefore tells a reader that 60 is the whole answer.
 *
 * Scryfall reports the real count on every response (`total_cards`); the
 * search hook used to drop it. These guard that it reaches the screen.
 */
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCollectibleCards: vi.fn(),
  getCardsByNames: vi.fn(async () => []),
  getPrintings: vi.fn(async () => []),
}));

const card = (i: number) =>
  ({
    id: `id-${i}`,
    name: `Card ${i}`,
    set: 'tst',
    collector_number: String(i),
    finishes: ['nonfoil'],
    type_line: 'Creature',
    prices: {},
  }) as never;

async function searchWith(count: number, total: number) {
  const { searchCollectibleCards } = await import('@/deck-builder/services/scryfall/client');
  (searchCollectibleCards as ReturnType<typeof vi.fn>).mockResolvedValue({
    object: 'list',
    total_cards: total,
    has_more: total > count,
    data: Array.from({ length: count }, (_, i) => card(i)),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('InlineCardSearch cap disclosure', () => {
  it('states how many matched when the search found more than the stack holds', async () => {
    await searchWith(60, 942);
    render(<InlineCardSearch query="otag:sweeper" onAdd={() => {}} />);
    // Ten tiles first, so the line has to describe the window, not the fetch.
    expect(await screen.findByText(/Showing 10 of 942 matches/)).toBeTruthy();
    expect(screen.getByText(/Narrow the search to see the rest/)).toBeTruthy();
    // The old copy promised the remainder was the fetched-but-hidden rows.
    expect(screen.queryByText(/50 not shown/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Show 10 more/ }));
    await waitFor(() => expect(screen.getByText(/Showing 20 of 942 matches/)).toBeTruthy());
  });

  it('says nothing extra when the stack holds every match', async () => {
    await searchWith(12, 12);
    render(<InlineCardSearch query="lightning bolt" onAdd={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Show 2 more/ })).toBeTruthy());
    expect(screen.queryByText(/matches/)).toBeNull();
  });
});

// The collection page, /search and /tags added through this panel with no
// word at all, while the Add cards sheet's identical "+" named what landed and
// offered Undo (T153). Same add, same confirmation.
describe('InlineCardSearch collection add', () => {
  it('names the printing and finish that landed, and Undo takes the copy back out', async () => {
    await searchWith(1, 1);
    useToastsStore.getState().clear();
    const addCard = vi.fn(async () => ['c1']);
    const replaceAllCards = vi.fn(async () => {});
    useCollectionStore.setState({
      cards: [
        { copyId: 'keep', name: 'Forest' },
        { copyId: 'c1', name: 'Card 0' },
      ] as never,
      addCard,
      replaceAllCards,
    });
    render(<InlineCardSearch query="card 0" />);
    expect(await screen.findByText('TST #0')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add Card 0' }));
    await waitFor(() => expect(useToastsStore.getState().toasts).toHaveLength(1));
    const toast = useToastsStore.getState().toasts[0];
    expect(toast.message).toBe('Added Card 0 · TST #0 · Non-foil');
    expect(toast.actionLabel).toBe('Undo');

    toast.onAction?.();
    await waitFor(() =>
      expect(replaceAllCards).toHaveBeenCalledWith([{ copyId: 'keep', name: 'Forest' }])
    );
  });
});
