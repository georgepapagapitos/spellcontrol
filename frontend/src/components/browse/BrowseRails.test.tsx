// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowseListId, BrowsePage } from '@/lib/browse-lists';
import { useCollectionStore } from '@/store/collection';
import { pending } from '@/test/pending';
import type { EnrichedCard } from '@/types';

const h = vi.hoisted(() => ({
  loadBrowseList: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@/lib/browse-lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/browse-lists')>()),
  loadBrowseList: h.loadBrowseList,
}));
// The preview is the carousel's own business (useCardCarousel's tests); here
// it only has to open with the right cards.
vi.mock('@/components/deck/useCardCarousel', () => ({
  useCardCarousel: () => ({ open: h.open, preview: null }),
}));
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { BrowseRails } from './BrowseRails';

const HOUR = 60 * 60 * 1000;

function page(id: BrowseListId, names: string[], extra: Partial<BrowsePage> = {}): BrowsePage {
  return {
    items: names.map((name) => ({
      name,
      numDecks: 20_100,
      potentialDecks: id === 'cards' ? 24_000 : null,
      salt: id === 'salt' ? 3.06 : null,
    })),
    hasMore: false,
    ...(id === 'commanders' || id === 'cards' || id === 'salt'
      ? {
          edhrec: {
            fetchedAt: Date.now() - 3 * HOUR,
            stale: false,
            sourceUrl: `https://edhrec.com/${id}`,
          },
        }
      : {}),
    ...extra,
  };
}

function names(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
}

function renderRails() {
  return render(
    <MemoryRouter>
      <BrowseRails />
    </MemoryRouter>
  );
}

function rail(title: string) {
  const heading = screen.getByRole('heading', { name: title });
  return heading.closest('section') as HTMLElement;
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

beforeEach(() => {
  setOnline(true);
  h.loadBrowseList.mockImplementation(async (id: BrowseListId) => page(id, names(12, id)));
});
afterEach(() => {
  vi.clearAllMocks();
  useCollectionStore.setState({ cards: [] });
});

describe('BrowseRails', () => {
  it('shows every list as a rail of its first ten cards, each with a door to the full list', async () => {
    renderRails();

    for (const [title, href] of [
      ['Top commanders', '/search/top/commanders'],
      ['New commanders', '/search/top/new-commanders'],
      ['Top cards', '/search/top/cards'],
      ['Game Changers', '/search/top/game-changers'],
      ['Saltiest cards', '/search/top/salt'],
      ['Banned in Commander', '/search/top/banned'],
    ]) {
      await waitFor(() => expect(within(rail(title)).queryAllByRole('button')).toHaveLength(10));
      expect(
        within(rail(title))
          .getByRole('link', { name: /see all/i })
          .getAttribute('href')
      ).toBe(href);
    }
  });

  it("puts each list's number under its tiles", async () => {
    renderRails();
    await waitFor(() => screen.getByRole('button', { name: /commanders 1, 20k decks$/ }));
    expect(screen.getByRole('button', { name: /^cards 1, In 84% of decks$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^salt 1, Salt 3\.06$/ })).toBeTruthy();
  });

  it('marks the cards the viewer owns', async () => {
    useCollectionStore.setState({ cards: [{ name: 'banned 2' } as EnrichedCard] });
    renderRails();
    const tile = await screen.findByRole('button', { name: 'banned 2, in your collection' });
    expect(within(tile).getByRole('img', { name: 'In your collection' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'banned 1' })).toBeTruthy();
  });

  it('opens the preview across the rail from the tapped card', async () => {
    renderRails();
    fireEvent.click(await screen.findByRole('button', { name: /^cards 3,/ }));
    const [entries, tapped] = h.open.mock.calls[0];
    expect(tapped).toBe('cards 3');
    expect(entries).toHaveLength(10);
    expect(entries[2]).toMatchObject({
      name: 'cards 3',
      label: 'In 84% of the decks that could run it',
    });
  });

  it('holds each rail open with card-shaped placeholders while it loads', () => {
    h.loadBrowseList.mockReturnValue(pending(page('game-changers', [])));
    renderRails();
    const loading = rail('Game Changers');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.querySelectorAll('.list-entries-grid-cell--skeleton')).toHaveLength(10);
    expect(within(loading).getByRole('status').textContent).toBe('Loading game changers…');
  });

  it('offers Retry when a list fails, and loads it again', async () => {
    h.loadBrowseList.mockImplementation(async (id: BrowseListId) => {
      if (id === 'salt') throw new Error("Couldn't reach EDHREC.");
      return page(id, names(3, id));
    });
    renderRails();

    const strip = await within(await waitFor(() => rail('Saltiest cards'))).findByRole('alert');
    expect(strip.textContent).toContain("Couldn't reach EDHREC.");

    h.loadBrowseList.mockImplementation(async (id: BrowseListId) => page(id, names(3, id)));
    fireEvent.click(within(strip).getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(within(rail('Saltiest cards')).getAllByRole('button')).toHaveLength(3)
    );
  });

  it('leaves out a list that comes back empty', async () => {
    h.loadBrowseList.mockImplementation(async (id: BrowseListId) =>
      page(id, id === 'banned' ? [] : names(2, id))
    );
    renderRails();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^salt / })).toHaveLength(2));
    expect(screen.queryByRole('heading', { name: 'Banned in Commander' })).toBeNull();
  });

  it('offline, stands the network lists aside behind one line and keeps what the device has', async () => {
    setOnline(false);
    h.loadBrowseList.mockImplementation(async (id: BrowseListId) => {
      if (id === 'banned') throw new Error('Failed to fetch');
      return page(id, names(2, id));
    });
    renderRails();

    expect(screen.getByText('Popular and new card lists need a connection.')).toBeTruthy();
    await waitFor(() =>
      expect(within(rail('Game Changers')).getAllByRole('button')).toHaveLength(2)
    );
    for (const title of [
      'Top commanders',
      'New commanders',
      'Top cards',
      'Saltiest cards',
      'Banned in Commander',
    ]) {
      expect(screen.queryByRole('heading', { name: title })).toBeNull();
    }
    expect(h.loadBrowseList.mock.calls.map(([id]) => id).sort()).toEqual([
      'banned',
      'game-changers',
    ]);
  });

  it('brings the network lists back when the connection returns', async () => {
    setOnline(false);
    renderRails();
    expect(screen.queryByRole('heading', { name: 'Top cards' })).toBeNull();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(within(rail('Top cards')).getAllByRole('button')).toHaveLength(10));
    expect(screen.queryByText('Popular and new card lists need a connection.')).toBeNull();
  });

  it('names its sources, linking each list to its own page there', async () => {
    renderRails();
    const line = await screen.findByText(/from EDHREC/);
    await waitFor(() => expect(line.textContent).toContain('updated 3 hours ago'));
    expect(within(line).getByRole('link', { name: 'Top commanders' }).getAttribute('href')).toBe(
      'https://edhrec.com/commanders/week'
    );
    expect(within(line).getByRole('link', { name: 'salt scores' }).getAttribute('href')).toBe(
      'https://edhrec.com/top/salt'
    );
    expect(within(line).getByRole('link', { name: 'bans' }).getAttribute('href')).toBe(
      'https://scryfall.com/search?q=banned%3Acommander'
    );
  });

  it("says so when EDHREC couldn't be reached and the lists are older", async () => {
    h.loadBrowseList.mockImplementation(async (id: BrowseListId) => {
      const p = page(id, names(2, id));
      if (id === 'salt' && p.edhrec)
        p.edhrec = { ...p.edhrec, stale: true, fetchedAt: Date.now() - 50 * HOUR };
      return p;
    });
    renderRails();
    const line = await screen.findByText(/from EDHREC/);
    await waitFor(() =>
      expect(line.textContent).toContain(
        "which couldn't be reached, so its lists are from 2 days ago"
      )
    );
  });
});
