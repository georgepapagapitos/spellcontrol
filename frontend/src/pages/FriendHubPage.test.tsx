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
import type { EnrichedCard } from '../types';

vi.mock('../store/auth', () => ({
  useAuth: (sel: (s: { status: string }) => unknown) => sel({ status: 'authed' }),
}));

// `cards` feeds the "They're looking for" matcher; `lists` feeds the trade
// radar. Per-test overrides go through `myCards`.
let myCards: EnrichedCard[] = [];
vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: { lists: unknown[]; cards: EnrichedCard[] }) => unknown) =>
    sel({ lists: [], cards: myCards }),
}));

// The real hook subscribes to the persisted decks/cube stores; nothing here
// allocates a copy, so an empty claim map is the whole truth.
vi.mock('../lib/allocations', async () => {
  const actual = await vi.importActual<typeof import('../lib/allocations')>('../lib/allocations');
  return { ...actual, useAllocations: () => new Map() };
});

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

const fetchFriendWants = vi.fn();
vi.mock('../lib/friends-client', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/friends-client')>('../lib/friends-client');
  return { ...actual, fetchFriendWants: (...args: unknown[]) => fetchFriendWants(...args) };
});

import { FriendHubPage } from './FriendHubPage';

function makeCard(overrides: Partial<FriendCard> & { name: string; oracleId: string }): FriendCard {
  return { colors: [], cmc: 0, typeLine: 'Creature', ...overrides };
}

function makeOwned(over: Partial<EnrichedCard> & { copyId: string; name: string }): EnrichedCard {
  return {
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: 'scry-default',
    purchasePrice: 0,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    ...over,
  } as EnrichedCard;
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
    fetchFriendWants.mockReset();
    fetchFriendWants.mockResolvedValue({ ownerUsername: 'friendo', wants: [] });
    myCards = [];
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

    // Color lives inside the shared filter dialog now — the same door the
    // authed collection and the public share views use.
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

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

describe('FriendHubPage — "They’re looking for" (the reciprocal radar)', () => {
  beforeEach(() => {
    fetchFriendCollection.mockReset();
    fetchFriendCollection.mockResolvedValue({ ownerUsername: 'friendo', cards: [] });
    fetchFriendWants.mockReset();
    myCards = [];
  });

  /** The overview panel, which is where this section lives. */
  function overview() {
    return document.getElementById('friend-hub-panel-overview')!;
  }

  it('marks a card with unallocated spare copies, and leads with it', async () => {
    myCards = [
      makeOwned({ copyId: 'c1', name: 'Sol Ring', oracleId: 'o-sol' }),
      makeOwned({ copyId: 'c2', name: 'Sol Ring', oracleId: 'o-sol' }),
      makeOwned({ copyId: 'c3', name: 'Arcane Signet', oracleId: 'o-sig' }),
    ];
    fetchFriendWants.mockResolvedValue({
      ownerUsername: 'friendo',
      wants: [
        { name: 'Arcane Signet', oracleId: 'o-sig' },
        { name: 'Sol Ring', oracleId: 'o-sol' },
      ],
    });
    renderPage();

    const strip = await screen.findByRole('list', { name: /cards you own that .* wants/i });
    // Two Sol Rings, one kept → one spare. One Arcane Signet → none.
    expect(within(strip).getByText('1 spare')).toBeTruthy();
    expect(within(strip).getByText('your only copy')).toBeTruthy();
    // Spare-first ordering, not alphabetical: Sol Ring leads Arcane Signet.
    const names = [...strip.querySelectorAll('.friend-hub-radar-name')].map((n) => n.textContent);
    expect(names).toEqual(['Sol Ring', 'Arcane Signet']);
    expect(within(overview()).getByText(/1 you can spare/)).toBeTruthy();
  });

  it('says so when they want things and you own none of them', async () => {
    myCards = [makeOwned({ copyId: 'c1', name: 'Llanowar Elves', oracleId: 'o-elves' })];
    fetchFriendWants.mockResolvedValue({
      ownerUsername: 'friendo',
      wants: [{ name: 'Black Lotus', oracleId: 'o-lotus' }],
    });
    renderPage();

    expect(await within(overview()).findByText(/nothing you own is on .*want lists/i)).toBeTruthy();
  });

  it('hides the section entirely when the friend has no want lists', async () => {
    myCards = [makeOwned({ copyId: 'c1', name: 'Sol Ring', oracleId: 'o-sol' })];
    fetchFriendWants.mockResolvedValue({ ownerUsername: 'friendo', wants: [] });
    renderPage();

    // The shares fetch settling is the signal that the page has finished its
    // first pass — the section is absent, not merely late.
    await screen.findByRole('tab', { name: 'Collection' });
    expect(screen.queryByText(/They’re looking for/)).toBeNull();
  });

  it('offers a retry when the wants fetch fails', async () => {
    fetchFriendWants.mockRejectedValueOnce(new Error('boom'));
    fetchFriendWants.mockResolvedValueOnce({
      ownerUsername: 'friendo',
      wants: [{ name: 'Sol Ring', oracleId: 'o-sol' }],
    });
    myCards = [makeOwned({ copyId: 'c1', name: 'Sol Ring', oracleId: 'o-sol' })];
    renderPage();

    const alert = await within(overview()).findByRole('alert');
    expect(alert.textContent).toMatch(/couldn.t check your collection/i);

    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('list', { name: /cards you own that .* wants/i })).toBeTruthy();
  });
});
