// @vitest-environment happy-dom
/**
 * Dragging a card off scryfall.com onto the deck editor adds that exact
 * printing through the same add path as the Add cards panel's +: the zone the
 * "Add cards to" toggle names, owned-copy claiming, one undoable edit, the add
 * toast, and the replace-when-full prompt on a full deck.
 *
 * Same stubbing approach as DeckEditorPage.commander-later.test.tsx: the page
 * has very heavy store + network dependencies, so everything non-essential is
 * stubbed and the wiring is asserted through the store actions it calls.
 */
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/deck-analysis/edhrec-combo-overlay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deck-analysis/edhrec-combo-overlay')>()),
  useEdhrecComboOverlay: () => ({}),
}));

// ── The deck ────────────────────────────────────────────────────────────────
function sf(name: string, colors: string[], extra: Record<string, unknown> = {}) {
  return {
    id: `sf-${name}`,
    name,
    color_identity: colors,
    type_line: 'Instant',
    legalities: {},
    ...extra,
  };
}
type Card = ReturnType<typeof sf>;
const KRENKO = sf('Krenko, Tin Street Kingpin', ['R'], {
  type_line: 'Legendary Creature — Goblin Warrior',
});
const BOLT = sf('Lightning Bolt', ['R']);
// The exact printing the drop names, a Secret Lair Sol Ring (not the cheapest).
const SOL_RING_ID = '6d5537da-112e-4ea8-9e4e-8a5ec1a8b2c4';
const SOL_RING_SLD = sf('Sol Ring', [], {
  id: SOL_RING_ID,
  set: 'sld',
  collector_number: '1011',
  type_line: 'Artifact',
});
const COUNTERSPELL = sf('Counterspell', ['U'], { id: 'sf-counterspell-7ed' });

type MockDeck = {
  id: string;
  name: string;
  source: string;
  format: string;
  commander: Card | null;
  partnerCommander: null;
  commanderAllocatedCopyId: string | null;
  partnerCommanderAllocatedCopyId: null;
  cards: { slotId: string; card: Card; allocatedCopyId: string | null }[];
  sideboard: never[];
  considering: never[];
  generationContext: null;
  createdAt: number;
  updatedAt: number;
};
let mockDeck: MockDeck;
function freshDeck(cards: MockDeck['cards']): MockDeck {
  return {
    id: 'deck-1',
    name: 'Goblins',
    source: 'manual',
    format: 'commander',
    commander: KRENKO,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards,
    sideboard: [],
    considering: [],
    generationContext: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const mockAddCard = vi.fn();
const mockAddConsideringCard = vi.fn();
const storeState = () => ({
  decks: [mockDeck],
  hydrated: true,
  deleteDeck: vi.fn(),
  updateDeck: vi.fn(),
  renameDeck: vi.fn(),
  addCard: mockAddCard,
  removeCard: vi.fn(),
  addSideboardCard: vi.fn(),
  addConsideringCard: mockAddConsideringCard,
  removeSideboardCard: vi.fn(),
  setCommander: vi.fn(),
  chooseCommander: vi.fn(),
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
  // The build-time coach nudge snapshots this before a mainboard add.
  getLocalMutationToken: () => 0,
}));

// recordEdit runs the mutation and remembers its label, so a test can assert
// the drop was ONE undoable edit.
const recorded: string[] = [];
vi.mock('../store/deck-history', () => {
  const state = {
    record: (_id: string, label: string, fn: () => void) => {
      recorded.push(label);
      fn();
    },
    begin: vi.fn(),
    commit: vi.fn(),
    undo: vi.fn(),
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

type Toast = { message: string; tone?: string };
const toasts: Toast[] = [];
vi.mock('../store/toasts', () => ({
  useToastsStore: (sel: (s: { push: (t: Toast) => void }) => unknown) =>
    sel({ push: (t: Toast) => toasts.push(t) }),
}));

// ── Children, reduced to what the drop touches ──────────────────────────────
vi.mock('../components/deck/DeckDisplay', () => ({ DeckDisplay: () => <div /> }));
vi.mock('../components/deck/CardSearchPanel', () => ({ CardSearchPanel: () => <div /> }));
type Footer = { label: string; onClick: () => void };
const sizePrompts: { title: string; footer: Footer[] }[] = [];
vi.mock('../components/deck/DeckSizePrompt', () => ({
  DeckSizePrompt: (p: { title: string; footer: Footer[] }) => {
    sizePrompts.push(p);
    return <div role="dialog" aria-label={p.title} />;
  },
}));
vi.mock('../components/deck/CoachFeed', () => ({ CoachFeed: () => <div /> }));
vi.mock('../components/deck/DeckVisibilityChip', () => ({ DeckVisibilityChip: () => null }));
vi.mock('../components/deck/DeckPublishNudge', () => ({ DeckPublishNudge: () => null }));
vi.mock('../components/deck/DeckCombosPanel', () => ({ DeckCombosPanel: () => <div /> }));
vi.mock('../components/deck/DeckAnalysisPanel', () => ({ DeckAnalysisPanel: () => <div /> }));
vi.mock('../components/deck/DeckTestHandPanel', () => ({ DeckTestHandPanel: () => <div /> }));
vi.mock('../components/deck/NextBestMove', () => ({ NextBestMove: () => <div /> }));
vi.mock('../components/deck/DeckTokensSheet', () => ({ DeckTokensSheet: () => <div /> }));
vi.mock('../components/deck/use-deck-tokens', () => ({ useDeckTokens: () => [] }));
vi.mock('../components/deck/PowerHero', () => ({ PowerHero: () => <div /> }));
vi.mock('../components/deck/EnginePanel', () => ({ EnginePanel: () => <div /> }));
vi.mock('../components/deck/WinConditionPanel', () => ({ WinConditionPanel: () => <div /> }));
vi.mock('../components/deck/CardFitPanel', () => ({ CardFitPanel: () => <div /> }));
vi.mock('../components/deck/SwapThisCard', () => ({ SwapThisCard: () => <div /> }));
vi.mock('../components/deck/SimilarCardsStrip', () => ({ SimilarCardsStrip: () => <div /> }));
vi.mock('../components/deck/MoveToDeckSheet', () => ({ MoveToDeckSheet: () => <div /> }));
vi.mock('../components/deck/BuildReportSheet', () => ({ BuildReportSheet: () => null }));
vi.mock('../components/deck/DeckAiRefine', () => ({ DeckAiRefine: () => null }));
vi.mock('../components/deck/PartnerCommanderSelector', () => ({
  PartnerCommanderSelector: () => <div />,
}));
vi.mock('@/lib/binder/materialize', () => ({ materializeBinders: () => ({ binders: [] }) }));
vi.mock('@/lib/deck-analysis/use-deck-combos', () => ({ useDeckCombos: () => ({ combos: [] }) }));
vi.mock('@/lib/deck-analysis/use-commander-bracket-analysis', () => ({
  useCommanderBracketAnalysis: () => ({ status: 'ready', retry: () => {} }),
}));
vi.mock('@/lib/deck/use-undo-redo-keyboard', () => ({ useUndoRedoKeyboard: () => {} }));
vi.mock('@/lib/binder/use-binder-layout-inputs', () => ({
  useBinderLayoutInputs: () => ({
    cards: [],
    binders: [],
    allocatedCopyIds: new Set(),
    setMap: undefined,
  }),
}));
vi.mock('@/lib/binder/use-binder-by-copy', () => ({ useBinderByCopyId: () => new Map() }));
// Owned-copy claiming: the add path must ask for a copy of the EXACT printing.
const mockPlanCardAdd = vi.fn((_name: string, _id?: string) => ({
  kind: 'bind' as const,
  copyId: 'copy-sol-sld',
}));
const mockPickCollectionCopy = vi.fn((_name: string, ..._rest: unknown[]) => ({
  copyId: 'copy-sol-sld',
}));
vi.mock('@/lib/collection/allocations', () => ({
  buildAllocationMap: () => new Map(),
  pickCollectionCopy: (name: string, ...rest: unknown[]) => mockPickCollectionCopy(name, ...rest),
  planCardAdd: (name: string, id?: string) => mockPlanCardAdd(name, id),
  bindableFinishesByPrinting: () => new Map(),
  findStealableCopy: () => null,
  listContestedCards: () => [],
  useCollectionByCopyId: () => new Map(),
  classifyAllocation: (id: string | null, byId?: Map<string, unknown>) =>
    id ? (byId?.has(id) ? 'allocated' : 'orphan') : 'unowned',
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
vi.mock('@/lib/coach/deck-change', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/coach/deck-change')>()),
  fromGapCard: () => null,
  sortOwnedFirst: () => [],
}));
vi.mock('@/lib/deck-analysis/deck-analysis', () => ({
  classifyCandidate: () => 'neutral',
  analyzeDeck: () => ({ roles: [] }),
}));
vi.mock('@/lib/coach/intelligent-cuts', () => ({ rankReplacementCuts: () => [] }));
vi.mock('@/lib/coach/card-fit', () => ({ computeAddFit: () => null }));
const lookup = vi.hoisted(() => ({
  getCardsByRefs: vi.fn(),
  getCardByName: vi.fn(),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardPrice: () => null,
  getCardByName: lookup.getCardByName,
  getCardsByRefs: lookup.getCardsByRefs,
  getOwnedPrinting: () => Promise.resolve(null),
  searchCards: () => Promise.resolve({ data: [] }),
}));
vi.mock('@/lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sync')>()),
  getSyncState: () => 'idle',
  onSyncedChange: () => () => {},
}));

import { DeckEditorPage } from './DeckEditorPage';

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={['/decks/deck-1']}>
      <Routes>
        <Route path="/decks/:id" element={<DeckEditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// ── A drag from another tab ─────────────────────────────────────────────────
const PAGE = 'https://scryfall.com/card/sld/1011/sol-ring';
const SCRYFALL_DRAG = {
  'text/uri-list': PAGE,
  'text/html': `<a href="${PAGE}"><img src="https://cards.scryfall.io/normal/front/6/d/${SOL_RING_ID}.jpg?1"></a>`,
};

function drag(type: string, data: Record<string, string>, target: EventTarget = document.body) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    value: { types: Object.keys(data), getData: (t: string) => data[t] ?? '', dropEffect: 'none' },
  });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}
async function dropOnEditor(data: Record<string, string>) {
  drag('dragenter', data);
  drag('dragover', data);
  const e = drag('drop', data);
  // Let the lookup and the add settle.
  await act(async () => {});
  return e;
}
const overlay = () => document.querySelector('.deck-link-drop');

beforeEach(() => {
  recorded.length = 0;
  toasts.length = 0;
  sizePrompts.length = 0;
  mockAddCard.mockClear();
  mockAddConsideringCard.mockClear();
  mockPlanCardAdd.mockClear();
  mockPickCollectionCopy.mockClear();
  lookup.getCardsByRefs.mockReset();
  lookup.getCardByName.mockReset();
  lookup.getCardByName.mockResolvedValue(null);
  lookup.getCardsByRefs.mockResolvedValue({ cards: [SOL_RING_SLD], error: null });
  mockDeck = freshDeck([{ slotId: 'slot-b', card: BOLT, allocatedCopyId: null }]);
});

describe('DeckEditorPage: dropping a card from Scryfall', () => {
  it('names the target zone while a link is dragged over, and clears when it leaves', () => {
    renderEditor();
    expect(overlay()).toBeNull();
    drag('dragenter', SCRYFALL_DRAG);
    expect(overlay()?.textContent).toBe('Drop to add to Mainboard');
    expect(overlay()?.getAttribute('aria-hidden')).toBe('true');
    drag('dragleave', SCRYFALL_DRAG);
    expect(overlay()).toBeNull();
  });

  it('adds the exact dropped printing to the mainboard through the normal add path', async () => {
    renderEditor();
    const drop = await dropOnEditor(SCRYFALL_DRAG);

    expect(drop.defaultPrevented).toBe(true);
    // The image's printing id wins over the page's set/number.
    expect(lookup.getCardsByRefs).toHaveBeenCalledWith([{ id: SOL_RING_ID }]);
    // Owned-copy claiming asked for this printing, and the slot stores it.
    expect(mockPlanCardAdd).toHaveBeenCalledWith('Sol Ring', SOL_RING_ID);
    expect(mockAddCard).toHaveBeenCalledTimes(1);
    expect(mockAddCard).toHaveBeenCalledWith('deck-1', SOL_RING_SLD, 'copy-sol-sld');
    expect(recorded).toEqual(['add Sol Ring']);
    expect(toasts.map((t) => t.message)).toEqual(['Added Sol Ring']);
    expect(overlay()).toBeNull();
  });

  it('says it is finding the card while the lookup runs', async () => {
    let resolve: (v: unknown) => void = () => {};
    lookup.getCardsByRefs.mockReturnValue(new Promise((r) => (resolve = r)));
    renderEditor();
    drag('dragenter', SCRYFALL_DRAG);
    drag('drop', SCRYFALL_DRAG);
    expect(overlay()?.textContent).toBe('Finding the card on Scryfall…');
    await act(async () => {
      resolve({ cards: [SOL_RING_SLD], error: null });
    });
    expect(overlay()).toBeNull();
    expect(mockAddCard).toHaveBeenCalledTimes(1);
  });

  it('lands in the zone the Add cards toggle names', async () => {
    renderEditor();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add cards' })[0]);
    fireEvent.click(screen.getByRole('radio', { name: 'Considering' }));
    drag('dragenter', SCRYFALL_DRAG);
    expect(overlay()?.textContent).toBe('Drop to add to Considering');

    drag('drop', SCRYFALL_DRAG);
    await act(async () => {});
    expect(mockAddConsideringCard).toHaveBeenCalledWith('deck-1', SOL_RING_SLD, 'copy-sol-sld');
    expect(mockAddCard).not.toHaveBeenCalled();
    expect(toasts.map((t) => t.message)).toEqual(['Added Sol Ring to considering']);
  });

  it('says a link that is not a Scryfall card is not one, and looks nothing up', async () => {
    renderEditor();
    await dropOnEditor({ 'text/uri-list': 'https://moxfield.com/decks/abc' });
    expect(lookup.getCardsByRefs).not.toHaveBeenCalled();
    expect(mockAddCard).not.toHaveBeenCalled();
    expect(toasts).toEqual([{ message: "That link isn't a Scryfall card.", tone: 'error' }]);
  });

  it('leaves the deck untouched when the lookup fails', async () => {
    lookup.getCardsByRefs.mockResolvedValue({
      cards: [],
      error: new Error("Couldn't reach Scryfall. Check your connection and try again."),
    });
    renderEditor();
    await dropOnEditor(SCRYFALL_DRAG);
    expect(mockAddCard).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
    expect(toasts).toEqual([
      {
        message: "Couldn't reach Scryfall. Check your connection and try again.",
        tone: 'error',
      },
    ]);
    expect(overlay()).toBeNull();
  });

  it('refuses a card already at its copy limit, and notes an off-color one', async () => {
    lookup.getCardsByRefs.mockResolvedValue({ cards: [BOLT, COUNTERSPELL], error: null });
    renderEditor();
    await dropOnEditor(SCRYFALL_DRAG);
    expect(mockAddCard).toHaveBeenCalledTimes(1);
    expect(mockAddCard).toHaveBeenCalledWith('deck-1', COUNTERSPELL, 'copy-sol-sld');
    expect(toasts.map((t) => t.message)).toEqual([
      'Lightning Bolt is already at its copy limit.',
      'Added Counterspell',
      "Counterspell is outside your commander's color identity.",
    ]);
  });

  it('refuses the commander itself on the mainboard, and reports cards it could not find', async () => {
    lookup.getCardsByRefs.mockResolvedValue({ cards: [KRENKO], error: new Error('x') });
    renderEditor();
    await dropOnEditor({
      'text/uri-list': `${PAGE}\nhttps://scryfall.com/card/znr/1/x`,
    });
    expect(mockAddCard).not.toHaveBeenCalled();
    expect(toasts.map((t) => t.message)).toEqual([
      'Krenko, Tin Street Kingpin is already your commander.',
      "Couldn't find 1 of the dropped cards on Scryfall.",
    ]);
  });

  it('opens the replace-when-full prompt on a full deck, and its way out keeps the printing', async () => {
    mockDeck = freshDeck(
      Array.from({ length: 99 }, (_, i) => ({
        slotId: `slot-${i}`,
        card: sf(`Filler ${i}`, ['R']),
        allocatedCopyId: null,
      }))
    );
    renderEditor();
    await dropOnEditor(SCRYFALL_DRAG);
    expect(mockAddCard).not.toHaveBeenCalled();
    const prompt = sizePrompts.at(-1)!;
    expect(prompt.title).toBe('Deck is full (99/99)');

    await act(async () => {
      prompt.footer.find((f) => f.label === 'Add anyway')!.onClick();
    });
    // Stored as the dropped printing, not re-resolved to the cheapest by name.
    expect(lookup.getCardByName).not.toHaveBeenCalledWith('Sol Ring');
    expect(mockAddCard).toHaveBeenCalledWith('deck-1', SOL_RING_SLD, 'copy-sol-sld');
  });

  it('ignores a file dragged from the desktop and a drag that starts on the page', () => {
    renderEditor();
    const file = drag('dragenter', { Files: '' });
    expect(file.defaultPrevented).toBe(false);
    expect(overlay()).toBeNull();

    drag('dragstart', SCRYFALL_DRAG);
    drag('dragenter', SCRYFALL_DRAG);
    expect(overlay()).toBeNull();
    drag('drop', SCRYFALL_DRAG);
    drag('dragend', SCRYFALL_DRAG);
    expect(lookup.getCardsByRefs).not.toHaveBeenCalled();
  });
});
