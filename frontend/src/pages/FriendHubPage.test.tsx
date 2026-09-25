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
import type { TradeOffer } from '../lib/trades-client';
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

// Their deck shelf. Fails by default, as the unmocked fetch always did here;
// the deck-badge test resolves it.
const fetchFriendDecks = vi.fn((_id: string): Promise<unknown> => Promise.reject(new Error('no')));
vi.mock('../lib/friend-decks-client', async () => {
  const actual = await vi.importActual<typeof import('../lib/friend-decks-client')>(
    '../lib/friend-decks-client'
  );
  return { ...actual, fetchFriendDecks: (id: string) => fetchFriendDecks(id) };
});

// The first-pull window: flipped on by the test that models a fresh device.
const firstPull = vi.hoisted(() => ({ awaiting: false }));
vi.mock('../lib/use-awaiting-first-pull', () => ({
  useAwaitingFirstPull: () => firstPull.awaiting,
}));

const fetchFriendWants = vi.fn();
vi.mock('../lib/friends-client', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/friends-client')>('../lib/friends-client');
  return { ...actual, fetchFriendWants: (...args: unknown[]) => fetchFriendWants(...args) };
});

// The trade thread. Defaults to empty so the existing tests see what they
// always saw (a real fetch that failed → no offers).
const listTrades = vi.fn((_opts?: unknown): Promise<{ offers: TradeOffer[]; truncated: boolean }> =>
  Promise.resolve({ offers: [], truncated: false })
);
vi.mock('../lib/trades-client', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/trades-client')>('../lib/trades-client');
  return { ...actual, listTrades: (opts?: unknown) => listTrades(opts) };
});
// The composer's per-printing binder badges and tag search — not under test.
vi.mock('../lib/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
vi.mock('../lib/card-tags', () => ({ getCardTags: () => [], useCardTagsReady: () => false }));

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

  it('renders the app-wide grid tile — an openable control, naming no quantity', async () => {
    // Two regressions in one assertion. The tile was a plain <li> (look at a
    // friend's binder, but never open a card in it), and then briefly its own
    // bespoke button — while every other grid in the app rendered
    // `CardGridCell`. It now renders that, which is why the accessible name is
    // the bare card name, exactly as in the owner's own collection.
    //
    // And `CardGridCell` states "quantity N" unconditionally, so the friend
    // surface passes `hideQty`: a count is the privacy line here, and
    // "quantity 1" would announce one the endpoint never sent.
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [makeCard({ name: 'Sol Ring', oracleId: 'sol' })],
    });
    renderPage();
    await openCollectionTab();

    const panel = document.getElementById('friend-hub-panel-collection')!;
    const tile = await within(panel).findByRole('button', { name: /sol ring/i });
    expect(tile.className).toContain('collection-grid-item');
    expect(tile.getAttribute('aria-label')).not.toMatch(/quantity/i);
  });

  it('marks what they can spare and which of their visible decks a card is in', async () => {
    // The friend's question was "which of these are already in a deck?". The
    // server answers with a yes/no `spare` and ids of decks the viewer can
    // open; the page names them from the shelf and links to that deck's page.
    fetchFriendDecks.mockResolvedValueOnce({
      ownerUsername: 'friendo',
      ownerDisplayName: null,
      decks: [
        {
          deckId: 'deck-krenko',
          href: '/d/krenko-goes-wide',
          name: 'Krenko Goes Wide',
          format: 'commander',
          commanderName: 'Krenko, Mob Boss',
          commanderImage: null,
          colorIdentity: ['R'],
          cardCount: 100,
          bracket: 3,
          visibility: 'published',
          updatedAt: 1,
        },
      ],
    });
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [
        makeCard({ name: 'Sol Ring', oracleId: 'sol', spare: true, deckIds: ['deck-krenko'] }),
        // An id the shelf doesn't have: named by nothing, so no badge.
        makeCard({ name: 'Mana Crypt', oracleId: 'crypt', spare: false, deckIds: ['gone'] }),
      ],
    });
    renderPage();
    await openCollectionTab();

    const panel = document.getElementById('friend-hub-panel-collection')!;
    const deckLink = await within(panel).findByRole('link', { name: 'In deck: Krenko Goes Wide' });
    expect(deckLink.getAttribute('href')).toBe('/d/krenko-goes-wide');
    expect(within(panel).getAllByRole('link', { name: /^In deck/ })).toHaveLength(1);
    expect(within(panel).getAllByText('Spare')).toHaveLength(1);
    expect(within(panel).getByRole('button', { name: /sol ring.*has a spare copy/i })).toBeTruthy();
    // Spare is a yes/no: no count rides along with it.
    expect(panel.textContent).not.toMatch(/\d+ (free|spare)/);
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
    const panel = document.getElementById('friend-hub-panel-collection')!;
    expect(await within(panel).findAllByText(/keeps their collection private/)).not.toHaveLength(0);
    expect(panel.textContent).not.toMatch(/hasn't added anything/);
  });

  it('points to the full view on their profile when it opens for this friend (T136)', async () => {
    fetchFriendCollection.mockResolvedValue({
      ownerUsername: 'friendo',
      cards: [makeCard({ name: 'Sol Ring', oracleId: 'sol' })],
      fullView: true,
    });
    renderPage();
    await openCollectionTab();
    const panel = document.getElementById('friend-hub-panel-collection')!;
    const link = await within(panel).findByRole('link', {
      name: 'See quantities and prices on their profile',
    });
    expect(link.getAttribute('href')).toBe('/u/friendo?tab=collection');
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

    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
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

  it('lands on the Trades tab with the composer open, prefilled with what they asked for', async () => {
    listTrades.mockResolvedValue({ offers: [incoming], truncated: false });
    renderWithCounter('t1');

    const dialog = await screen.findByRole('dialog', { name: /Trade with/ });
    const basket = within(dialog).getByRole('list', { name: /You get: chosen cards/i });
    expect(within(basket).getByText('Sol Ring')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Trades/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('ignores a counter link for an offer that is no longer open', async () => {
    listTrades.mockResolvedValue({
      offers: [{ ...incoming, status: 'declined' }],
      truncated: false,
    });
    renderWithCounter('t1');

    await screen.findByRole('tab', { name: /Trades/ });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
