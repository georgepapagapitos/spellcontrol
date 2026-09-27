// @vitest-environment happy-dom
/**
 * E465: a commander deck can start without a commander, and the editor is
 * where it gets one.
 *
 * The live dead end this replaces: a commander-format deck with no commander
 * showed "Choose a commander", which opened a "Pick a commander first"
 * interstitial whose button only switched to the Deck view, which showed the
 * same "Choose a commander" again. Every door now opens the commander picker,
 * and Add cards opens the real add sheet.
 *
 * Same stubbing approach as DeckEditorPage.delete.test.tsx: the page has very
 * heavy store + network dependencies, so everything non-essential is stubbed
 * and the wiring is asserted through the props the page hands its children.
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/edhrec-combo-overlay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/edhrec-combo-overlay')>()),
  useEdhrecComboOverlay: () => ({}),
}));

// ── The deck ────────────────────────────────────────────────────────────────
function sf(name: string, colors: string[], typeLine = 'Instant') {
  return { id: `sf-${name}`, name, color_identity: colors, type_line: typeLine, legalities: {} };
}
const KRENKO = sf('Krenko, Tin Street Kingpin', ['R'], 'Legendary Creature — Goblin Warrior');
const BOLT = sf('Lightning Bolt', ['R']);
const SWORDS = sf('Swords to Plowshares', ['W']);

type MockDeck = {
  id: string;
  name: string;
  source: string;
  format: string;
  commander: ReturnType<typeof sf> | null;
  partnerCommander: null;
  commanderAllocatedCopyId: string | null;
  partnerCommanderAllocatedCopyId: null;
  cards: { slotId: string; card: ReturnType<typeof sf>; allocatedCopyId: string | null }[];
  sideboard: never[];
  generationContext: null;
  createdAt: number;
  updatedAt: number;
};
let mockDeck: MockDeck;
function freshDeck(cards: MockDeck['cards']): MockDeck {
  return {
    id: 'deck-1',
    name: 'Untitled deck',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards,
    sideboard: [],
    generationContext: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// chooseCommander stands in for the store's one-write action, so the page's
// follow-up read (the toast's off-color count) sees the post-pick deck.
const mockChooseCommander = vi.fn(
  (
    _deckId: string,
    card: ReturnType<typeof sf>,
    allocated: string | null,
    opts?: { fromSlotId?: string | null }
  ) => {
    mockDeck = {
      ...mockDeck,
      commander: card,
      commanderAllocatedCopyId: allocated,
      cards: mockDeck.cards.filter((c) => c.slotId !== opts?.fromSlotId),
    };
  }
);
const mockSetCommander = vi.fn();
const storeState = () => ({
  decks: [mockDeck],
  hydrated: true,
  deleteDeck: vi.fn(),
  updateDeck: vi.fn(),
  renameDeck: vi.fn(),
  addCard: vi.fn(),
  removeCard: vi.fn(),
  addSideboardCard: vi.fn(),
  removeSideboardCard: vi.fn(),
  setCommander: mockSetCommander,
  chooseCommander: mockChooseCommander,
  setPartnerCommander: vi.fn(),
  duplicateDeck: vi.fn(() => 'dup-id'),
  setCardAllocation: vi.fn(),
  updateCardPrinting: vi.fn(),
  swapCard: vi.fn(),
  replaceDeck: vi.fn(),
  createDeck: vi.fn(() => 'new-id'),
});
vi.mock('../store/decks', () => ({
  useDecksStore: Object.assign(
    (sel: (s: ReturnType<typeof storeState>) => unknown) => sel(storeState()),
    { getState: () => storeState() }
  ),
  commanderShortName: (c: { name: string }) => c.name.split(',')[0].trim(),
  effectiveBracket: () => undefined,
  newDeckCard: vi.fn(),
}));

// recordEdit runs the mutation and remembers its label, so a test can assert
// the pick was ONE undoable edit.
const recorded: string[] = [];
const mockUndo = vi.fn();
vi.mock('../store/deck-history', () => {
  const state = {
    record: (_id: string, label: string, fn: () => void) => {
      recorded.push(label);
      fn();
    },
    begin: vi.fn(),
    commit: vi.fn(),
    undo: (id: string) => mockUndo(id),
    redo: vi.fn(),
    canUndo: () => false,
    canRedo: () => false,
    undoLabel: () => null,
    redoLabel: () => null,
  };
  return {
    useDeckHistoryStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
      getState: () => state,
    }),
  };
});

vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: []; binders: []; importHistory: [] }) => unknown) =>
    sel({ cards: [], binders: [], importHistory: [] }),
}));

type Toast = { message: string; actionLabel?: string; onAction?: () => void };
const toasts: Toast[] = [];
vi.mock('../store/toasts', () => ({
  useToastsStore: (sel: (s: { push: (t: Toast) => void }) => unknown) =>
    sel({ push: (t: Toast) => toasts.push(t) }),
}));

// ── Children, reduced to the doors they expose ─────────────────────────────
type DisplayProps = {
  onAddCards?: () => void;
  onChooseCommander?: () => void;
  onChangeCommander?: () => void;
  coachFeedSlot?: ReactNode;
};
vi.mock('../components/deck/DeckDisplay', () => ({
  DeckDisplay: (p: DisplayProps) => (
    <div data-testid="deck-display">
      {p.onChooseCommander && (
        <button type="button" onClick={p.onChooseCommander}>
          Open slot choose
        </button>
      )}
      {p.onChangeCommander && (
        <button type="button" onClick={p.onChangeCommander}>
          Change commander
        </button>
      )}
      <button type="button" onClick={p.onAddCards}>
        Empty state add cards
      </button>
      <div data-testid="coach-slot">{p.coachFeedSlot}</div>
    </div>
  ),
}));
type PickerProps = {
  deckCards: ReturnType<typeof sf>[];
  exclude?: string[];
  onPick: (c: ReturnType<typeof sf>) => void;
};
const pickerProps: PickerProps[] = [];
vi.mock('../components/deck/CommanderPickerSheet', () => ({
  CommanderPickerSheet: (p: PickerProps) => {
    pickerProps.push(p);
    return (
      <div data-testid="commander-picker">
        <button type="button" onClick={() => p.onPick(KRENKO)}>
          Pick Krenko
        </button>
        <button type="button" onClick={() => p.onPick(sf('Krenko, Mob Boss', ['R']))}>
          Pick Mob Boss
        </button>
      </div>
    );
  },
}));
const searchPanelProps: Record<string, unknown>[] = [];
vi.mock('../components/deck/CardSearchPanel', () => ({
  CardSearchPanel: (props: Record<string, unknown>) => {
    searchPanelProps.push(props);
    return <div data-testid="card-search-panel" />;
  },
}));
vi.mock('../components/deck/CoachFeed', () => ({
  CoachFeed: () => <div data-testid="coach-feed" />,
}));
vi.mock('../components/deck/DeckVisibilityChip', () => ({ DeckVisibilityChip: () => null }));
vi.mock('../components/deck/DeckPublishNudge', () => ({ DeckPublishNudge: () => null }));
vi.mock('../components/deck/DeckCombosPanel', () => ({ DeckCombosPanel: () => <div /> }));
vi.mock('../components/deck/DeckAnalysisPanel', () => ({ DeckAnalysisPanel: () => <div /> }));
vi.mock('../components/deck/DeckTestHandPanel', () => ({ DeckTestHandPanel: () => <div /> }));
vi.mock('../components/deck/NextBestMove', () => ({ NextBestMove: () => <div /> }));
vi.mock('../components/deck/DeckTokensSheet', () => ({ DeckTokensSheet: () => <div /> }));
vi.mock('../components/deck/use-deck-tokens', () => ({ useDeckTokens: () => [] }));
vi.mock('../components/deck/PowerHero', () => ({ PowerHero: () => <div /> }));
vi.mock('../components/deck/DeckSizePrompt', () => ({ DeckSizePrompt: () => <div /> }));
vi.mock('../components/deck/EnginePanel', () => ({ EnginePanel: () => <div /> }));
vi.mock('../components/deck/WinConditionPanel', () => ({ WinConditionPanel: () => <div /> }));
vi.mock('../components/deck/CardFitPanel', () => ({ CardFitPanel: () => <div /> }));
vi.mock('../components/deck/SwapThisCard', () => ({ SwapThisCard: () => <div /> }));
vi.mock('../components/deck/SimilarCardsStrip', () => ({ SimilarCardsStrip: () => <div /> }));
vi.mock('../components/deck/MoveToDeckSheet', () => ({ MoveToDeckSheet: () => <div /> }));
vi.mock('../components/deck/BuildReportSheet', () => ({ BuildReportSheet: () => null }));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => <div />,
}));
vi.mock('../lib/materialize', () => ({ materializeBinders: () => ({ binders: [] }) }));
vi.mock('../lib/use-deck-combos', () => ({ useDeckCombos: () => ({ combos: [] }) }));
vi.mock('../lib/use-commander-bracket-analysis', () => ({
  useCommanderBracketAnalysis: () => ({ status: 'ready', retry: () => {} }),
}));
vi.mock('../lib/use-undo-redo-keyboard', () => ({ useUndoRedoKeyboard: () => {} }));
vi.mock('../lib/allocations', () => ({
  buildAllocationMap: () => new Map(),
  pickCollectionCopy: () => null,
  bindableFinishesByPrinting: () => new Map(),
  findStealableCopy: () => null,
  useCollectionByCopyId: () => new Map(),
}));
vi.mock('../deck-builder/services/deckBuilder/substituteFinder', () => ({
  buildSubstitutionPlan: () => [],
  buildSubstitutionOptions: () => ({ rows: [] }),
}));
vi.mock('../deck-builder/services/deckBuilder/nextBestMove', () => ({
  buildNextBestMoves: () => [],
}));
vi.mock('../deck-builder/services/deckBuilder/commanderDeckAnalysis', () => ({
  computeRoleCounts: () => ({}),
}));
vi.mock('../deck-builder/services/tagger/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../deck-builder/services/tagger/client')>()),
  loadTaggerData: () => Promise.resolve(null),
  hasTaggerData: () => false,
}));
vi.mock('../deck-builder/services/deckBuilder/costAnalyzer', () => ({
  filterCostPlanByOwnership: () => [],
}));
vi.mock('@/lib/deck-change', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deck-change')>()),
  fromGapCard: () => null,
  sortOwnedFirst: () => [],
}));
vi.mock('../lib/deck-analysis', () => ({
  classifyCandidate: () => 'neutral',
  analyzeDeck: () => ({ roles: [] }),
}));
vi.mock('../lib/intelligent-cuts', () => ({ rankReplacementCuts: () => [] }));
vi.mock('../lib/card-fit', () => ({ computeAddFit: () => null }));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardPrice: () => null,
  getCardByName: () => Promise.resolve(null),
  getOwnedPrinting: () => Promise.resolve(null),
  searchCards: () => Promise.resolve({ data: [] }),
}));
vi.mock('../lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/sync')>()),
  getSyncState: () => 'idle',
  onSyncedChange: () => () => {},
}));

import { DeckEditorPage } from './DeckEditorPage';

function renderEditor(path = '/decks/deck-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/decks/:id" element={<DeckEditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  recorded.length = 0;
  toasts.length = 0;
  pickerProps.length = 0;
  searchPanelProps.length = 0;
  mockChooseCommander.mockClear();
  mockUndo.mockClear();
  mockDeck = freshDeck([
    { slotId: 'slot-k', card: KRENKO, allocatedCopyId: 'copy-k' },
    { slotId: 'slot-b', card: BOLT, allocatedCopyId: null },
    { slotId: 'slot-s', card: SWORDS, allocatedCopyId: null },
  ]);
});
afterEach(() => localStorage.clear());

const latestSearchProps = () => searchPanelProps[searchPanelProps.length - 1];

describe('DeckEditorPage — every door to the commander opens the picker (E465)', () => {
  it('the open slot opens the picker', () => {
    renderEditor();
    expect(screen.queryByTestId('commander-picker')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open slot choose' }));
    expect(screen.getByTestId('commander-picker')).toBeTruthy();
    // The picker lists what's already in the deck, so an in-deck legend is
    // one tap away.
    expect(pickerProps.at(-1)?.deckCards.map((c) => c.name)).toContain(KRENKO.name);
  });

  it('the Coach tab says what Coach needs instead of "looks tuned", and its button opens the picker', () => {
    renderEditor('/decks/deck-1?view=tune');
    const coach = screen.getByTestId('coach-slot');
    expect(coach.textContent).toContain('Choose a commander and Coach reads the deck against it.');
    expect(screen.queryByTestId('coach-feed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a commander' }));
    expect(screen.getByTestId('commander-picker')).toBeTruthy();
  });

  it('Coach mounts its feed once there is a commander', () => {
    mockDeck = { ...mockDeck, commander: KRENKO };
    renderEditor('/decks/deck-1?view=tune');
    expect(screen.getByTestId('coach-feed')).toBeTruthy();
    expect(screen.getByTestId('coach-slot').textContent).not.toContain('Choose a commander');
  });
});

describe('DeckEditorPage — adding before a commander is allowed (E465)', () => {
  it.each([
    ['the empty state', 'Empty state add cards'],
    ['the header', 'Add cards'],
  ])('Add cards from %s opens the real add sheet, not an interstitial', (_door, name) => {
    renderEditor();
    fireEvent.click(screen.getAllByRole('button', { name })[0]);
    expect(screen.getByTestId('card-search-panel')).toBeTruthy();
    expect(screen.queryByText('Pick a commander first')).toBeNull();
    const props = latestSearchProps();
    expect(props.noCommanderYet).toBe(true);
    expect(props.enableSuggestions).toBe(false);
    expect(props.legalityKey).toBe('commander');
  });

  it('the / shortcut opens the real add sheet too', () => {
    renderEditor();
    fireEvent.keyDown(document, { key: '/' });
    expect(screen.getByTestId('card-search-panel')).toBeTruthy();
  });

  it('turns suggestions on and the no-commander rules off once a commander exists', () => {
    mockDeck = { ...mockDeck, commander: KRENKO };
    renderEditor();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add cards' })[0]);
    const props = latestSearchProps();
    expect(props.noCommanderYet).toBe(false);
    expect(props.enableSuggestions).toBe(true);
  });
});

describe('DeckEditorPage — picking the commander (E465)', () => {
  it('moves an in-deck card into the command zone with its copy claim, as one undoable edit', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Open slot choose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick Krenko' }));

    expect(mockChooseCommander).toHaveBeenCalledTimes(1);
    expect(mockChooseCommander).toHaveBeenCalledWith('deck-1', KRENKO, 'copy-k', {
      fromSlotId: 'slot-k',
    });
    expect(recorded).toEqual([`make ${KRENKO.name} commander`]);
    // Nothing else wrote: the old remove + set pair is gone.
    expect(mockSetCommander).not.toHaveBeenCalled();
    expect(screen.queryByTestId('commander-picker')).toBeNull();

    const toast = toasts.at(-1)!;
    expect(toast.message).toBe('Krenko is the commander. 1 card is off color.');
    expect(toast.actionLabel).toBe('Undo');
    toast.onAction?.();
    expect(mockUndo).toHaveBeenCalledWith('deck-1');
  });

  it('seats a card that is not in the deck without pulling any slot', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Open slot choose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick Mob Boss' }));
    expect(mockChooseCommander).toHaveBeenCalledWith(
      'deck-1',
      expect.objectContaining({ name: 'Krenko, Mob Boss' }),
      null,
      { fromSlotId: undefined }
    );
    expect(toasts.at(-1)!.message).toBe('Krenko is the commander. 1 card is off color.');
  });

  it('replacing an existing commander from the row menu asks what happens to the old one', () => {
    mockDeck = { ...mockDeck, commander: sf('Muxus, Goblin Grandee', ['R'], 'Legendary Creature') };
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Change commander' }));
    // The seated commander isn't offered back to itself.
    expect(pickerProps.at(-1)?.exclude).toEqual(['Muxus, Goblin Grandee']);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Krenko' }));
    expect(mockChooseCommander).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep in deck' }));
    expect(mockChooseCommander).toHaveBeenCalledWith('deck-1', KRENKO, 'copy-k', {
      fromSlotId: 'slot-k',
      keepPrevious: true,
    });
  });
});
