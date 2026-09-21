// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StarterDeckPlaytestPage } from './StarterDeckPlaytestPage';
import { pending } from '../test/pending';
import type { ProductResolveResponse } from '../types';

const fetchProduct = vi.fn();
const toastShow = vi.fn();

vi.mock('@/lib/api', () => ({ fetchProduct: (...a: unknown[]) => fetchProduct(...a) }));
vi.mock('@/store/toasts', () => ({ toast: { show: (...a: unknown[]) => toastShow(...a) } }));

// The board is exercised by the playtest suite; what matters here is that the
// resolved deck reaches it, external, with the starter's id.
vi.mock('@/playtest/components/PlaytestSession', () => ({
  PlaytestSession: ({
    deck,
    external,
  }: {
    deck: { id: string; name: string };
    external?: boolean;
  }) => (
    <div data-testid="board" data-deck-id={deck.id} data-external={String(!!external)}>
      {deck.name}
    </div>
  ),
}));

function resolved(over: Partial<ProductResolveResponse['deck']> = {}): ProductResolveResponse {
  return {
    product: {
      fileName: 'precon.json',
      code: 'abc',
      name: 'Squirreled Away',
      type: 'Commander Deck',
      releaseDate: '2026-01-01',
    },
    deck: {
      commander: null,
      companion: null,
      cards: [{ id: 'sol-ring', name: 'Sol Ring' }],
      unresolvedNames: [],
      fetchErrors: [],
      detectedFormat: 'commander',
      cardCount: 1,
      ...over,
    },
    physicalCards: [],
    unresolvedNames: [],
    fetchErrors: [],
    physicalCardCount: 1,
  } as unknown as ProductResolveResponse;
}

function renderAt(fileName = 'precon.json') {
  render(
    <MemoryRouter initialEntries={[`/decks/starters/${fileName}/playtest`]}>
      <Routes>
        <Route path="/decks/starters/:fileName/playtest" element={<StarterDeckPlaytestPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchProduct.mockResolvedValue(resolved());
});

afterEach(() => {
  fetchProduct.mockReset();
  toastShow.mockReset();
});

describe('StarterDeckPlaytestPage', () => {
  it('says it is dealing before the deck resolves', () => {
    fetchProduct.mockReturnValue(pending(resolved()));
    renderAt();
    expect(screen.getByText(/Dealing the starter deck/)).toBeTruthy();
  });

  it('hands the resolved precon to the board as an external deck', async () => {
    renderAt();
    const board = await screen.findByTestId('board');
    expect(board.getAttribute('data-external')).toBe('true');
    // The seat's deck id and the board's deck id are the same string, which is
    // what lets an online seat on a starter open this route.
    expect(board.getAttribute('data-deck-id')).toBe('starter:precon.json');
    expect(board.textContent).toBe('Squirreled Away');
  });

  it('announces cards it could not look up rather than dealing a short deck', async () => {
    fetchProduct.mockResolvedValue(resolved({ unresolvedNames: ['Ancestral Recall'] }));
    renderAt();
    await screen.findByTestId('board');
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'warn', message: expect.stringContaining('1 card') })
    );
  });

  it('offers a way back when the product cannot be resolved', async () => {
    fetchProduct.mockRejectedValue(new Error('Failed to fetch'));
    renderAt();
    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't load that starter deck"
    );
    expect(screen.getByRole('link', { name: 'Back to decks' })).toBeTruthy();
  });

  it('resolves the file name the URL escaped', async () => {
    renderAt(encodeURIComponent('Fate Reforged.json'));
    await waitFor(() => expect(fetchProduct).toHaveBeenCalledWith('Fate Reforged.json'));
  });
});
