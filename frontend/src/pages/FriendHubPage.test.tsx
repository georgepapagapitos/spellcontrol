// @vitest-environment happy-dom
/**
 * FriendHubPage — the Collection tab (E-friend-collection-browse): the shared
 * fetch feeds both the trade radar and the browser, the browser never renders
 * quantity/price, name search + color filtering work, and the "Show more" cap
 * only reveals more of an already-fetched set (no re-fetch, no re-filter).
 *
 * No `@testing-library/jest-dom` in this repo (see other *.test.tsx files) —
 * assertions use plain vitest/chai matchers, not `.toBeInTheDocument()`.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FriendCard } from '../lib/cube/pool';

vi.mock('../store/auth', () => ({
  useAuth: (sel: (s: { status: string }) => unknown) => sel({ status: 'authed' }),
}));

vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: { lists: unknown[] }) => unknown) => sel({ lists: [] }),
}));

vi.mock('../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

vi.mock('../lib/share-client', () => ({
  getFriendShares: vi.fn(() =>
    Promise.resolve({
      ownerUsername: 'friendo',
      ownerDisplayName: null,
      shares: [],
    })
  ),
}));

vi.mock('../lib/game-results-client', () => ({
  fetchH2H: vi.fn(() => Promise.reject(new Error('no h2h in this test'))),
}));

const fetchFriendCollection = vi.fn();
vi.mock('../lib/cube/pool', async () => {
  const actual = await vi.importActual<typeof import('../lib/cube/pool')>('../lib/cube/pool');
  return {
    ...actual,
    fetchFriendCollection: (...args: unknown[]) => fetchFriendCollection(...args),
  };
});

import { FriendHubPage } from './FriendHubPage';

function makeCard(overrides: Partial<FriendCard> & { name: string; oracleId: string }): FriendCard {
  return { colors: [], cmc: 0, typeLine: 'Creature', ...overrides };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/friends/friend-1']}>
      <Routes>
        <Route path="/friends/:friendId" element={<FriendHubPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function openCollectionTab() {
  const tab = await screen.findByRole('tab', { name: 'Collection' });
  fireEvent.click(tab);
  return tab;
}

describe('FriendHubPage — Collection browser', () => {
  beforeEach(() => {
    fetchFriendCollection.mockReset();
  });

  it('renders card names but never a quantity or price anywhere in the panel', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [
        makeCard({ name: 'Sol Ring', oracleId: 'sol', edhrecRank: 1 }),
        makeCard({ name: 'Lightning Bolt', oracleId: 'bolt', colors: ['R'], edhrecRank: 50 }),
      ],
    });
    renderPage();
    await openCollectionTab();

    const panel = document.getElementById('friend-hub-panel-collection')!;
    expect(await within(panel).findByText('Sol Ring')).toBeTruthy();
    expect(within(panel).getByText('Lightning Bolt')).toBeTruthy();

    // No quantity (×N) or currency-formatted price string anywhere in the panel.
    expect(panel.textContent).not.toMatch(/×\d/);
    expect(panel.textContent).not.toMatch(/\$\d/);
  });

  it('shows the contract line and the empty state when the friend owns nothing', async () => {
    fetchFriendCollection.mockResolvedValue({ ownerUsername: 'friendo', cards: [] });
    renderPage();
    await openCollectionTab();

    expect(await screen.findByText(/never quantities or values/i)).toBeTruthy();
    expect(await screen.findByText(/hasn.t added anything to their collection yet/i)).toBeTruthy();
  });

  it('filters by name search across the full set, not just the rendered page', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [
        makeCard({ name: 'Sol Ring', oracleId: 'sol' }),
        makeCard({ name: 'Lightning Bolt', oracleId: 'bolt', colors: ['R'] }),
      ],
    });
    renderPage();
    await openCollectionTab();
    await screen.findByText('Sol Ring');

    fireEvent.change(screen.getByRole('textbox', { name: /search .*collection by card name/i }), {
      target: { value: 'bolt' },
    });

    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(screen.queryByText('Sol Ring')).toBeNull();
  });

  it('filters by color and shows a filtered-empty state that can be reset', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [makeCard({ name: 'Sol Ring', oracleId: 'sol', colors: [] })],
    });
    renderPage();
    await openCollectionTab();
    await screen.findByText('Sol Ring');

    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));

    expect(await screen.findByText(/no cards match your search or filters/i)).toBeTruthy();
    expect(screen.queryByText('Sol Ring')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset search' }));
    expect(await screen.findByText('Sol Ring')).toBeTruthy();
  });

  it('caps the initial render and reveals more via "Show more" without a re-fetch', async () => {
    const cards = Array.from({ length: 75 }, (_, i) =>
      makeCard({
        name: `Card ${String(i).padStart(2, '0')}`,
        oracleId: `oracle-${i}`,
        edhrecRank: i,
      })
    );
    fetchFriendCollection.mockResolvedValue({ ownerUsername: 'friendo', cards });
    renderPage();
    await openCollectionTab();

    await screen.findByText('Card 00');
    expect(screen.queryByText('Card 60')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /show more/i }));

    expect(await screen.findByText('Card 60')).toBeTruthy();
    expect(fetchFriendCollection).toHaveBeenCalledTimes(1);
  });
});
