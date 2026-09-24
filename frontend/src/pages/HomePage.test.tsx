// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pending } from '@/test/pending';

// Stub AddCardsSheet so opening it doesn't mount the full modal stack
// (CardScanner, UploadPanel, etc.) — mirrors CollectionPage.test.tsx.
vi.mock('../components/AddCardsSheet', () => ({
  AddCardsSheet: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="add-cards-sheet">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

// Every section fetches or reads IndexedDB on mount — stubbed so this suite
// stays hermetic and exercises HomePage's composition and the hero, not each
// section's own branching (covered by each section's own test file).
vi.mock('../lib/use-activity', () => ({
  useActivity: () => ({ count: 0, actionRequired: [], recent: [], loading: false }),
}));

// Controllable per-test — mutated directly (not via mockReturnValue) since
// useAuth's real shape is a selector-hook, not a plain mock return. Reset to
// the authed default in beforeEach so no test leaks state into the next.
const mockAuthState = vi.hoisted(() => ({
  status: 'authed' as 'authed' | 'guest',
  user: { id: 'u1', username: 'georgep', role: 'user' as const },
  profile: null as { displayName: string | null } | null,
}));
vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

vi.mock('../lib/friends-client', () => ({
  getFriendsActivity: () => Promise.resolve([]),
}));
vi.mock('../lib/discover-client', () => ({
  listDiscoverDecks: () => Promise.resolve({ decks: [], page: 1, hasMore: false }),
  likeDeck: vi.fn(),
  unlikeDeck: vi.fn(),
  bookmarkDeck: vi.fn(),
  unbookmarkDeck: vi.fn(),
}));
vi.mock('../components/play/GameNights', () => ({
  useGameNights: () => ({ nights: [], loading: false, error: null, refresh: vi.fn() }),
}));
// Controllable so the hero's pending-value branch (E277 reservation) is
// reachable — the default resolves empty like before.
const mockGetValueHistory = vi.hoisted(() => vi.fn((): Promise<unknown> => Promise.resolve([])));
vi.mock('../lib/value-history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/value-history')>();
  return {
    ...actual,
    getValueHistory: mockGetValueHistory,
    getLatestMovers: () => Promise.resolve(null),
  };
});

// The hero's own pure picks — mocked so a branch (art vs fallback) is a
// deterministic setup, not dependent on this file's real (empty) collection/
// decks stores, and so the time-of-day greeting can't make an assertion
// flaky depending on when the suite happens to run.
const mockPickHeroCard = vi.hoisted(() =>
  vi.fn(() => null as { name: string; art?: string; reason: 'top' | 'recent' | 'commander' } | null)
);
vi.mock('../lib/home-hero', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/home-hero')>();
  return { ...actual, pickHeroCard: mockPickHeroCard, heroGreeting: () => 'Good morning' };
});

const mockUseCardThumb = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
vi.mock('../lib/card-thumbs', () => ({
  useCardThumb: mockUseCardThumb,
  imageFromCard: () => undefined,
}));

// The hero reads live sync state to distinguish "settled empty" from "still
// settling" — pinned to idle here so the fallback branch is deterministic;
// the settling branch flips this per-test.
const mockSyncState = vi.hoisted(() => ({ state: 'ready' as string }));
vi.mock('../lib/sync', () => ({
  getSyncState: () => mockSyncState.state,
  onSyncedChange: () => () => {},
  // The hero, YourDecks and WaitingOnYou read `useAwaitingFirstPull`, which bails
  // on a failed pull so a broken sync falls back to the empty state instead of
  // spinning forever. Without this the whole file throws on mount.
  hasSyncError: () => false,
  // Both stores' persist subscribers call this SYNCHRONOUSLY on any
  // `cards`/`binders`/`decks` write, so seeding a store below throws without
  // it — the scale-line tests are the first in this file to write real rows.
  isApplyingServer: () => false,
}));

import { HomePage } from './HomePage';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import type { BinderDef, EnrichedCard } from '../types';
import type { Deck } from '../store/decks';
import { dayKey } from '../lib/value-history';

/** The thinnest rows the scale line's three counts can be taken from — the
 *  cards below still walk them (NewArrivalsCard reads deck.cards), so an
 *  empty object literal isn't enough. */
function makeRow(): EnrichedCard {
  return { name: 'Card', quantity: 1 } as unknown as EnrichedCard;
}

function makeDeckRow(id: string): Deck {
  return {
    id,
    name: id,
    format: 'commander',
    cards: [],
    sideboard: [],
    updatedAt: 0,
  } as unknown as Deck;
}

/** A collection with cards, so the hero shows the collection rather than
 *  the setup checklist an empty one gets. */
function withCollection() {
  useCollectionStore.setState({ cards: [makeRow(), makeRow()] });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockAuthState.status = 'authed';
  mockAuthState.user = { id: 'u1', username: 'georgep', role: 'user' };
  mockAuthState.profile = null;
  mockPickHeroCard.mockReturnValue(null);
  mockUseCardThumb.mockReturnValue(undefined);
  // 'ready' = the first pull has landed, so an empty collection is settled
  // empty (useAwaitingFirstPull); tests that need it pending set their own.
  mockSyncState.state = 'ready';
  mockGetValueHistory.mockImplementation(() => Promise.resolve([]));
  // The remembered /home shape is written from effects that can land after a
  // test's last await — cleared at the start, never the end.
  localStorage.removeItem('sc-home-shape');
  // The real store boots with hydrating: true (App flips it after the IDB
  // hydrate); settle it here so the fallback branch is reachable by default.
  useCollectionStore.setState({ hydrating: false, cards: [], binders: [] });
  useDecksStore.setState({ decks: [], hydrated: true });
});

describe('HomePage', () => {
  it('reads top to bottom for a returning collector: hero, decks, table, discover', async () => {
    withCollection();
    useDecksStore.setState({ decks: [makeDeckRow('d1')], hydrated: true });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Good morning, georgep' })).toBeTruthy();
    // Sections with nothing to show (no price movers, no import, nobody at the
    // table) render nothing once settled. Cards but no binder yet: that step
    // is waiting on you.
    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
        'Waiting on you',
        'Your decks',
        'Discover',
      ])
    );
    expect(screen.getByRole('link', { name: 'Build your first binder' })).toBeTruthy();
    // Nothing in the table: one quiet line, not three empty cards.
    expect(screen.getByRole('region', { name: 'Around the table' })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('No public decks from other players yet.')).toBeTruthy()
    );
    expect(screen.queryByTestId('add-cards-sheet')).toBeNull();
  });

  // STYLE_GUIDE § Layout system: one filled primary, one outline secondary, a
  // ⋮ for the rest. It was four equal outline buttons under a scoped search.
  describe('hero actions', () => {
    beforeEach(() => withCollection());

    it('are Add cards, New deck, and a ⋮ holding the rest', () => {
      renderPage();
      const add = screen.getByRole('button', { name: 'Add cards' });
      expect(add.className).toContain('btn-primary');
      expect(screen.getByRole('link', { name: 'New deck' }).getAttribute('href')).toBe(
        '/decks/new'
      );
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      expect(screen.getByRole('menuitem', { name: 'Plan a game night' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'Friends' })).toBeTruthy();
    });

    it('has no search box or scope toggle of its own — each list carries its own search', () => {
      renderPage();
      expect(screen.queryByRole('radio')).toBeNull();
      expect(screen.queryByRole('search', { name: /scope/i })).toBeNull();
    });

    it('opens AddCardsSheet from Add cards, and closes it', () => {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Add cards' }));
      expect(screen.getByTestId('add-cards-sheet')).toBeTruthy();
      fireEvent.click(screen.getByText('Close'));
      expect(screen.queryByTestId('add-cards-sheet')).toBeNull();
    });
  });

  // An empty collection's hero is the setup checklist (it was a separate Get
  // started card beside eight empty rows).
  describe('hero checklist', () => {
    it('shows the three steps, the sample collection, and the guides for an empty collection', () => {
      renderPage();
      expect(screen.getByRole('heading', { level: 1, name: 'Start with your cards' })).toBeTruthy();
      expect(screen.getByText('Good morning, georgep')).toBeTruthy();
      expect(screen.getByRole('link', { name: /Add your collection/ }).getAttribute('href')).toBe(
        '/collection?add=list'
      );
      expect(
        screen.getByRole('link', { name: /Build your first binder/ }).getAttribute('href')
      ).toBe('/collection/binders');
      expect(screen.getByRole('link', { name: /Make a deck/ }).getAttribute('href')).toBe(
        '/decks/new'
      );
      expect(screen.getByRole('button', { name: /Try the sample collection/ })).toBeTruthy();
      expect(screen.getByRole('link', { name: /Read the guides/ }).getAttribute('href')).toBe(
        '/guides/'
      );
      expect(screen.getByRole('button', { name: 'Add cards' })).toBeTruthy();
    });

    it('ticks a finished step instead of linking it', () => {
      useDecksStore.setState({ decks: [makeDeckRow('d1')], hydrated: true });
      renderPage();
      expect(screen.queryByRole('link', { name: /Make a deck/ })).toBeNull();
      expect(screen.getByText(/, done/)).toBeTruthy();
    });

    it('never shows while the collection is still hydrating', () => {
      useCollectionStore.setState({ hydrating: true });
      renderPage();
      expect(screen.queryByText('Start with your cards')).toBeNull();
    });

    it('gives a guest the checklist with no personal greeting', () => {
      mockAuthState.status = 'guest';
      renderPage();
      expect(screen.getByRole('heading', { level: 1, name: 'Start with your cards' })).toBeTruthy();
      expect(screen.getByText('Welcome to SpellControl')).toBeTruthy();
      expect(screen.queryByText(/Good morning/)).toBeNull();
    });
  });

  // One fact, one place: the value and its trend live in the hero only.
  describe('hero value and sparkline', () => {
    beforeEach(() => withCollection());

    it('draws the value, its delta and the sparkline from two points up', async () => {
      mockGetValueHistory.mockImplementation(() =>
        Promise.resolve([
          { day: dayKey(Date.now() - 7 * 86400000), value: 100, at: Date.now() - 7 * 86400000 },
          { day: dayKey(Date.now()), value: 130, at: Date.now() },
        ])
      );
      const { container } = renderPage();
      expect(await screen.findByText('$130')).toBeTruthy();
      expect(screen.getByText('+$30 this week')).toBeTruthy();
      await waitFor(() =>
        expect(container.querySelector('.home-value-sparkline-line')).toBeTruthy()
      );
      const slider = screen.getByRole('slider');
      const label = slider.getAttribute('aria-label') ?? '';
      expect(label).toContain('$100');
      expect(label).toContain('$130');
      expect(label).toContain('+30%');
      expect(screen.getByText('Today')).toBeTruthy();
    });

    it('steps the readout with the arrow keys and clears it with Escape', async () => {
      mockGetValueHistory.mockImplementation(() =>
        Promise.resolve([
          { day: dayKey(Date.now() - 2 * 86400000), value: 100, at: Date.now() - 2 * 86400000 },
          { day: dayKey(Date.now() - 86400000), value: 110, at: Date.now() - 86400000 },
          { day: dayKey(Date.now()), value: 130, at: Date.now() },
        ])
      );
      renderPage();
      const slider = await screen.findByRole('slider');
      expect(slider.getAttribute('aria-valuenow')).toBe('2');
      fireEvent.keyDown(slider, { key: 'ArrowLeft' });
      expect(slider.getAttribute('aria-valuenow')).toBe('1');
      expect(within(slider).getByRole('status').textContent).toContain('$110');
      fireEvent.keyDown(slider, { key: 'Home' });
      expect(slider.getAttribute('aria-valuenow')).toBe('0');
      fireEvent.keyDown(slider, { key: 'Escape' });
      expect(slider.getAttribute('aria-valuenow')).toBe('2');
    });

    it('draws no sparkline from a single point', async () => {
      mockGetValueHistory.mockImplementation(() =>
        Promise.resolve([{ day: dayKey(Date.now()), value: 130, at: Date.now() }])
      );
      const { container } = renderPage();
      expect(await screen.findByText('$130')).toBeTruthy();
      expect(container.querySelector('.home-value-sparkline')).toBeNull();
    });
  });

  describe('hero featured card', () => {
    it('shows the empty-sleeve brand fallback (no art) for a brand-new empty collection', () => {
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeTruthy();
      expect(container.querySelector('.home-hero-art')).toBeNull();
      expect(container.querySelector('.home-hero-caption')).toBeNull();
    });

    it('shows the card art + tape-label caption once a hero card resolves', () => {
      withCollection();
      mockPickHeroCard.mockReturnValue({ name: 'Sol Ring', reason: 'top' });
      mockUseCardThumb.mockReturnValue('sol-ring.png');
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeNull();
      const img = container.querySelector('.home-hero-art') as HTMLImageElement | null;
      expect(img?.getAttribute('src')).toBe('sol-ring.png');
      expect(img?.getAttribute('alt')).toBe('');
      expect(screen.getByText('Sol Ring')).toBeTruthy();
      expect(screen.getByText('One of your most valuable cards')).toBeTruthy();
    });

    it('renders the owned printing art directly, skipping name resolution', () => {
      withCollection();
      mockPickHeroCard.mockReturnValue({
        name: 'Sol Ring',
        art: 'owned-printing.jpg',
        reason: 'top',
      });
      const { container } = renderPage();
      const img = container.querySelector('.home-hero-art') as HTMLImageElement | null;
      expect(img?.getAttribute('src')).toBe('owned-printing.jpg');
      // useCardThumb is skipped (called with undefined) when owned art is in hand.
      expect(mockUseCardThumb).toHaveBeenCalledWith(undefined, 'art_crop');
    });

    it('shows the loading shimmer, never the brand fallback, while still hydrating/syncing', () => {
      useCollectionStore.setState({ hydrating: true });
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeNull();
      expect(container.querySelector('.home-hero-art-loading')).toBeTruthy();

      useCollectionStore.setState({ hydrating: false });
      mockSyncState.state = 'syncing';
      const { container: c2 } = renderPage();
      expect(c2.querySelector('.home-hero-fallback')).toBeNull();
      expect(c2.querySelector('.home-hero-art-loading')).toBeTruthy();
    });

    it('never shows personal art for a guest, even if a hero card would otherwise resolve', () => {
      mockAuthState.status = 'guest';
      withCollection();
      mockPickHeroCard.mockReturnValue({ name: 'Sol Ring', reason: 'top' });
      mockUseCardThumb.mockReturnValue('sol-ring.png');
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-fallback')).toBeTruthy();
      expect(container.querySelector('.home-hero-art')).toBeNull();
      // No personal greeting/value either — same layout, generic content.
      expect(
        screen.getByRole('heading', { level: 1, name: 'Plan your Magic: The Gathering collection' })
      ).toBeTruthy();
      expect(screen.queryByText(/Good morning/)).toBeNull();
    });
  });

  describe('hero reservations (E277)', () => {
    it('reserves the value and scale lines while pending when the last visit had them', () => {
      localStorage.setItem('sc-home-shape', JSON.stringify({ 'hero-value': 1, 'hero-stats': 1 }));
      mockGetValueHistory.mockReturnValue(pending([]));
      useCollectionStore.setState({ hydrating: true });
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-value--loading')).toBeTruthy();
      expect(container.querySelector('.home-hero-stats--loading')).toBeTruthy();
      // Placeholders, not doors: nothing linkable and nothing announced.
      expect(screen.queryByRole('link', { name: /cards$/ })).toBeNull();
      expect(
        container.querySelector('.home-hero-stats--loading')?.getAttribute('aria-hidden')
      ).toBe('true');
    });

    it('reserves the caption under the loading art when the last visit showed a card', () => {
      localStorage.setItem('sc-home-shape', JSON.stringify({ 'hero-caption': 1 }));
      useCollectionStore.setState({ hydrating: true });
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-art-loading')).toBeTruthy();
      expect(container.querySelector('.home-hero-caption--loading')).toBeTruthy();
      expect(container.querySelector('.home-hero-value--loading')).toBeNull();
    });

    it('records the caption once a card with art resolves, and its absence on a settled-empty hero', async () => {
      mockPickHeroCard.mockReturnValue({ name: 'Sol Ring', art: 'owned.jpg', reason: 'top' });
      const { unmount } = renderPage();
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem('sc-home-shape') ?? '{}')).toMatchObject({
          'hero-caption': 1,
        })
      );
      unmount();
      mockPickHeroCard.mockReturnValue(null);
      renderPage();
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem('sc-home-shape') ?? '{}')).toMatchObject({
          'hero-caption': 0,
        })
      );
    });

    it('reserves nothing on a first visit (no memory) — a fresh account never gets a phantom row', () => {
      mockGetValueHistory.mockReturnValue(pending([]));
      useCollectionStore.setState({ hydrating: true });
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-value--loading')).toBeNull();
      expect(container.querySelector('.home-hero-stats--loading')).toBeNull();
      expect(container.querySelector('.home-hero-caption--loading')).toBeNull();
    });

    it('records the resolved shape so the next visit can reserve it', async () => {
      useCollectionStore.setState({ cards: [makeRow()] });
      renderPage();
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem('sc-home-shape') ?? '{}')).toMatchObject({
          'hero-stats': 1,
          'hero-value': 0,
        })
      );
    });

    it('a guest reserves nothing even with a remembered shape', () => {
      localStorage.setItem('sc-home-shape', JSON.stringify({ 'hero-value': 1, 'hero-stats': 1 }));
      mockAuthState.status = 'guest';
      useCollectionStore.setState({ hydrating: true });
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-value--loading')).toBeNull();
      expect(container.querySelector('.home-hero-stats--loading')).toBeNull();
    });
  });

  describe('hero scale line', () => {
    it('is suppressed entirely on a fresh account — a row of zeroes is worse than no row', () => {
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-stats')).toBeNull();
    });

    it('is suppressed for a guest even with local rows (the hero shows a guest nothing personal)', () => {
      mockAuthState.status = 'guest';
      useCollectionStore.setState({ cards: [makeRow(), makeRow()] });
      const { container } = renderPage();
      expect(container.querySelector('.home-hero-stats')).toBeNull();
    });

    it('renders one labelled door per count once any store holds rows', () => {
      useCollectionStore.setState({
        cards: [makeRow(), makeRow(), makeRow()],
        binders: [{ id: 'b1', name: 'Binder', filterGroups: [] } as unknown as BinderDef],
      });
      useDecksStore.setState({ decks: [makeDeckRow('d1'), makeDeckRow('d2')] });
      renderPage();
      expect(screen.getByRole('link', { name: '3 cards' }).getAttribute('href')).toBe(
        '/collection'
      );
      expect(screen.getByRole('link', { name: '2 decks' }).getAttribute('href')).toBe('/decks');
      expect(screen.getByRole('link', { name: '1 binder' }).getAttribute('href')).toBe(
        '/collection/binders'
      );
    });
  });
});
