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

// Stub the thumbnail network leaf so the nested DeckCardRows don't reach out
// (avoids the post-teardown fetch flake).
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

// DeckEditorPage calls useEdhrecComboOverlay ITSELF (page line ~846) — mocking
// DeckCombosPanel below does not cover it. Unstubbed, its effect fires two
// EDHREC fetches per render whose retry timers outlive the test; the rejection
// is logged inside edhrec/client.ts, and that console write races vitest's
// worker teardown (`Closing rpc while "onUserConsoleLog" was pending`).
//
// Measured, not guessed: a 3x instrumented CI run attributed 50 of 100
// post-afterAll console writes to this file, all EDHREC. It is also the file
// CI named in all three teardown-flake failures (2026-07-16/08-04/08-07).
// The hook has only two consumers, so stubbing it here is bounded.
vi.mock('@/lib/deck-analysis/edhrec-combo-overlay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deck-analysis/edhrec-combo-overlay')>()),
  useEdhrecComboOverlay: () => ({}),
}));

// ── Store stubs ─────────────────────────────────────────────────────────────
const mockDeleteDeck = vi.fn();
const mockRenameDeck = vi.fn();
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

// Mutable so the hydration-gate tests below can simulate a not-yet-hydrated
// store / a missing deck without a second vi.mock factory; reset in that
// describe block's own beforeEach/afterEach so it can't leak into the rest of
// this file's tests, which all expect the default (hydrated, deck present).
let mockDecks: (typeof mockDeck)[] = [mockDeck];
let mockHydrated = true;
// The viewer's collection by copy id; the printing-action tests bind copies.
let mockCollectionById = new Map<string, { copyId: string; name: string; scryfallId: string }>();

vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: {
      decks: (typeof mockDeck)[];
      hydrated: boolean;
      deleteDeck: typeof mockDeleteDeck;
      updateDeck: () => void;
      renameDeck: () => void;
      addCard: () => void;
      removeCard: () => void;
      addSideboardCard: () => void;
      removeSideboardCard: () => void;
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
      decks: mockDecks,
      hydrated: mockHydrated,
      deleteDeck: mockDeleteDeck,
      updateDeck: vi.fn(),
      renameDeck: mockRenameDeck,
      addCard: vi.fn(),
      removeCard: vi.fn(),
      addSideboardCard: vi.fn(),
      removeSideboardCard: vi.fn(),
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

// Mutable so the header-actions tests below can flip Undo/Redo availability
// per-test without a second vi.mock factory; reset in each describe block's
// beforeEach so a toggled test can't leak into the delete-flow tests above.
let mockCanUndo = false;
let mockCanRedo = false;
let mockUndoLabel: string | null = null;
let mockRedoLabel: string | null = null;

vi.mock('../store/deck-history', () => ({
  useDeckHistoryStore: (
    sel: (s: {
      record: () => void;
      begin: () => void;
      commit: () => void;
      undo: () => void;
      redo: () => void;
      canUndo: () => boolean;
      canRedo: () => boolean;
      undoLabel: () => string | null;
      redoLabel: () => string | null;
    }) => unknown
  ) =>
    sel({
      record: vi.fn(),
      begin: vi.fn(),
      commit: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: () => mockCanUndo,
      canRedo: () => mockCanRedo,
      undoLabel: () => mockUndoLabel,
      redoLabel: () => mockRedoLabel,
    }),
}));

vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: []; binders: []; importHistory: [] }) => unknown) =>
    sel({ cards: [], binders: [], importHistory: [] }),
}));

// The binder chain (tags, Secret Lair drops, release dates, allocations, set
// data) reads the same empty collection as the store mock above.
vi.mock('@/lib/binder/use-binder-layout-inputs', () => ({
  useBinderLayoutInputs: () => ({
    cards: [],
    binders: [],
    allocatedCopyIds: new Set(),
    setMap: undefined,
  }),
}));
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));

const mockPushToast = vi.fn();
vi.mock('../store/toasts', () => ({
  useToastsStore: (sel: (s: { push: () => void }) => unknown) => sel({ push: mockPushToast }),
}));

// The two ⋮ printing actions: the planners stay real (they decide which rows
// show), the async runners are stubbed so each test picks the outcome.
const mockApplyCheapest = vi.fn();
const mockApplyMatch = vi.fn();
vi.mock('@/lib/deck/deck-printing-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deck/deck-printing-actions')>()),
  applyCheapestPrintings: (...args: unknown[]) => mockApplyCheapest(...args),
  applyMatchMyCopies: (...args: unknown[]) => mockApplyMatch(...args),
}));

// ── Heavy component / lib stubs ─────────────────────────────────────────────
// The stub renders the toolbar's Edit actions the page hands it, so the page's
// own handlers for them (paste, printings) stay under test.
vi.mock('../components/deck/DeckDisplay', () => ({
  DeckDisplay: ({
    editActions,
    deckActionsInHeader,
  }: {
    editActions?: { label: string; onClick: () => void }[];
    deckActionsInHeader?: boolean;
  }) => (
    <div data-testid="deck-display" data-deck-actions-in-header={String(!!deckActionsInHeader)}>
      {editActions?.map((a) => (
        <button key={a.label} type="button" data-testid="edit-action" onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </div>
  ),
}));
// The chip pulls in ShareDialog (the share sheet, friends-client,
// auth-api…) and fetches on mount via useDeckVisibility — irrelevant to these
// delete-flow tests and exactly the unmocked-network-leaf shape that causes
// the post-teardown fetch flake (see project_vitest_teardown_flake).
vi.mock('../components/deck/DeckVisibilityChip', () => ({
  DeckVisibilityChip: ({ variant }: { variant?: string }) => (
    <span data-testid="visibility-chip" data-variant={variant ?? 'meta'} />
  ),
}));
// DeckPublishNudge (E150) pulls in the same ShareDialog tree as the chip
// above, for the identical reason — none of these delete-flow tests navigate
// here with promptVisibility router state, so it never actually renders, but
// mock it anyway so the import itself can't reintroduce the fetch flake.
vi.mock('../components/deck/DeckPublishNudge', () => ({
  DeckPublishNudge: () => null,
}));
// Records the props the page hands the search panel, so the zone it reports
// can be asserted without mounting the real panel. Which filters that zone
// lifts is the panel's own business — see CardSearchPanel.zones.test.tsx.
const searchPanelProps: { addZone?: string }[] = [];
vi.mock('../components/deck/CardSearchPanel', () => ({
  CardSearchPanel: (props: { addZone?: string }) => {
    searchPanelProps.push(props);
    return <div />;
  },
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
vi.mock('@/lib/deck/build-report-seen', () => ({
  isBuildReportSeen: vi.fn(() => false),
  markBuildReportSeen: vi.fn(),
}));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => <div />,
}));
vi.mock('@/lib/binder/materialize', () => ({ materializeBinders: () => ({ binders: [] }) }));
vi.mock('@/lib/deck-analysis/use-deck-combos', () => ({ useDeckCombos: () => ({ combos: [] }) }));
vi.mock('@/lib/deck-analysis/use-commander-bracket-analysis', () => ({
  useCommanderBracketAnalysis: () => ({ status: 'ready', retry: () => {} }),
}));
vi.mock('@/lib/deck/use-undo-redo-keyboard', () => ({
  useUndoRedoKeyboard: () => {},
}));
vi.mock('@/lib/collection/allocations', () => ({
  buildAllocationMap: () => new Map(),
  pickCollectionCopy: () => null,
  bindableFinishesByPrinting: () => new Map(),
  findStealableCopy: () => null,
  useCollectionByCopyId: () => mockCollectionById,
  classifyAllocation: (id: string | null, byId?: Map<string, unknown>) =>
    id ? (byId?.has(id) ? 'allocated' : 'orphan') : 'unowned',
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
vi.mock('@/lib/deck-analysis/deck-analysis', () => ({
  classifyCandidate: () => 'neutral',
  // Land-count advice memo — empty roles ⇒ no advice, keeps the hero quiet.
  analyzeDeck: () => ({ roles: [] }),
}));
vi.mock('@/lib/coach/intelligent-cuts', () => ({
  rankReplacementCuts: () => [],
}));
vi.mock('@/lib/coach/card-fit', () => ({
  computeAddFit: () => null,
}));
vi.mock('../deck-builder/services/winConditions/types', () => ({}));
vi.mock('@/lib/deck/commanders', () => ({ isValidCommander: () => true }));
vi.mock('@/deck-builder/lib/partnerUtils', () => ({
  areValidPartners: () => false,
  canHavePartner: () => false,
}));
vi.mock('@/lib/coach/deck-change', () => ({
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

// E412: records the deck list each cross-deck scan receives.
const crossDeckScans: number[] = [];
vi.mock('@/lib/coach/cross-deck-moves', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/coach/cross-deck-moves')>()),
  findCrossDeckMoves: (decks: unknown[]) => {
    crossDeckScans.push(decks.length);
    return [];
  },
}));

import { DeckEditorPage } from './DeckEditorPage';

function renderEditor({ justGenerated = false }: { justGenerated?: boolean } = {}) {
  // The one-shot Build Report only shows when arriving FROM generation —
  // The build flow navigates with { state: { justGenerated: true } }.
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

/** Render at a viewport width: the header picks its action tier with
 *  matchMedia (min-/max-width queries), so answer those against `px`. */
function atWidth(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (!min || px >= Number(min[1])) && (!max || px <= Number(max[1]));
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  });
}

let mockSyncState: 'idle' | 'syncing' | 'ready' = 'idle';
vi.mock('@/lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sync')>()),
  getSyncState: () => mockSyncState,
  onSyncedChange: () => () => {},
}));

describe('DeckEditorPage — the hero meta owns the out-zone jump (2026-09-20)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    mockDeck.sideboard = [];
  });

  it('makes the "+N sideboard" count the link into the out-zone', () => {
    mockDeck.sideboard = [{ card: { id: 's1', name: 'Sideboard Card' } }] as never;
    const { container } = renderEditor();
    const link = container.querySelector('.deck-hero-outzone-link');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('#deck-outzone');
    expect(link!.textContent).toContain('sideboard');
  });

  it('adds no link when there is nothing outside the deck', () => {
    const { container } = renderEditor();
    expect(container.querySelector('.deck-hero-outzone-link')).toBeNull();
  });
});

// E465: the format can change after a deck is made. Its door is the format in
// the meta line, the way sharing opens from its own status.
describe('DeckEditorPage — the format in the hero meta', () => {
  afterEach(() => {
    mockDeck.format = 'commander';
  });

  it('is a link that opens the format sheet', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Format: Commander. Change format' }));
    expect(screen.getByRole('dialog', { name: 'Format' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Commander/ })).toHaveProperty('checked', true);
  });

  it('shows a bracket only while the format has a commander', () => {
    // effectiveBracket is stubbed to 3: a switched deck can still carry one.
    const { container, unmount } = renderEditor();
    expect(container.querySelector('.deck-hero-bracket')).not.toBeNull();
    unmount();
    mockDeck.format = 'modern';
    const modern = renderEditor();
    expect(modern.container.querySelector('.deck-hero-bracket')).toBeNull();
  });
});

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

  it('keeps Playtest in the phone ⋮ menu where there is no inline Playtest button', () => {
    atWidth(390);
    renderEditor();
    fireEvent.click(screen.getByLabelText('Deck actions'));

    expect(screen.getByRole('menuitem', { name: 'Playtest' })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  // T157 — a single-item delete is undoable from the toast, so it no longer
  // confirms first (deleteDeck itself shows the Undo toast — see
  // decks-store.test.ts for that store-level contract).
  it('calls deleteDeck directly when Delete is activated, with no confirm dialog', () => {
    renderEditor();
    const [trigger] = screen.getAllByLabelText('Deck actions');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(mockDeleteDeck).toHaveBeenCalledWith('deck-1');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/This can't be undone/)).toBeNull();
  });
});

describe('DeckEditorPage — the Deck menu holds the deck, the toolbar the list (E181)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  // Export and Test hand act on the whole deck, so they are the header Deck
  // menu's at every width, and the toolbar is told to leave them out.
  it.each([390, 768, 1280])('puts Export and Test hand in the Deck menu at %ipx', (px) => {
    atWidth(px);
    renderEditor();
    fireEvent.click(screen.getByLabelText('Deck actions'));

    expect(screen.getByRole('menuitem', { name: 'Export' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Test hand' })).toBeTruthy();
    expect(screen.getByTestId('deck-display').dataset.deckActionsInHeader).toBe('true');
    vi.unstubAllGlobals();
  });

  // The edits to the card list are the toolbar's Edit menu, never this one.
  it('keeps list edits out of the Deck menu and hands them to the toolbar', () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('Deck actions'));
    for (const name of ['Paste cards', 'Bulk edit', 'Resync from a list']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
    const edits = screen.getAllByTestId('edit-action').map((b) => b.textContent);
    expect(edits.slice(0, 3)).toEqual(['Paste cards', 'Bulk edit', 'Resync from a list']);
  });

  // Regenerate lived only in the decks index's tile menu, not here where the
  // player reads the deck and its build report.
  it('offers Regenerate on a generated deck, and only there', () => {
    renderEditor();
    const [trigger] = screen.getAllByLabelText('Deck actions');
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Regenerate' })).toBeTruthy();
  });

  it('leaves Regenerate out for a hand-built deck', () => {
    const original = mockDeck.source;
    (mockDeck as { source: string }).source = 'manual';
    try {
      renderEditor();
      const [trigger] = screen.getAllByLabelText('Deck actions');
      fireEvent.click(trigger);
      expect(screen.queryByRole('menuitem', { name: 'Regenerate' })).toBeNull();
    } finally {
      (mockDeck as { source: string }).source = original;
    }
  });

  it('sections the menu into labelled clusters instead of one flat list', () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('Deck actions'));

    const section = (label: string) =>
      screen.getByText(label).closest('.deck-editor-overflow-section')?.textContent ?? '';
    expect(section('Play')).toContain('Test hand');
    expect(section('Share')).toContain('Export');
    expect(section('Share')).toContain('Primer');
    expect(section('Share')).toContain('Get feedback');
    expect(section('This deck')).toContain('Duplicate');
  });

  describe('printing actions', () => {
    const deckActionsText = () =>
      screen
        .getAllByTestId('edit-action')
        .map((b) => b.textContent)
        .join(' | ');
    const bindAtraxa = (scryfallId: string) => {
      (mockDeck as { commanderAllocatedCopyId: string | null }).commanderAllocatedCopyId = 'cp1';
      mockCollectionById = new Map([['cp1', { copyId: 'cp1', name: 'Atraxa', scryfallId }]]);
    };
    afterEach(() => {
      mockDeck.commanderAllocatedCopyId = null;
      mockCollectionById = new Map();
    });

    it('offers cheapest printings while a card has no owned copy', () => {
      renderEditor();
      const text = deckActionsText();
      expect(text).toContain('Cheapest printings for missing');
      expect(text).not.toContain('Match my copies');
    });

    it('offers Match my copies when a bound copy is another printing', () => {
      bindAtraxa('other-printing');
      renderEditor();
      const text = deckActionsText();
      expect(text).toContain('Match my copies');
      expect(text).not.toContain('Cheapest printings for missing');
    });

    const clickRow = async (name: string) => {
      fireEvent.click(screen.getByRole('button', { name }));
      await vi.waitFor(() => expect(mockPushToast).toHaveBeenCalled());
      return mockPushToast.mock.calls[0][0] as {
        message: string;
        tone: string;
        actionLabel?: string;
      };
    };

    it('toasts what the cheapest pass changed, with Undo', async () => {
      mockPushToast.mockClear();
      mockApplyCheapest.mockResolvedValue({ changed: 2, saved: 3.5, unresolved: 0 });
      renderEditor();
      const toast = await clickRow('Cheapest printings for missing');
      expect(mockApplyCheapest).toHaveBeenCalledWith('deck-1', expect.any(String));
      expect(toast.message).toMatch(/^Switched 2 printings\. Missing cards cost .3\.50 less$/);
      expect(toast).toMatchObject({ tone: 'success', actionLabel: 'Undo' });
    });

    it('says so plainly when no missing card has a cheaper printing', async () => {
      mockPushToast.mockClear();
      mockApplyCheapest.mockResolvedValue({ changed: 0, saved: 0, unresolved: 0 });
      renderEditor();
      const toast = await clickRow('Cheapest printings for missing');
      expect(toast).toMatchObject({
        message: 'No cheaper printings for your missing cards',
        tone: 'info',
      });
    });

    it('reports a failed lookup as an error, not as nothing to change', async () => {
      mockPushToast.mockClear();
      mockApplyCheapest.mockResolvedValue({ changed: 0, saved: 0, unresolved: 3 });
      renderEditor();
      expect(await clickRow('Cheapest printings for missing')).toMatchObject({
        message: "Couldn't look up cheaper printings.",
        tone: 'error',
      });
    });

    it('names being offline when the lookup cannot run', async () => {
      const { PrintingLookupOfflineError } = await import('@/lib/deck/deck-printing-actions');
      mockPushToast.mockClear();
      mockApplyCheapest.mockRejectedValue(new PrintingLookupOfflineError());
      renderEditor();
      expect(await clickRow('Cheapest printings for missing')).toMatchObject({
        message: "You're offline. Reconnect to look up printings.",
        tone: 'error',
      });
    });

    it('toasts the matched count with Undo, and an error when none resolved', async () => {
      bindAtraxa('other-printing');
      mockPushToast.mockClear();
      mockApplyMatch.mockResolvedValueOnce({ changed: 1, unresolved: 0 });
      renderEditor();
      expect(await clickRow('Match my copies')).toMatchObject({
        message: 'Matched 1 card to your copies',
        tone: 'success',
        actionLabel: 'Undo',
      });

      mockPushToast.mockClear();
      mockApplyMatch.mockRejectedValueOnce(new Error('network'));
      fireEvent.click(screen.getByRole('button', { name: 'Match my copies' }));
      await vi.waitFor(() => expect(mockPushToast).toHaveBeenCalled());
      expect(mockPushToast.mock.calls[0][0]).toMatchObject({
        message: "Couldn't look up your copies' printings.",
        tone: 'error',
      });
    });

    it('shows neither when every card is its bound copy', () => {
      bindAtraxa('c1');
      renderEditor();
      const text = deckActionsText();
      expect(text).not.toContain('Match my copies');
      expect(text).not.toContain('Cheapest printings for missing');
    });
  });

  it('every menu row clears the 44px coarse-pointer floor, not just Bulk edit', () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText('Deck actions'));

    const rows = screen.getAllByRole('menuitem');
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.className).toContain('deck-editor-overflow-item');
    }
    // No row opts out of the shared class via the old touch-only variant.
    expect(document.querySelector('.deck-editor-overflow-item-touch')).toBeNull();
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

describe('DeckEditorPage — header actions by tier (STYLE_GUIDE § Layout system)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCanUndo = true;
    mockCanRedo = true;
    mockUndoLabel = 'remove Sol Ring';
    mockRedoLabel = 'add Sol Ring';
  });
  afterEach(() => {
    localStorage.clear();
    mockCanUndo = false;
    mockCanRedo = false;
    mockUndoLabel = null;
    mockRedoLabel = null;
    vi.unstubAllGlobals();
  });

  const inlineLabels = () =>
    Array.from(
      document.querySelectorAll('.deck-editor-actions button, .deck-editor-actions a')
    ).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
  const menuLabels = () => {
    fireEvent.click(screen.getByLabelText('Deck actions'));
    return screen.getAllByRole('menuitem').map((r) => r.textContent);
  };

  it('keeps the header actions and the ⋮ in the header, after the title', () => {
    renderEditor();
    const hero = document.querySelector('header.deck-editor-hero')!;
    expect(hero.querySelector('h1 .deck-editor-name')).toBeTruthy();
    expect(hero.querySelector('.deck-editor-actions [aria-label="Deck actions"]')).toBeTruthy();
    expect(screen.getAllByLabelText('Deck actions')).toHaveLength(1);
  });

  it('shows Add cards (the one primary) and the ⋮ on a phone', () => {
    atWidth(390);
    renderEditor();
    expect(inlineLabels()).toEqual(['Add cards', 'Deck actions']);
    expect(document.querySelector('.deck-editor-actions .btn-primary')?.textContent).toContain(
      'Add cards'
    );
    // Undo/redo lead the menu, above its first labelled section.
    const items = menuLabels();
    expect(items.slice(0, 2)).toEqual(['Undo remove Sol Ring', 'Redo add Sol Ring']);
    expect(items).toContain('Playtest');
  });

  it('adds Playtest beside Add cards on a tablet, and takes it out of the ⋮', () => {
    atWidth(768);
    renderEditor();
    expect(inlineLabels()).toEqual(['Playtest', 'Add cards', 'Deck actions']);
    const items = menuLabels();
    expect(items).not.toContain('Playtest');
    expect(items[0]).toBe('Undo remove Sol Ring');
  });

  it('adds undo/redo on a desktop, and the ⋮ holds neither', () => {
    atWidth(1280);
    renderEditor();
    expect(inlineLabels()).toEqual([
      'Undo remove Sol Ring',
      'Redo add Sol Ring',
      'Playtest',
      'Add cards',
      'Deck actions',
    ]);
    const items = menuLabels();
    expect(items.some((t) => t?.startsWith('Undo') || t?.startsWith('Redo'))).toBe(false);
    expect(items).not.toContain('Playtest');
  });

  // A phone's meta line is one line of facts. Sharing ended it before, and in
  // a 358px line it wrapped the meta onto extra 44px touch rows, so on a
  // phone it is a header action beside Add cards instead.
  it.each([
    [390, '.deck-editor-actions', 'button'],
    [768, '.binder-hero-meta', 'meta'],
    [1280, '.binder-hero-meta', 'meta'],
  ])('at %ipx puts sharing in %s', (px, where, variant) => {
    atWidth(px);
    renderEditor();
    const chips = screen.getAllByTestId('visibility-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].closest(where)).toBeTruthy();
    expect(chips[0].dataset.variant).toBe(variant);
  });

  it('omits undo/redo from the ⋮ when there is nothing to undo or redo', () => {
    mockCanUndo = false;
    mockCanRedo = false;
    atWidth(390);
    renderEditor();
    fireEvent.click(screen.getByLabelText('Deck actions'));
    expect(screen.queryByRole('menuitem', { name: /^Undo/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Redo/ })).toBeNull();
  });
});

// E412: the cross-deck scan classifies every card of every deck and was the
// largest piece of the deck page's first long task, in front of the hero
// art (the LCP element). Its rows live in the Coach feed, off screen at first
// paint, so the first render scans no decks and a deferred render scans all.
describe('DeckEditorPage — the cross-deck scan waits for a deferred render (E412)', () => {
  afterEach(() => {
    mockDecks = [mockDeck];
    crossDeckScans.length = 0;
  });

  it('scans nothing on the first render, then every deck', () => {
    mockDecks = [mockDeck, { ...mockDeck, id: 'deck-2', name: 'Second Deck' }];
    crossDeckScans.length = 0;
    renderEditor();

    expect(crossDeckScans[0]).toBe(0);
    expect(crossDeckScans.at(-1)).toBe(2);
  });
});

describe('DeckEditorPage — cold-load hydration gate (B6-01)', () => {
  afterEach(() => {
    mockDecks = [mockDeck];
    mockHydrated = true;
  });

  it('shows a loading state, not "no longer exists", while the decks store has not hydrated yet', () => {
    mockDecks = [];
    mockHydrated = false;
    renderEditor();

    expect(screen.getByText('Loading deck…')).toBeTruthy();
    expect(screen.queryByText('That deck no longer exists.')).toBeNull();
  });

  it('keeps the loading state while the first server pull is still in flight on a fresh device', () => {
    mockDecks = [];
    mockHydrated = true;
    mockSyncState = 'syncing';
    renderEditor();

    expect(screen.getByText('Loading deck…')).toBeTruthy();
    expect(screen.queryByText('That deck no longer exists.')).toBeNull();
    mockSyncState = 'idle';
  });

  it('shows "no longer exists" once hydrated and the deck is genuinely absent', () => {
    mockDecks = [];
    mockHydrated = true;
    renderEditor();

    expect(screen.getByText('That deck no longer exists.')).toBeTruthy();
    expect(screen.queryByText('Loading deck…')).toBeNull();
  });
});

describe('DeckEditorPage — the zone toggle reaches the search panel', () => {
  beforeEach(() => {
    mockDecks = [mockDeck];
    mockHydrated = true;
    searchPanelProps.length = 0;
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  const latestProps = () => searchPanelProps[searchPanelProps.length - 1];

  it('reports the mainboard while the zone toggle sits on Mainboard', () => {
    renderEditor();
    fireEvent.click(screen.getAllByRole('button', { name: /Add cards/ })[0]);

    expect(latestProps().addZone).toBe('main');
  });

  it('reports the out-of-deck zone once the toggle moves — that is what lifts the mainboard-only filters', () => {
    renderEditor();
    fireEvent.click(screen.getAllByRole('button', { name: /Add cards/ })[0]);
    fireEvent.click(screen.getAllByRole('radio', { name: 'Considering' })[0]);

    expect(latestProps().addZone).toBe('considering');
  });
});

describe('DeckEditorPage — rename (STYLE_GUIDE § Verbs — Rename)', () => {
  afterEach(() => {
    mockRenameDeck.mockClear();
  });

  it('renames in place: the title stays a heading, Enter saves', async () => {
    renderEditor();
    const hero = document.querySelector('header.deck-editor-hero')!;
    expect(hero.querySelector('h1.deck-editor-title')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Test Deck' }));
    const input = screen.getByLabelText('Deck name');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockRenameDeck).toHaveBeenCalledWith('deck-1', 'New name');
  });

  it('Escape reverts without renaming, and the title is still a heading', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Test Deck' }));
    const input = screen.getByLabelText('Deck name');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(mockRenameDeck).not.toHaveBeenCalled();
    const hero = document.querySelector('header.deck-editor-hero')!;
    expect(hero.querySelector('h1.deck-editor-title')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename Test Deck' }).textContent).toContain(
      'Test Deck'
    );
  });

  it('the color picker stays open beside the name and Done commits both', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Test Deck' }));
    expect(screen.getByLabelText('Deck color')).toBeTruthy();

    const input = screen.getByLabelText('Deck name');
    fireEvent.change(input, { target: { value: 'Renamed via Done' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(mockRenameDeck).toHaveBeenCalledWith('deck-1', 'Renamed via Done');
  });
});
