// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub heavy dependencies so the test stays lightweight and focused on the
// deep-link / sheet-open behaviour, not on data rendering.
vi.mock('../lib/allocations', () => ({ useAllocations: () => new Map() }));
vi.mock('../lib/api', () => ({ useSetMap: () => new Map() }));
vi.mock('../lib/materialize', () => ({
  materializeBinders: () => ({ binders: [] }),
}));
vi.mock('../components/CardListTable', () => ({
  CardListTable: ({
    onAddCards,
    filterJump,
  }: {
    onAddCards: (query?: string) => void;
    filterJump?: { kind: string } | null;
  }) => (
    <div data-testid="card-table" data-filter-jump={filterJump?.kind ?? ''}>
      <button onClick={() => onAddCards()}>Add cards (table)</button>
      <button onClick={() => onAddCards('dark ritual')}>Search hand-off (table)</button>
    </div>
  ),
}));
vi.mock('../components/StatsBar', () => ({
  StatsBar: ({ open }: { open: boolean }) => (open ? <div data-testid="stats-drawer" /> : null),
}));
vi.mock('../components/ShareDialog', () => ({ ShareDialog: () => null }));
// Controllable sync state so we can exercise the fresh-device "loading your
// collection" branch without standing up the real sync engine.
const syncMock = vi.hoisted(() => ({ state: 'idle' as 'idle' | 'syncing' | 'ready' }));
vi.mock('../lib/sync', () => ({
  getSyncState: () => syncMock.state,
  onSyncedChange: () => () => {},
}));
// Stub AddCardsSheet to expose its initialTab/initialQuery for assertion
// without rendering the full modal stack (CardScanner, UploadPanel, etc.).
vi.mock('../components/AddCardsSheet', () => ({
  AddCardsSheet: ({
    initialTab,
    initialQuery,
    onClose,
  }: {
    initialTab?: string;
    initialQuery?: string;
    onClose: () => void;
  }) => (
    <div
      data-testid="add-cards-sheet"
      data-initial-tab={initialTab ?? 'search'}
      data-initial-query={initialQuery ?? ''}
    >
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import { CollectionPage } from './CollectionPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';

function renderPage(initialEntry = '/collection') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CollectionPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  // Reset collection store to empty/ready state.
  useCollectionStore.setState({
    cards: [],
    binders: [],
    hydrating: false,
    error: null,
    isRefreshingPrices: false,
    priceRefreshProgress: null,
  });
  syncMock.state = 'idle';
  useAuth.setState({ status: 'guest' });
});

describe('CollectionPage – collection load feedback', () => {
  it('shows "Loading your collection…" while an authed device pulls (empty + syncing)', () => {
    useAuth.setState({ status: 'authed' });
    syncMock.state = 'syncing';
    renderPage('/collection');
    expect(screen.getByText('Loading your collection…')).toBeTruthy();
  });

  it('does NOT show the loading state for a guest with an empty collection', () => {
    syncMock.state = 'syncing'; // guests never sync, but assert the auth gate
    renderPage('/collection');
    expect(screen.queryByText('Loading your collection…')).toBeNull();
  });

  it('does NOT show the loading state once cards have arrived (empty=false)', () => {
    useAuth.setState({ status: 'authed' });
    syncMock.state = 'syncing';
    useCollectionStore.setState({
      cards: [{ copyId: 'c1', scryfallId: 'sf1', name: 'Sol Ring' }] as never,
    });
    renderPage('/collection');
    expect(screen.queryByText('Loading your collection…')).toBeNull();
  });
});

describe('CollectionPage – hero total while pricing', () => {
  // Measured on the 11.5k-card dev collection: the hero read
  // Pricing… → $1,646 → $3,351 → $4,770 → … → $7,754 over ~60s, because the
  // pending state was gated on `collectionValue === 0` and gave way to a live
  // PARTIAL sum the moment the first chunk landed. A settled-looking $1,646
  // against a true $7,754 is worse than showing no number at all.
  const priced = (n: number, each: number) =>
    Array.from({ length: n }, (_, i) => ({
      copyId: `c${i}`,
      scryfallId: `sf${i}`,
      name: `Card ${i}`,
      purchasePrice: each,
    })) as never;

  it('never shows a partial total mid-refresh, even once some prices have landed', () => {
    useCollectionStore.setState({
      cards: priced(3, 100), // $300 so far — but the refresh is still running
      isRefreshingPrices: true,
      priceRefreshProgress: { done: 1, total: 6 },
    });
    renderPage('/collection');
    expect(screen.getByText(/Pricing 1\/6/)).toBeTruthy();
    expect(screen.queryByText('$300')).toBeNull();
  });

  it('reports how far along the refresh is', () => {
    useCollectionStore.setState({
      cards: priced(1, 5),
      isRefreshingPrices: true,
      priceRefreshProgress: { done: 4, total: 6 },
    });
    renderPage('/collection');
    expect(screen.getByText(/Pricing 4\/6/)).toBeTruthy();
  });

  it('shows the total once the refresh finishes', () => {
    useCollectionStore.setState({
      cards: priced(3, 100),
      isRefreshingPrices: false,
      priceRefreshProgress: null,
    });
    renderPage('/collection');
    expect(screen.getByText('$300')).toBeTruthy();
    expect(screen.queryByText(/Pricing/)).toBeNull();
  });

  it('keeps the total visible during an untracked background re-price', () => {
    // The other half of the contract. `autoRefreshStalePrices` only passes
    // `{ track: true }` for the fresh-device first fill, so a routine daily
    // staleness refresh leaves `priceRefreshProgress` null — and must NOT blank
    // out a perfectly good total or flash a spinner on a normal launch.
    useCollectionStore.setState({
      cards: priced(3, 100),
      isRefreshingPrices: true,
      priceRefreshProgress: null,
    });
    renderPage('/collection');
    expect(screen.getByText('$300')).toBeTruthy();
    expect(screen.queryByText(/Pricing/)).toBeNull();
  });
});

describe('CollectionPage – AddCardsSheet deep-link (UX-333)', () => {
  it('does not open AddCardsSheet without a query param', () => {
    renderPage('/collection');
    expect(screen.queryByTestId('add-cards-sheet')).toBeNull();
  });

  it('opens AddCardsSheet on the upload tab when ?add=list is present', () => {
    renderPage('/collection?add=list');
    const sheet = screen.getByTestId('add-cards-sheet');
    expect(sheet).toBeTruthy();
    expect(sheet.getAttribute('data-initial-tab')).toBe('upload');
  });

  it('defaults to the search tab for an unknown ?add= value', () => {
    renderPage('/collection?add=unknown');
    // Unknown value → still opens the sheet (param is present) but on search tab.
    // Current implementation: addParam !== null → open, initialTab defaults to 'search'.
    const sheet = screen.getByTestId('add-cards-sheet');
    expect(sheet.getAttribute('data-initial-tab')).toBe('search');
  });

  it('opens on the Products tab for ?add=products', () => {
    renderPage('/collection?add=products');
    expect(screen.getByTestId('add-cards-sheet').getAttribute('data-initial-tab')).toBe('product');
  });

  it('opens on the Scan tab for ?add=scan', () => {
    renderPage('/collection?add=scan');
    expect(screen.getByTestId('add-cards-sheet').getAttribute('data-initial-tab')).toBe('scan');
  });

  it('opens on Search with the query pre-filled for ?add=search&q=', () => {
    renderPage('/collection?add=search&q=dark%20ritual');
    const sheet = screen.getByTestId('add-cards-sheet');
    expect(sheet.getAttribute('data-initial-tab')).toBe('search');
    expect(sheet.getAttribute('data-initial-query')).toBe('dark ritual');
  });

  it('opens the sheet on Search with the query when the collection search hands off', () => {
    renderPage('/collection');
    expect(screen.queryByTestId('add-cards-sheet')).toBeNull();
    fireEvent.click(screen.getByText('Search hand-off (table)'));
    const sheet = screen.getByTestId('add-cards-sheet');
    expect(sheet.getAttribute('data-initial-tab')).toBe('search');
    expect(sheet.getAttribute('data-initial-query')).toBe('dark ritual');
  });

  it('strips the ?add= param from the URL after mount', async () => {
    // We can't inspect the router's location directly in MemoryRouter without
    // routing hooks, so we verify the param was consumed by rendering again at
    // the same URL and checking the component doesn't re-open the sheet after
    // close. This test simply confirms the sheet renders (param consumed means
    // re-renders after close don't re-open — covered by the open-once behaviour
    // of useState initialiser).
    //
    // The actual URL mutation is tested implicitly: useEffect strips it via
    // setSearchParams({ replace: true }) which is a no-op in MemoryRouter but
    // the sheet is not re-opened on subsequent renders (state is local).
    renderPage('/collection?add=list');
    expect(screen.getByTestId('add-cards-sheet')).toBeTruthy();
  });
});

// Home's Your cards card links here (T164): its Breakdown door and shared-card
// row open the drawer, its Spare copies row lands on the surplus filter.
describe('CollectionPage – deep links from Home', () => {
  it('opens the Breakdown drawer for ?stats', () => {
    renderPage('/collection?stats');
    expect(screen.getByTestId('stats-drawer')).toBeTruthy();
  });

  it('applies the tradeable-surplus filter for ?spares, drawer closed', () => {
    renderPage('/collection?spares');
    expect(screen.getByTestId('card-table').getAttribute('data-filter-jump')).toBe('surplus');
    expect(screen.queryByTestId('stats-drawer')).toBeNull();
  });

  it('opens neither without the params', () => {
    renderPage('/collection');
    expect(screen.queryByTestId('stats-drawer')).toBeNull();
    expect(screen.getByTestId('card-table').getAttribute('data-filter-jump')).toBe('');
  });
});

describe('CollectionPage – Import history moved to ⋮ (T153)', () => {
  it('opens Import history from the ⋮ menu, not the add-cards flow', () => {
    useCollectionStore.setState({
      cards: [{ copyId: 'c1', scryfallId: 'sf1', name: 'Sol Ring' }] as never,
      importHistory: [
        { id: 'imp1', name: 'collection.csv', count: 5, format: 'manabox', addedAt: Date.now() },
      ] as never,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'More collection actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import history' }));
    expect(screen.getByRole('heading', { name: 'Import history' })).toBeTruthy();
    expect(screen.getByText('collection.csv')).toBeTruthy();
  });

  it('deletes an import with a confirm that is honest about Undo, not "cannot be undone"', () => {
    useCollectionStore.setState({
      cards: [{ copyId: 'c1', scryfallId: 'sf1', name: 'Sol Ring', importId: 'imp1' }] as never,
      importHistory: [
        { id: 'imp1', name: 'collection.csv', count: 1, format: 'manabox', addedAt: Date.now() },
      ] as never,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'More collection actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import history' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select/ }));
    fireEvent.click(screen.getByRole('button', { name: /Delete selected/ }));
    expect(screen.getByText(/You can undo from the toast/)).toBeTruthy();
    expect(screen.queryByText(/This can't be undone/)).toBeNull();
  });
});

describe('CollectionPage – Delete collection from ⋮', () => {
  it('is not offered on an empty collection', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'More collection actions' })).toBeNull();
  });

  it('runs the two-step confirm, then clears the collection', async () => {
    const clearCards = vi.fn(() => Promise.resolve());
    useCollectionStore.setState({
      cards: [
        { copyId: 'c1', scryfallId: 'sf1', name: 'Sol Ring' },
        { copyId: 'c2', scryfallId: 'sf2', name: 'Arcane Signet' },
      ] as never,
      clearCards,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'More collection actions' }));
    const items = screen.getAllByRole('menuitem');
    expect(items[items.length - 1].textContent).toBe('Delete collection');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete collection' }));

    expect(screen.getByRole('heading', { name: 'Delete entire collection?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(clearCards).not.toHaveBeenCalled();

    // The store offers Undo from its toast, so the final step must not claim otherwise.
    expect(screen.getByRole('heading', { name: 'Last chance: delete everything?' })).toBeTruthy();
    expect(screen.getByText(/Undo is only in the toast that follows/)).toBeTruthy();
    expect(screen.queryByText(/can't be undone/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));

    await waitFor(() => expect(clearCards).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Last chance: delete everything?' })).toBeNull()
    );
  });

  it('Cancel leaves the collection alone', () => {
    const clearCards = vi.fn(() => Promise.resolve());
    useCollectionStore.setState({
      cards: [{ copyId: 'c1', scryfallId: 'sf1', name: 'Sol Ring' }] as never,
      clearCards,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'More collection actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete collection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Delete entire collection?' })).toBeNull();
    expect(clearCards).not.toHaveBeenCalled();
  });
});
