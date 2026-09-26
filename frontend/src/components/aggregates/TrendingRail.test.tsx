// @vitest-environment happy-dom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { pending } from '@/test/pending';

const mockUseCardThumb = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: mockUseCardThumb }));

import { TrendingRail, type TrendingDeck } from './TrendingRail';

interface RisingCommanderFixture {
  commanderKey: string;
  commanderName: string;
  partnerName: string | null;
  deckCount: number;
  newLast7d: number;
}

const risingFixture: RisingCommanderFixture[] = [
  {
    commanderKey: 'cmd-atraxa',
    commanderName: "Atraxa, Praetors' Voice",
    partnerName: null,
    deckCount: 120,
    newLast7d: 5,
  },
  {
    commanderKey: 'cmd-rising',
    commanderName: 'Rising Commander',
    partnerName: null,
    deckCount: 10,
    newLast7d: 8,
  },
];

const trendingDecksFixture: TrendingDeck[] = [
  {
    slug: 'meren-of-clan-nel-toth-a1b2c3d4',
    deckName: "Meren's Graveyard Value",
    commanderName: 'Meren of Clan Nel Toth',
    players: 9,
  },
  {
    slug: 'thrasios-tymna-e5f6a7b8',
    deckName: 'Thrasios/Tymna Stax',
    commanderName: 'Thrasios, Triton Hero',
    players: 5,
  },
  {
    slug: 'krenko-mob-boss-c9d0e1f2',
    deckName: 'Krenko Go Wide',
    commanderName: null,
    players: 3,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetchResolved(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, status)));
}

/** The skeleton renders the section headings too, so "Rising commanders"
 *  being on screen says nothing about the fetch — wait for the loading
 *  status to leave instead (E272: a wait on skeleton text let the tile
 *  assertions run before the stubbed fetch settled, under suite load). */
const loaded = () => waitFor(() => expect(screen.queryByText('Loading trending decks')).toBeNull());

function renderRail(enabled = true) {
  return render(
    <MemoryRouter>
      <TrendingRail enabled={enabled} />
    </MemoryRouter>
  );
}

describe('TrendingRail', () => {
  // The remembered rail shape is written from an effect that can land after a
  // test's last await, so it is cleared at the START of each test, not the end.
  beforeEach(() => localStorage.removeItem('sc-trending-shape'));
  afterEach(() => {
    vi.unstubAllGlobals();
    mockUseCardThumb.mockClear();
  });

  it('enabled=false never fires the initial fetch', () => {
    stubFetchResolved({ risingCommanders: [] });
    renderRail(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fires the fetch once enabled flips true', async () => {
    stubFetchResolved({ risingCommanders: risingFixture });
    const { rerender } = render(
      <MemoryRouter>
        <TrendingRail enabled={false} />
      </MemoryRouter>
    );
    expect(fetch).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <TrendingRail enabled={true} />
      </MemoryRouter>
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it('shows a skeleton while pending, never a spinner', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending(new Response('{}')))
    );
    renderRail();
    expect(screen.getByText('Loading trending decks')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeTruthy();
    // A first visit reserves a full section (the common production shape),
    // so the browse grid beneath does not shift when data lands.
    expect(document.querySelectorAll('.trending-tile-skeleton')).toHaveLength(10);
  });

  it('reserves the shape the rail had last time: its tile count, or nothing when it was empty', async () => {
    stubFetchResolved({ risingCommanders: risingFixture });
    const { unmount } = renderRail();
    await loaded();
    expect(screen.getByText('Rising commanders')).toBeTruthy();
    await waitFor(() =>
      expect(localStorage.getItem('sc-trending-shape')).toBe(String(risingFixture.length))
    );
    unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending(new Response('{}')))
    );
    renderRail();
    expect(document.querySelectorAll('.trending-tile-skeleton')).toHaveLength(risingFixture.length);

    localStorage.setItem('sc-trending-shape', '0');
    const { container } = renderRail();
    expect(container.querySelector('.trending-rail')).toBeNull();
  });

  it('renders nothing at all when neither list has anything in it', async () => {
    stubFetchResolved({ risingCommanders: [], trendingDecks: [] });
    const { container } = renderRail();
    await loaded();
    await waitFor(() => expect(container.querySelector('.trending-rail')).toBeNull());
    expect(container.textContent).toBe('');
  });

  it('reads an API without trendingDecks as empty', async () => {
    stubFetchResolved({ risingCommanders: [] });
    const { container } = renderRail();
    await loaded();
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('renders only the rising sub-section when no deck qualifies', async () => {
    stubFetchResolved({ risingCommanders: risingFixture });
    renderRail();
    await loaded();
    expect(screen.getByText('Rising commanders')).toBeTruthy();
    expect(screen.queryByText('Popular this week')).toBeNull();
    expect(screen.getByText(`Build with ${risingFixture[0].commanderName}`)).toBeTruthy();
  });

  it('renders both sub-sections when both are present', async () => {
    stubFetchResolved({ risingCommanders: risingFixture, trendingDecks: trendingDecksFixture });
    renderRail();
    await loaded();
    expect(screen.getByText('Rising commanders')).toBeTruthy();
    expect(screen.getByText('Popular this week')).toBeTruthy();
  });

  it('shows an error state with Retry, and Retry re-fetches into content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'down' }, 500)));
    renderRail();
    await waitFor(() =>
      expect(screen.getByText("Couldn't load trending decks right now.")).toBeTruthy()
    );
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ risingCommanders: risingFixture }))
    );
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await loaded();
    expect(screen.getByText('Rising commanders')).toBeTruthy();
  });

  describe('popular-this-week sub-section (independently testable from rising commanders)', () => {
    it('renders tiles in rank order linking to /d/{slug}, names how many players, and resolves art by commander', async () => {
      // risingCommanders is deliberately empty here -- proves this sub-section
      // renders correctly on its own, decoupled from the rising section.
      stubFetchResolved({ risingCommanders: [], trendingDecks: trendingDecksFixture });
      renderRail();
      await waitFor(() => expect(screen.getByText('Popular this week')).toBeTruthy());
      expect(screen.queryByText('Rising commanders')).toBeNull();

      const links = screen.getAllByRole('link');
      expect(links.map((l) => l.getAttribute('href'))).toEqual([
        '/d/meren-of-clan-nel-toth-a1b2c3d4',
        '/d/thrasios-tymna-e5f6a7b8',
        '/d/krenko-mob-boss-c9d0e1f2',
      ]);
      expect(links[0].textContent).toContain('9 players this week');
      expect(screen.getByTitle('5 players this week')).toBeTruthy();

      expect(screen.getByText('Meren of Clan Nel Toth')).toBeTruthy();
      expect(screen.getByText('Thrasios, Triton Hero')).toBeTruthy();
      // No commander: no empty commander line under the name.
      expect(links[2].querySelector('.commander-result-type')).toBeNull();

      // `small`, not `normal`: the tile art box is 2.6rem wide, and the
      // landing page renders this rail — `normal` was ~100 KB per tile there.
      expect(mockUseCardThumb).toHaveBeenCalledWith('Meren of Clan Nel Toth', 'small');
      expect(mockUseCardThumb).toHaveBeenCalledWith('Thrasios, Triton Hero', 'small');
    });
  });

  describe('TrendingCommanderTile', () => {
    it('renders as a real anchor, never a button, with honest non-prefill-claiming copy', async () => {
      stubFetchResolved({ risingCommanders: risingFixture });
      renderRail();
      await loaded();
      expect(screen.getByText('Rising commanders')).toBeTruthy();

      const link = screen.getByRole('link', {
        name: `Build a deck with ${risingFixture[0].commanderName}`,
      });
      expect(link.getAttribute('href')).toBe('/decks/new');
      expect(screen.queryByRole('button', { name: /praetors/i })).toBeNull();
      expect(link.getAttribute('title')).toBeNull();
      expect(mockUseCardThumb).toHaveBeenCalledWith("Atraxa, Praetors' Voice", 'small');
    });

    it('clicking navigates to /decks/new (router test wrapper, not a real navigation)', async () => {
      stubFetchResolved({ risingCommanders: risingFixture });
      render(
        <MemoryRouter initialEntries={['/discover']}>
          <Routes>
            <Route path="/discover" element={<TrendingRail enabled={true} />} />
            <Route path="/decks/new" element={<div>New deck sentinel</div>} />
          </Routes>
        </MemoryRouter>
      );
      await loaded();
      expect(screen.getByText('Rising commanders')).toBeTruthy();
      fireEvent.click(screen.getAllByRole('link', { name: /build a deck with/i })[0]);
      await waitFor(() => expect(screen.getByText('New deck sentinel')).toBeTruthy());
    });
  });
});
