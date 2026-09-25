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
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

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
vi.mock('@/lib/edhrec-combo-overlay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/edhrec-combo-overlay')>()),
  useEdhrecComboOverlay: () => ({}),
}));

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

// Mutable so the hydration-gate tests below can simulate a not-yet-hydrated
// store / a missing deck without a second vi.mock factory; reset in that
// describe block's own beforeEach/afterEach so it can't leak into the rest of
// this file's tests, which all expect the default (hydrated, deck present).
let mockDecks: (typeof mockDeck)[] = [mockDeck];
let mockHydrated = true;

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
      renameDeck: vi.fn(),
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

vi.mock('../store/toasts', () => ({
  useToastsStore: (sel: (s: { push: () => void }) => unknown) => sel({ push: vi.fn() }),
}));

// ── Heavy component / lib stubs ─────────────────────────────────────────────
vi.mock('../components/deck/DeckDisplay', () => ({
  DeckDisplay: () => <div data-testid="deck-display" />,
}));
// The chip pulls in ShareDialog (the share sheet, friends-client,
// auth-api…) and fetches on mount via useDeckVisibility — irrelevant to these
// delete-flow tests and exactly the unmocked-network-leaf shape that causes
// the post-teardown fetch flake (see project_vitest_teardown_flake).
vi.mock('../components/deck/DeckVisibilityChip', () => ({
  DeckVisibilityChip: () => null,
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
  useCommanderBracketAnalysis: () => ({ status: 'ready', retry: () => {} }),
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

// E412: records the deck list each cross-deck scan receives.
const crossDeckScans: number[] = [];
vi.mock('@/lib/cross-deck-moves', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cross-deck-moves')>()),
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
vi.mock('../lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/sync')>()),
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
});

describe('DeckEditorPage — ⋮ menu sectioning + Export de-dup (E181)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  // Export belongs to the deck toolbar (its ⋯ on a wide row, its kebab on a
  // phone), so the header ⋮ never repeats it at any width.
  it.each([390, 768, 1280])('leaves Export out of the header ⋮ at %ipx', (px) => {
    atWidth(px);
    renderEditor();
    fireEvent.click(screen.getByLabelText('Deck actions'));

    expect(screen.queryByRole('menuitem', { name: 'Export' })).toBeNull();
    vi.unstubAllGlobals();
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

    expect(screen.getByText('Text tools')).toBeTruthy();
    expect(screen.getByText('Deck actions')).toBeTruthy();
    // Text tools clusters the paste/bulk-edit/resync trio.
    const textTools = screen.getByText('Text tools').closest('.deck-editor-overflow-section');
    expect(textTools?.textContent).toContain('Paste cards');
    expect(textTools?.textContent).toContain('Bulk edit');
    expect(textTools?.textContent).toContain('Resync from a list');
    // Deck actions clusters Duplicate/Primer/Get feedback (+ Export on mobile).
    const deckActions = screen.getByText('Deck actions').closest('.deck-editor-overflow-section');
    expect(deckActions?.textContent).toContain('Duplicate');
    expect(deckActions?.textContent).toContain('Primer');
    expect(deckActions?.textContent).toContain('Get feedback');
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
    Array.from(document.querySelectorAll('.deck-editor-actions button')).map(
      (b) => b.getAttribute('aria-label') ?? b.textContent?.trim()
    );
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
