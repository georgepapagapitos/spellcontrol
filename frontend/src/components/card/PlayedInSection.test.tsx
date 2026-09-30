// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { CardPlayedIn } from '@/deck-builder/services/edhrec/client';
import type { EnrichedCard } from '@/types';
import theOneRing from '@/deck-builder/services/edhrec/__fixtures__/card-page-the-one-ring.fixture.json';

const playedInMock = vi.fn<(name: string) => Promise<CardPlayedIn>>();
vi.mock('@/deck-builder/services/edhrec/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCardPlayedIn: (name: string) => playedInMock(name),
}));

// Art resolves through Scryfall's CDN in the app; nothing to fetch here.
vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

// The nested preview enriches name-only slides through Scryfall; stay offline.
vi.mock('@/deck-builder/services/scryfall/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardByNameResilient: async () => null,
  getOwnedPrinting: async () => null,
}));

// The nested CardPreview's own dependencies, as in CardPreview.test.tsx.
vi.mock('@/lib/api', async () => {
  const { pending } = await import('@/test/pending');
  return { getSetMap: () => pending({}) };
});
vi.mock('./CardImageFrame', () => ({
  CardImageFrame: (p: { card: { name: string } }) => <div data-name={p.card.name} />,
}));
vi.mock('@/lib/cards/card-rulings', () => ({ fetchCardRulings: async () => [] }));

import { PlayedInSection, PLAYED_IN_SETTLE_MS } from './PlayedInSection';
import { parseCardPlayedIn } from '@/deck-builder/services/edhrec/client';
import { useCollectionStore } from '@/store/collection';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

const ring = parseCardPlayedIn(theOneRing, 'the-one-ring');

function Location() {
  const loc = useLocation();
  return <p data-testid="location">{loc.pathname + loc.search}</p>;
}

function renderSection(onLeave = vi.fn()) {
  const utils = render(
    <MemoryRouter initialEntries={['/search']}>
      <Routes>
        <Route path="*" element={<PlayedInSection name="The One Ring" onLeave={onLeave} />} />
      </Routes>
      <Location />
    </MemoryRouter>
  );
  return { ...utils, onLeave };
}

beforeEach(() => {
  playedInMock.mockReset();
  useCollectionStore.setState({ cards: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PlayedInSection', () => {
  it('waits for the card to settle before asking EDHREC, showing skeleton rows', async () => {
    vi.useFakeTimers();
    playedInMock.mockResolvedValue(ring);
    const { container } = renderSection();
    expect(screen.getByRole('button', { name: 'Played in' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
    expect(container.querySelectorAll('.played-in-row.is-skeleton')).toHaveLength(3);
    vi.advanceTimersByTime(PLAYED_IN_SETTLE_MS - 1);
    expect(playedInMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(playedInMock).toHaveBeenCalledTimes(1);
    expect(playedInMock).toHaveBeenCalledWith('The One Ring');
  });

  it("shows the card's play rate, then the top five commanders with a way to see all", async () => {
    playedInMock.mockResolvedValue(ring);
    renderSection();
    expect(await screen.findByText('of decks that can play it', { exact: false })).toBeTruthy();
    const top = screen.getByText('Top commanders').parentElement!;
    expect(within(top).getAllByRole('button')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 22' }));
    expect(within(top).getAllByRole('button')).toHaveLength(22);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(within(top).getAllByRole('button')).toHaveLength(5);
    const fresh = screen.getByText('New commanders').parentElement!;
    expect(within(fresh).getAllByRole('button')).toHaveLength(5);
  });

  it("reads each row as that commander's share of its own decks", async () => {
    playedInMock.mockResolvedValue(ring);
    renderSection();
    // Smaug the Impenetrable: 1,993 of 6,301 decks.
    expect(
      await screen.findByRole('button', {
        name: 'Smaug the Impenetrable. In 32% of its 6.3k decks',
      })
    ).toBeTruthy();
  });

  it('links back to the card on EDHREC', async () => {
    playedInMock.mockResolvedValue(ring);
    renderSection();
    const link = await screen.findByRole('link', { name: /View on EDHREC/ });
    expect(link.getAttribute('href')).toBe('https://edhrec.com/cards/the-one-ring');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it("marks the commanders in the viewer's collection", async () => {
    useCollectionStore.setState({
      cards: [{ name: 'Smaug the Impenetrable' } as EnrichedCard],
    });
    playedInMock.mockResolvedValue(ring);
    renderSection();
    const smaug = await screen.findByRole('button', { name: /^Smaug the Impenetrable\..*Owned$/ });
    expect(within(smaug).getByText('Owned')).toBeTruthy();
    const magnificent = screen.getByRole('button', { name: /^Smaug the Magnificent\./ });
    expect(within(magnificent).queryByText('Owned')).toBeNull();
  });

  it('renders nothing when EDHREC has no page for the card', async () => {
    playedInMock.mockResolvedValue({ status: 'none' });
    const { container } = renderSection();
    await waitFor(() => expect(container.querySelector('.played-in')).toBeNull());
    expect(playedInMock).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for a page with no commanders and no play rate', async () => {
    playedInMock.mockResolvedValue({ status: 'ok', slug: 'x', card: null, top: [], new: [] });
    const { container } = renderSection();
    await waitFor(() => expect(container.querySelector('.played-in')).toBeNull());
  });

  it('offers a retry when the fetch fails', async () => {
    playedInMock.mockResolvedValueOnce({ status: 'error' });
    playedInMock.mockResolvedValueOnce(ring);
    renderSection();
    expect(await screen.findByText(/Couldn't load commanders from EDHREC\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Top commanders')).toBeTruthy();
    expect(playedInMock).toHaveBeenCalledTimes(2);
  });

  it('collapses in place', async () => {
    playedInMock.mockResolvedValue(ring);
    renderSection();
    await screen.findByText('Top commanders');
    fireEvent.click(screen.getByRole('button', { name: 'Played in' }));
    expect(screen.queryByText('Top commanders')).toBeNull();
  });

  it('opens a commander in its own preview, whose Build a deck leaves for the generator', async () => {
    playedInMock.mockImplementation(async (name) =>
      name === 'The One Ring' ? ring : { status: 'none' }
    );
    const { onLeave } = renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /^Smaug the Impenetrable\./ }));
    const dialog = await screen.findByRole('dialog');
    // Its context line says what the number is about: this card, in its decks.
    expect(dialog.textContent).toContain('The One Ring · In 32% of its 6.3k decks');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Build a deck' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location').textContent).toBe(
      '/decks/new/generate?commander=Smaug%20the%20Impenetrable'
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
