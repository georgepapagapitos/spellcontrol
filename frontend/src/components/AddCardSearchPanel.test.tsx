// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';

const h = vi.hoisted(() => ({
  addCard: vi.fn(async (..._a: unknown[]) => ['c1']),
  replaceAllCards: vi.fn(async (_cards: Array<{ copyId: string }>) => {}),
  pinCardToBinder: vi.fn(),
  removeCardFromBinder: vi.fn(),
  push: vi.fn((_input: { message: string; onAction?: () => void }) => 'toast-1'),
  fetchPrintings: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  carouselOpen: vi.fn(),
  results: [] as unknown[],
  cards: [] as Array<{ copyId: string; name: string }>,
}));

vi.mock('../store/collection', () => {
  const state = {
    get cards() {
      return h.cards;
    },
    addCard: h.addCard,
    replaceAllCards: h.replaceAllCards,
    pinCardToBinder: h.pinCardToBinder,
    removeCardFromBinder: h.removeCardFromBinder,
  };
  const useCollectionStore = (selector: (s: typeof state) => unknown) => selector(state);
  useCollectionStore.getState = () => state;
  return { useCollectionStore };
});

vi.mock('../store/toasts', () => ({
  useToastsStore: (selector: (s: { push: typeof h.push }) => unknown) => selector({ push: h.push }),
}));

vi.mock('../lib/use-search-cards', () => ({
  useSearchCards: () => ({ results: h.results, loading: false, error: null }),
}));

vi.mock('../lib/api', () => ({ fetchPrintings: h.fetchPrintings }));

vi.mock('../lib/haptics', () => ({ haptics: { tap: () => {} } }));

// The carousel itself is covered by its own suite — here we only care that the
// row's thumbnail is wired to open it with every result as a slide.
vi.mock('./deck/useCardCarousel', () => ({
  useCardCarousel: () => ({ open: h.carouselOpen, preview: null }),
}));

import { AddCardSearchPanel } from './AddCardSearchPanel';

/** Mount and flush the panel's result-reset effect, which defers its setState to
 *  a microtask — without this the pending reset lands *after* the first click
 *  and silently collapses whatever the test just opened. */
async function mount() {
  const view = render(<AddCardSearchPanel autoFocus={false} />);
  await act(async () => {});
  return view;
}

function card(id: string, over: Record<string, unknown> = {}): ScryfallCard {
  return {
    id,
    name: 'Sol Ring',
    set: 'ltr',
    set_name: 'The Lord of the Rings',
    collector_number: '123',
    finishes: ['nonfoil', 'foil'],
    prices: { usd: '1.50' },
    image_uris: { normal: `https://cards.scryfall.io/normal/${id}.jpg` },
    ...over,
  } as unknown as ScryfallCard;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.addCard.mockResolvedValue(['c1']);
  h.fetchPrintings.mockResolvedValue([]);
  h.results = [card('a')];
  h.cards = [];
});

describe('AddCardSearchPanel', () => {
  it('leads each result with the card image, wired to the preview carousel', async () => {
    await mount();
    const thumb = screen.getByRole('button', { name: 'Preview Sol Ring' });
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe(
      'https://cards.scryfall.io/normal/a.jpg'
    );

    fireEvent.click(thumb);
    expect(h.carouselOpen).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'Sol Ring', card: expect.objectContaining({ id: 'a' }) })],
      'Sol Ring'
    );
  });

  it('confirms an add with a toast naming the printing that landed', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Sol Ring' }));

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    expect(h.push.mock.calls[0][0]).toMatchObject({
      message: 'Added Sol Ring · LTR #123',
      tone: 'success',
      actionLabel: 'Undo',
    });
  });

  it('shows every printing as a tile with its own art, and rings the selected one', async () => {
    h.fetchPrintings.mockResolvedValue([card('a'), card('b', { collector_number: '456' })]);
    const { container } = await mount();
    fireEvent.click(screen.getByRole('button', { name: /Printing & finish/ }));

    const options = await waitFor(() => {
      const found = container.querySelectorAll('.inline-card-search-printing');
      expect(found.length).toBe(2);
      return Array.from(found);
    });
    // Both printings render their OWN art — the whole point of the picker.
    expect(options.map((o) => o.querySelector('img')?.getAttribute('src'))).toEqual([
      'https://cards.scryfall.io/normal/a.jpg',
      'https://cards.scryfall.io/normal/b.jpg',
    ]);
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.click(options[1]);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
  });

  it("undoing from the toast drops that add's whole batch, not just the last copy", async () => {
    h.fetchPrintings.mockResolvedValue([card('a')]);
    h.addCard.mockResolvedValue(['c1', 'c2', 'c3']);
    h.cards = [
      { copyId: 'keep', name: 'Forest' },
      { copyId: 'c1', name: 'Sol Ring' },
      { copyId: 'c2', name: 'Sol Ring' },
      { copyId: 'c3', name: 'Sol Ring' },
    ];

    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Printing & finish/ }));
    const bump = await screen.findByRole('button', { name: 'Increase quantity' });
    fireEvent.click(bump);
    fireEvent.click(bump);
    fireEvent.click(screen.getByRole('button', { name: /^Add 3 ×/ }));

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const toast = h.push.mock.calls[0][0] as unknown as {
      message: string;
      onAction: () => void;
    };
    expect(toast.message).toBe('Added 3 × Sol Ring · LTR #123 · Non-foil');

    toast.onAction();
    await waitFor(() => expect(h.replaceAllCards).toHaveBeenCalled());
    expect(h.replaceAllCards.mock.calls[0][0]).toEqual([{ copyId: 'keep', name: 'Forest' }]);
  });
});
