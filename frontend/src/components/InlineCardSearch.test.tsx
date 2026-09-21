// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InlineCardSearch } from './InlineCardSearch';

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
  searchCards: vi.fn(),
  getCardsByNames: vi.fn(async () => []),
  getPrintings: vi.fn(async () => []),
}));

const card = (i: number) =>
  ({
    id: `id-${i}`,
    name: `Card ${i}`,
    type_line: 'Creature',
    prices: {},
  }) as never;

async function searchWith(count: number, total: number) {
  const { searchCards } = await import('@/deck-builder/services/scryfall/client');
  (searchCards as ReturnType<typeof vi.fn>).mockResolvedValue({
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
