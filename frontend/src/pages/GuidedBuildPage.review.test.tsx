// @vitest-environment happy-dom
/**
 * Focused tests for the GuidedBuildPage structured Review step (UX-316 item 3).
 * The page has heavy store and network dependencies, so we stub everything
 * that isn't the Review rendering logic and advance to step 3 via fireEvent.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const baseCustomization = {
    targetBracket: 3,
    landCount: 37,
    nonBasicLandCount: 15,
    collectionMode: false,
    collectionStrategy: 'partial',
    collectionOwnedPercent: 80,
    budgetMode: false,
    budgetCents: 5000,
    tempBannedCards: [],
    tempMustIncludeCards: [],
  };

  return {
    baseCustomization,
    customization: { ...baseCustomization },
    collectionCards: [] as unknown[],
    decks: [] as unknown[],
    generateDeck: vi.fn(() => Promise.resolve({})),
  };
});

// ── Store stubs ─────────────────────────────────────────────────────────────
vi.mock('@/deck-builder/store', () => ({
  useDeckBuilderStore: (
    sel: (
      s: ReturnType<typeof import('@/deck-builder/store').useDeckBuilderStore.getState>
    ) => unknown
  ) =>
    sel({
      commander: {
        id: 'c1',
        name: 'Atraxa, Praetors’ Voice',
        type_line: 'Legendary Creature',
      } as unknown as import('@/deck-builder/types').ScryfallCard,
      partnerCommander: null,
      colorIdentity: ['W', 'U', 'B', 'G'],
      customization: testState.customization,
      updateCustomization: vi.fn(),
      setCommander: vi.fn(),
      setPartnerCommander: vi.fn(),
      setEdhrecStats: vi.fn(),
      setEdhrecLandSuggestion: vi.fn(),
      reset: vi.fn(),
    } as unknown as ReturnType<typeof import('@/deck-builder/store').useDeckBuilderStore.getState>),
}));

vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: unknown[] }) => unknown) =>
    sel({ cards: testState.collectionCards }),
}));
vi.mock('../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[]; createDeck: () => string }) => unknown) =>
    sel({ decks: testState.decks, createDeck: () => 'new-id' }),
}));

// ── Network / service stubs ─────────────────────────────────────────────────
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCommanderData: () => Promise.resolve(null),
}));
vi.mock('@/deck-builder/services/deckBuilder/commanderProfile', () => ({
  buildCommanderProfile: () => ({ suggestedThemes: [] }),
}));
vi.mock('@/deck-builder/services/deckBuilder/deckGenerator', () => ({
  generateDeck: testState.generateDeck,
}));
vi.mock('../lib/save-generated-deck', () => ({
  saveGeneratedDeck: () => 'new-id',
}));

// ── Heavy component stubs ───────────────────────────────────────────────────
vi.mock('../components/deck/CommanderSearch', () => ({
  CommanderSearch: () => <div data-testid="commander-search" />,
}));
vi.mock('../components/deck/PlaystylePicker', () => ({
  PlaystylePicker: () => <div />,
}));
vi.mock('../components/deck/CommanderProfileCard', () => ({
  CommanderProfileCard: () => <div />,
}));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => <div />,
}));
vi.mock('../components/deck/ThemePicker', () => ({
  ThemePicker: () => <div data-testid="theme-picker" />,
}));
vi.mock('../components/deck/DeckCustomizer', () => ({
  DeckCustomizer: () => <div data-testid="deck-customizer" />,
}));
vi.mock('../components/GenerationTakeover', () => ({
  GenerationTakeover: () => <div />,
}));

// ── Import after mocks ──────────────────────────────────────────────────────
import { GuidedBuildPage } from './GuidedBuildPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <GuidedBuildPage />
    </MemoryRouter>
  );
}

/** Advance the stepper to step 3 (Review) by clicking Next three times. */
function advanceToReview() {
  // Step 0 → 1
  fireEvent.click(screen.getByText('Next'));
  // Step 1 → 2
  fireEvent.click(screen.getByText('Next'));
  // Step 2 → 3
  fireEvent.click(screen.getByText('Next'));
}

describe('GuidedBuildPage — structured Review step (UX-316)', () => {
  beforeEach(() => {
    localStorage.clear();
    testState.customization = { ...testState.baseCustomization };
    testState.collectionCards = [];
    testState.decks = [];
    testState.generateDeck.mockClear();
  });

  it('shows the Review heading at step 3', () => {
    renderPage();
    advanceToReview();
    expect(screen.getByText('Review')).toBeTruthy();
  });

  it('shows the commander name in the review card', () => {
    renderPage();
    advanceToReview();
    expect(screen.getByText(/Atraxa/)).toBeTruthy();
  });

  it('shows the Commander label row', () => {
    renderPage();
    advanceToReview();
    expect(screen.getByText('Commander')).toBeTruthy();
  });

  it('shows the Themes label row', () => {
    renderPage();
    advanceToReview();
    expect(screen.getByText('Themes')).toBeTruthy();
  });

  it('shows the Bracket label row', () => {
    renderPage();
    advanceToReview();
    expect(screen.getByText('Bracket')).toBeTruthy();
  });

  it('shows the Lands label row', () => {
    renderPage();
    advanceToReview();
    // "Lands" appears both as a review-row label AND as a chip — use getAllByText.
    const all = screen.getAllByText('Lands');
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the Card pool label row', () => {
    renderPage();
    advanceToReview();
    expect(screen.getByText('Card pool')).toBeTruthy();
  });

  it('renders Target composition section with category chips', () => {
    renderPage();
    advanceToReview();
    expect(screen.getByText('Target composition')).toBeTruthy();
    // "Lands" appears as both a review-row label and a chip; getAllByText handles that.
    expect(screen.getAllByText('Lands').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Ramp')).toBeTruthy();
    expect(screen.getByText('Removal')).toBeTruthy();
  });

  it('shows "Commander core" when no themes are selected', () => {
    renderPage();
    advanceToReview();
    expect(screen.getByText('Commander core')).toBeTruthy();
  });

  it('shows the Build my deck button at step 3', () => {
    renderPage();
    advanceToReview();
    expect(screen.getByText('Build my deck')).toBeTruthy();
  });

  it('renders the guided-review-card element', () => {
    renderPage();
    advanceToReview();
    expect(document.querySelector('.guided-review-card')).toBeTruthy();
  });

  it('passes only free collection copies to available-only generation', async () => {
    testState.customization = {
      ...testState.baseCustomization,
      collectionMode: true,
      collectionStrategy: 'available',
    };
    testState.collectionCards = [
      { copyId: 'free-copy', name: 'Free Card' },
      { copyId: 'claimed-copy', name: 'Claimed Card' },
      { copyId: 'partly-claimed-copy', name: 'Partly Claimed Card' },
      { copyId: 'partly-free-copy', name: 'Partly Claimed Card' },
    ];
    testState.decks = [
      {
        id: 'deck-1',
        cards: [
          {
            slotId: 'slot-1',
            card: { id: 'claimed-scryfall', name: 'Claimed Card' },
            allocatedCopyId: 'claimed-copy',
          },
          {
            slotId: 'slot-2',
            card: { id: 'partly-scryfall', name: 'Partly Claimed Card' },
            allocatedCopyId: 'partly-claimed-copy',
          },
        ],
        sideboard: [],
      },
    ];

    renderPage();
    advanceToReview();
    fireEvent.click(screen.getByText('Build my deck'));

    await waitFor(() => expect(testState.generateDeck).toHaveBeenCalled());
    const [[args]] = testState.generateDeck.mock.calls as unknown as Array<
      [
        {
          collectionNames: Set<string>;
          collectionAvailableCounts: Map<string, number>;
        },
      ]
    >;
    expect([...args.collectionNames].sort()).toEqual(['Free Card', 'Partly Claimed Card']);
    expect(args.collectionAvailableCounts.get('Free Card')).toBe(1);
    expect(args.collectionAvailableCounts.get('Partly Claimed Card')).toBe(1);
    expect(args.collectionAvailableCounts.has('Claimed Card')).toBe(false);
  });
});
