// @vitest-environment happy-dom
/**
 * Targeted tests for:
 *   UX-316 — desktop Delete moved from inline btn-danger to the ⋮ OverflowMenu.
 *   UX-316 — one-shot BuildReportSheet wired into DeckEditorPage.
 *
 * DeckEditorPage has very heavy store + network dependencies, so we stub
 * everything non-essential and verify the structural changes only.
 */
import 'fake-indexeddb/auto';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildReport } from '@/deck-builder/types';

// ── Store stubs ─────────────────────────────────────────────────────────────
const mockDeleteDeck = vi.fn();
const mockDeck = {
  id: 'deck-1',
  name: 'Test Deck',
  source: 'generated',
  format: 'commander',
  cards: [],
  sideboard: [],
  commander: { id: 'c1', name: 'Atraxa', image_uris: { art_crop: 'https://cdn/art.jpg' } },
  partnerCommander: null,
  commanderAllocatedCopyId: null,
  partnerCommanderAllocatedCopyId: null,
  generationContext: null,
  buildReport: {
    targetBracket: 3,
    estimatedBracket: 3,
    dataSource: 'theme+bracket',
    builtFromCollection: false,
  } satisfies BuildReport,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: {
      decks: (typeof mockDeck)[];
      deleteDeck: typeof mockDeleteDeck;
      updateDeck: () => void;
      renameDeck: () => void;
      addCard: () => void;
      removeCard: () => void;
      addSideboardCard: () => void;
      removeSideboardCard: () => void;
      moveBetweenZones: () => void;
      setCommander: () => void;
      setPartnerCommander: () => void;
      duplicateDeck: () => string;
      setCardAllocation: () => void;
      updateCardPrinting: () => void;
      swapCard: () => void;
      replaceDeck: () => void;
      createDeck: () => string;
    }) => unknown
  ) =>
    sel({
      decks: [mockDeck],
      deleteDeck: mockDeleteDeck,
      updateDeck: vi.fn(),
      renameDeck: vi.fn(),
      addCard: vi.fn(),
      removeCard: vi.fn(),
      addSideboardCard: vi.fn(),
      removeSideboardCard: vi.fn(),
      moveBetweenZones: vi.fn(),
      setCommander: vi.fn(),
      setPartnerCommander: vi.fn(),
      duplicateDeck: vi.fn(() => 'dup-id'),
      setCardAllocation: vi.fn(),
      updateCardPrinting: vi.fn(),
      swapCard: vi.fn(),
      replaceDeck: vi.fn(),
      createDeck: vi.fn(() => 'new-id'),
    }),
  effectiveBracket: () => 3,
  newDeckCard: vi.fn(),
}));

vi.mock('../store/deck-history', () => ({
  useDeckHistoryStore: (
    sel: (s: {
      record: () => void;
      begin: () => void;
      commit: () => void;
      undo: () => void;
      redo: () => void;
      canUndo: () => false;
      canRedo: () => false;
      undoLabel: () => null;
      redoLabel: () => null;
    }) => unknown
  ) =>
    sel({
      record: vi.fn(),
      begin: vi.fn(),
      commit: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: () => false,
      canRedo: () => false,
      undoLabel: () => null,
      redoLabel: () => null,
    }),
}));

vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: []; binders: []; importHistory: [] }) => unknown) =>
    sel({ cards: [], binders: [], importHistory: [] }),
}));

vi.mock('../store/toasts', () => ({
  useToastsStore: (sel: (s: { push: () => void }) => unknown) => sel({ push: vi.fn() }),
}));

// ── Heavy component / lib stubs ─────────────────────────────────────────────
vi.mock('../components/deck/DeckDisplay', () => ({
  DeckDisplay: () => <div data-testid="deck-display" />,
}));
vi.mock('../components/deck/CardSearchPanel', () => ({
  CardSearchPanel: () => <div />,
}));
vi.mock('../components/deck/DeckCombosPanel', () => ({
  DeckCombosPanel: () => <div />,
}));
vi.mock('../components/deck/DeckAnalysisPanel', () => ({
  DeckAnalysisPanel: () => <div />,
}));
vi.mock('../components/deck/DeckTestHandPanel', () => ({
  DeckTestHandPanel: () => <div />,
}));
vi.mock('../components/deck/NextBestMove', () => ({
  NextBestMove: () => <div />,
}));
vi.mock('../components/deck/DeckTokensSheet', () => ({
  DeckTokensSheet: () => <div />,
}));
vi.mock('../components/deck/use-deck-tokens', () => ({
  useDeckTokens: () => [],
}));
vi.mock('../components/deck/PowerHero', () => ({
  PowerHero: () => <div />,
}));
vi.mock('../components/deck/CoachFeed', () => ({
  CoachFeed: () => <div />,
}));
vi.mock('../components/deck/DeckSizePrompt', () => ({
  DeckSizePrompt: () => <div />,
}));
vi.mock('../components/deck/EnginePanel', () => ({
  EnginePanel: () => <div />,
}));
vi.mock('../components/deck/WinConditionPanel', () => ({
  WinConditionPanel: () => <div />,
}));
vi.mock('../components/deck/CardFitPanel', () => ({
  CardFitPanel: () => <div />,
}));
vi.mock('../components/deck/SwapThisCard', () => ({
  SwapThisCard: () => <div />,
}));
vi.mock('../components/deck/SimilarCardsStrip', () => ({
  SimilarCardsStrip: () => <div />,
}));
vi.mock('../components/deck/MoveToDeckSheet', () => ({
  MoveToDeckSheet: () => <div />,
}));
vi.mock('../components/deck/BuildReportSheet', () => ({
  BuildReportSheet: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="build-report-sheet">
      <button onClick={onClose}>Close report</button>
    </div>
  ),
}));
vi.mock('../lib/build-report-seen', () => ({
  isBuildReportSeen: vi.fn(() => false),
  markBuildReportSeen: vi.fn(),
}));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => <div />,
}));
vi.mock('../lib/materialize', () => ({ materializeBinders: () => ({ binders: [] }) }));
vi.mock('../lib/use-deck-combos', () => ({ useDeckCombos: () => ({ combos: [] }) }));
vi.mock('../lib/use-commander-bracket-analysis', () => ({
  useCommanderBracketAnalysis: () => null,
}));
vi.mock('../lib/use-undo-redo-keyboard', () => ({
  useUndoRedoKeyboard: () => {},
}));
vi.mock('../lib/allocations', () => ({
  buildAllocationMap: () => new Map(),
  pickCollectionCopy: () => null,
  bindableFinishesByPrinting: () => new Map(),
  findStealableCopy: () => null,
  useCollectionByCopyId: () => new Map(),
}));
vi.mock('../deck-builder/services/deckBuilder/substituteFinder', () => ({
  buildSubstitutionPlan: () => [],
}));
vi.mock('../deck-builder/services/deckBuilder/nextBestMove', () => ({
  buildNextBestMoves: () => [],
}));
vi.mock('../deck-builder/services/deckBuilder/commanderDeckAnalysis', () => ({
  computeRoleCounts: () => ({}),
}));
vi.mock('../deck-builder/services/tagger/client', () => ({
  loadTaggerData: () => Promise.resolve(null),
  hasTaggerData: () => false,
}));
vi.mock('../deck-builder/services/deckBuilder/costAnalyzer', () => ({
  filterCostPlanByOwnership: () => [],
}));
vi.mock('../lib/deck-analysis', () => ({
  classifyCandidate: () => 'neutral',
  // Land-count advice memo — empty roles ⇒ no advice, keeps the hero quiet.
  analyzeDeck: () => ({ roles: [] }),
}));
vi.mock('../lib/intelligent-cuts', () => ({
  rankReplacementCuts: () => [],
}));
vi.mock('../lib/card-fit', () => ({
  computeAddFit: () => null,
}));
vi.mock('../deck-builder/services/winConditions/types', () => ({}));
vi.mock('../lib/commanders', () => ({ isValidCommander: () => true }));
vi.mock('@/deck-builder/lib/partnerUtils', () => ({
  areValidPartners: () => false,
  canHavePartner: () => false,
}));
vi.mock('@/lib/deck-change', () => ({
  fromGapCard: () => null,
  sortOwnedFirst: () => [],
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardPrice: () => null,
  getCardByName: () => Promise.resolve(null),
}));
vi.mock('@/deck-builder/lib/constants/archetypes', () => ({
  DECK_FORMAT_CONFIGS: {
    commander: {
      mainboardSize: 99,
      hasCommander: true,
      sideboardSize: 0,
      label: 'Commander',
      maxCopies: 1,
    },
    brawl: {
      mainboardSize: 59,
      hasCommander: true,
      sideboardSize: 0,
      label: 'Brawl',
      maxCopies: 1,
    },
    standard: {
      mainboardSize: 60,
      hasCommander: false,
      sideboardSize: 15,
      label: 'Standard',
      maxCopies: 4,
    },
    modern: {
      mainboardSize: 60,
      hasCommander: false,
      sideboardSize: 15,
      label: 'Modern',
      maxCopies: 4,
    },
    legacy: {
      mainboardSize: 60,
      hasCommander: false,
      sideboardSize: 15,
      label: 'Legacy',
      maxCopies: 4,
    },
    vintage: {
      mainboardSize: 60,
      hasCommander: false,
      sideboardSize: 15,
      label: 'Vintage',
      maxCopies: 4,
    },
    pauper: {
      mainboardSize: 60,
      hasCommander: false,
      sideboardSize: 15,
      label: 'Pauper',
      maxCopies: 4,
    },
    oathbreaker: {
      mainboardSize: 58,
      hasCommander: true,
      sideboardSize: 0,
      label: 'Oathbreaker',
      maxCopies: 1,
    },
    paupercommander: {
      mainboardSize: 99,
      hasCommander: true,
      sideboardSize: 0,
      label: 'Pauper Commander',
      maxCopies: 1,
    },
    pioneer: {
      mainboardSize: 60,
      hasCommander: false,
      sideboardSize: 15,
      label: 'Pioneer',
      maxCopies: 4,
    },
    predh: {
      mainboardSize: 99,
      hasCommander: true,
      sideboardSize: 0,
      label: 'PreDH',
      maxCopies: 1,
    },
    duel: {
      mainboardSize: 99,
      hasCommander: true,
      sideboardSize: 0,
      label: 'Duel Commander',
      maxCopies: 1,
    },
  },
}));

import { DeckEditorPage } from './DeckEditorPage';

function renderEditor({ justGenerated = false }: { justGenerated?: boolean } = {}) {
  // The one-shot Build Report only shows when arriving FROM generation —
  // GuidedBuildPage navigates with { state: { justGenerated: true } }.
  const entry = justGenerated
    ? { pathname: '/decks/deck-1', state: { justGenerated: true } }
    : '/decks/deck-1';
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/decks/:id" element={<DeckEditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('DeckEditorPage — Delete in ⋮ overflow (UX-316)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('does NOT render an inline btn-danger "Delete" button in the action row', () => {
    renderEditor();
    // The old inline Delete was a .btn.btn-danger button with text "Delete".
    // It should no longer exist outside the ⋮ dropdown panel.
    const dangerBtns = Array.from(document.querySelectorAll('.btn-danger')).filter((el) =>
      el.textContent?.includes('Delete')
    );
    expect(dangerBtns).toHaveLength(0);
  });

  it('renders the ⋮ Deck actions trigger button', () => {
    renderEditor();
    const triggers = screen.getAllByLabelText('Deck actions');
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('reveals Delete as a danger menuitem when the ⋮ is opened', () => {
    renderEditor();
    // Open the first ⋮ trigger (desktop actions bar).
    const [trigger] = screen.getAllByLabelText('Deck actions');
    fireEvent.click(trigger);
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
    expect(deleteItem).toBeTruthy();
    expect(deleteItem.className).toContain('deck-editor-overflow-item--danger');
  });

  it('keeps Playtest out of the desktop ⋮ menu because the action row already shows it', () => {
    renderEditor();
    const [desktopTrigger] = screen.getAllByLabelText('Deck actions');
    fireEvent.click(desktopTrigger);

    expect(screen.queryByRole('menuitem', { name: 'Playtest' })).toBeNull();
  });

  it('keeps Playtest in the mobile ⋮ menu where there is no inline Playtest button', () => {
    renderEditor();
    const [, mobileTrigger] = screen.getAllByLabelText('Deck actions');
    fireEvent.click(mobileTrigger);

    expect(screen.getByRole('menuitem', { name: 'Playtest' })).toBeTruthy();
  });
});

describe('DeckEditorPage — one-shot BuildReportSheet (UX-316)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('shows BuildReportSheet when arriving from generation with the report unseen', () => {
    renderEditor({ justGenerated: true });
    expect(screen.getByTestId('build-report-sheet')).toBeTruthy();
  });

  it('hides BuildReportSheet after its onClose fires', () => {
    renderEditor({ justGenerated: true });
    fireEvent.click(screen.getByText('Close report'));
    expect(screen.queryByTestId('build-report-sheet')).toBeNull();
  });

  it('does NOT show the sheet on a normal open of a pre-existing generated deck', () => {
    // Same deck, same unseen report — but no justGenerated router state.
    // Without this gate every generated deck made before the feature shipped
    // would pop the sheet once on its next open.
    renderEditor();
    expect(screen.queryByTestId('build-report-sheet')).toBeNull();
  });
});
