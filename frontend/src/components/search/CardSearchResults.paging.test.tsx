// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import { CardSearchResults } from './CardSearchResults';

const cards = (from: number, to: number): ScryfallCard[] =>
  Array.from(
    { length: to - from },
    (_, i) =>
      ({
        id: `c${from + i}`,
        name: `Card ${from + i}`,
        set: 'tst',
        set_name: 'Test',
        collector_number: String(from + i),
        finishes: ['nonfoil'],
        prices: {},
      }) as unknown as ScryfallCard
  );

describe('CardSearchResults paging (E341)', () => {
  it('fetches the next page once every loaded row is shown and Scryfall has more', async () => {
    const onLoadMore = vi.fn(async () => true);
    const { rerender } = render(
      <CardSearchResults
        results={cards(0, 3)}
        pageSize={2}
        total={10}
        hasMore
        onLoadMore={onLoadMore}
      />
    );
    // Rows still hidden: the button reveals, it does not fetch.
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));
    expect(onLoadMore).not.toHaveBeenCalled();

    // Everything loaded is now shown: the same slot fetches.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <CardSearchResults
        results={cards(0, 6)}
        pageSize={2}
        total={10}
        hasMore
        onLoadMore={onLoadMore}
      />
    );
    await act(async () => {});
    // Appending keeps the reveal window and reveals one more step of rows.
    expect(screen.getByText(/Card 4/)).toBeTruthy();
    expect(screen.queryByText(/Card 5/)).toBeNull();
  });

  it('shows a busy, same-slot button while the page loads', () => {
    render(
      <CardSearchResults
        results={cards(0, 2)}
        pageSize={5}
        total={10}
        hasMore
        loadingMore
        onLoadMore={vi.fn(async () => true)}
      />
    );
    const btn = screen.getByRole('button', { name: 'Loading more…' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps loaded rows and offers Try again when a page fails', () => {
    render(
      <CardSearchResults
        results={cards(0, 2)}
        pageSize={5}
        total={10}
        hasMore
        moreError="Couldn't load more results."
        onLoadMore={vi.fn(async () => false)}
      />
    );
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load more");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByText(/Card 1/)).toBeTruthy();
  });

  it('says "Narrow the search" only where paging is not offered', () => {
    const { unmount } = render(<CardSearchResults results={cards(0, 2)} pageSize={5} total={10} />);
    expect(screen.getByText(/Showing 2 of 10 matches\. Narrow the search/)).toBeTruthy();
    unmount();

    render(
      <CardSearchResults
        results={cards(0, 2)}
        pageSize={5}
        total={10}
        hasMore
        onLoadMore={vi.fn(async () => true)}
      />
    );
    const line = screen.getByText(/Showing 2 of 10 matches\./);
    expect(line.textContent).not.toContain('Narrow');
  });

  it('has no fetch button once Scryfall has nothing more', () => {
    render(
      <CardSearchResults
        results={cards(0, 2)}
        pageSize={5}
        total={2}
        onLoadMore={vi.fn(async () => true)}
      />
    );
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
