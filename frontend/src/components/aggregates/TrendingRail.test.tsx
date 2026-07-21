// @vitest-environment happy-dom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, afterEach } from 'vitest';

const mockUseCardThumb = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: mockUseCardThumb }));

import { TrendingRail, type TopCopiedDeck } from './TrendingRail';

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

// Verbatim from the w4-trending spec's "Fixture for the most-copied
// sub-section's independent testability" block.
const topCopiedDecksFixture: TopCopiedDeck[] = [
  {
    deckId: 'd-1',
    slug: 'meren-of-clan-nel-toth-a1b2c3d4',
    deckName: "Meren's Graveyard Value",
    commanderName: 'Meren of Clan Nel Toth',
    partnerName: null,
    score: 41.2,
  },
  {
    deckId: 'd-2',
    slug: 'thrasios-tymna-e5f6a7b8',
    deckName: 'Thrasios/Tymna Stax',
    commanderName: 'Thrasios, Triton Hero',
    partnerName: 'Tymna the Weaver',
    score: 33.7,
  },
  {
    deckId: 'd-3',
    slug: 'krenko-mob-boss-c9d0e1f2',
    deckName: 'Krenko Go Wide',
    commanderName: 'Krenko, Mob Boss',
    partnerName: null,
    score: 12.4,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetchResolved(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, status)));
}

function renderRail(enabled = true) {
  return render(
    <MemoryRouter>
      <TrendingRail enabled={enabled} />
    </MemoryRouter>
  );
}

describe('TrendingRail', () => {
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
      vi.fn(() => new Promise(() => {}))
    );
    renderRail();
    expect(screen.getByText('Loading trending decks')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeTruthy();
  });

  it('shows the exact empty-both copy when neither sub-section has data', async () => {
    stubFetchResolved({ risingCommanders: [] });
    renderRail();
    await waitFor(() => expect(screen.getByText('Nothing trending yet.')).toBeTruthy());
    expect(screen.getByText('Publish a deck to be the first commander on the board.')).toBeTruthy();
  });

  it('renders only the rising sub-section when topCopiedDecks is absent', async () => {
    stubFetchResolved({ risingCommanders: risingFixture });
    renderRail();
    await waitFor(() => expect(screen.getByText('Rising commanders')).toBeTruthy());
    expect(screen.queryByText('Most copied decks')).toBeNull();
    expect(screen.getByText(`Build with ${risingFixture[0].commanderName}`)).toBeTruthy();
  });

  it('renders both sub-sections when both are present', async () => {
    stubFetchResolved({ risingCommanders: risingFixture, topCopiedDecks: topCopiedDecksFixture });
    renderRail();
    await waitFor(() => expect(screen.getByText('Rising commanders')).toBeTruthy());
    expect(screen.getByText('Most copied decks')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText('Rising commanders')).toBeTruthy());
  });

  describe('most-copied sub-section (independently testable from rising commanders)', () => {
    it('renders three tiles in score order, links to /d/{slug}, combines partner names, resolves art by commander name, and never shows a raw score', async () => {
      // risingCommanders is deliberately empty here -- proves this sub-section
      // renders correctly on its own, decoupled from the rising section.
      stubFetchResolved({ risingCommanders: [], topCopiedDecks: topCopiedDecksFixture });
      renderRail();
      await waitFor(() => expect(screen.getByText('Most copied decks')).toBeTruthy());
      expect(screen.queryByText('Rising commanders')).toBeNull();

      const links = screen.getAllByRole('link');
      expect(links.map((l) => l.getAttribute('href'))).toEqual([
        '/d/meren-of-clan-nel-toth-a1b2c3d4',
        '/d/thrasios-tymna-e5f6a7b8',
        '/d/krenko-mob-boss-c9d0e1f2',
      ]);

      expect(screen.getByText('Meren of Clan Nel Toth')).toBeTruthy();
      expect(screen.getByText('Thrasios, Triton Hero + Tymna the Weaver')).toBeTruthy();
      expect(screen.getByText('Krenko, Mob Boss')).toBeTruthy();

      expect(screen.queryByText('41.2')).toBeNull();
      expect(screen.queryByText('33.7')).toBeNull();
      expect(screen.queryByText('12.4')).toBeNull();
      expect(document.body.textContent).not.toMatch(/41\.2|33\.7|12\.4/);

      expect(mockUseCardThumb).toHaveBeenCalledWith('Meren of Clan Nel Toth', 'normal');
      expect(mockUseCardThumb).toHaveBeenCalledWith('Thrasios, Triton Hero', 'normal');
      expect(mockUseCardThumb).toHaveBeenCalledWith('Krenko, Mob Boss', 'normal');
    });
  });

  describe('TrendingCommanderTile', () => {
    it('renders as a real anchor, never a button, with honest non-prefill-claiming copy', async () => {
      stubFetchResolved({ risingCommanders: risingFixture });
      renderRail();
      await waitFor(() => expect(screen.getByText('Rising commanders')).toBeTruthy());

      const link = screen.getByRole('link', {
        name: `${risingFixture[0].commanderName} — opens the deck builder; pick it there.`,
      });
      expect(link.getAttribute('href')).toBe('/decks/new');
      expect(screen.queryByRole('button', { name: /praetors/i })).toBeNull();
      expect(link.getAttribute('title')).not.toMatch(/prefill|pre-fill|prefilled/i);
      expect(mockUseCardThumb).toHaveBeenCalledWith("Atraxa, Praetors' Voice", 'normal');
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
      await waitFor(() => expect(screen.getByText('Rising commanders')).toBeTruthy());
      fireEvent.click(screen.getAllByRole('link', { name: /opens the deck builder/i })[0]);
      await waitFor(() => expect(screen.getByText('New deck sentinel')).toBeTruthy());
    });
  });
});
