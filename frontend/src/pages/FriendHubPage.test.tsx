// @vitest-environment happy-dom
/**
 * FriendHubPage — the Collection tab is the trade workspace (E586): ONE copies
 * fetch feeds the trade radar and the workspace, the hub's own thin grid, sort
 * and filter state and its composer mount are gone, and "Propose a trade" goes
 * to the Collection tab. The browser's own search, filters and "+" are covered
 * where they live (CollectionBrowser, TradeWorkspace); this suite covers the
 * hub's wiring: the radars, the tabs, the counter hand-off and the fetch.
 *
 * No `@testing-library/jest-dom` in this repo (see other *.test.tsx files) —
 * assertions use plain vitest/chai matchers, not `.toBeInTheDocument()`.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCard } from '@/lib/social/shared-types';
import { useToastsStore } from '@/store/toasts';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import type { TradeOffer } from '@/lib/trade/trades-client';
import type { EnrichedCard } from '../types';

vi.mock('../store/auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ status: 'authed', user: { id: 'viewer-1' } }),
}));

// `cards` feeds the "They're looking for" matcher; `lists` feeds the trade
// radar. Per-test overrides go through `myCards`.
let myCards: EnrichedCard[] = [];
vi.mock('../store/collection', () => ({
  useCollectionStore: (
    sel: (s: { lists: unknown[]; cards: EnrichedCard[]; binders: unknown[] }) => unknown
  ) => sel({ lists: [], cards: myCards, binders: [] }),
}));

// The real hook subscribes to the persisted decks/cube stores; nothing here
// allocates a copy, so an empty claim map is the whole truth.
const NO_CLAIMS = vi.hoisted(() => new Map());
vi.mock('@/lib/collection/allocations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/collection/allocations')>(
    '@/lib/collection/allocations'
  );
  return { ...actual, useAllocations: () => NO_CLAIMS };
});

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

vi.mock('@/lib/social/share-client', () => ({
  getFriendShares: vi.fn(() =>
    Promise.resolve({
      ownerUsername: 'friendo',
      ownerDisplayName: null,
      shares: [],
    })
  ),
}));

vi.mock('@/lib/play/game-results-client', () => ({
  fetchH2H: vi.fn(() => Promise.reject(new Error('no h2h in this test'))),
}));

// Their deck shelf. Fails by default, as the unmocked fetch always did here;
// the deck-badge test resolves it.
const fetchFriendDecks = vi.fn((_id: string): Promise<unknown> => Promise.reject(new Error('no')));
vi.mock('@/lib/social/friend-decks-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/social/friend-decks-client')>(
    '@/lib/social/friend-decks-client'
  );
  return { ...actual, fetchFriendDecks: (id: string) => fetchFriendDecks(id) };
});

// The first-pull window: flipped on by the test that models a fresh device.
const firstPull = vi.hoisted(() => ({ awaiting: false }));
vi.mock('@/lib/sync/use-awaiting-first-pull', () => ({
  useAwaitingFirstPull: () => firstPull.awaiting,
}));

const fetchFriendWants = vi.fn();
const fetchFriendCollection = vi.fn();
vi.mock('@/lib/social/friends-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/social/friends-client')>(
    '@/lib/social/friends-client'
  );
  return {
    ...actual,
    fetchFriendWants: (...args: unknown[]) => fetchFriendWants(...args),
    // The copies shape: the hub's one collection fetch.
    fetchFriendCollectionCopies: (...args: unknown[]) => fetchFriendCollection(...args),
  };
});
vi.mock('@/lib/trade/trade-value', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/trade/trade-value')>('@/lib/trade/trade-value');
  return { ...actual, useFloorPrices: () => ({ prices: new Map(), pending: false }) };
});
vi.mock('@/lib/api', async () => {
  const { pending } = await import('@/test/pending');
  return { getSetMap: () => pending({}) };
});

// The trade thread. Defaults to empty so the existing tests see what they
// always saw (a real fetch that failed → no offers).
const listTrades = vi.fn((_opts?: unknown): Promise<{ offers: TradeOffer[]; truncated: boolean }> =>
  Promise.resolve({ offers: [], truncated: false })
);
vi.mock('@/lib/trade/trades-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade/trades-client')>(
    '@/lib/trade/trades-client'
  );
  return { ...actual, listTrades: (opts?: unknown) => listTrades(opts) };
});
// The composer's per-printing binder badges and tag search — not under test.
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
// Settled trades file into the viewer's binders; this suite has none.
vi.mock('@/lib/binder/use-binder-layout-inputs', () => ({
  useBinderLayoutInputs: () => ({
    cards: [],
    binders: [],
    allocatedCopyIds: new Set(),
    setMap: undefined,
  }),
}));
vi.mock('@/lib/cards/card-tags', () => ({ getCardTags: () => [], useCardTagsReady: () => false }));

import { FriendHubPage } from './FriendHubPage';

function makeCard(overrides: Partial<PublicCard> & { name: string; oracleId: string }): PublicCard {
  return {
    scryfallId: `sf-${overrides.oracleId}`,
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 1,
    cmc: 0,
    typeLine: 'Creature',
    colors: [],
    ...overrides,
  };
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

describe('FriendHubPage — Collection tab (the trade workspace)', () => {
  beforeEach(() => {
    fetchFriendCollection.mockReset();
    fetchFriendWants.mockReset();
    fetchFriendWants.mockResolvedValue({ ownerUsername: 'friendo', wants: [] });
    useTradeDraftsStore.setState({ drafts: {} });
    myCards = [];
  });

  const panel = () => document.getElementById('friend-hub-panel-collection')!;

  it('renders their cards in the shared browser and never a quantity-free thin grid', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [
        makeCard({ name: 'Sol Ring', oracleId: 'sol', edhrecRank: 1 }),
        makeCard({ name: 'Lightning Bolt', oracleId: 'bolt', edhrecRank: 50 }),
      ],
    });
    renderPage();
    await openCollectionTab();

    expect(await within(panel()).findByText('Sol Ring')).toBeTruthy();
    expect(within(panel()).getByText('Lightning Bolt')).toBeTruthy();
    // The shared browser's own toolbar, not the hub's retired one.
    expect(within(panel()).getByRole('textbox', { name: 'Search cards' })).toBeTruthy();
    expect(within(panel()).getByRole('tab', { name: "@friendo's cards" })).toBeTruthy();
    expect(within(panel()).getByRole('tab', { name: 'Your cards' })).toBeTruthy();
  });

  it('feeds the radar and the workspace from ONE fetch', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [makeCard({ name: 'Sol Ring', oracleId: 'sol' })],
    });
    renderPage();
    await openCollectionTab();
    await within(panel()).findByText('Sol Ring');
    expect(fetchFriendCollection).toHaveBeenCalledTimes(1);
  });

  it('retires the composer mount and the profile link', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [makeCard({ name: 'Sol Ring', oracleId: 'sol' })],
      fullView: true,
    });
    renderPage();
    await openCollectionTab();
    await within(panel()).findByText('Sol Ring');

    expect(screen.queryByText('See quantities and prices on their profile')).toBeNull();
    expect(screen.queryByText(/never quantities or values/i)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds a card to the trade from its tile and shows the tray', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [makeCard({ name: 'Sol Ring', oracleId: 'sol' })],
    });
    renderPage();
    await openCollectionTab();
    fireEvent.click(await within(panel()).findByRole('button', { name: 'Ask for Sol Ring' }));

    expect(screen.getByRole('button', { name: /^Review trade with @friendo. Get 1/ })).toBeTruthy();
    expect(useTradeDraftsStore.getState().getDraft('viewer-1', 'friend-1')?.get.sol.quantity).toBe(
      1
    );
  });

  it('says a Private collection is private, rather than empty (T136)', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [],
      collectionPrivate: true,
      fullView: false,
    });
    renderPage();
    await openCollectionTab();
    expect(await within(panel()).findByText(/keeps their collection private/)).toBeTruthy();
    expect(panel().textContent).not.toMatch(/collection is empty/);
  });

  it('says so when the friend owns nothing', async () => {
    fetchFriendCollection.mockResolvedValue({ ownerUsername: 'friendo', cards: [] });
    renderPage();
    await openCollectionTab();
    expect(await within(panel()).findByText('This collection is empty.')).toBeTruthy();
  });

  it('offers Retry when the collection fails to load, and refetches', async () => {
    fetchFriendCollection.mockRejectedValueOnce(new Error('boom'));
    fetchFriendCollection.mockResolvedValueOnce({
      ownerUsername: 'friendo',
      cards: [makeCard({ name: 'Sol Ring', oracleId: 'sol' })],
    });
    renderPage();
    await openCollectionTab();
    const alert = await within(panel()).findByRole('alert');
    expect(alert.textContent).toMatch(/couldn.t load this collection/i);
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await within(panel()).findByText('Sol Ring')).toBeTruthy();
    expect(fetchFriendCollection).toHaveBeenCalledTimes(2);
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

describe('FriendHubPage — "Propose a trade" goes to the Collection tab', () => {
  beforeEach(() => {
    fetchFriendCollection.mockReset();
    fetchFriendWants.mockReset();
    useTradeDraftsStore.setState({ drafts: {} });
    myCards = [makeOwned({ copyId: 'c1', name: 'Sol Ring', oracleId: 'o-sol' })];
    listTrades.mockReset();
    listTrades.mockResolvedValue({ offers: [], truncated: false });
  });

  function Where() {
    const loc = useLocation();
    return <output data-testid="where">{loc.pathname + loc.search}</output>;
  }

  it('from the want radar, with no composer dialog', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [makeCard({ name: 'Sol Ring', oracleId: 'o-sol' })],
    });
    fetchFriendWants.mockResolvedValue({
      ownerUsername: 'friendo',
      wants: [{ name: 'Sol Ring', oracleId: 'o-sol' }],
    });
    render(
      <MemoryRouter initialEntries={['/friends/friend-1']}>
        <Routes>
          <Route
            path="/friends/:friendId"
            element={
              <>
                <FriendHubPage />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    const strip = await screen.findByRole('list', { name: /cards you own that .* wants/i });
    const section = strip.closest('section')!;
    fireEvent.click(within(section).getByRole('button', { name: 'Propose a trade' }));

    expect(screen.getByTestId('where').textContent).toBe('/friends/friend-1?tab=collection');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Collection' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('from the Trades tab', async () => {
    fetchFriendCollection.mockResolvedValue({ ownerUsername: 'friendo', cards: [] });
    fetchFriendWants.mockResolvedValue({ ownerUsername: 'friendo', wants: [] });
    render(
      <MemoryRouter initialEntries={['/friends/friend-1?tab=trades']}>
        <Routes>
          <Route
            path="/friends/:friendId"
            element={
              <>
                <FriendHubPage />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Propose a trade' }));
    expect(screen.getByTestId('where').textContent).toBe('/friends/friend-1?tab=collection');
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

  it('keeps both radars on their skeletons while the first pull is still landing (playtest batch 9)', async () => {
    // A fresh device: the store is empty because nothing has ARRIVED yet, not
    // because the viewer owns nothing. Measured: this said "Nothing you own is
    // on their want lists" for the whole 42s first pull of a 12k-card account,
    // and the Trade radar section was missing outright, then both popped in.
    firstPull.awaiting = true;
    try {
      myCards = [];
      fetchFriendWants.mockResolvedValue({
        ownerUsername: 'friendo',
        wants: [{ name: 'Sol Ring', oracleId: 'o-sol' }],
      });
      renderPage();

      const looking = await screen.findByRole('region', {
        name: /what this friend is looking for/i,
      });
      expect(within(looking).getByLabelText(/checking .*want lists/i)).toBeTruthy();
      expect(within(looking).queryByText(/nothing you own/i)).toBeNull();
      const radar = screen.getByRole('region', { name: 'Trade radar' });
      expect(within(radar).getByLabelText(/checking your want lists/i)).toBeTruthy();
      expect(within(radar).queryByText(/nothing on your want lists/i)).toBeNull();
    } finally {
      firstPull.awaiting = false;
    }
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

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: /cards you own that .* wants/i })).toBeTruthy();
  });
});

describe('FriendHubPage — ?counter=<offerId> from /trades', () => {
  beforeEach(() => {
    fetchFriendCollection.mockReset();
    fetchFriendCollection.mockResolvedValue({ ownerUsername: 'friendo', cards: [] });
    fetchFriendWants.mockReset();
    fetchFriendWants.mockResolvedValue({ ownerUsername: 'friendo', wants: [] });
    listTrades.mockReset();
    listTrades.mockResolvedValue({ offers: [], truncated: false });
    useTradeDraftsStore.setState({ drafts: {} });
    myCards = [];
  });

  const incoming: TradeOffer = {
    id: 't1',
    mine: false,
    counterpartyId: 'friend-1',
    counterpartyUsername: 'friendo',
    counterpartyDisplayName: null,
    status: 'proposed',
    note: '',
    give: [{ oracleId: 'o-sol', name: 'Sol Ring', quantity: 1, copies: [] }],
    receive: [],
    settled: false,
    createdAt: 1,
    updatedAt: 1,
    resolvedAt: null,
  };

  function renderWithCounter(id: string) {
    return render(
      <MemoryRouter initialEntries={[`/friends/friend-1?counter=${id}`]}>
        <Routes>
          <Route path="/friends/:friendId" element={<FriendHubPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('lands on the Collection tab with the review open, the WHOLE offer on its own sides', async () => {
    // Offers are viewer-relative: `give` is what I was asked to hand over,
    // `receive` is what I would get. A counter must keep them there.
    myCards = [
      makeOwned({ copyId: 'c1', name: 'Sol Ring', oracleId: 'o-sol' }),
      makeOwned({ copyId: 'c2', name: 'Arcane Signet', oracleId: 'o-sig' }),
    ];
    listTrades.mockResolvedValue({
      offers: [
        {
          ...incoming,
          give: [
            { oracleId: 'o-sol', name: 'Sol Ring', quantity: 1, copies: [] },
            { oracleId: 'o-sig', name: 'Arcane Signet', quantity: 1, copies: [] },
          ],
          receive: [{ oracleId: 'o-bolt', name: 'Lightning Bolt', quantity: 2, copies: [] }],
        },
      ],
      truncated: false,
    });
    renderWithCounter('t1');

    const dialog = await screen.findByRole('dialog', { name: /Trade with/ });
    const give = within(dialog).getByRole('list', { name: /You give: chosen cards/i });
    expect(within(give).getByText('Sol Ring')).toBeTruthy();
    expect(within(give).getByText('Arcane Signet')).toBeTruthy();
    const get = within(dialog).getByRole('list', { name: /You get: chosen cards/i });
    expect(within(get).getByText('Lightning Bolt')).toBeTruthy();
    expect(within(get).queryByText('Sol Ring')).toBeNull();
    expect(within(dialog).getByText(/Countering @friendo.s offer/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Collection' }).getAttribute('aria-selected')).toBe(
      'true'
    );

    // The draft is what was seeded, and it remembers what it answers.
    const saved = useTradeDraftsStore.getState().getDraft('viewer-1', 'friend-1');
    expect(saved?.counterTo).toEqual({ offerId: 't1', name: '@friendo' });
    expect(saved?.get['o-bolt'].quantity).toBe(2);
    expect(Object.keys(saved?.give ?? {}).sort()).toEqual(['o-sig', 'o-sol']);
  });

  it('spends the counter and review params once it has landed', async () => {
    myCards = [makeOwned({ copyId: 'c1', name: 'Sol Ring', oracleId: 'o-sol' })];
    listTrades.mockResolvedValue({ offers: [incoming], truncated: false });
    render(
      <MemoryRouter initialEntries={['/friends/friend-1?counter=t1']}>
        <Routes>
          <Route
            path="/friends/:friendId"
            element={
              <>
                <FriendHubPage />
                <WhereAmI />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByRole('dialog', { name: /Trade with/ });
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/friends/friend-1?tab=collection')
    );
  });

  it('names a card the viewer no longer has instead of seeding it silently', async () => {
    useToastsStore.getState().clear();
    myCards = [makeOwned({ copyId: 'c2', name: 'Arcane Signet', oracleId: 'o-sig' })];
    listTrades.mockResolvedValue({ offers: [incoming], truncated: false });
    renderWithCounter('t1');

    await screen.findByRole('dialog', { name: /Trade with/ });
    expect(
      useToastsStore.getState().toasts.some((t) => /You no longer have Sol Ring/.test(t.message))
    ).toBe(true);
    const saved = useTradeDraftsStore.getState().getDraft('viewer-1', 'friend-1');
    expect(saved?.give).toEqual({});
  });

  it('waits for the first pull rather than seeding an empty collection', async () => {
    firstPull.awaiting = true;
    try {
      myCards = [];
      listTrades.mockResolvedValue({ offers: [incoming], truncated: false });
      renderWithCounter('t1');
      await screen.findByRole('tab', { name: 'Collection' });
      await Promise.resolve();
      expect(useTradeDraftsStore.getState().getDraft('viewer-1', 'friend-1')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      firstPull.awaiting = false;
    }
  });

  it('ignores a counter link for an offer that is no longer open', async () => {
    listTrades.mockResolvedValue({
      offers: [{ ...incoming, status: 'declined' }],
      truncated: false,
    });
    renderWithCounter('t1');

    await screen.findByRole('tab', { name: /Trades/ });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useTradeDraftsStore.getState().getDraft('viewer-1', 'friend-1')).toBeNull();
  });

  it('Counter on the Trades tab seeds the same way', async () => {
    myCards = [makeOwned({ copyId: 'c1', name: 'Sol Ring', oracleId: 'o-sol' })];
    listTrades.mockResolvedValue({ offers: [incoming], truncated: false });
    render(
      <MemoryRouter initialEntries={['/friends/friend-1?tab=trades']}>
        <Routes>
          <Route path="/friends/:friendId" element={<FriendHubPage />} />
        </Routes>
      </MemoryRouter>
    );
    // Counter now lives in the offer's review, not on the row.
    fireEvent.click(await screen.findByRole('button', { name: 'Review offer' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Counter/ }));
    expect(await screen.findByRole('dialog', { name: /Trade with/ })).toBeTruthy();
  });
});

function WhereAmI() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

describe('FriendHubPage: the tab lives in ?tab=', () => {
  beforeEach(() => {
    fetchFriendCollection.mockReset();
    fetchFriendCollection.mockResolvedValue({ ownerUsername: 'friendo', cards: [] });
    fetchFriendWants.mockReset();
    fetchFriendWants.mockResolvedValue({ ownerUsername: 'friendo', wants: [] });
    listTrades.mockReset();
    listTrades.mockResolvedValue({ offers: [], truncated: false });
    myCards = [];
  });

  function Where() {
    const loc = useLocation();
    return <output data-testid="where">{loc.pathname + loc.search}</output>;
  }

  function renderAt(entry: string) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/friends/:friendId"
            element={
              <>
                <FriendHubPage />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
  }

  const where = () => screen.getByTestId('where').textContent;

  it('opens on the tab named in the URL', async () => {
    renderAt('/friends/friend-1?tab=trades');
    const tab = await screen.findByRole('tab', { name: /Trades/ });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });

  it('writes the tab to the URL and drops it for Overview', async () => {
    renderAt('/friends/friend-1');
    expect(
      (await screen.findByRole('tab', { name: 'Overview' })).getAttribute('aria-selected')
    ).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Decks' }));
    expect(where()).toBe('/friends/friend-1?tab=decks');
    expect(screen.getByRole('tab', { name: 'Decks' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(where()).toBe('/friends/friend-1');
  });

  it('falls back to Overview for an unknown tab', async () => {
    renderAt('/friends/friend-1?tab=nonsense');
    const tab = await screen.findByRole('tab', { name: 'Overview' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
  });

  it('?counter= still forces a tab, and changing tab clears it', async () => {
    renderAt('/friends/friend-1?counter=gone&tab=decks');
    const collection = await screen.findByRole('tab', { name: 'Collection' });
    expect(collection.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Decks' }));
    expect(where()).toBe('/friends/friend-1?tab=decks');
  });
});

describe('FriendHubPage: Overview with no share links', () => {
  beforeEach(() => {
    fetchFriendWants.mockReset();
    fetchFriendWants.mockResolvedValue({ ownerUsername: 'friendo', wants: [] });
    listTrades.mockReset();
    listTrades.mockResolvedValue({ offers: [], truncated: false });
    myCards = [];
  });

  it('does not claim nothing is shared when their collection is viewable', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [makeCard({ name: 'Sol Ring', oracleId: 'sol' })],
    });
    renderPage();

    expect(await screen.findByText(/Their cards are on the Collection tab/)).toBeTruthy();
    expect(screen.queryByText(/shared anything with friends/)).toBeNull();
  });

  it('keeps the plain empty copy when their collection is empty too', async () => {
    fetchFriendCollection.mockResolvedValue({ ownerUsername: 'friendo', cards: [] });
    renderPage();

    expect(await screen.findByText(/shared anything with friends yet/)).toBeTruthy();
  });
});
