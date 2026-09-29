// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowseFilters, BrowseListId, BrowsePage } from '@/lib/browse-lists';
import type { CardPreviewAction } from '@/components/CardPreview';
import type { CarouselEntry } from '@/components/deck/useCardCarousel';
import { useCollectionStore } from '@/store/collection';
import { pending } from '@/test/pending';
import type { EnrichedCard } from '@/types';

const h = vi.hoisted(() => ({
  loadBrowseList: vi.fn(),
  open: vi.fn(),
  getActions: undefined as ((entry: CarouselEntry, i: number) => CardPreviewAction[]) | undefined,
  navigate: vi.fn(),
}));

vi.mock('@/lib/browse-lists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/browse-lists')>()),
  loadBrowseList: h.loadBrowseList,
}));
vi.mock('@/components/deck/useCardCarousel', () => ({
  useCardCarousel: (
    _name: string,
    getActions?: (entry: CarouselEntry, i: number) => CardPreviewAction[]
  ) => {
    h.getActions = getActions;
    return { open: h.open, preview: null };
  },
}));
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}));

import { BrowseListPage } from './BrowseListPage';

function edhrecPage(names: string[], extra: Partial<BrowsePage> = {}): BrowsePage {
  return {
    items: names.map((name, i) => ({
      name,
      numDecks: 5000 - i,
      potentialDecks: null,
      salt: null,
    })),
    hasMore: false,
    edhrec: {
      fetchedAt: Date.now() - 2 * 60 * 60 * 1000,
      stale: false,
      sourceUrl: 'https://edhrec.com/commanders/week',
    },
    ...extra,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location">{`${loc.pathname}${loc.search}`}</span>;
}
const location = () => screen.getByTestId('location').textContent;

function renderList(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/search/top/:list" element={<BrowseListPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
}

const lastFilters = (): BrowseFilters => h.loadBrowseList.mock.lastCall?.[1];

beforeEach(() => {
  h.loadBrowseList.mockImplementation(async () =>
    edhrecPage(['Ygra, Eater of All', 'Jace, Multiverse Architect'])
  );
});
afterEach(() => {
  vi.clearAllMocks();
  useCollectionStore.setState({ cards: [] });
});

describe('BrowseListPage', () => {
  it('shows the whole list with its stat, source and freshness', async () => {
    renderList('/search/top/commanders');

    expect(screen.getByRole('heading', { level: 1, name: 'Top commanders' })).toBeTruthy();
    expect(screen.getByText('The commanders most built on EDHREC this week.')).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Ygra, Eater of All, 5k decks' })
    ).toBeTruthy();
    const source = screen.getByText(/Data from/);
    expect(source.textContent).toBe('Data from EDHREC · updated 2 hours ago');
    expect(within(source).getByRole('link', { name: 'EDHREC' }).getAttribute('href')).toBe(
      'https://edhrec.com/commanders/week'
    );
    expect(screen.getByRole('link', { name: 'Search' }).getAttribute('href')).toBe('/search');
    expect(document.title).toContain('Top commanders');
  });

  it('says plainly when EDHREC was down and the list is an older copy', async () => {
    h.loadBrowseList.mockResolvedValue(
      edhrecPage(['Ygra, Eater of All'], {
        edhrec: {
          fetchedAt: Date.now() - 26 * 60 * 60 * 1000,
          stale: true,
          sourceUrl: 'https://edhrec.com/commanders/week',
        },
      })
    );
    renderList('/search/top/commanders');
    expect((await screen.findByText(/couldn't be reached/)).textContent).toBe(
      "EDHREC couldn't be reached, so this list is from 1 day ago."
    );
  });

  it('puts the period in the URL and asks for that window', async () => {
    renderList('/search/top/commanders');
    await screen.findByRole('button', { name: /Ygra/ });

    fireEvent.click(screen.getByRole('radio', { name: 'Month' }));

    expect(location()).toBe('/search/top/commanders?period=month');
    await waitFor(() => expect(lastFilters()).toMatchObject({ period: 'month' }));
    expect(screen.getByText('The commanders most built on EDHREC this month.')).toBeTruthy();
  });

  it('locks a colour list to the past 2 years and says why', async () => {
    renderList('/search/top/cards?period=week&colors=UW&type=mana-artifacts');

    await waitFor(() =>
      expect(lastFilters()).toMatchObject({ period: 'year', colors: 'WU', type: 'mana-artifacts' })
    );
    expect((screen.getByRole('radio', { name: 'Week' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: '2 years' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Color and type lists cover the past 2 years.')).toBeTruthy();
    expect(
      screen.getByText('The Azorius mana rocks most played on EDHREC over the past 2 years.')
    ).toBeTruthy();
  });

  it('picks colours with the shared pips, writing them to the URL', async () => {
    renderList('/search/top/commanders?period=month');
    await screen.findByRole('button', { name: /Ygra/ });

    fireEvent.click(screen.getByRole('button', { name: 'White' }));
    expect(location()).toBe('/search/top/commanders?period=month&colors=W');
    expect(
      screen.getByText('The mono-white commanders most built on EDHREC over the past 2 years.')
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Colorless' }));
    expect(location()).toBe('/search/top/commanders?period=month&colors=C');
  });

  it('narrows to the cards in the collection, and offers the way back when none are', async () => {
    useCollectionStore.setState({
      cards: [{ name: 'Jace, Multiverse Architect' } as EnrichedCard],
    });
    renderList('/search/top/commanders');
    await screen.findByRole('button', { name: /Ygra/ });

    fireEvent.click(screen.getByRole('radio', { name: 'In my collection' }));
    expect(location()).toBe('/search/top/commanders?show=owned');
    expect(screen.queryByRole('button', { name: /Ygra/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: /Jace, Multiverse Architect, .*in your collection/ })
    ).toBeTruthy();

    useCollectionStore.setState({ cards: [{ name: 'Sol Ring' } as EnrichedCard] });
    expect(await screen.findByText('None of these are in your collection.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(location()).toBe('/search/top/commanders');
  });

  it("doesn't offer the collection filter without a collection", async () => {
    renderList('/search/top/commanders');
    await screen.findByRole('button', { name: /Ygra/ });
    expect(screen.queryByRole('radio', { name: 'In my collection' })).toBeNull();
  });

  it('opens a commander in the preview with Build a deck', async () => {
    renderList('/search/top/commanders');
    fireEvent.click(await screen.findByRole('button', { name: /Jace/ }));

    const [entries, tapped] = h.open.mock.calls[0];
    expect(tapped).toBe('Jace, Multiverse Architect');
    expect(entries.map((e: CarouselEntry) => e.label)).toEqual(['5k decks', '5k decks']);

    const [build] = h.getActions!(entries[1], 1);
    expect(build).toMatchObject({ label: 'Build a deck', closesPreview: true });
    build.onClick();
    expect(h.navigate).toHaveBeenCalledWith(
      '/decks/new/generate?commander=Jace%2C%20Multiverse%20Architect'
    );
  });

  it('keeps card lists free of the commander action', async () => {
    renderList('/search/top/salt');
    await screen.findByRole('button', { name: /Ygra/ });
    expect(h.getActions).toBeUndefined();
  });

  it('holds the grid while loading, then offers Retry when the list fails', async () => {
    h.loadBrowseList.mockReturnValueOnce(pending(edhrecPage([])));
    const { unmount } = renderList('/search/top/salt');
    expect(screen.getByRole('status').textContent).toBe('Loading saltiest cards…');
    expect(document.querySelectorAll('.list-entries-grid-cell--skeleton').length).toBeGreaterThan(
      0
    );
    unmount();

    h.loadBrowseList.mockRejectedValueOnce(new Error("Couldn't reach EDHREC."));
    renderList('/search/top/salt');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't reach EDHREC.");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Ygra/ })).toBeTruthy();
  });

  it('offers to clear the filters when EDHREC has no list for them', async () => {
    h.loadBrowseList.mockResolvedValue(edhrecPage([]));
    renderList('/search/top/cards?colors=WUBRG&type=battles');
    expect(await screen.findByText('EDHREC has no list for this yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(location()).toBe('/search/top/cards');
  });

  it('pages through new commanders', async () => {
    const card = (name: string) => ({ name, releasedAt: '2026-08-14' });
    h.loadBrowseList.mockImplementation(async (_id: BrowseListId, _f: BrowseFilters, p = 1) => ({
      items: p === 1 ? [card('Smaug the Magnificent')] : [card('Thorin, King of Durin’s Folk')],
      hasMore: p === 1,
    }));
    renderList('/search/top/new-commanders');

    expect(
      await screen.findByRole('button', { name: /Smaug the Magnificent, Released Aug 14/ })
    ).toBeTruthy();
    expect(screen.queryByText(/Data from/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('button', { name: /Thorin/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('keeps what loaded when the next page fails, and retries it', async () => {
    h.loadBrowseList
      .mockResolvedValueOnce({ items: [{ name: 'Smaug the Magnificent' }], hasMore: true })
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ items: [{ name: 'Bard, Heir of Girion' }], hasMore: false });
    renderList('/search/top/new-commanders');

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load more of this list.");
    expect(screen.getByRole('button', { name: /Smaug/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Bard/ })).toBeTruthy();
  });

  it('reads an unknown list as a broken link', () => {
    renderList('/search/top/best-cards');
    expect(screen.getByText('Page not found.')).toBeTruthy();
    expect(h.loadBrowseList).not.toHaveBeenCalled();
  });
});
