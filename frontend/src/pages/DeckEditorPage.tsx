import { Coins, Copy, ListChecks, MoreVertical, Plus, Redo2, Undo2, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { haptics } from '../lib/haptics';
import { scryfallArtCrop } from '../lib/offline/slim-to-scryfall';
import { useCardsWithTags, bindersUseTags } from '../lib/card-tags';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
  Link,
  Navigate,
} from 'react-router-dom';
import { useDecksStore, effectiveBracket } from '../store/decks';
import { useCubeStore } from '../store/cube';
import { useDeckHistoryStore } from '../store/deck-history';
import { useCollectionStore } from '../store/collection';
import {
  DeckDisplay,
  type DeckDisplayCard,
  type AnalysisTabId,
  type DeckView,
} from '../components/deck/DeckDisplay';
import { Tabs } from '../components/Tabs';
import { materializeBinders } from '../lib/materialize';
import { formatMoney } from '../lib/format-money';
import type { BinderInfo } from '../components/BinderBadge';
import { CardSearchPanel, type CardSearchPanelHandle } from '../components/deck/CardSearchPanel';
import { DeckCombosPanel, type DeckCombosPanelHandle } from '../components/deck/DeckCombosPanel';
import { DeckAnalysisPanel } from '../components/deck/DeckAnalysisPanel';
import { DeckTestHandPanel } from '../components/deck/DeckTestHandPanel';
import { DeckTokensSheet } from '../components/deck/DeckTokensSheet';
import { PullListSheet } from '../components/deck/PullListSheet';
import { useDeckTokens } from '../components/deck/use-deck-tokens';
import { PowerHero } from '../components/deck/PowerHero';
import { TableRecordPanel } from '../components/deck/TableRecordPanel';
import { CoachFeed } from '../components/deck/CoachFeed';
import { DeckSizePrompt, type SizePromptOption } from '../components/deck/DeckSizePrompt';
import { filterCostPlanByOwnership } from '@/deck-builder/services/deckBuilder/costAnalyzer';
import { EnginePanel } from '../components/deck/EnginePanel';
import { WinConditionPanel } from '../components/deck/WinConditionPanel';
import { analyzeDeckSynergy } from '../deck-builder/services/synergy/deckSynergy';
import {
  buildSubstitutionOptions,
  type SubstituteCandidate,
} from '@/deck-builder/services/deckBuilder/substituteFinder';
import {
  buildNextBestMoves,
  type NextBestMoveFocus,
} from '@/deck-builder/services/deckBuilder/nextBestMove';
import {
  fromGapCard,
  toSwapAgainst,
  sortOwnedFirst,
  type Change,
  type LaneId,
  type ChangeOwnership,
} from '@/lib/deck-change';
import { rankReplacementCuts } from '@/lib/intelligent-cuts';
import { buildSwapAlternativeFactors, type WhyFactor } from '@/lib/why-factors';
import { computeAddFit } from '@/lib/card-fit';
import { useEdhrecComboOverlay } from '@/lib/edhrec-combo-overlay';
import { CardFitPanel } from '../components/deck/CardFitPanel';
import { SwapThisCard } from '../components/deck/SwapThisCard';
import { SimilarCardsStrip } from '../components/deck/SimilarCardsStrip';
import { classifyCandidate, analyzeDeck } from '../lib/deck-analysis';
import { useTaggerReady } from '../lib/use-tagger-ready';
import { loadTaggerData, hasTaggerData } from '@/deck-builder/services/tagger/client';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { useDeckCombos } from '../lib/use-deck-combos';
import { useCommanderBracketAnalysis } from '../lib/use-commander-bracket-analysis';
import { useEscapeKey } from '../lib/use-escape-key';
import { useUndoRedoKeyboard } from '../lib/use-undo-redo-keyboard';
import { useRegisterShortcuts } from '../lib/shortcut-registry';
import { useSheetExit } from '../lib/use-sheet-exit';
import { CardEditDialog, type PrintingSelection } from '../components/CardEditDialog';
import {
  buildAllocationMap,
  pickCollectionCopy,
  classifyPrintingAvailability,
  bindableFinishesByPrinting,
  findStealableCopy,
  planCardAdd,
  listContestedCards,
  makeDeckAllocationInfo,
  useCollectionByCopyId,
  type DonorOutcome,
  type DonorZone,
  type StealableCopy,
} from '../lib/allocations';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SharedCopiesSheet } from '../components/deck/SharedCopiesSheet';
import { DeckFeedbackSheet } from '../components/deck/DeckFeedbackSheet';
import { MovePrintingPrompt } from '../components/deck/MovePrintingPrompt';
import { MoveToDeckSheet } from '../components/deck/MoveToDeckSheet';
import { BuildReportSheet } from '../components/deck/BuildReportSheet';
import { isBuildReportSeen } from '../lib/build-report-seen';
import { BackLink } from '../components/BackLink';
import { ColorPicker } from '../components/ColorPicker';
import { Modal } from '../components/Modal';
import { isValidCommander, isPdhCommanderEligible } from '../lib/commanders';
import { areValidPartners, canHavePartner } from '@/deck-builder/lib/partnerUtils';
import { PartnerCommanderSelector } from '../components/deck/PartnerCommanderSelector';
import { useToastsStore } from '../store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { computeLandUpgrades } from '@/deck-builder/services/deckBuilder/landUpgrades';
import { useSearchCards } from '@/lib/use-search-cards';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { getCardPrice, getCardByName, searchCards } from '../deck-builder/services/scryfall/client';

// Fetch strong on-color fixing lands for the "Re-analyze lands" tool's acquire
// rows (duals the user may not own yet). The deck's identity letters are passed
// as the search hook's query string; this parses them back into a color filter.
// edhrec order surfaces the popular duals first, bounded by the hook's limit.
// Module-level (stable ref) as useSearchCards requires. Basics excluded; the
// merit engine ranks and filters what's returned.
const fetchFixingLands = (identityKey: string): Promise<ScryfallCard[]> =>
  searchCards('t:land -t:basic', identityKey.split(''), { order: 'edhrec' }).then((r) => r.data);
import type { WinConditionAnalysis } from '@/deck-builder/services/winConditions/types';

/**
 * Build a one-line win-condition summary for the PowerHero Gameplan pillar.
 * e.g. "Wins via Infinite combo · backup: Mill, Aristocrats"
 */
function buildWinConditionSummary(wc: WinConditionAnalysis | undefined): string | undefined {
  if (!wc) return undefined;
  if (wc.noClearWinCondition) return 'No clear win condition';
  if (!wc.primary) return undefined;
  const parts: string[] = [`Wins via ${wc.primary.label}`];
  if (wc.secondary.length > 0) {
    parts.push(`backup: ${wc.secondary.map((s) => s.label).join(', ')}`);
  }
  return parts.join(' · ');
}

/** Functional role key → display label (the four roles the tagger classifies). */
const ROLE_LABEL: Record<string, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipes',
  cardDraw: 'Card Advantage',
};

/** Shortcut items contributed to the registry under the "Deck editor" section. */
const DECK_EDITOR_SHORTCUTS = [
  { keys: ['/'], description: 'Open card search' },
  { keys: ['a'], description: 'Open Coach tab (suggestions)' },
  { keys: ['c'], description: 'Open Power tab with combos' },
  { keys: ['Cmd/Ctrl', 'Z'], description: 'Undo last edit' },
  { keys: ['Cmd/Ctrl', 'Shift+Z'], description: 'Redo last edit' },
];

// "Owned only" Coach toggle — persisted here (the page owns the state) so both
// the feed and the Next-best-move hero, which is built upstream, share it.
const OWNED_ONLY_KEY = 'spellcontrol-improve-owned-only';
function readOwnedOnly(): boolean {
  try {
    return window.localStorage.getItem(OWNED_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

export function DeckEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const deck = useDecksStore((s) => s.decks.find((d) => d.id === id) ?? null);
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const renameDeck = useDecksStore((s) => s.renameDeck);
  const deleteDeck = useDecksStore((s) => s.deleteDeck);
  const addCard = useDecksStore((s) => s.addCard);
  const removeCard = useDecksStore((s) => s.removeCard);
  const addSideboardCard = useDecksStore((s) => s.addSideboardCard);
  const removeSideboardCard = useDecksStore((s) => s.removeSideboardCard);
  const moveBetweenZones = useDecksStore((s) => s.moveBetweenZones);
  const setCommander = useDecksStore((s) => s.setCommander);
  const setPartnerCommander = useDecksStore((s) => s.setPartnerCommander);
  const duplicateDeck = useDecksStore((s) => s.duplicateDeck);
  const decks = useDecksStore((s) => s.decks);
  // Physical cubes claim copies too — every allocation/ownership computation here
  // folds them in so a copy in a cube reads as committed (not free for a deck).
  const savedCubes = useCubeStore((s) => s.saved);
  const rawCollectionCards = useCollectionStore((s) => s.cards);
  const binderDefs = useCollectionStore((s) => s.binders);
  // Decorate with oracle tags so the per-card binder badge respects tag rules
  // (no-op unless a binder uses one).
  const collectionCards = useCardsWithTags(rawCollectionCards, bindersUseTags(binderDefs));
  const updateCardPrinting = useDecksStore((s) => s.updateCardPrinting);
  const swapCard = useDecksStore((s) => s.swapCard);
  const setCardAllocation = useDecksStore((s) => s.setCardAllocation);
  const replaceDeck = useDecksStore((s) => s.replaceDeck);
  const pushToast = useToastsStore((s) => s.push);

  // Undo/redo history (deck-scoped). `recordEdit` brackets a synchronous block;
  // `beginEdit`/`commitEdit` bracket an async one (resolve a card, then mutate)
  // so multi-mutation actions collapse to a single undo entry. The can*/label
  // selectors re-render the toolbar as the stack changes.
  const recordEdit = useDeckHistoryStore((s) => s.record);
  const beginEdit = useDeckHistoryStore((s) => s.begin);
  const commitEdit = useDeckHistoryStore((s) => s.commit);
  const undoEdit = useDeckHistoryStore((s) => s.undo);
  const redoEdit = useDeckHistoryStore((s) => s.redo);
  const canUndoEdit = useDeckHistoryStore((s) => (id ? s.canUndo(id) : false));
  const canRedoEdit = useDeckHistoryStore((s) => (id ? s.canRedo(id) : false));
  const undoEditLabel = useDeckHistoryStore((s) => (id ? s.undoLabel(id) : null));
  const redoEditLabel = useDeckHistoryStore((s) => (id ? s.redoLabel(id) : null));

  // Keyboard undo/redo for the editor: Cmd/Ctrl+Z undo, Shift+Z or Ctrl+Y redo.
  // The hook owns the key contract and the text-field skip; we just wire the
  // history store + success toast (read the label BEFORE mutating the stack).
  const onKeyboardUndo = useCallback(() => {
    if (!id) return false;
    const h = useDeckHistoryStore.getState();
    const label = h.undoLabel(id);
    if (!h.undo(id)) return false;
    if (label) pushToast({ message: `Undone: ${label}`, tone: 'info', durationMs: 2500 });
    return true;
  }, [id, pushToast]);
  const onKeyboardRedo = useCallback(() => {
    if (!id) return false;
    const h = useDeckHistoryStore.getState();
    const label = h.redoLabel(id);
    if (!h.redo(id)) return false;
    if (label) pushToast({ message: `Redone: ${label}`, tone: 'info', durationMs: 2500 });
    return true;
  }, [id, pushToast]);
  useUndoRedoKeyboard({ enabled: !!id, onUndo: onKeyboardUndo, onRedo: onKeyboardRedo });

  // Register deck editor shortcuts in the app-wide `?` overlay (UX-334).
  // Touch points: this line + the DECK_EDITOR_SHORTCUTS constant above it (~L107).
  useRegisterShortcuts('Deck editor', DECK_EDITOR_SHORTCUTS);

  const collectionById = useCollectionByCopyId();
  const [editingSlot, setEditingSlot] = useState<{ slotId: string; card: ScryfallCard } | null>(
    null
  );
  // Pending "pull an owned-but-committed printing in from another deck/cube"
  // prompt, raised from the edit-printing picker when the chosen printing has no
  // free copy. Resolved by handleMovePrintingConfirm.
  const [movePrompt, setMovePrompt] = useState<{
    editSlotId: string;
    newCard: ScryfallCard;
    chosenSetName: string;
    donor: StealableCopy;
    swap: { returnCopyId: string; returnCard: ScryfallCard; returnSetName: string } | null;
  } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [makeCommanderTarget, setMakeCommanderTarget] = useState<{
    slotId: string;
    card: ScryfallCard;
    zone: 'main' | 'side';
    allocatedCopyId: string | null;
  } | null>(null);
  const [makePartnerTarget, setMakePartnerTarget] = useState<{
    slotId: string;
    card: ScryfallCard;
    zone: 'main' | 'side';
    allocatedCopyId: string | null;
  } | null>(null);
  const [showPartnerPicker, setShowPartnerPicker] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Coach "Owned only" filter — shared by the feed and the Next-best-move hero.
  const [ownedOnly, setOwnedOnly] = useState<boolean>(readOwnedOnly);
  const handleOwnedOnlyChange = useCallback((next: boolean) => {
    setOwnedOnly(next);
    try {
      window.localStorage.setItem(OWNED_ONLY_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, []);
  // One-shot build-report sheet: shown once immediately after deck generation.
  // Gated on BOTH the justGenerated router state (set by GuidedBuildPage's
  // post-save navigate — so pre-existing generated decks never pop it) AND the
  // localStorage seen-set (so a refresh that restores history state doesn't
  // re-show it).
  const [showBuildReport, setShowBuildReport] = useState(
    () =>
      !!(
        (location.state as { justGenerated?: boolean } | null)?.justGenerated &&
        deck?.source === 'generated' &&
        deck?.buildReport &&
        !isBuildReportSeen(deck?.id ?? '')
      )
  );
  // Hoisted so the mobile action sheet can open Export without rendering
  // a duplicate button. Passed to DeckDisplay as a controlled prop pair.
  const [exportOpen, setExportOpen] = useState(false);
  // Feedback Tool: mint/copy the suggestion link + review submitted responses.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [addZone, setAddZone] = useState<'main' | 'side'>('main');
  const searchPanelRef = useRef<CardSearchPanelHandle>(null);
  // The deck editor is a set of page-top distinct views (Deck · Stats · Power ·
  // Tune) switched by the hub tab bar below the header. `view`
  // is the active one; the feature-strip chips + keyboard shortcuts deep-link
  // into a view and scroll it into reach. Test hand is NOT a view — it's its own
  // standalone overlay (goldfishing is a distinct activity), opened on demand
  // from the Deck-view toolbar — a modal on desktop, a bottom sheet on mobile
  // (same card-picker pattern as Add cards), so it's never pinned inline.
  const viewScrollRef = useRef<HTMLDivElement>(null);
  const [showTestHand, setShowTestHand] = useState(false);
  // The active view lives in the URL (`?view=power`) so each tab switch is a real
  // history entry: hardware/gesture back walks back through the tabs you visited
  // before exiting the editor, and tabs become deep-linkable. 'deck' is the clean
  // default (no param). Mirrors PlayPage's `?tab=` pattern.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get('view') as DeckView | null) ?? 'deck';
  const setView = useCallback(
    (next: DeckView) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'deck') p.delete('view');
          else p.set('view', next);
          return p;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );
  const [addingEngineNames, setAddingEngineNames] = useState<Set<string>>(new Set());
  // Deck-size guard prompts: a pending full-deck add awaiting a replace choice,
  // and a post-cut refill nudge (the card just cut + its role).
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  // Resolved ScryfallCard for `pendingAdd`, so the replace-when-full ranker can
  // judge relatedness by card type + mana cost (not just name-based role). Tagged
  // with `forName` so a stale resolve from a previous prompt is ignored; null
  // until it resolves, and the ranker degrades to role-only relatedness meanwhile.
  const [pendingAddCard, setPendingAddCard] = useState<{
    forName: string;
    card: ScryfallCard;
  } | null>(null);
  const [refillAfterCut, setRefillAfterCut] = useState<{
    name: string;
    role: string | null;
  } | null>(null);
  // Physical-copy reallocation (move owned cards between decks). Each move is an
  // explicit, conscious action — nothing moves silently. Pulling a copy IN (the
  // Shared-copies review + per-row "Use my copy") is a direct leave-gap move with
  // an Undo toast; `moveCard` drives the MoveToDeckSheet (sending a copy out, with
  // the donor-outcome chooser); `releaseCard` drives the release confirm (freeing
  // a copy back to the collection).
  const [moveCard, setMoveCard] = useState<ScryfallCard | null>(null);
  const [releaseCard, setReleaseCard] = useState<ScryfallCard | null>(null);
  // In-context "Swap this card" — its OWN loading gate (not addingEngineNames),
  // so a swap-in-flight never cross-disables the Engine/Substitution Add buttons.
  const [swappingSlot, setSwappingSlot] = useState<string | null>(null);
  // E20 audition / what-if: a resolved card the user is "previewing the fit" of
  // (from a card-search row or a CoachFeed row) before committing. Drives the
  // CardFitPanel overlay.
  const [auditionCard, setAuditionCard] = useState<ScryfallCard | null>(null);
  // For swap-row auditions from CoachFeed: the outgoing card name to pin as the
  // first cut suggestion in CardFitPanel. Cleared when the panel closes.
  const [auditionPinnedCutName, setAuditionPinnedCutName] = useState<string | null>(null);
  // Bracket Fit swaps gate the row by the CUT card's name (the page-side swap
  // state is slot-keyed, which BracketFitLane can't see). Tracked separately so a
  // swap-in-flight disables only its own row.
  const [bracketFitSwapName, setBracketFitSwapName] = useState<string | null>(null);
  const openView = useCallback(
    (next: DeckView) => {
      setView(next);
      window.requestAnimationFrame(() => {
        viewScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [setView]
  );
  // Chip / keyboard deep-links target a specific analysis view.
  const openAnalysisTab = useCallback((tab: AnalysisTabId) => openView(tab), [openView]);

  // Resolve the pending-add card so the replace-when-full ranker can use its type
  // + CMC for relatedness. Guarded against races (a newer pendingAdd wins).
  useEffect(() => {
    if (!pendingAdd) return;
    let stale = false;
    void getCardByName(pendingAdd).then((scry) => {
      if (!stale && scry) setPendingAddCard({ forName: pendingAdd, card: scry });
    });
    return () => {
      stale = true;
    };
  }, [pendingAdd]);

  // The Combos panel lives inside the Power bento; switching to Power lands on
  // the top of the bento, not the panel. A next-best-move with focus 'combos'
  // (the "Complete a combo" suggestion) reveals + scrolls the panel and opens
  // its one-away tab. The panel only mounts once Power is active, so reveal on
  // the next frame, after the view switch has committed.
  const combosRef = useRef<DeckCombosPanelHandle>(null);
  // A hero move that deep-links into the Coach feed sets this; CoachFeed maps it
  // to a filter chip, then clears it (one-shot) via onFilterHandled.
  const [tuneFocusLane, setTuneFocusLane] = useState<LaneId | null>(null);
  const clearTuneFocus = useCallback(() => setTuneFocusLane(null), []);
  const handleNbmNavigate = useCallback(
    (next: DeckView, focus?: NextBestMoveFocus) => {
      openView(next);
      if (focus === 'combos') {
        window.requestAnimationFrame(() => combosRef.current?.reveal('oneAway'));
      } else if (focus) {
        // A Tune intent lane — hand the target to DeckDisplay to reveal + scroll.
        setTuneFocusLane(focus);
      }
    },
    [openView]
  );

  // Load tagger role data on mount (deduped) so the in-context "Swap this card"
  // section can scope alternatives to a card's role even when the preview is
  // opened from the Deck tab, where the Analysis panel isn't mounted.
  useEffect(() => {
    if (!hasTaggerData()) void loadTaggerData();
  }, []);

  // Counts already in this deck — fed to the search panel so it can mark
  // duplicates with a live "in deck × N" hint and let users add basics
  // multiple times.
  const formatConfig = deck ? DECK_FORMAT_CONFIGS[deck.format] : null;

  // Commander decks are exactly 100 (mainboard 99, or 98 with a partner — the
  // partner is the 2nd commander). Other formats have no hard upper bound here,
  // so the replace-when-full prompt only fires for commander-like formats.
  const isCommander = !!formatConfig?.hasCommander;
  const mainboardLimit =
    isCommander && formatConfig
      ? formatConfig.mainboardSize - (deck?.partnerCommander ? 1 : 0)
      : Infinity;
  const deckIsFull = !!deck && deck.cards.length >= mainboardLimit;

  const existingCardCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!deck) return m;
    for (const c of deck.cards) m.set(c.card.name, (m.get(c.card.name) ?? 0) + 1);
    for (const c of deck.sideboard) m.set(c.card.name, (m.get(c.card.name) ?? 0) + 1);
    return m;
  }, [deck]);

  // Name → the actual deck printing. Feeds Optimize's Remove column so its card
  // preview shows the printing in the deck (matching the thumbnail) instead of
  // the default printing the carousel would otherwise fetch by name.
  const deckCardsByName = useMemo(() => {
    const m = new Map<string, ScryfallCard>();
    if (!deck) return m;
    for (const c of deck.cards) if (!m.has(c.card.name)) m.set(c.card.name, c.card);
    return m;
  }, [deck]);

  // Oracle ids of every card in the deck — fed to the combos panel so it can
  // bucket combos against the deck. `oracle_id` is on ScryfallCard; cards
  // imported before that field landed may lack it (combos for those rows just
  // won't surface until the next deck-import).
  const deckOracleIds = useMemo(() => {
    if (!deck) return [];
    const ids = new Set<string>();
    if (deck.commander?.oracle_id) ids.add(deck.commander.oracle_id);
    if (deck.partnerCommander?.oracle_id) ids.add(deck.partnerCommander.oracle_id);
    for (const c of deck.cards) if (c.card.oracle_id) ids.add(c.card.oracle_id);
    for (const c of deck.sideboard) if (c.card.oracle_id) ids.add(c.card.oracle_id);
    return Array.from(ids);
  }, [deck]);

  // Tokens this deck can make — a pre-game prep checklist surfaced on demand from
  // the deck-action row (not Stats; it's prep, not analysis). The hook re-resolves
  // names to recover token data the slimmed persisted cards drop.
  const deckScryCards = useMemo(() => {
    if (!deck) return [];
    const list: ScryfallCard[] = [];
    if (deck.commander) list.push(deck.commander);
    if (deck.partnerCommander) list.push(deck.partnerCommander);
    for (const c of deck.cards) list.push(c.card);
    return list;
  }, [deck]);
  const deckTokens = useDeckTokens(deckScryCards);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [pullListOpen, setPullListOpen] = useState(false);
  const hasPullSlots =
    !!deck && (deck.cards.length > 0 || deck.sideboard.length > 0 || !!deck.commander);
  const [showSharedCopies, setShowSharedCopies] = useState(false);

  // Flat card list for EnginePanel's tappable axis drill-through — mainboard only
  // (commanders don't form a typical synergy axis row).
  const deckCards = useMemo(() => (deck ? deck.cards.map((c) => c.card) : []), [deck]);
  // Library names (one per physical copy) for WinConditionPanel's assembly clock.
  const deckLibraryNames = useMemo(() => deckCards.map((c) => c.name), [deckCards]);
  // Full axis summaries (card names + reasons) for the EnginePanel annotation layer.
  const axisSummaries = useMemo(
    () => (deck?.synergyAnalysis ? analyzeDeckSynergy(deckCards).axes : undefined),
    [deck?.synergyAnalysis, deckCards]
  );

  const ownedOracleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of collectionCards) if (c.oracleId) ids.add(c.oracleId);
    return Array.from(ids);
  }, [collectionCards]);

  // Set-form of ownedOracleIds for O(1) membership checks in combo filtering.
  const ownedOracleIdSet = useMemo(() => new Set(ownedOracleIds), [ownedOracleIds]);

  // Owned card names — lets the gap-analysis suggestions flag cards the user
  // already has in their collection.
  const ownedNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of collectionCards) names.add(c.name);
    return names;
  }, [collectionCards]);

  // Lowercased mainboard names — the CoachFeed's ground truth for hiding
  // applied suggestions (and resurfacing them when an apply is undone).
  const deckCardNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of deck?.cards ?? []) names.add(c.card.name.toLowerCase());
    return names;
  }, [deck?.cards]);

  // Allocation-aware ownership for a card name (mirrors DeckAnalysisPanel) so
  // every Tune surface agrees: 'owned' = a free/unallocated copy (or one already
  // in THIS deck) exists; 'in-other-deck' = every copy is claimed by other decks;
  // else 'unowned'. Re-derived live — never the persisted isOwned snapshot. This
  // matters because pickCollectionCopy only claims FREE copies, so a card whose
  // copies are all elsewhere can't actually be added tonight.
  const ownershipByName = useMemo(() => {
    const allocations = buildAllocationMap(decks, savedCubes);
    const byName = new Map<string, { free: number; deck: number; cube: number }>();
    for (const copy of collectionCards) {
      if (!copy.name) continue;
      const key = copy.name.toLowerCase();
      const e = byName.get(key) ?? { free: 0, deck: 0, cube: 0 };
      const claim = allocations.get(copy.copyId);
      // A copy claimed by THIS deck counts as free (we can keep it); a cube claim
      // (deckId='') never matches deck?.id, so cube copies are never "free here".
      if (!claim || claim.deckId === deck?.id) e.free += 1;
      else if (claim.ownerKind === 'cube') e.cube += 1;
      else e.deck += 1;
      byName.set(key, e);
    }
    return byName;
  }, [collectionCards, decks, savedCubes, deck?.id]);

  const ownershipFor = useCallback(
    (name: string): ChangeOwnership => {
      const e = ownershipByName.get(name.toLowerCase());
      if (!e) return 'unowned';
      if (e.free > 0) return 'owned';
      // Prefer the deck label over the cube label when copies are split — a deck
      // is the more familiar, more actionable place to pull from.
      if (e.deck > 0) return 'in-other-deck';
      if (e.cube > 0) return 'in-cube';
      return 'unowned';
    },
    [ownershipByName]
  );

  // Ownership-aware trim-cost plan (E23). Suppress cheaper-swap rows for cards the
  // user already owns and can field in this deck — you've already paid, so there's
  // no spend to trim. Only un-owned ('unowned') or all-copies-claimed-elsewhere
  // ('in-other-deck') cards keep a row. Live: re-derives from `ownershipFor` so
  // buying/selling/reallocating a copy updates the list without a re-analysis.
  const rawCostPlan = deck?.costPlan;
  const effectiveCostPlan = useMemo(
    () =>
      rawCostPlan
        ? filterCostPlanByOwnership(rawCostPlan, (name) => ownershipFor(name) === 'owned')
        : null,
    [rawCostPlan, ownershipFor]
  );

  // Free (unallocated) owned copies of a card name — drives the "N free" badge on
  // similar-card suggestions. Mirrors `ownershipFor` over the same live map.
  const freeCountFor = useCallback(
    (name: string): number => ownershipByName.get(name.toLowerCase())?.free ?? 0,
    [ownershipByName]
  );

  // Per-printing availability for the edit-printing picker: does the user own
  // this exact printing, and is a copy free to bind here? Same live sources as
  // ownershipFor, but keyed by scryfallId rather than name.
  const printingAllocationMap = useMemo(
    () => buildAllocationMap(decks, savedCubes),
    [decks, savedCubes]
  );
  const resolveAvailability = useCallback(
    (printing: ScryfallCard): ChangeOwnership =>
      classifyPrintingAvailability(printing.id, collectionCards, printingAllocationMap, deck?.id),
    [collectionCards, printingAllocationMap, deck?.id]
  );
  // Owned finishes per printing (one pass over the collection) so the picker
  // can show what you physically have — and constrain the finish choice —
  // instead of offering every finish Scryfall says exists.
  const ownedFinishesByPrinting = useMemo(
    () => bindableFinishesByPrinting(collectionCards, printingAllocationMap, deck?.id),
    [collectionCards, printingAllocationMap, deck?.id]
  );
  const resolveOwnedFinishes = useCallback(
    (printing: ScryfallCard): Finish[] => ownedFinishesByPrinting.get(printing.id) ?? [],
    [ownedFinishesByPrinting]
  );

  // Which binder(s) each collection copy lives in — mirrors how the
  // collection table derives `binders` per row (materialize, then map by
  // copyId). Lets the deck grid show a binder badge for cards whose
  // allocated copy is filed in a binder.
  const binderByCopyId = useMemo(() => {
    const map = new Map<string, BinderInfo[]>();
    if (collectionCards.length === 0 || binderDefs.length === 0) return map;
    const { binders: materialized } = materializeBinders(collectionCards, binderDefs, {
      search: '',
    });
    for (const b of materialized) {
      const info: BinderInfo = { id: b.def.id, name: b.def.name, color: b.def.color };
      for (const section of b.sections) {
        for (const c of section.cards) {
          if (!c.copyId) continue;
          const arr = map.get(c.copyId);
          if (arr) {
            if (!arr.some((x) => x.id === info.id)) arr.push(info);
          } else {
            map.set(c.copyId, [info]);
          }
        }
      }
    }
    return map;
  }, [collectionCards, binderDefs]);

  const comboData = useDeckCombos({ deckOracleIds, ownedOracleIds, format: deck?.format });
  const comboOverlay = useEdhrecComboOverlay(deck?.commander?.name ?? null);

  // Count one-away combos whose missing piece the user already owns.
  // Uses the `oneAway` bucket (not `almostInCollection`, which is empty for
  // decks with oracle IDs — see match.ts:112) filtered against the owned set.
  const comboOwnedMissingCount = useMemo(
    () =>
      (comboData.data?.oneAway ?? []).filter((m) => {
        const id = m.missingOracleIds[0];
        return id && ownedOracleIdSet.has(id);
      }).length,
    [comboData.data?.oneAway, ownedOracleIdSet]
  );

  // The Power hero's summary lines deep-link to their detail panels below.
  // Bracket and Engine are always-open panels, so a scroll suffices; Combos is
  // collapsible, so reuse its reveal() handle (expand + scroll + focus), landing
  // on the one-away tab when the user owns completable pieces.
  const scrollToPowerPanel = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);
  const handleViewBracket = useCallback(
    () => scrollToPowerPanel('deck-power-bracket'),
    [scrollToPowerPanel]
  );
  const handleViewEngine = useCallback(
    () => scrollToPowerPanel('deck-power-engine'),
    [scrollToPowerPanel]
  );
  const handleViewWinConditions = useCallback(
    () => scrollToPowerPanel('deck-power-wincon'),
    [scrollToPowerPanel]
  );
  const handleViewCombos = useCallback(() => {
    combosRef.current?.reveal(comboOwnedMissingCount > 0 ? 'oneAway' : 'inDeck');
  }, [comboOwnedMissingCount]);

  const commanderColorIdentity = useMemo(() => {
    if (!deck) return [];
    const ci = new Set<string>();
    for (const c of deck.commander?.color_identity ?? []) ci.add(c);
    for (const c of deck.partnerCommander?.color_identity ?? []) ci.add(c);
    return [...ci];
  }, [deck]);

  // Keep grade/bracket live for any commander deck as its cards change —
  // generated and manual alike (the user's bracketOverride layers on top).
  useCommanderBracketAnalysis({
    deck,
    comboData: comboData.data,
    mainboardSize: deck ? DECK_FORMAT_CONFIGS[deck.format].mainboardSize : undefined,
    hasCommander: deck ? DECK_FORMAT_CONFIGS[deck.format].hasCommander : false,
    colorIdentity: commanderColorIdentity,
    updateDeck,
    // The user's target bracket drives the Bracket Fit plan; folding it into the
    // hook recomputes the plan when the target changes, not only when cards do.
    bracketOverride: deck?.bracketOverride,
  });

  const taggerReady = useTaggerReady();

  // Curve-derived land-count advice for the hero — the lands RoleHealth from
  // the same analyzeDeck the Analysis panel renders, so badge and hero agree
  // on both the number and when it applies (Karsten gate lives in there).
  const landAdvice = useMemo(() => {
    if (!deck || !DECK_FORMAT_CONFIGS[deck.format].hasCommander) return undefined;
    const lands = analyzeDeck(
      {
        format: deck.format,
        commander: deck.commander,
        partnerCommander: deck.partnerCommander,
        mainboard: deck.cards,
      },
      taggerReady
    ).roles.find((r) => r.key === 'lands');
    return lands?.suggested != null
      ? { count: lands.count, suggested: lands.suggested }
      : undefined;
  }, [deck, taggerReady]);

  // "Next best move" — the single highest-leverage change, derived from the
  // live PlanScore + role gaps + near-miss combos. Manual decks don't carry
  // roleCounts (set only at generation), so derive them from the tagger.
  const nextBestMoves = useMemo(() => {
    if (!deck || !DECK_FORMAT_CONFIGS[deck.format].hasCommander) return [];
    const roleCounts =
      deck.roleCounts ?? computeRoleCounts(deck.cards.map((c) => c.card)).roleCounts;
    return buildNextBestMoves({
      planScore: deck.planScore,
      roleCounts,
      roleTargets: deck.roleTargets ?? {},
      gapAnalysis: deck.gapAnalysis,
      // Count the commander zone too (incl. a partner) so the total matches
      // the Deck tab's header and the 100-card (deckSize) target — commanders
      // live in their own fields, not in deck.cards.
      cardCount: deck.cards.length + (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0),
      deckTarget: DECK_FORMAT_CONFIGS[deck.format].deckSize,
      oneAwayCombos: comboData.data?.oneAway,
      ownedNames,
      winConditions: deck.winConditions,
      bracketFitHasMoves: (deck.bracketFit?.moves.length ?? 0) > 0,
      ownedOnly,
      landAdvice,
    });
  }, [deck, comboData.data, ownedNames, ownedOnly, landAdvice]);

  // UX-310: whether the async commander-deck analysis is still in its first
  // run. `gradeBracketSignature` is only set after a successful analysis
  // completes, so its absence means no result has landed yet. Non-commander
  // decks or decks without a commander skip analysis entirely → 'ready'.
  const analysisState = useMemo<'pending' | 'ready'>(() => {
    if (!deck || !DECK_FORMAT_CONFIGS[deck.format].hasCommander || !deck.commander) return 'ready';
    return deck.gradeBracketSignature ? 'ready' : 'pending';
  }, [deck]);

  // Session-scoped reveal key for score animations. Non-null only when analysis
  // is ready and the deck has a gradeBracketSignature. The module-level registry
  // in use-animated-number ensures the reveal fires exactly once per key (even
  // across tab switches and remounts) — no latch state needed here.
  const scoreRevealKey = useMemo<string | null>(() => {
    if (!deck) return null;
    if (analysisState !== 'ready') return null;
    if (!deck.gradeBracketSignature) return null;
    return `${deck.id}:${deck.gradeBracketSignature}`;
  }, [deck, analysisState]);

  // UX-311: deep-link from a StatsHero shortfall to the Coach filter that fixes
  // it. Switches to the Coach tab and sets the focus so CoachFeed activates the
  // matching chip (the same one-shot mechanism as NextBestMove deep-links).
  const handleNavigateToTune = useCallback(
    (lane: LaneId) => {
      openView('tune');
      setTuneFocusLane(lane);
    },
    [openView]
  );

  // Owned-substitute plan ("From your collection") — derived live from the
  // persisted gap analysis + the live collection (ownership is intentionally a
  // UI-layer concern; the analysis orchestrator stays collection-agnostic).
  // For each EDHREC staple the deck wants but doesn't own, find an owned card
  // filling the same role within color identity. Pure + cheap → recompute on
  // change rather than persist.
  const substitutionPlan = useMemo(() => {
    if (!deck || !DECK_FORMAT_CONFIGS[deck.format].hasCommander) return null;
    const gap = deck.gapAnalysis;
    if (!gap || gap.length === 0) return null;
    // Staples worth substituting: role-bearing, and not already owned (an owned
    // staple is something you'd just add — not a "buy" to substitute around).
    const missingStaples = gap.filter((g) => g.role && !ownedNames.has(g.name));
    if (missingStaples.length === 0) return null;

    const ownedPool: SubstituteCandidate[] = collectionCards.map((c) => ({
      name: c.name,
      colorIdentity: c.colorIdentity ?? [],
      cmc: c.cmc,
      typeLine: c.typeLine,
    }));
    const deckNames = new Set(deck.cards.map((c) => c.card.name));
    const inclusionByName = new Map<string, number>(Object.entries(deck.cardInclusionMap ?? {}));
    // Options variant: each primary carries ranked owned alternatives for the
    // "N other owned options" expander (deck generation still uses the greedy
    // single-pick buildSubstitutionPlan).
    return buildSubstitutionOptions(missingStaples, ownedPool, deckNames, commanderColorIdentity, {
      inclusionByName,
    });
  }, [deck, ownedNames, collectionCards, commanderColorIdentity]);

  // Strong on-color duals for the deck's colors, fetched live for the
  // "Re-analyze lands" tool's acquire rows (duals worth getting, not just ones
  // you own). Gated to 2+ color decks (minLength 2) — mono-color decks have no
  // duals to fetch; the owned-swap path still works for them. Cached 10min by
  // the search client, so re-opens are cheap. Failure is silent → owned-only.
  const identityKey = useMemo(
    () => [...commanderColorIdentity].sort().join(''),
    [commanderColorIdentity]
  );
  const { results: fetchedFixingLands } = useSearchCards(identityKey, {
    fetcher: fetchFixingLands,
    limit: 60,
    minLength: 2,
  });

  // Merit-based land upgrades — the "Re-analyze lands" tool. Scores on-color
  // candidate lands by intrinsic strength (popularity-blind, so a strong new
  // land EDHREC hasn't rated still surfaces) and proposes safe swaps for weak
  // lands in the deck. Candidate pool = the user's OWNED unused lands (apply-now)
  // + the fetched duals above (acquire). EnrichedCard is camelCase and lacks
  // produced_mana; we map owned copies to the ScryfallCard shape the engine reads
  // (producedManaColors' oracle-text fallback recovers colors) — mirroring
  // classifyOwnedCommanderPlaystyles. Fetched cards are already full ScryfallCards.
  const landUpgrades = useMemo(() => {
    if (!deck) return [];
    const identity = new Set(commanderColorIdentity);
    if (identity.size === 0) return [];
    const seen = new Set<string>();
    const candidateLands: ScryfallCard[] = [];
    for (const c of collectionCards) {
      if (!c.typeLine?.toLowerCase().includes('land')) continue;
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      candidateLands.push({
        name: c.name,
        type_line: c.typeLine,
        oracle_text: c.oracleText,
        mana_cost: c.manaCost,
        cmc: c.cmc,
        color_identity: c.colorIdentity,
        layout: c.layout,
      } as ScryfallCard);
    }
    for (const c of fetchedFixingLands) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      candidateLands.push(c);
    }
    return computeLandUpgrades(deckCards, identity, candidateLands, ownedNames);
  }, [deck, commanderColorIdentity, collectionCards, deckCards, fetchedFixingLands, ownedNames]);

  // `/` opens the search panel; `c` jumps to the Power tab and reveals the
  // combos panel; `a` opens the Coach tab (suggestions). Skipped while the user
  // is typing into another input/textarea so the keys still type literally
  // inside a rename/search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (e.key === '/') {
        e.preventDefault();
        setShowAddPanel(true);
        window.requestAnimationFrame(() => searchPanelRef.current?.focusInput());
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        // Combos render under the Power tab. Switch there, then reveal the
        // panel on the next frame (it only mounts once Power is active).
        openAnalysisTab('power');
        window.requestAnimationFrame(handleViewCombos);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        openAnalysisTab('tune'); // Suggestions live under the Coach tab (view id stays 'tune').
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openAnalysisTab, handleViewCombos]);

  // Esc closes the Test hand sheet (the card-picker overlay has no built-in
  // dismiss key — only backdrop tap / the close button).
  useEffect(() => {
    if (!showTestHand) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowTestHand(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showTestHand]);

  // Hero totals — a quick at-a-glance summary above the deck composition.
  // The count/value reflect the *mainboard deck only* (commanders + main
  // cards), matching the legality banner's notion of the deck; the sideboard
  // ("maybe" cards) is surfaced separately so the hero doesn't claim "104
  // cards" on a 100-card deck. Computed BEFORE the missing-deck early return
  // so the hook order stays stable across renders.
  const heroTotals = useMemo(() => {
    if (!deck) return { count: 0, value: 0, sideboard: 0 };
    const sumPrice = (cards: ScryfallCard[]) =>
      cards.reduce((sum, c) => {
        const raw = getCardPrice(c, 'USD');
        const n = raw ? Number(raw) : NaN;
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    const commanders: ScryfallCard[] = [];
    if (deck.commander) commanders.push(deck.commander);
    if (deck.partnerCommander) commanders.push(deck.partnerCommander);
    const mainCards = deck.cards.map((c) => c.card);
    const main = [...commanders, ...mainCards];
    return { count: main.length, value: sumPrice(main), sideboard: deck.sideboard.length };
  }, [deck]);

  // Commander presence for the hero — same art_crop resolution + offline-URL
  // healing as the Decks index cards (see DecksIndexPage). Undefined for
  // commanderless decks; the hero keeps its plain color-border look.
  const rawHeroArt =
    deck?.commander?.image_uris?.art_crop ?? deck?.commander?.card_faces?.[0]?.image_uris?.art_crop;
  const heroArt = rawHeroArt ? scryfallArtCrop(rawHeroArt) : undefined;

  // CoachFeed "Fit?" button — open the audition for a feed row's incoming card.
  // For swap rows, also store the outgoing card name so CardFitPanel can pin it
  // as the first cut suggestion (pre-seeding the natural swap target).
  // Reuses the same getCardByName + setAuditionCard flow as the card-search path.
  // Defined BEFORE the missing-deck early return so hook order is stable.
  const handleCoachPreviewFit = useCallback(
    async (change: Change) => {
      if (!deck) return;
      const scry = await getCardByName(change.name);
      if (!scry) return;
      setAuditionPinnedCutName(change.type === 'swap' && change.inName ? change.inName : null);
      setAuditionCard(scry);
    },
    [deck]
  );

  if (!id) return <Navigate to="/decks" replace />;
  if (!deck) {
    return (
      <div className="deck-editor-missing">
        <p>That deck no longer exists.</p>
        <Link to="/decks" className="btn btn-primary">
          Back to decks
        </Link>
      </div>
    );
  }

  const handleStartRename = () => {
    setDraftName(deck.name);
    setRenaming(true);
  };
  const handleCommitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== deck.name) renameDeck(deck.id, trimmed);
    setRenaming(false);
  };
  const handleCancelRename = () => {
    setDraftName(deck.name);
    setRenaming(false);
  };
  const handleConfirmDelete = () => {
    deleteDeck(deck.id);
    navigate('/decks');
  };
  const handleDuplicate = () => {
    const newId = duplicateDeck(deck.id);
    if (newId) navigate(`/decks/${newId}`);
  };
  const handleToggleAddPanel = () => {
    const next = !showAddPanel;
    setShowAddPanel(next);
    if (next) {
      window.requestAnimationFrame(() => searchPanelRef.current?.focusInput());
    }
  };

  // Capture the slot before removing so Undo can re-add the same card with
  // the same allocated printing. (`addCard` mints a fresh slotId, but the
  // collection allocation is what actually matters to the user.)
  const handleRemoveCard = (slotId: string) => {
    const slot = deck.cards.find((c) => c.slotId === slotId);
    if (!slot) return;
    recordEdit(deck.id, `remove ${slot.card.name}`, () => removeCard(deck.id, slotId));
    pushToast({
      message: `Removed ${slot.card.name}`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  // ── Physical-copy reallocation (move owned cards between decks) ────────────
  // A move pulls one physical copy out of a donor deck and (optionally) into a
  // recipient deck, with an explicit donor outcome. A cross-deck move can't be a
  // single per-deck undo command, so it reverses via one toast "Undo" that
  // atomically restores BOTH decks' pre-move snapshots (the blessed
  // compensating-mutation pattern under LWW). Ctrl+Z stays in-deck-only.

  // Locate the slot in the current deck to move a copy of `name` OUT of. Prefers
  // an allocated slot (a real physical copy to move), else an unowned slot
  // (relocating just the list entry).
  const findDonorSlotInDeck = (
    name: string
  ): { zone: 'main' | 'sideboard'; slotId: string; copyId: string | null } | null => {
    if (!deck) return null;
    const key = name.toLowerCase();
    const mainAlloc = deck.cards.find(
      (c) => c.card.name.toLowerCase() === key && c.allocatedCopyId
    );
    if (mainAlloc)
      return { zone: 'main', slotId: mainAlloc.slotId, copyId: mainAlloc.allocatedCopyId };
    const sideAlloc = deck.sideboard.find(
      (c) => c.card.name.toLowerCase() === key && c.allocatedCopyId
    );
    if (sideAlloc)
      return { zone: 'sideboard', slotId: sideAlloc.slotId, copyId: sideAlloc.allocatedCopyId };
    const main = deck.cards.find((c) => c.card.name.toLowerCase() === key);
    if (main) return { zone: 'main', slotId: main.slotId, copyId: null };
    const side = deck.sideboard.find((c) => c.card.name.toLowerCase() === key);
    if (side) return { zone: 'sideboard', slotId: side.slotId, copyId: null };
    return null;
  };

  // Apply the chosen donor outcome to the slot losing the copy. Commander/partner
  // slots can only be freed (leave-gap) — they have no portable list slot.
  const applyDonorOutcome = (
    donorDeckId: string,
    zone: DonorZone,
    slotId: string | null,
    donorCard: ScryfallCard,
    outcome: DonorOutcome,
    replacement: { name: string; card: ScryfallCard } | null
  ): void => {
    // Cube donors never route here — a cube is freed via releaseCubePick (no slot,
    // leave-gap only). Guard so a future cube-outbound path can't silently no-op.
    if (zone === 'cube') {
      if (import.meta.env.DEV)
        throw new Error('[applyDonorOutcome] cube zone must use releaseCubePick');
      return;
    }
    if (zone === 'commander') return void setCommander(donorDeckId, donorCard, null);
    if (zone === 'partner') return void setPartnerCommander(donorDeckId, donorCard, null);
    if (!slotId) return;
    if (outcome === 'remove') {
      if (zone === 'sideboard') removeSideboardCard(donorDeckId, slotId);
      else removeCard(donorDeckId, slotId);
      return;
    }
    if (outcome === 'replace' && replacement) {
      const alloc =
        pickCollectionCopy(
          replacement.name,
          collectionCards,
          buildAllocationMap(useDecksStore.getState().decks, useCubeStore.getState().saved),
          replacement.card.id
        )?.copyId ?? null;
      if (zone === 'sideboard') {
        removeSideboardCard(donorDeckId, slotId);
        addSideboardCard(donorDeckId, replacement.card, alloc);
      } else {
        swapCard(donorDeckId, slotId, replacement.card, alloc);
      }
      return;
    }
    // leave-gap (default): the donor keeps the card as an unowned copy it needs.
    if (zone === 'sideboard') {
      // setCardAllocation only touches the mainboard; clear a sideboard slot's
      // allocation by re-seating it unowned.
      const slot = useDecksStore
        .getState()
        .decks.find((d) => d.id === donorDeckId)
        ?.sideboard.find((c) => c.slotId === slotId);
      removeSideboardCard(donorDeckId, slotId);
      if (slot) addSideboardCard(donorDeckId, slot.card, null);
    } else {
      setCardAllocation(donorDeckId, slotId, null);
    }
  };

  // Execute a cross-deck reallocation and offer a single toast-Undo that
  // atomically restores both decks.
  const executeReallocation = (opts: {
    donorDeckId: string;
    /** Set when the donor is a physical cube (instead of a deck) — snapshot the
     *  cube so Undo restores the released pick atomically alongside the deck. */
    donorCubeId?: string;
    recipientDeckId: string;
    recipientApply: () => void;
    donorApply: () => void;
    label: string;
  }): void => {
    const decksNow = useDecksStore.getState().decks;
    const snapDonor = decksNow.find((d) => d.id === opts.donorDeckId) ?? null;
    const snapRecipient =
      opts.recipientDeckId === opts.donorDeckId
        ? null
        : (decksNow.find((d) => d.id === opts.recipientDeckId) ?? null);
    const snapCube = opts.donorCubeId
      ? (useCubeStore.getState().saved.find((c) => c.id === opts.donorCubeId) ?? null)
      : null;
    // Ordering matters for crash-safety. A cube steal writes two different entity
    // rows (cube + deck) with no cross-entity dedupe heal, so RELEASE from the cube
    // first: a crash between the two writes then leaves the copy FREE (re-bindable),
    // never double-claimed. The deck→deck path keeps recipient-first because its
    // `replace` donor outcome must pick a free copy AFTER the moved copy is still
    // claimed (reversing it would let the replacement grab the copy being moved).
    if (opts.donorCubeId) {
      opts.donorApply();
      opts.recipientApply();
    } else {
      opts.recipientApply();
      opts.donorApply();
    }
    haptics.tap();
    pushToast({
      message: opts.label,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => {
        if (snapDonor) replaceDeck(opts.donorDeckId, snapDonor);
        if (snapRecipient) replaceDeck(opts.recipientDeckId, snapRecipient);
        // Restore the cube's pre-release picks (re-binds the freed copy).
        if (snapCube) useCubeStore.getState().updateSaved(snapCube.id, { picks: snapCube.picks });
        haptics.tap();
      },
    });
  };

  // Surface 2 commit (from MoveToDeckSheet): send a copy of `card` from this deck
  // into `targetDeckId`, applying the donor outcome to THIS deck.
  const handleMoveConfirm = (
    card: ScryfallCard,
    targetDeckId: string,
    outcome: DonorOutcome,
    replacement: { name: string; card: ScryfallCard } | null
  ): void => {
    if (!deck) return;
    setMoveCard(null);
    const slot = findDonorSlotInDeck(card.name);
    if (!slot) return;
    const target = decks.find((d) => d.id === targetDeckId);
    executeReallocation({
      donorDeckId: deck.id,
      recipientDeckId: targetDeckId,
      recipientApply: () => addCard(targetDeckId, card, slot.copyId),
      donorApply: () =>
        applyDonorOutcome(deck.id, slot.zone, slot.slotId, card, outcome, replacement),
      label: `Moved ${card.name} → ${target?.name ?? 'deck'}`,
    });
  };

  // Surface 3: free an owned copy back to the collection (the slot stays as a
  // card you still need). Single-deck → normal undo + toast.
  const handleReleaseConfirm = (): void => {
    if (!deck || !releaseCard) return;
    const card = releaseCard;
    setReleaseCard(null);
    const slot = deck.cards.find((c) => c.card.name === card.name && c.allocatedCopyId);
    if (slot) {
      recordEdit(deck.id, `release ${card.name}`, () =>
        setCardAllocation(deck.id, slot.slotId, null)
      );
    } else if (deck.commander?.name === card.name && deck.commanderAllocatedCopyId) {
      recordEdit(deck.id, `release ${card.name}`, () =>
        setCommander(deck.id, deck.commander, null)
      );
    } else if (deck.partnerCommander?.name === card.name && deck.partnerCommanderAllocatedCopyId) {
      recordEdit(deck.id, `release ${card.name}`, () =>
        setPartnerCommander(deck.id, deck.partnerCommander, null)
      );
    } else {
      return;
    }
    pushToast({
      message: `${card.name} released — the copy is now free.`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  // Pull an owned copy of a slot's card into THIS deck from whichever other deck
  // OR physical cube holds it, leaving that donor a gap (it keeps the card
  // listed, now shown "In [this deck]"). One atomic Undo restores both. The
  // explicit "Move here…" / "Use my copy" click IS the conscious choice — we
  // don't pop a second sheet; the donor always gets leave-gap. (Replace/remove
  // live in the outbound "Move to another deck" flow; a cube only ever leaves a
  // gap.) Keyed by slotId so duplicate-name rows are exact.
  const handleMoveSharedCopy = (slotId: string): void => {
    if (!deck) return;
    const slot = deck.cards.find((c) => c.slotId === slotId);
    if (!slot) return;
    const stealable = findStealableCopy(
      slot.card.name,
      collectionCards,
      useDecksStore.getState().decks,
      deck.id,
      slot.card.id,
      useCubeStore.getState().saved
    );
    if (stealable) {
      const fromCube = stealable.donorKind === 'cube';
      executeReallocation({
        donorDeckId: stealable.donorDeckId,
        donorCubeId: fromCube ? stealable.donorId : undefined,
        recipientDeckId: deck.id,
        recipientApply: () => setCardAllocation(deck.id, slotId, stealable.copyId),
        donorApply: () =>
          fromCube
            ? useCubeStore.getState().releaseCubePick(stealable.donorId, stealable.copyId)
            : applyDonorOutcome(
                stealable.donorDeckId,
                stealable.donorZone,
                stealable.donorSlotId,
                stealable.donorCard!,
                'leave-gap',
                null
              ),
        label: `Moved ${slot.card.name} here from ${stealable.donorDeckName}`,
      });
      return;
    }
    // A free copy is available — bind it directly (no cross-deck move).
    const claim = pickCollectionCopy(
      slot.card.name,
      collectionCards,
      buildAllocationMap(useDecksStore.getState().decks, useCubeStore.getState().saved),
      slot.card.id
    );
    if (claim) {
      recordEdit(deck.id, `use my ${slot.card.name}`, () =>
        setCardAllocation(deck.id, slotId, claim.copyId)
      );
      pushToast({ message: `Using your copy of ${slot.card.name}`, tone: 'success' });
      haptics.tap();
    }
  };

  // Per-row "Use my copy" (row ⋮): resolve the card to its first unowned slot and
  // pull a copy in via the same conscious leave-gap move.
  const handleUseOwnCopy = (card: ScryfallCard): void => {
    if (!deck) return;
    const slot = deck.cards.find((c) => c.card.name === card.name && !c.allocatedCopyId);
    if (slot) handleMoveSharedCopy(slot.slotId);
  };

  // The single brain for adding an already-resolved card — used by every add path
  // (collection search panel, Coach/Engine lanes, size-aware prompt) so they behave
  // identically. Binds a free owned copy if one exists; otherwise adds the slot
  // unbound — classifyAllocation renders it "In [deck]" (owned but every copy is
  // elsewhere) or "unowned" (not owned). It NEVER moves a copy out of another deck:
  // pulling a copy in is always a separate, conscious choice (per-row "Use my copy"
  // / the Shared-copies review). This matches what import/generate already do.
  const allocateAndAdd = (
    card: ScryfallCard,
    zone: 'main' | 'sideboard',
    notify: boolean
  ): void => {
    if (!deck) return;
    const plan = planCardAdd(
      card.name,
      card.id,
      collectionCards,
      useDecksStore.getState().decks,
      useCubeStore.getState().saved
    );
    const allocatedId = plan.kind === 'bind' ? plan.copyId : null;
    recordEdit(
      deck.id,
      zone === 'sideboard' ? `add ${card.name} to sideboard` : `add ${card.name}`,
      () =>
        zone === 'sideboard'
          ? addSideboardCard(deck.id, card, allocatedId)
          : addCard(deck.id, card, allocatedId)
    );
    if (notify)
      pushToast({
        message: zone === 'sideboard' ? `Added ${card.name} to sideboard` : `Added ${card.name}`,
        tone: 'success',
      });
  };

  // Resolve a card by name (Scryfall) then route through allocateAndAdd. Used by
  // the Optimize plan and the Coach/Engine lanes (which only have a card name).
  const addResolvedCard = async (cardName: string, zone: 'main' | 'sideboard' = 'main') => {
    if (!deck) return;
    setAddingEngineNames((prev) => new Set(prev).add(cardName));
    try {
      const scry = await getCardByName(cardName);
      if (!scry) return;
      allocateAndAdd(scry, zone, true);
      haptics.tap();
    } catch {
      pushToast({ message: `Couldn't add ${cardName}`, tone: 'error' });
    } finally {
      setAddingEngineNames((prev) => {
        const next = new Set(prev);
        next.delete(cardName);
        return next;
      });
    }
  };

  // Add from a Tune lane. A Commander deck at its card limit would overfill, so
  // open the replace-when-full prompt instead of silently going to 101; otherwise
  // add straight away.
  const handleAddEngineCard = async (cardName: string) => {
    if (!deck) return;
    if (deckIsFull) {
      setPendingAdd(cardName);
      return;
    }
    await addResolvedCard(cardName);
  };

  // Cut a single in-deck card by name (the Improve lane's "Consider cutting"
  // rows). removeCard is synchronous, so no in-flight gate. If the cut drops a
  // previously-full Commander deck below the limit, nudge for a same-role refill.
  const handleCutEngineCard = (cardName: string) => {
    if (!deck) return;
    const key = cardName.toLowerCase();
    const slotId = deck.cards.find((c) => c.card.name.toLowerCase() === key)?.slotId;
    if (!slotId) return;
    const wasFull = deck.cards.length >= mainboardLimit;
    recordEdit(deck.id, `cut ${cardName}`, () => removeCard(deck.id, slotId));
    pushToast({ message: `Cut ${cardName}`, tone: 'success' });
    haptics.tap();
    if (isCommander && wasFull) {
      setRefillAfterCut({ name: cardName, role: classifyCandidate(cardName) ?? null });
    }
  };

  // Replace a chosen in-deck card with the pending add (1-for-1 keeps the deck
  // legal): cut the slot first so its physical copy frees up, then add.
  const handleReplaceWhenFull = async (cutSlotId: string) => {
    if (!deck || !pendingAdd) return;
    const name = pendingAdd;
    setPendingAdd(null);
    const cutName = deck.cards.find((c) => c.slotId === cutSlotId)?.card.name;
    setAddingEngineNames((prev) => new Set(prev).add(name));
    try {
      const scry = await getCardByName(name);
      if (!scry) {
        pushToast({ message: `Couldn't add ${name}`, tone: 'error' });
        return;
      }
      const before = beginEdit(deck.id);
      const allocations = buildAllocationMap(
        useDecksStore.getState().decks,
        useCubeStore.getState().saved
      );
      const claim = pickCollectionCopy(name, collectionCards, allocations, scry.id);
      // Atomic 1-for-1: never passes through a transient over/under-size state.
      swapCard(deck.id, cutSlotId, scry, claim?.copyId ?? null);
      if (before)
        commitEdit(deck.id, cutName ? `replace ${cutName} → ${name}` : `add ${name}`, before);
      pushToast({ message: `Added ${name}`, tone: 'success' });
      haptics.tap();
    } catch {
      pushToast({ message: `Couldn't add ${name}`, tone: 'error' });
    } finally {
      setAddingEngineNames((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  // Full-deck escape hatches: stash the card off-mainboard, or add over-limit.
  const addToSideboardAndClose = async () => {
    if (!pendingAdd) return;
    const name = pendingAdd;
    setPendingAdd(null);
    await addResolvedCard(name, 'sideboard');
  };
  const addAnywayAndClose = async () => {
    if (!pendingAdd) return;
    const name = pendingAdd;
    setPendingAdd(null);
    await addResolvedCard(name);
  };

  // Replace-when-full options (E20 intelligent cuts): rank cuts by how
  // *related/replaceable* they are vs the card being added (shared role, same
  // type, similar CMC) and surface the optimizer's real per-card reason instead
  // of a flat "weak slot". `all` is every deck card for "pick another". Plain
  // consts (not hooks) — computed below the early-return guard, only meaningful
  // while a prompt is open. `anyRelated` drives honest copy: when no cut actually
  // relates to the add, the prompt says "make room" rather than implying a swap.
  const replaceOptions =
    !pendingAdd || !deck
      ? null
      : (() => {
          const labelFor = (name: string): string | undefined => {
            const r = classifyCandidate(name);
            return r ? ROLE_LABEL[r] : undefined;
          };
          const toOpt = (
            c: { slotId: string; card: ScryfallCard },
            hint?: string,
            factors?: WhyFactor[]
          ): SizePromptOption => ({
            key: c.slotId,
            name: c.card.name,
            roleLabel: labelFor(c.card.name),
            hint,
            factors,
            onPick: () => void handleReplaceWhenFull(c.slotId),
          });
          // Stub when the add card hasn't resolved yet (or the resolve is for a
          // previous prompt) — name-based role still works.
          const resolvedAdd = pendingAddCard?.forName === pendingAdd ? pendingAddCard.card : null;
          const addCard: ScryfallCard =
            resolvedAdd ?? ({ name: pendingAdd, type_line: '', cmc: 0 } as ScryfallCard);
          const ranked = rankReplacementCuts({
            addCard,
            deckCards: deck.cards,
            removals: deck.optimizeSwaps?.removals,
            inDeckCombos: comboData.data?.inDeck,
            comboOverlay,
          });
          const suggested = ranked.map((r) =>
            toOpt({ slotId: r.slotId, card: r.card }, r.reason, r.factors)
          );
          const anyRelated = ranked.some((r) => r.related);
          const all = [...deck.cards]
            .sort((a, b) => a.card.name.localeCompare(b.card.name))
            .map((c) => toOpt(c));
          return { suggested, all, anyRelated };
        })();

  // E20 audition fit report — engine/curve/role/color + ranked cuts for the card
  // the user is previewing. Computed only while the panel is open (a plain const,
  // like replaceOptions — past the early-return guard so `deck` is defined).
  const auditionReport =
    auditionCard && deck
      ? computeAddFit({
          addCard: auditionCard,
          deckCards: deck.cards,
          removals: deck.optimizeSwaps?.removals,
          inDeckCombos: comboData.data?.inDeck,
          comboOverlay,
          commanderColorIdentity,
        })
      : null;

  // Refill-after-cut options: same-role staples the deck is missing (owned-first
  // hint), to bring the deck back to its legal count.
  const refillOptions: SizePromptOption[] =
    !refillAfterCut || !deck
      ? []
      : (() => {
          const role = refillAfterCut.role;
          const deckNames = new Set(deck.cards.map((c) => c.card.name.toLowerCase()));
          return (deck.gapAnalysis ?? [])
            .filter((g) => (!role || g.role === role) && !deckNames.has(g.name.toLowerCase()))
            .slice(0, 8)
            .map((g) => ({
              key: g.name,
              name: g.name,
              roleLabel: g.roleLabel,
              hint: ownershipFor(g.name) === 'owned' ? 'owned' : undefined,
              onPick: () => {
                setRefillAfterCut(null);
                void addResolvedCard(g.name);
              },
            }));
        })();

  // In-context swap: cut the in-deck card at `slotId` and add `newName` in its
  // place (resolve → allocate → add). Removal runs BEFORE the add so the freed
  // physical copy is re-allocatable; net size is unchanged (1-for-1), keeping a
  // 99-card deck legal. `close()` dismisses the preview (the card it showed is
  // gone). Uses its own loading gate (swappingSlot).
  const handleSwapInDeck = async (
    slotId: string,
    oldName: string,
    newName: string,
    close: () => void
  ) => {
    if (!deck) return;
    setSwappingSlot(slotId);
    try {
      const scry = await getCardByName(newName);
      if (!scry) {
        pushToast({ message: `Couldn't find ${newName}`, tone: 'error' });
        return;
      }
      const before = beginEdit(deck.id);
      const allocations = buildAllocationMap(
        useDecksStore.getState().decks,
        useCubeStore.getState().saved
      );
      const claim = pickCollectionCopy(newName, collectionCards, allocations, scry.id);
      // Atomic swap: one state update, so no transient "card removed" deck row.
      swapCard(deck.id, slotId, scry, claim?.copyId ?? null);
      if (before) commitEdit(deck.id, `swap ${oldName} → ${newName}`, before);
      pushToast({ message: `Swapped ${oldName} → ${newName}`, tone: 'success' });
      haptics.tap();
      close();
    } catch {
      pushToast({ message: `Couldn't swap ${oldName}`, tone: 'error' });
    } finally {
      setSwappingSlot(null);
    }
  };

  // CoachFeed unified apply handler — routes add/cut/swap changes from the
  // CoachFeed to the existing engine add/cut/swap flows.
  const handleApplyCoachMove = async (change: Change) => {
    if (!deck) return;
    if (change.type === 'add') {
      await handleAddEngineCard(change.name);
    } else if (change.type === 'cut') {
      handleCutEngineCard(change.name);
    } else if (change.type === 'swap' && change.inName) {
      if (bracketFitSwapName === change.inName) return;
      const slotId = deck.cards.find((c) => c.card.name === change.inName)?.slotId;
      if (!slotId) return;
      setBracketFitSwapName(change.inName);
      void handleSwapInDeck(slotId, change.inName, change.name, () => {}).finally(() =>
        setBracketFitSwapName(null)
      );
    }
  };

  // Build the in-context "Swap this card" section for an in-deck card: role-scoped
  // EDHREC alternatives (same functional role, not the card itself), owned-first,
  // capped. Returns null when the role is untagged or there are no alternatives.
  const renderSwapSuggestions = (card: ScryfallCard, slotId: string, close: () => void) => {
    if (!deck) return null;
    const role = classifyCandidate(card.name);
    if (!role) return null;
    // Never re-propose a card already in the deck (addCard doesn't dedup, so it
    // would duplicate a slot) — guards the gapAnalysis recompute/offline window.
    const deckCardNames = new Set(deck.cards.map((c) => c.card.name));
    const gaps = (deck.gapAnalysis ?? []).filter(
      (g) => g.role === role && g.name !== card.name && !deckCardNames.has(g.name)
    );
    if (gaps.length === 0) return null;
    // Each alternative is a real swap (this card → the alternative), so the row
    // shows the trade: the focused card dimmed on the left, the alternative
    // coming in. The apply path still reads the incoming name (`onSwap`).
    const alternatives = sortOwnedFirst(
      gaps.map((g) => {
        const ownership = ownershipFor(g.name);
        return {
          ...toSwapAgainst(fromGapCard(g, ownership), card.name),
          // Each same-role alternative gets its own grounded "why this over the
          // others" — replaces the six identical "{role} staple" reason lines.
          whyFactors: buildSwapAlternativeFactors({
            inclusion: g.inclusion,
            synergy: g.synergy,
            owned: ownership === 'owned',
            roleLabel: g.roleLabel,
            commanderName: deck.commander?.name,
          }),
        };
      })
    ).slice(0, 6);
    return (
      <SwapThisCard
        currentName={card.name}
        alternatives={alternatives}
        swapping={swappingSlot === slotId}
        commanderName={deck.commander?.name}
        onSwap={(name) => void handleSwapInDeck(slotId, card.name, name, close)}
      />
    );
  };

  // In-context "Similar cards" for an in-deck card: owned look-alikes from the
  // collection, then broader synergy-axis discovery (see <SimilarCardsStrip>).
  // Same `(card, slotId, close)` shape + swap mechanics as renderSwapSuggestions.
  const renderSimilarCards = (card: ScryfallCard, slotId: string, close: () => void) => {
    if (!deck) return null;
    return (
      <SimilarCardsStrip
        target={card}
        deckCardNames={deck.cards.map((c) => c.card.name)}
        collectionCards={collectionCards}
        ownershipFor={ownershipFor}
        freeCountFor={freeCountFor}
        identity={commanderColorIdentity}
        inclusionMap={deck.cardInclusionMap ?? {}}
        onSwap={(name) => void handleSwapInDeck(slotId, card.name, name, close)}
        swapping={swappingSlot === slotId}
        commanderName={deck.commander?.name}
        enabled
      />
    );
  };

  // Apply a batch of 1-for-1 swaps as ONE undo entry: each pair cuts the named
  // in-deck card and adds the replacement. Drives both the budget "Apply all
  // drop-ins" and the bracket "Converge to target" bulk actions — both are
  // swap-only, so the deck size never changes. `kind` only tunes the copy.
  const handleApplyCostSwaps = async (
    swaps: Array<{ removeName: string; addName: string }>,
    kind: 'budget' | 'bracket' = 'budget'
  ) => {
    if (!deck) return;
    try {
      const slotsByName = new Map<string, string[]>();
      for (const c of deck.cards) {
        const k = c.card.name.toLowerCase();
        const arr = slotsByName.get(k) ?? [];
        arr.push(c.slotId);
        slotsByName.set(k, arr);
      }
      // Bracket the whole batch as one undo entry (begin before the loop,
      // commit once after) — Cmd+Z reverts the entire budget plan at once.
      const before = beginEdit(deck.id);
      let done = 0;
      for (const { removeName, addName } of swaps) {
        const slotId = slotsByName.get(removeName.toLowerCase())?.shift();
        if (!slotId) continue;
        try {
          const scry = await getCardByName(addName);
          if (!scry) continue;
          const allocations = buildAllocationMap(
            useDecksStore.getState().decks,
            useCubeStore.getState().saved
          );
          const claim = pickCollectionCopy(addName, collectionCards, allocations, scry.id);
          swapCard(deck.id, slotId, scry, claim?.copyId ?? null);
          done += 1;
        } catch {
          /* skip cards that won't resolve — leave the original in place */
        }
      }
      if (before) commitEdit(deck.id, `apply ${done} ${kind} swap${done === 1 ? '' : 's'}`, before);
      pushToast({
        message: `Applied ${done} ${kind} swap${done === 1 ? '' : 's'}`,
        tone: 'success',
      });
    } catch {
      pushToast({ message: `Couldn't apply ${kind} swaps.`, tone: 'error' });
    }
  };

  const handleRemoveSideboardCard = (slotId: string) => {
    const slot = deck.sideboard.find((c) => c.slotId === slotId);
    if (!slot) return;
    recordEdit(deck.id, `remove ${slot.card.name} from sideboard`, () =>
      removeSideboardCard(deck.id, slotId)
    );
    pushToast({
      message: `Removed ${slot.card.name} from sideboard`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  // Both zone moves take the row's slot ids — one copy, or its whole stack. The
  // loop sits inside a single recordEdit so "move all 4" is one undo entry.
  const handleMoveToSideboard = (slotIds: string[]) => {
    const name = deck.cards.find((c) => c.slotId === slotIds[0])?.card.name ?? 'card';
    const label =
      slotIds.length === 1
        ? `move ${name} to sideboard`
        : `move ${slotIds.length} × ${name} to sideboard`;
    recordEdit(deck.id, label, () => {
      for (const slotId of slotIds) moveBetweenZones(deck.id, slotId, 'main');
    });
  };

  const handleMoveToMainboard = (slotIds: string[]) => {
    const name = deck.sideboard.find((c) => c.slotId === slotIds[0])?.card.name ?? 'card';
    const label =
      slotIds.length === 1
        ? `move ${name} to mainboard`
        : `move ${slotIds.length} × ${name} to mainboard`;
    recordEdit(deck.id, label, () => {
      for (const slotId of slotIds) moveBetweenZones(deck.id, slotId, 'side');
    });
  };

  const handleMakeCommanderClick = (slotId: string, card: ScryfallCard) => {
    const mainSlot = deck.cards.find((c) => c.slotId === slotId);
    const sideSlot = mainSlot ? null : deck.sideboard.find((c) => c.slotId === slotId);
    const slot = mainSlot ?? sideSlot;
    if (!slot) return;
    const target = {
      slotId,
      card,
      zone: (mainSlot ? 'main' : 'side') as 'main' | 'side',
      allocatedCopyId: slot.allocatedCopyId,
    };
    // No current commander → just set it directly, no dialog needed.
    if (!deck.commander) {
      recordEdit(deck.id, `make ${card.name} commander`, () => {
        if (target.zone === 'main') removeCard(deck.id, slotId);
        else removeSideboardCard(deck.id, slotId);
        setCommander(deck.id, card, target.allocatedCopyId);
      });
      pushToast({ message: `${card.name} is now the commander.`, tone: 'success' });
      return;
    }
    setMakeCommanderTarget(target);
  };

  const handleConfirmMakeCommander = (keepOldInDeck: boolean) => {
    const target = makeCommanderTarget;
    if (!target) return;
    const oldCommander = deck.commander;
    const oldAllocated = deck.commanderAllocatedCopyId;
    setMakeCommanderTarget(null);

    recordEdit(deck.id, `make ${target.card.name} commander`, () => {
      if (target.zone === 'main') removeCard(deck.id, target.slotId);
      else removeSideboardCard(deck.id, target.slotId);

      if (keepOldInDeck && oldCommander) {
        addCard(deck.id, oldCommander, oldAllocated);
      }
      setCommander(deck.id, target.card, target.allocatedCopyId);
    });
    pushToast({
      message: `${target.card.name} is now the commander${
        keepOldInDeck && oldCommander ? ` · ${oldCommander.name} moved to the deck` : ''
      }.`,
      tone: 'success',
    });
  };

  // Whether a deck card is a legal partner for the current commander — gates
  // the "Make partner" row action. Requires a commander already set; the
  // partner mechanic itself (generic Partner, "Partner with X", Friends
  // forever, Choose a Background, Doctor's companion) is checked in
  // areValidPartners, which also rejects pairing a card with itself. Plain
  // function (not a hook) since it lives below the missing-deck early return.
  const canMakePartner = (card: ScryfallCard) =>
    !!deck.commander && areValidPartners(deck.commander, card);

  const handleMakePartnerClick = (slotId: string, card: ScryfallCard) => {
    const mainSlot = deck.cards.find((c) => c.slotId === slotId);
    const sideSlot = mainSlot ? null : deck.sideboard.find((c) => c.slotId === slotId);
    const slot = mainSlot ?? sideSlot;
    if (!slot) return;
    const target = {
      slotId,
      card,
      zone: (mainSlot ? 'main' : 'side') as 'main' | 'side',
      allocatedCopyId: slot.allocatedCopyId,
    };
    // No current partner → pull the card out of the deck and pair it directly.
    if (!deck.partnerCommander) {
      recordEdit(deck.id, `make ${card.name} partner`, () => {
        if (target.zone === 'main') removeCard(deck.id, slotId);
        else removeSideboardCard(deck.id, slotId);
        setPartnerCommander(deck.id, card, target.allocatedCopyId);
      });
      pushToast({ message: `${card.name} is now the partner commander.`, tone: 'success' });
      return;
    }
    setMakePartnerTarget(target);
  };

  const handleConfirmMakePartner = (keepOldInDeck: boolean) => {
    const target = makePartnerTarget;
    if (!target) return;
    const oldPartner = deck.partnerCommander;
    const oldAllocated = deck.partnerCommanderAllocatedCopyId;
    setMakePartnerTarget(null);

    recordEdit(deck.id, `make ${target.card.name} partner`, () => {
      if (target.zone === 'main') removeCard(deck.id, target.slotId);
      else removeSideboardCard(deck.id, target.slotId);

      if (keepOldInDeck && oldPartner) {
        addCard(deck.id, oldPartner, oldAllocated);
      }
      setPartnerCommander(deck.id, target.card, target.allocatedCopyId);
    });
    pushToast({
      message: `${target.card.name} is now the partner commander${
        keepOldInDeck && oldPartner ? ` · ${oldPartner.name} moved to the deck` : ''
      }.`,
      tone: 'success',
    });
  };

  // Picker entry point (hero): pair a legal partner that may not already be in
  // the deck. If the chosen card IS in the deck, reuse its slot/allocation and
  // pull it out (mirrors make-commander); otherwise claim a free owned copy.
  // Passing null clears the partner.
  const handleSelectPartnerFromPicker = (card: ScryfallCard | null) => {
    if (!card) {
      recordEdit(deck.id, 'remove partner', () => setPartnerCommander(deck.id, null, null));
      pushToast({ message: 'Partner commander removed.', tone: 'success' });
      return;
    }
    const mainSlot = deck.cards.find((c) => c.card.name === card.name);
    const sideSlot = mainSlot ? null : deck.sideboard.find((c) => c.card.name === card.name);
    const slot = mainSlot ?? sideSlot;
    let allocated: string | null;
    if (slot) {
      allocated = slot.allocatedCopyId ?? null;
    } else {
      const allocations = buildAllocationMap(
        useDecksStore.getState().decks,
        useCubeStore.getState().saved
      );
      allocated =
        pickCollectionCopy(card.name, collectionCards, allocations, card.id)?.copyId ?? null;
    }
    recordEdit(deck.id, `make ${card.name} partner`, () => {
      if (slot) {
        if (mainSlot) removeCard(deck.id, slot.slotId);
        else removeSideboardCard(deck.id, slot.slotId);
      }
      setPartnerCommander(deck.id, card, allocated);
    });
    setShowPartnerPicker(false);
    pushToast({ message: `${card.name} is now the partner commander.`, tone: 'success' });
  };

  // Click-to-edit qty handler: diffs the desired count against the live
  // count and adds or removes slots in bulk. Bulk removes show ONE toast
  // for the whole batch with an Undo that restores every original
  // allocation — important for basics where the user might drop 8 copies
  // in a single edit.
  const handleSetQty = (card: ScryfallCard, qty: number) => {
    const current = deck.cards.filter((c) => c.card.name === card.name);
    const delta = qty - current.length;
    if (delta === 0) return;
    if (delta > 0) {
      // Quantity increments bind free owned copies; any beyond what's free are
      // added unbound (listed as "In [deck]"/"unowned"). Never pulls copies from
      // other decks — that's a conscious choice elsewhere. One in-deck undo entry.
      const label = delta === 1 ? `add ${card.name}` : `add ${delta} × ${card.name}`;
      recordEdit(deck.id, label, () => {
        // Reuse the live allocations between iterations so two adds don't try to
        // claim the same collection copy.
        const allocations = buildAllocationMap(
          useDecksStore.getState().decks,
          useCubeStore.getState().saved
        );
        for (let i = 0; i < delta; i++) {
          const claim = pickCollectionCopy(card.name, collectionCards, allocations, card.id);
          const allocatedId = claim?.copyId ?? null;
          if (allocatedId) {
            allocations.set(
              allocatedId,
              makeDeckAllocationInfo(deck.id, deck.name, deck.color, card.name)
            );
          }
          addCard(deck.id, card, allocatedId);
        }
      });
      return;
    }
    // delta < 0 → drop the most-recent N slots as one undo entry.
    const dropping = current.slice(delta); // last |delta| items
    recordEdit(
      deck.id,
      dropping.length === 1 ? `remove ${card.name}` : `remove ${dropping.length} × ${card.name}`,
      () => {
        for (const slot of [...dropping].reverse()) removeCard(deck.id, slot.slotId);
      }
    );
    pushToast({
      message:
        dropping.length === 1
          ? `Removed ${card.name}`
          : `Removed ${dropping.length} × ${card.name}`,
      tone: 'success',
      actionLabel: 'Undo',
      onAction: () => undoEdit(deck.id),
    });
  };

  const handleEditCard = (slotId: string, card: ScryfallCard) => {
    setEditingSlot({ slotId, card });
  };

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingSlot || !deck) return;
    const newCard = selection.card;
    const slotsForName = deck.cards.filter((c) => c.card.name === editingSlot.card.name);

    // If the chosen printing — or the chosen FINISH of it (a foil pick while
    // only the foil is committed) — is owned but every such copy is committed
    // elsewhere, don't silently bind a lesser copy or leave the slot unbound:
    // offer to pull the exact copy in from its donor (Move), or trade this
    // slot's current copy back to the donor (Swap). Nothing moves without the
    // explicit choice; the reallocation itself happens in
    // handleMovePrintingConfirm. findStealableCopy scopes its "a free copy
    // exists" bail-out to these preferences, so it returns null whenever the
    // normal binding below can satisfy the pick.
    const donor = findStealableCopy(
      newCard.name,
      collectionCards,
      decks,
      deck.id,
      newCard.id,
      savedCubes,
      selection.finish
    );
    const donorCopy = donor ? collectionCards.find((c) => c.copyId === donor.copyId) : undefined;
    // Only prompt when the pull delivers the printing the user picked — the
    // finder's fallback can surface a different-printing copy, but a deck
    // lists an unowned printing freely (no prompt, slot just goes unbound).
    if (donor && donorCopy?.scryfallId === newCard.id) {
      const editSlot = deck.cards.find((c) => c.slotId === editingSlot.slotId);
      // Swap needs a reciprocal owned copy this slot can hand back — and a
      // mainboard deck donor whose slot we can rewrite. A copy bound to a
      // printing other than the slot's own (a suboptimal binding) has no clean
      // ScryfallCard to send, so require the slot to hold its own printing.
      const displaced = editSlot?.allocatedCopyId
        ? collectionCards.find((c) => c.copyId === editSlot.allocatedCopyId)
        : undefined;
      const canSwap =
        donor.donorKind === 'deck' &&
        donor.donorZone === 'main' &&
        !!displaced &&
        displaced.scryfallId === editSlot!.card.id;
      // Name the finish in the prompt when the pulled copy is a premium one,
      // so "your foil <set> copy is in <deck>" reads as the reason for the ask.
      const finishPrefix =
        donorCopy.finish === 'foil' ? 'foil ' : donorCopy.finish === 'etched' ? 'etched ' : '';
      setMovePrompt({
        editSlotId: editingSlot.slotId,
        newCard,
        chosenSetName: `${finishPrefix}${newCard.set_name ?? newCard.set?.toUpperCase() ?? 'this'}`,
        donor,
        swap: canSwap
          ? {
              returnCopyId: displaced!.copyId,
              returnCard: editSlot!.card,
              returnSetName: editSlot!.card.set_name ?? displaced!.setCode,
            }
          : null,
      });
      setEditingSlot(null);
      return;
    }

    // Bind each rebound slot to a free owned copy of the NEW printing so picking
    // a printing you own actually sources it from your collection — previously
    // the swap always nulled the allocation, so an owned printing read as
    // unowned. Release these slots' own copies first, and pick greedily, so N
    // same-name slots don't double-claim one physical copy.
    const allocations = buildAllocationMap(decks, savedCubes);
    for (const slot of slotsForName) {
      if (slot.allocatedCopyId) allocations.delete(slot.allocatedCopyId);
    }
    const bindings = new Map<string, string | null>();
    for (const slot of slotsForName) {
      // The chosen finish rides along as a preference: owning both finishes of
      // the picked printing binds the one the user asked for (foil stays foil)
      // instead of the ranking's non-foil default.
      const copy = pickCollectionCopy(
        newCard.name,
        collectionCards,
        allocations,
        newCard.id,
        selection.finish
      );
      // pickCollectionCopy falls back to any free copy of the name; the slot now
      // shows newCard, so only keep a copy that is actually the chosen printing.
      if (copy && copy.scryfallId === newCard.id) {
        bindings.set(slot.slotId, copy.copyId);
        allocations.set(
          copy.copyId,
          makeDeckAllocationInfo(deck.id, deck.name, deck.color, newCard.name)
        );
      } else {
        bindings.set(slot.slotId, null);
      }
    }
    recordEdit(deck.id, `change printing of ${newCard.name}`, () => {
      for (const slot of slotsForName) {
        updateCardPrinting(deck.id, slot.slotId, newCard, bindings.get(slot.slotId) ?? null);
      }
    });
    setEditingSlot(null);
    pushToast({ message: `Updated printing for ${newCard.name}`, tone: 'success' });
  };

  // Commit the pending move/swap from the edit-printing picker. Both directions
  // reuse the shared reallocation engine (snapshot both decks + one Undo toast):
  // the recipient side sets the chosen printing on every same-name slot and binds
  // the pulled copy to the edited slot; the donor side either leaves a gap (Move)
  // or takes this slot's displaced copy in return (Swap).
  const handleMovePrintingConfirm = (mode: 'move' | 'swap'): void => {
    if (!deck || !movePrompt) return;
    const { editSlotId, newCard, donor, swap } = movePrompt;
    setMovePrompt(null);
    const fromCube = donor.donorKind === 'cube';
    executeReallocation({
      donorDeckId: donor.donorDeckId,
      donorCubeId: fromCube ? donor.donorId : undefined,
      recipientDeckId: deck.id,
      // Only the edited slot changes — bring the one pulled copy into it. Other
      // same-name slots keep their own printing and binding; a move relocates a
      // single physical copy, not the whole playset.
      recipientApply: () => updateCardPrinting(deck.id, editSlotId, newCard, donor.copyId),
      donorApply: () => {
        if (fromCube) {
          useCubeStore.getState().releaseCubePick(donor.donorId, donor.copyId);
        } else if (mode === 'swap' && swap) {
          // Hand our displaced copy back to the donor's mainboard slot so it stays
          // whole — its slot now shows (and holds) that printing.
          updateCardPrinting(
            donor.donorDeckId,
            donor.donorSlotId!,
            swap.returnCard,
            swap.returnCopyId
          );
        } else {
          applyDonorOutcome(
            donor.donorDeckId,
            donor.donorZone,
            donor.donorSlotId,
            donor.donorCard!,
            'leave-gap',
            null
          );
        }
      },
      label:
        mode === 'swap' && swap
          ? `Swapped ${newCard.name} with ${donor.donorDeckName}`
          : `Moved ${newCard.name} here from ${donor.donorDeckName}`,
    });
  };

  const displayCards: DeckDisplayCard[] = deck.cards.map((c) => ({
    slotId: c.slotId,
    card: c.card,
    allocatedCopyId: c.allocatedCopyId,
    addedAt: c.addedAt,
  }));

  const displaySideboard: DeckDisplayCard[] = deck.sideboard.map((c) => ({
    slotId: c.slotId,
    card: c.card,
    allocatedCopyId: c.allocatedCopyId,
    addedAt: c.addedAt,
  }));

  // Page-top hub tabs: Deck (card list) · Stats (mana + overview) · Power +
  // Tune. Stats always shows for every format.
  const hasCommanderFormat = !!formatConfig?.hasCommander;
  // Bracket is glanceable info — it rides the hero meta line now (the old
  // feature-strip chip is gone); the Tune view still owns the override UI.
  const bracketValue = effectiveBracket(deck);
  // Power + Tune are Commander-only: their analysis (bracket fit, EDHREC-driven
  // Improve, command-zone-aware stats) doesn't apply to 60-card formats, where
  // it read as misleading. Gate them to commander formats (E2/T19) — a commander
  // format still shows them before cards are added, for its early power signals.
  const showAnalysisExtras = hasCommanderFormat;
  // The Tune tab carries no count badge — a bare number there read as a
  // mystery (it was the in-deck combo count); the combo count is shown,
  // clearly labelled, on the "In deck" sub-tab of the embedded Combos panel.
  const viewTabs: Array<{ id: DeckView; label: string }> = [
    { id: 'deck', label: 'Deck' },
    { id: 'stats', label: 'Stats' },
    ...(showAnalysisExtras
      ? [
          { id: 'power' as DeckView, label: 'Power' },
          { id: 'tune' as DeckView, label: 'Coach' },
        ]
      : []),
  ];
  // Guard against a stale view that no longer has a tab. Map any legacy
  // analysis id that might still be in `view` from an earlier restructure, then
  // fall back to a real tab. (overview/mana → stats; improve → tune; the old
  // "power" id now maps to the real Power tab again.)
  const legacyViewMap: Record<string, DeckView> = {
    overview: 'stats',
    mana: 'stats',
    improve: 'tune',
  };
  const mappedView = legacyViewMap[view] ?? view;
  // Default the analysis surface to Stats: if the active view isn't a real tab,
  // prefer Stats over Deck so opening analysis lands somewhere useful.
  const safeView: DeckView = viewTabs.some((t) => t.id === mappedView)
    ? mappedView
    : viewTabs.some((t) => t.id === 'stats')
      ? 'stats'
      : 'deck';

  return (
    <div className="deck-editor-page">
      <BackLink to="/decks" label="All decks" />
      <header className="deck-editor-header">
        <div className="deck-editor-hero" style={{ borderLeftColor: deck.color }}>
          {/* Commander art rides behind the title as a right-anchored backdrop
              (≥600px; phones keep the plain hero — art behind full-width text
              costs legibility there). Decorative only. */}
          {heroArt && (
            <span className="deck-editor-hero-artwrap" aria-hidden="true">
              <img className="deck-editor-hero-art" src={heroArt} alt="" loading="lazy" />
              <span className="deck-editor-hero-art-fade" />
            </span>
          )}
          {renaming ? (
            <div
              className="deck-editor-hero-edit"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  handleCommitRename();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleCancelRename();
              }}
            >
              <input
                autoFocus
                type="text"
                className="deck-editor-name-input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommitRename();
                }}
                aria-label="Deck name"
              />
              <div className="deck-editor-hero-edit-color">
                <span className="deck-editor-hero-edit-label">Color</span>
                <ColorPicker
                  value={deck.color}
                  onChange={(hex) => updateDeck(deck.id, { color: hex })}
                  ariaLabel="Deck color"
                />
              </div>
              <button
                type="button"
                className="btn btn-primary deck-editor-hero-edit-done"
                onClick={handleCommitRename}
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="deck-editor-name binder-hero-name"
              onClick={handleStartRename}
              title="Edit deck name & color"
            >
              {deck.name}
            </button>
          )}
          {/* \u00A0 glues each label to its value ("Bracket 2", "100 cards") and
              each · to the segment before it, so the line only wraps between
              segments — never leaving an orphaned "2" or a line-leading "·". */}
          <p className="binder-hero-meta">
            {formatConfig && <span className="deck-format-badge">{formatConfig.label}</span>}
            {deck.commander && (
              <>
                {formatConfig ? '\u00A0· ' : ''}
                {deck.commander.name}
                {/* Read-only pairing summary; add/change/remove lives in the
                    deck grid's Commander section (see onEditPartner). */}
                {deck.partnerCommander && ` +\u00A0${deck.partnerCommander.name}`}
              </>
            )}
            {/* Desktop-only totals chip — hidden on tablet/mobile via
                .deck-hero-totals to keep the meta line short there. */}
            <span className="deck-hero-totals">
              {'\u00A0· '}
              {heroTotals.count}
              {'\u00A0'}
              {heroTotals.count === 1 ? 'card' : 'cards'}
              {'\u00A0· '}
              {formatMoney(heroTotals.value)}
              {heroTotals.sideboard > 0 && `\u00A0· +${heroTotals.sideboard}\u00A0maybe`}
            </span>
            {/* Bracket — glanceable on every view (it left the feature strip). */}
            {bracketValue != null && (
              <span className="deck-hero-bracket">{`\u00A0· Bracket\u00A0${bracketValue}`}</span>
            )}
          </p>
        </div>
        <div className="deck-editor-actions">
          <button
            type="button"
            className="btn deck-editor-action-btn deck-editor-icon-btn"
            onClick={() => undoEdit(deck.id)}
            disabled={!canUndoEdit}
            title={canUndoEdit ? `Undo: ${undoEditLabel} (Ctrl/Cmd+Z)` : 'Nothing to undo'}
            aria-label={canUndoEdit ? `Undo ${undoEditLabel}` : 'Nothing to undo'}
          >
            <Undo2 width={14} height={14} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="btn deck-editor-action-btn deck-editor-icon-btn"
            onClick={() => redoEdit(deck.id)}
            disabled={!canRedoEdit}
            title={canRedoEdit ? `Redo: ${redoEditLabel} (Ctrl/Cmd+Shift+Z)` : 'Nothing to redo'}
            aria-label={canRedoEdit ? `Redo ${redoEditLabel}` : 'Nothing to redo'}
          >
            <Redo2 width={14} height={14} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="btn deck-editor-action-btn"
            onClick={handleToggleAddPanel}
            aria-expanded={showAddPanel}
            title="Add cards (press / to focus search)"
          >
            {showAddPanel ? (
              <X width={14} height={14} strokeWidth={2} aria-hidden />
            ) : (
              <Plus width={14} height={14} strokeWidth={2} aria-hidden />
            )}
            {showAddPanel ? 'Hide cards panel' : 'Add cards'}
          </button>
          <button
            type="button"
            className="btn deck-editor-action-btn"
            onClick={() => navigate(`/decks/${deck.id}/playtest`)}
          >
            Playtest
          </button>
          {deckTokens.length > 0 && (
            <button
              type="button"
              className="btn deck-editor-action-btn"
              onClick={() => setTokensOpen(true)}
              title="Tokens this deck makes — prep them before you play"
            >
              <Coins width={14} height={14} strokeWidth={2} aria-hidden />
              Tokens
              <span className="deck-editor-action-badge">{deckTokens.length}</span>
            </button>
          )}
          {hasPullSlots && (
            <button
              type="button"
              className="btn deck-editor-action-btn"
              onClick={() => setPullListOpen(true)}
              title="Where every card lives — pull this deck from your binders"
            >
              <ListChecks width={14} height={14} strokeWidth={2} aria-hidden />
              Pull list
            </button>
          )}
          <button type="button" className="btn deck-editor-action-btn" onClick={handleDuplicate}>
            <Copy width={14} height={14} strokeWidth={2} aria-hidden />
            Duplicate
          </button>
          {/* Delete lives in the ⋮ overflow on ALL sizes (desktop included),
              per the STYLE_GUIDE ruling that destructive actions belong in
              the page kebab — not inline. UX-316. */}
          <DeckEditorOverflowMenu
            onDuplicate={handleDuplicate}
            onDelete={() => setConfirmDelete(true)}
            onExport={() => setExportOpen(true)}
            onFeedback={() => setFeedbackOpen(true)}
            onTokens={deckTokens.length > 0 ? () => setTokensOpen(true) : undefined}
            onPullList={hasPullSlots ? () => setPullListOpen(true) : undefined}
            onUndo={canUndoEdit ? () => undoEdit(deck.id) : undefined}
            onRedo={canRedoEdit ? () => redoEdit(deck.id) : undefined}
            undoLabel={undoEditLabel}
            redoLabel={redoEditLabel}
          />
        </div>
        <div className="deck-editor-mobile-actions">
          {/* Undo/redo aren't pills here — a bare icon gives no hint of *what*
              it'd undo. Quick undo is the contextual edit toast ("Removed X ·
              Undo"); multi-step undo/redo live in the ⋮ menu, labelled. */}
          <button
            type="button"
            className="pill-btn deck-editor-add-pill"
            onClick={handleToggleAddPanel}
            aria-expanded={showAddPanel}
            title="Add cards (press / to focus search)"
          >
            <Plus width={15} height={15} strokeWidth={2} aria-hidden />
            <span>Add cards</span>
          </button>
          <DeckEditorOverflowMenu
            onDuplicate={handleDuplicate}
            onDelete={() => setConfirmDelete(true)}
            onExport={() => setExportOpen(true)}
            onFeedback={() => setFeedbackOpen(true)}
            onPlaytest={() => navigate(`/decks/${deck.id}/playtest`)}
            onTokens={deckTokens.length > 0 ? () => setTokensOpen(true) : undefined}
            onPullList={hasPullSlots ? () => setPullListOpen(true) : undefined}
            onUndo={canUndoEdit ? () => undoEdit(deck.id) : undefined}
            onRedo={canRedoEdit ? () => redoEdit(deck.id) : undefined}
            undoLabel={undoEditLabel}
            redoLabel={redoEditLabel}
          />
        </div>
      </header>

      {/* Page-top distinct-view tabs (Deck · Stats · Power · Tune; Power/Tune
          appear only with analysis extras), mirroring the Collection hub. Sticky
          so it stays in reach as the active view scrolls. */}
      <div className="deck-editor-view-tabs" ref={viewScrollRef}>
        <Tabs
          ariaLabel="Deck views"
          variant="underline"
          value={safeView}
          onChange={setView}
          tabs={viewTabs.map((t) => ({
            id: t.id,
            label: t.label,
            controls: `deck-view-panel-${t.id}`,
          }))}
        />
      </div>

      <div className="deck-editor-layout">
        <main className="deck-editor-main">
          <DeckDisplay
            title={deck.name}
            deckId={deck.id}
            format={deck.format}
            color={deck.color}
            commander={deck.commander}
            partnerCommander={deck.partnerCommander}
            selectedThemes={deck.generationContext?.selectedThemes}
            commanderAllocatedCopyId={deck.commanderAllocatedCopyId}
            partnerCommanderAllocatedCopyId={deck.partnerCommanderAllocatedCopyId}
            cards={displayCards}
            sideboard={displaySideboard}
            onRemoveCard={handleRemoveCard}
            onRemoveSideboardCard={handleRemoveSideboardCard}
            onMoveToSideboard={handleMoveToSideboard}
            onMoveToMainboard={handleMoveToMainboard}
            onSetQty={handleSetQty}
            onEditCard={handleEditCard}
            onMakeCommander={formatConfig?.hasCommander ? handleMakeCommanderClick : undefined}
            canMakeCommander={
              formatConfig?.hasCommander
                ? deck.format === 'paupercommander'
                  ? isPdhCommanderEligible
                  : isValidCommander
                : undefined
            }
            onMakePartner={
              formatConfig?.hasCommander && deck.commander ? handleMakePartnerClick : undefined
            }
            canMakePartner={
              formatConfig?.hasCommander && deck.commander ? canMakePartner : undefined
            }
            onEditPartner={
              formatConfig?.hasCommander && deck.commander && canHavePartner(deck.commander)
                ? () => setShowPartnerPicker(true)
                : undefined
            }
            onMoveToAnotherDeck={decks.length > 1 ? setMoveCard : undefined}
            onReleaseCopy={setReleaseCard}
            onUseOwnCopy={handleUseOwnCopy}
            onReviewShared={() => setShowSharedCopies(true)}
            collectionByCopyId={collectionById}
            binderByCopyId={binderByCopyId}
            onAddFromSearch={(q) => {
              setShowAddPanel(true);
              window.requestAnimationFrame(() => searchPanelRef.current?.seed(q));
            }}
            roleCounts={deck.roleCounts}
            roleTargets={deck.roleTargets}
            buildReport={deck.buildReport}
            onAddSuggestedCard={handleAddEngineCard}
            addingSuggestedCardNames={addingEngineNames}
            oneAwayCombos={comboData.data?.oneAway}
            ownedOracleIds={ownedOracleIdSet}
            landUpgradeCount={landUpgrades.length}
            cardInclusionMap={deck.cardInclusionMap}
            rampSubtypeCounts={deck.rampSubtypeCounts}
            removalSubtypeCounts={deck.removalSubtypeCounts}
            boardwipeSubtypeCounts={deck.boardwipeSubtypeCounts}
            cardDrawSubtypeCounts={deck.cardDrawSubtypeCounts}
            bracketEstimation={deck.bracketEstimation}
            deckCardsByName={deckCardsByName}
            bracketOverride={deck.bracketOverride}
            onSetBracketOverride={(b) => updateDeck(deck.id, { bracketOverride: b })}
            deckGrade={deck.deckGrade}
            planScore={deck.planScore}
            averageSalt={deck.averageSalt}
            saltiestCards={deck.saltiestCards}
            exportOpen={exportOpen}
            onExportOpenChange={setExportOpen}
            activeView={safeView}
            onShowTestHand={() => setShowTestHand(true)}
            analysisState={analysisState}
            scoreRevealKey={scoreRevealKey}
            onNavigateToTune={
              // Only wire the deep-link when analysis has run — until then the
              // Tune lanes don't exist yet, so a deep-link would land on nothing.
              analysisState === 'ready' ? handleNavigateToTune : undefined
            }
            renderSwapSuggestions={renderSwapSuggestions}
            renderSimilarCards={renderSimilarCards}
            powerHeroSlot={
              formatConfig?.hasCommander ? (
                <PowerHero
                  bracket={effectiveBracket(deck) ?? null}
                  bracketOverridden={deck.bracketOverride != null}
                  revealKey={scoreRevealKey}
                  bracketReasons={(deck.bracketEstimation?.hardFloors ?? []).map((f) => f.reason)}
                  engineLabel={deck.synergyAnalysis?.axes[0]?.label}
                  engineProducers={deck.synergyAnalysis?.axes[0]?.producers}
                  enginePayoffs={deck.synergyAnalysis?.axes[0]?.payoffs}
                  engineLopsided={(deck.synergyAnalysis?.warnings.length ?? 0) > 0}
                  comboInDeck={comboData.data?.inDeck.length ?? 0}
                  comboOwnedMissing={comboOwnedMissingCount}
                  combosLoading={!!formatConfig?.hasCommander && comboData.loading}
                  // Link a pillar to its panel only when that panel actually renders below.
                  onViewBracket={
                    deck.bracketEstimation || deck.bracketOverride != null
                      ? handleViewBracket
                      : undefined
                  }
                  onViewEngine={
                    deck.synergyAnalysis &&
                    (deck.synergyAnalysis.warnings.length > 0 ||
                      deck.synergyAnalysis.axes.length > 0)
                      ? handleViewEngine
                      : undefined
                  }
                  onViewCombos={handleViewCombos}
                  winConditionSummary={buildWinConditionSummary(deck.winConditions)}
                  winConditionWarn={deck.winConditions?.noClearWinCondition}
                  onViewWinConditions={deck.winConditions ? handleViewWinConditions : undefined}
                  // UX-313: target bracket control in the PowerHero
                  bracketOverride={deck.bracketOverride}
                  onSetBracketOverride={(b) => updateDeck(deck.id, { bracketOverride: b })}
                />
              ) : undefined
            }
            tableRecordSlot={<TableRecordPanel deckId={deck.id} />}
            combosSlot={
              formatConfig?.hasCommander ? (
                <DeckCombosPanel
                  ref={combosRef}
                  embedded
                  deckId={deck.id}
                  deckOracleIds={deckOracleIds}
                  format={deck.format}
                  onAdd={(card, allocatedCopyId) => addCard(deck.id, card, allocatedCopyId)}
                />
              ) : undefined
            }
            coachFeedSlot={
              formatConfig?.hasCommander ? (
                <CoachFeed
                  gaps={deck.gapAnalysis ?? []}
                  optimize={deck.optimizeSwaps}
                  synergy={deck.synergyAnalysis?.suggestions ?? []}
                  substitutes={substitutionPlan?.rows ?? []}
                  costPlan={effectiveCostPlan ?? undefined}
                  bracketFit={deck.bracketFit ?? undefined}
                  landUpgrades={landUpgrades}
                  oneAwayCombos={comboData.data?.oneAway}
                  planScore={deck.planScore}
                  roleCounts={deck.roleCounts ?? {}}
                  roleTargets={deck.roleTargets ?? {}}
                  deckSize={
                    deck.cards.length + (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0)
                  }
                  deckTarget={DECK_FORMAT_CONFIGS[deck.format].deckSize}
                  bracketOverridePresent={deck.bracketOverride != null}
                  resolveOwnership={ownershipFor}
                  ownedNames={ownedNames}
                  deckNames={deckCardNames}
                  onApplyMove={handleApplyCoachMove}
                  onApplyAllDropIns={handleApplyCostSwaps}
                  onConvergeBracket={(swaps) => handleApplyCostSwaps(swaps, 'bracket')}
                  onPreviewFit={(change) => void handleCoachPreviewFit(change)}
                  initialFilter={tuneFocusLane ?? undefined}
                  onFilterHandled={clearTuneFocus}
                  analysisState={analysisState}
                  commanderName={deck.commander?.name}
                  busyNames={
                    bracketFitSwapName
                      ? new Set([...addingEngineNames, bracketFitSwapName])
                      : addingEngineNames
                  }
                  browser={
                    <DeckAnalysisPanel
                      embedded
                      deckId={deck.id}
                      format={deck.format}
                      commander={deck.commander}
                      partnerCommander={deck.partnerCommander}
                      mainboard={deck.cards.map((c) => ({ slotId: c.slotId, card: c.card }))}
                      onAdd={(card, allocatedCopyId) => addCard(deck.id, card, allocatedCopyId)}
                    />
                  }
                  ownedOnly={ownedOnly}
                  onOwnedOnlyChange={handleOwnedOnlyChange}
                  nextBestMoves={nextBestMoves}
                  combosLoading={!!formatConfig?.hasCommander && comboData.loading}
                  onNbmNavigate={handleNbmNavigate}
                  onNbmApply={handleAddEngineCard}
                />
              ) : undefined
            }
            engineSlot={
              formatConfig?.hasCommander &&
              deck.synergyAnalysis &&
              (deck.synergyAnalysis.warnings.length > 0 || deck.synergyAnalysis.axes.length > 0) ? (
                // Power tab keeps only the axis-balance diagnostics; the off-meta
                // picks live in the Tune Improve engine (synergy source).
                <EnginePanel
                  analysis={deck.synergyAnalysis}
                  onAdd={handleAddEngineCard}
                  showSuggestions={false}
                  axisSummaries={axisSummaries}
                  allCards={deckCards}
                />
              ) : undefined
            }
            winConditionSlot={
              formatConfig?.hasCommander && deck.winConditions ? (
                <WinConditionPanel analysis={deck.winConditions} libraryNames={deckLibraryNames} />
              ) : undefined
            }
          />
        </main>
      </div>

      {/* Test hand — a breakpoint-aware overlay (bottom sheet on mobile,
          centered modal ≥1024px) via the shared card-picker sheet. Goldfishing
          is a distinct activity, opened on demand from the Deck-view toolbar so
          it's never pinned inline or in a tab. */}
      {showTestHand && (
        <DeckEditorCardPickerSheet
          label="Test hand"
          className="deck-test-hand-sheet"
          onClose={() => setShowTestHand(false)}
        >
          {(dismiss) => (
            <>
              <div className="card-picker-handle" aria-hidden />
              <div className="deck-test-hand-sheet-header">
                <h2 className="deck-test-hand-sheet-title">Test hand</h2>
                <button
                  type="button"
                  className="deck-test-hand-sheet-close"
                  onClick={dismiss}
                  aria-label="Close test hand"
                >
                  <X width={18} height={18} strokeWidth={2} aria-hidden />
                </button>
              </div>
              <div className="deck-test-hand-sheet-body">
                <DeckTestHandPanel embedded deckId={deck.id} />
              </div>
            </>
          )}
        </DeckEditorCardPickerSheet>
      )}

      {/* Add cards on a Commander deck with no commander yet: card suggestions
          and color-identity filtering both key off the commander, so we can't
          meaningfully add to the mainboard. Show an interstitial that points at
          the commander picker instead of silently no-opping. */}
      {showAddPanel && formatConfig?.hasCommander && !deck.commander && (
        <DeckEditorCardPickerSheet
          label="Pick a commander first"
          className="deck-add-needs-commander"
          onClose={() => setShowAddPanel(false)}
        >
          {(dismiss) => (
            <>
              <div className="card-picker-handle" aria-hidden />
              <div className="deck-add-needs-commander-body">
                <p className="deck-add-needs-commander-title">Pick a commander first</p>
                <p className="deck-add-needs-commander-hint">
                  This is a Commander deck. Choose a commander before adding cards so suggestions
                  and color identity stay in sync.
                </p>
                <div className="deck-add-needs-commander-actions">
                  <button type="button" className="btn" onClick={dismiss}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setShowAddPanel(false);
                      openView('deck');
                    }}
                  >
                    Choose commander
                  </button>
                </div>
              </div>
            </>
          )}
        </DeckEditorCardPickerSheet>
      )}

      {/* Add cards — a breakpoint-aware overlay (bottom sheet on
          mobile, centered modal ≥1024px) via the shared card-picker
          sheet, instead of an inline rail. */}
      {showAddPanel && (formatConfig?.hasCommander ? deck.commander : true) && (
        <DeckEditorCardPickerSheet
          label="Add cards"
          className="deck-add-sheet"
          onClose={() => setShowAddPanel(false)}
        >
          {(dismiss) => (
            <>
              <div className="card-picker-handle" aria-hidden />
              {formatConfig && formatConfig.sideboardSize > 0 && (
                <div className="deck-editor-zone-toggle">
                  <button
                    type="button"
                    className={`btn btn-sm${addZone === 'main' ? ' btn-primary' : ''}`}
                    onClick={() => setAddZone('main')}
                  >
                    Mainboard
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm${addZone === 'side' ? ' btn-primary' : ''}`}
                    onClick={() => setAddZone('side')}
                  >
                    Sideboard
                  </button>
                </div>
              )}
              <CardSearchPanel
                ref={searchPanelRef}
                deckId={deck.id}
                commanderColorIdentity={commanderColorIdentity}
                existingCardCounts={existingCardCounts}
                onAdd={({ card }) => {
                  if (addZone === 'side') {
                    // allocateAndAdd resolves the copy itself (free / auto-move /
                    // proxy) — the panel's own pick only ever sees free copies, so
                    // routing through it is what makes "add an owned card whose copy
                    // is in another deck" Just Work instead of silently proxying.
                    allocateAndAdd(card, 'sideboard', false);
                    return;
                  }
                  // A full Commander deck would overfill — open the intelligent
                  // replace-when-full prompt instead of silently going to 101.
                  if (deckIsFull) {
                    setShowAddPanel(false);
                    setPendingAdd(card.name);
                    return;
                  }
                  allocateAndAdd(card, 'main', false);
                }}
                onPreviewFit={(card) => setAuditionCard(card)}
                onClose={dismiss}
                suggestions={deck.gapAnalysis}
                oneAwayCombos={comboData.data?.oneAway}
                ownershipFor={ownershipFor}
                enableSuggestions={!!formatConfig?.hasCommander}
                suggestionsPending={analysisState === 'pending'}
              />
            </>
          )}
        </DeckEditorCardPickerSheet>
      )}

      {auditionCard && auditionReport && deck && (
        <CardFitPanel
          addCard={auditionCard}
          report={auditionReport}
          commanderName={deck.commander?.name}
          busySlotId={swappingSlot}
          pinnedCutName={auditionPinnedCutName ?? undefined}
          onSwapCut={(cut) =>
            void handleSwapInDeck(cut.slotId, cut.card.name, auditionCard.name, () => {
              setAuditionCard(null);
              setAuditionPinnedCutName(null);
            })
          }
          onAddAnyway={() => {
            const name = auditionCard.name;
            setAuditionCard(null);
            setAuditionPinnedCutName(null);
            void handleAddEngineCard(name);
          }}
          onClose={() => {
            setAuditionCard(null);
            setAuditionPinnedCutName(null);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete deck"
          body={`Delete "${deck.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {tokensOpen && <DeckTokensSheet tokens={deckTokens} onClose={() => setTokensOpen(false)} />}
      {pullListOpen && (
        <PullListSheet
          deck={deck}
          collection={collectionCards}
          binderDefs={binderDefs}
          allocations={printingAllocationMap}
          onClose={() => setPullListOpen(false)}
        />
      )}

      {editingSlot && (
        <CardEditDialog
          cardName={editingSlot.card.name}
          currentScryfallId={editingSlot.card.id}
          // The slot's real finish is whatever physical copy it's bound to —
          // an unbound slot has no finish, so it reads as non-foil.
          currentFinish={(() => {
            const copyId = deck.cards.find((c) => c.slotId === editingSlot.slotId)?.allocatedCopyId;
            return (copyId && collectionById?.get(copyId)?.finish) || 'nonfoil';
          })()}
          resolveAvailability={resolveAvailability}
          resolveOwnedFinishes={resolveOwnedFinishes}
          onConfirm={handleEditConfirm}
          onCancel={() => setEditingSlot(null)}
        />
      )}

      {movePrompt && (
        <MovePrintingPrompt
          cardName={movePrompt.newCard.name}
          chosenSetName={movePrompt.chosenSetName}
          donorName={movePrompt.donor.donorDeckName}
          donorKind={movePrompt.donor.donorKind}
          swap={movePrompt.swap ? { returnSetName: movePrompt.swap.returnSetName } : null}
          onMove={() => handleMovePrintingConfirm('move')}
          onSwap={() => handleMovePrintingConfirm('swap')}
          onCancel={() => setMovePrompt(null)}
        />
      )}

      {makeCommanderTarget && deck.commander && (
        <Modal onClose={() => setMakeCommanderTarget(null)} labelledBy="make-commander-title">
          <h2 id="make-commander-title" className="choice-dialog-title">
            Make {makeCommanderTarget.card.name} the commander?
          </h2>
          <p className="choice-dialog-body">
            <strong>{deck.commander.name}</strong> is currently the commander. What should happen to
            it?
          </p>
          <div className="choice-dialog-actions">
            <button type="button" className="btn" onClick={() => setMakeCommanderTarget(null)}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={() => handleConfirmMakeCommander(false)}>
              Remove from deck
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleConfirmMakeCommander(true)}
              autoFocus
            >
              Keep in deck
            </button>
          </div>
        </Modal>
      )}

      {makePartnerTarget && deck.partnerCommander && (
        <Modal onClose={() => setMakePartnerTarget(null)} labelledBy="make-partner-title">
          <h2 id="make-partner-title" className="choice-dialog-title">
            Make {makePartnerTarget.card.name} the partner commander?
          </h2>
          <p className="choice-dialog-body">
            <strong>{deck.partnerCommander.name}</strong> is currently the partner. What should
            happen to it?
          </p>
          <div className="choice-dialog-actions">
            <button type="button" className="btn" onClick={() => setMakePartnerTarget(null)}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={() => handleConfirmMakePartner(false)}>
              Remove from deck
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleConfirmMakePartner(true)}
              autoFocus
            >
              Keep in deck
            </button>
          </div>
        </Modal>
      )}

      {showPartnerPicker && deck.commander && (
        <Modal onClose={() => setShowPartnerPicker(false)} labelledBy="partner-picker-title">
          <h2 id="partner-picker-title" className="choice-dialog-title">
            Partner commander
          </h2>
          {/* collectionMode={false}: the editor isn't constrained to owned
              cards, so the picker lists every legal partner and the build does
              the allocation when one is chosen. */}
          <PartnerCommanderSelector
            commander={deck.commander}
            partner={deck.partnerCommander}
            onSelect={handleSelectPartnerFromPicker}
            collectionMode={false}
          />
        </Modal>
      )}

      {/* Deck-size guard: replace-when-full (adding to a full Commander deck). */}
      {pendingAdd && replaceOptions && deck && (
        <DeckSizePrompt
          title={`Deck is full (${deck.cards.length}/${mainboardLimit})`}
          subtitle={
            replaceOptions.anyRelated
              ? `Replace a card with ${pendingAdd}?`
              : `Make room for ${pendingAdd} — cut a weak card?`
          }
          actionVerb="Replace"
          options={replaceOptions.suggested}
          moreOptions={replaceOptions.all}
          footer={[
            { label: 'Add to sideboard', onClick: () => void addToSideboardAndClose() },
            { label: 'Add anyway', onClick: () => void addAnywayAndClose() },
            { label: 'Cancel', onClick: () => setPendingAdd(null), primary: true },
          ]}
          onClose={() => setPendingAdd(null)}
        />
      )}

      {/* Deck-size guard: refill nudge (a cut dropped a full deck below 100). */}
      {refillAfterCut && deck && (
        <DeckSizePrompt
          title={`Cut ${refillAfterCut.name}`}
          subtitle="Add a replacement to keep your deck at its limit?"
          actionVerb="Add"
          options={refillOptions}
          footer={[{ label: 'Leave it', onClick: () => setRefillAfterCut(null), primary: true }]}
          onClose={() => setRefillAfterCut(null)}
        />
      )}

      {/* Physical-copy reallocation — move owned cards between decks. */}
      {moveCard && deck && (
        <MoveToDeckSheet
          card={moveCard}
          currentDeck={deck}
          collectionCards={collectionCards}
          ownershipFor={ownershipFor}
          freeCountFor={freeCountFor}
          onConfirm={(targetId, outcome, replacement) =>
            handleMoveConfirm(moveCard, targetId, outcome, replacement)
          }
          onCancel={() => setMoveCard(null)}
        />
      )}

      {releaseCard && deck && (
        <ConfirmDialog
          title={`Release your copy of ${releaseCard.name}?`}
          body={`The copy frees up for another deck or trade. ${releaseCard.name} stays in this deck as a card you still need.`}
          confirmLabel="Release copy"
          onConfirm={handleReleaseConfirm}
          onCancel={() => setReleaseCard(null)}
        />
      )}

      {feedbackOpen && deck && (
        <DeckFeedbackSheet deck={deck} onClose={() => setFeedbackOpen(false)} />
      )}

      {showSharedCopies && deck && (
        <SharedCopiesSheet
          deckName={deck.name}
          contested={listContestedCards(deck, collectionCards, decks, savedCubes)}
          onMove={handleMoveSharedCopy}
          onClose={() => setShowSharedCopies(false)}
        />
      )}

      {/* One-shot post-generation build report sheet (UX-316).
          Shown once per deck immediately after generation; never again. */}
      {showBuildReport && deck?.buildReport && (
        <BuildReportSheet
          deckId={deck.id}
          commanderName={deck.commander?.name}
          commanderImageUrl={
            deck.commander?.image_uris?.art_crop ??
            deck.commander?.card_faces?.[0]?.image_uris?.art_crop
          }
          report={deck.buildReport}
          oneAwayCombos={comboData.data?.oneAway}
          ownedOracleIds={ownedOracleIdSet}
          onClose={() => setShowBuildReport(false)}
          onReviewConflicts={() => {
            setShowBuildReport(false);
            setShowSharedCopies(true);
          }}
        />
      )}

      {/* Suppress unused-import lint */}
      <span hidden>{updateDeck.name}</span>
    </div>
  );
}

function DeckEditorCardPickerSheet({
  label,
  className,
  onClose,
  children,
}: {
  label: string;
  className: string;
  onClose: () => void;
  children: (dismiss: () => void) => ReactNode;
}) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  return (
    <div
      className="card-picker-root"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        dismiss();
      }}
    >
      <div
        className={`card-picker-sheet ${className}${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onAnimationEnd}
      >
        {children(dismiss)}
      </div>
    </div>
  );
}

function DeckEditorOverflowMenu({
  onDuplicate,
  onDelete,
  onExport,
  onFeedback,
  onPlaytest,
  onTokens,
  onPullList,
  onUndo,
  onRedo,
  undoLabel,
  redoLabel,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
  /** Opens the Feedback Tool sheet (mint link + review responses). */
  onFeedback: () => void;
  onPlaytest?: () => void;
  /** Present only when the deck makes tokens. */
  onTokens?: () => void;
  /** Present only when the deck has cards to pull. */
  onPullList?: () => void;
  /** Present only when there's an edit to undo; carries the action label. */
  onUndo?: () => void;
  /** Present only when there's an edit to redo; carries the action label. */
  onRedo?: () => void;
  undoLabel?: string | null;
  redoLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="deck-editor-overflow" ref={wrapperRef}>
      <button
        type="button"
        className="deck-editor-overflow-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Deck actions"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical width={20} height={20} strokeWidth={2.2} aria-hidden />
      </button>
      {open && (
        <>
          <div className="deck-editor-overflow-panel" role="menu">
            {onUndo && (
              <button
                type="button"
                role="menuitem"
                className="deck-editor-overflow-item"
                onClick={() => {
                  setOpen(false);
                  onUndo();
                }}
              >
                Undo{undoLabel ? ` ${undoLabel}` : ''}
              </button>
            )}
            {onRedo && (
              <button
                type="button"
                role="menuitem"
                className="deck-editor-overflow-item"
                onClick={() => {
                  setOpen(false);
                  onRedo();
                }}
              >
                Redo{redoLabel ? ` ${redoLabel}` : ''}
              </button>
            )}
            {(onUndo || onRedo) && (
              <div className="deck-editor-overflow-divider" role="separator" aria-hidden />
            )}
            {onPlaytest && (
              <button
                type="button"
                role="menuitem"
                className="deck-editor-overflow-item"
                onClick={() => {
                  setOpen(false);
                  onPlaytest();
                }}
              >
                Playtest
              </button>
            )}
            {onTokens && (
              <button
                type="button"
                role="menuitem"
                className="deck-editor-overflow-item"
                onClick={() => {
                  setOpen(false);
                  onTokens();
                }}
              >
                Tokens to prep
              </button>
            )}
            {onPullList && (
              <button
                type="button"
                role="menuitem"
                className="deck-editor-overflow-item"
                onClick={() => {
                  setOpen(false);
                  onPullList();
                }}
              >
                Pull list
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="deck-editor-overflow-item"
              onClick={() => {
                setOpen(false);
                onDuplicate();
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              role="menuitem"
              className="deck-editor-overflow-item"
              onClick={() => {
                setOpen(false);
                onExport();
              }}
            >
              Export
            </button>
            <button
              type="button"
              role="menuitem"
              className="deck-editor-overflow-item"
              onClick={() => {
                setOpen(false);
                onFeedback();
              }}
            >
              Get feedback
            </button>
            <button
              type="button"
              role="menuitem"
              className="deck-editor-overflow-item deck-editor-overflow-item--danger"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
