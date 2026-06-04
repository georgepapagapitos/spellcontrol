import { Copy, MoreVertical, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link, Navigate } from 'react-router-dom';
import { useDecksStore, effectiveBracket } from '../store/decks';
import { useCollectionStore } from '../store/collection';
import {
  DeckDisplay,
  type DeckDisplayCard,
  type AnalysisTabId,
  type DeckView,
} from '../components/deck/DeckDisplay';
import { Tabs } from '../components/Tabs';
import { materializeBinders } from '../lib/materialize';
import type { BinderInfo } from '../components/BinderBadge';
import { CardSearchPanel, type CardSearchPanelHandle } from '../components/deck/CardSearchPanel';
import { DeckCombosPanel, type DeckCombosPanelHandle } from '../components/deck/DeckCombosPanel';
import { DeckAnalysisPanel } from '../components/deck/DeckAnalysisPanel';
import { DeckTestHandPanel } from '../components/deck/DeckTestHandPanel';
import { NextBestMove } from '../components/deck/NextBestMove';
import { PowerHero } from '../components/deck/PowerHero';
import { ImproveLane } from '../components/deck/ImproveLane';
import { DeckSizePrompt, type SizePromptOption } from '../components/deck/DeckSizePrompt';
import { CostPanel } from '../components/deck/CostPanel';
import { BracketFitLane } from '../components/deck/BracketFitLane';
import { EnginePanel } from '../components/deck/EnginePanel';
import { WinConditionPanel } from '../components/deck/WinConditionPanel';
import {
  buildSubstitutionPlan,
  type SubstituteCandidate,
} from '@/deck-builder/services/deckBuilder/substituteFinder';
import {
  buildNextBestMoves,
  type NextBestMoveFocus,
} from '@/deck-builder/services/deckBuilder/nextBestMove';
import { fromGapCard, sortOwnedFirst, type LaneId, type ChangeOwnership } from '@/lib/deck-change';
import { SwapThisCard } from '../components/deck/SwapThisCard';
import { SimilarCardsStrip } from '../components/deck/SimilarCardsStrip';
import { classifyCandidate } from '../lib/deck-analysis';
import { loadTaggerData, hasTaggerData } from '@/deck-builder/services/tagger/client';
import { computeRoleCounts } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { useDeckCombos } from '../lib/use-deck-combos';
import { useCommanderBracketAnalysis } from '../lib/use-commander-bracket-analysis';
import { CardEditDialog, type PrintingSelection } from '../components/CardEditDialog';
import { buildAllocationMap, pickCollectionCopy, useCollectionByCopyId } from '../lib/allocations';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BackLink } from '../components/BackLink';
import { ColorPicker } from '../components/ColorPicker';
import { Modal } from '../components/Modal';
import { isValidCommander } from '../lib/commanders';
import { areValidPartners, canHavePartner } from '@/deck-builder/lib/partnerUtils';
import { PartnerCommanderSelector } from '../components/deck/PartnerCommanderSelector';
import { useToastsStore } from '../store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { getCardPrice, getCardByName } from '../deck-builder/services/scryfall/client';
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

export function DeckEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
  const collectionCards = useCollectionStore((s) => s.cards);
  const binderDefs = useCollectionStore((s) => s.binders);
  const updateCardPrinting = useDecksStore((s) => s.updateCardPrinting);
  const pushToast = useToastsStore((s) => s.push);

  const collectionById = useCollectionByCopyId();
  const [editingSlot, setEditingSlot] = useState<{ slotId: string; card: ScryfallCard } | null>(
    null
  );
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
  // Hoisted so the mobile action sheet can open Export without rendering
  // a duplicate button. Passed to DeckDisplay as a controlled prop pair.
  const [exportOpen, setExportOpen] = useState(false);
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
  const [applyingCost, setApplyingCost] = useState(false);
  const [addingEngineNames, setAddingEngineNames] = useState<Set<string>>(new Set());
  // Deck-size guard prompts: a pending full-deck add awaiting a replace choice,
  // and a post-cut refill nudge (the card just cut + its role).
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [refillAfterCut, setRefillAfterCut] = useState<{
    name: string;
    role: string | null;
  } | null>(null);
  // In-context "Swap this card" — its OWN loading gate (not addingEngineNames),
  // so a swap-in-flight never cross-disables the Engine/Substitution Add buttons.
  const [swappingSlot, setSwappingSlot] = useState<string | null>(null);
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

  // The Combos panel lives inside the Power bento; switching to Power lands on
  // the top of the bento, not the panel. A next-best-move with focus 'combos'
  // (the "Complete a combo" suggestion) reveals + scrolls the panel and opens
  // its one-away tab. The panel only mounts once Power is active, so reveal on
  // the next frame, after the view switch has committed.
  const combosRef = useRef<DeckCombosPanelHandle>(null);
  // A hero move that deep-links into a Tune lane sets this; DeckDisplay expands +
  // scrolls the matching lane, then clears it (one-shot) via onTuneFocusHandled.
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

  const ownedOracleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of collectionCards) if (c.oracleId) ids.add(c.oracleId);
    return Array.from(ids);
  }, [collectionCards]);

  // Owned card names — lets the gap-analysis suggestions flag cards the user
  // already has in their collection.
  const ownedNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of collectionCards) names.add(c.name);
    return names;
  }, [collectionCards]);

  // Allocation-aware ownership for a card name (mirrors DeckAnalysisPanel) so
  // every Tune surface agrees: 'owned' = a free/unallocated copy (or one already
  // in THIS deck) exists; 'in-other-deck' = every copy is claimed by other decks;
  // else 'unowned'. Re-derived live — never the persisted isOwned snapshot. This
  // matters because pickCollectionCopy only claims FREE copies, so a card whose
  // copies are all elsewhere can't actually be added tonight.
  const ownershipByName = useMemo(() => {
    const allocations = buildAllocationMap(decks);
    const byName = new Map<string, { free: number; claimed: number }>();
    for (const copy of collectionCards) {
      if (!copy.name) continue;
      const key = copy.name.toLowerCase();
      const e = byName.get(key) ?? { free: 0, claimed: 0 };
      const claim = allocations.get(copy.copyId);
      if (!claim || claim.deckId === deck?.id) e.free += 1;
      else e.claimed += 1;
      byName.set(key, e);
    }
    return byName;
  }, [collectionCards, decks, deck?.id]);

  const ownershipFor = useCallback(
    (name: string): ChangeOwnership => {
      const e = ownershipByName.get(name.toLowerCase());
      if (!e) return 'unowned';
      if (e.free > 0) return 'owned';
      if (e.claimed > 0) return 'in-other-deck';
      return 'unowned';
    },
    [ownershipByName]
  );

  // Free (unallocated) owned copies of a card name — drives the "N free" badge on
  // similar-card suggestions. Mirrors `ownershipFor` over the same live map.
  const freeCountFor = useCallback(
    (name: string): number => ownershipByName.get(name.toLowerCase())?.free ?? 0,
    [ownershipByName]
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
    combosRef.current?.reveal(comboData.data?.almostInCollection.length ? 'oneAway' : 'inDeck');
  }, [comboData.data?.almostInCollection.length]);

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
      cardCount: deck.cards.length,
      deckTarget: DECK_FORMAT_CONFIGS[deck.format].mainboardSize,
      oneAwayCombos: comboData.data?.oneAway,
      ownedNames,
      winConditions: deck.winConditions,
    });
  }, [deck, comboData.data, ownedNames]);

  // Which Tune lane to expand on first paint — the one the verdict hero points
  // at (hero-pointed-expand). Falls back to Fill the gaps when the top move
  // routes elsewhere (Deck/Stats/Power).
  const tuneDefaultLane = useMemo<LaneId>(() => {
    const lanes: readonly LaneId[] = ['fill-gaps', 'upgrade', 'budget', 'collection'];
    const hit = nextBestMoves.find(
      (m): m is typeof m & { focus: LaneId } =>
        m.focus != null && (lanes as readonly string[]).includes(m.focus)
    );
    return hit?.focus ?? 'fill-gaps';
  }, [nextBestMoves]);

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
    }));
    const deckNames = new Set(deck.cards.map((c) => c.card.name));
    const inclusionByName = new Map<string, number>(Object.entries(deck.cardInclusionMap ?? {}));
    return buildSubstitutionPlan(missingStaples, ownedPool, deckNames, commanderColorIdentity, {
      inclusionByName,
    });
  }, [deck, ownedNames, collectionCards, commanderColorIdentity]);

  // `/` opens the search panel; `c` reveals the combos panel (the panel is
  // always rendered in the aside; `c` just expands + scrolls + focuses it).
  // Skipped while the user is typing into another input/textarea so the keys
  // still type literally inside a rename/search box.
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
        openAnalysisTab('tune'); // Combos live under the Tune tab.
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        openAnalysisTab('tune'); // Suggestions live under the Tune tab.
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openAnalysisTab]);

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

  // Hero totals — mirrors the values surfaced in the Statistics panel
  // header so the desktop hero reads as a quick at-a-glance summary
  // before the user scrolls into the deck composition. Sideboard counts
  // toward the totals; commanders are added on top since they're not
  // part of `deck.cards`. Computed BEFORE the missing-deck early
  // return so the hook order stays stable across renders.
  const heroTotals = useMemo(() => {
    if (!deck) return { count: 0, value: 0 };
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
    const sideCards = deck.sideboard.map((c) => c.card);
    const allCards = [...commanders, ...mainCards, ...sideCards];
    return { count: allCards.length, value: sumPrice(allCards) };
  }, [deck]);

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
    removeCard(deck.id, slotId);
    pushToast({
      message: `Removed ${slot.card.name}`,
      tone: 'info',
      actionLabel: 'Undo',
      onAction: () => addCard(deck.id, slot.card, slot.allocatedCopyId),
    });
  };

  // Apply an Optimize plan: cut the selected removals (by name → slot) and add
  // the selected additions (resolved from Scryfall + allocated against the
  // collection). Removals run first so the freed copies can be reallocated.
  // Raw add: resolve name → full card, claim a free collection copy if any, add
  // to the mainboard (or sideboard). The size-aware `handleAddEngineCard` and the
  // deck-size prompt's actions (replace / sideboard / add-anyway) all route here.
  const addResolvedCard = async (cardName: string, zone: 'main' | 'sideboard' = 'main') => {
    if (!deck) return;
    setAddingEngineNames((prev) => new Set(prev).add(cardName));
    try {
      const scry = await getCardByName(cardName);
      if (!scry) return;
      const allocations = buildAllocationMap(useDecksStore.getState().decks);
      const claim = pickCollectionCopy(cardName, collectionCards, allocations, scry.id);
      if (zone === 'sideboard') {
        addSideboardCard(deck.id, scry, claim?.copyId ?? null);
        pushToast({ message: `Added ${cardName} to sideboard`, tone: 'success' });
      } else {
        addCard(deck.id, scry, claim?.copyId ?? null);
        pushToast({ message: `Added ${cardName}`, tone: 'success' });
      }
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
    removeCard(deck.id, slotId);
    pushToast({ message: `Cut ${cardName}`, tone: 'success' });
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
    removeCard(deck.id, cutSlotId);
    await addResolvedCard(name);
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

  // Replace-when-full options: cards to cut, suggested role-matched first (same
  // role as the card being added → keeps the curve balanced), then the
  // optimizer's weak/excess removals; `all` is every deck card for "pick another".
  // Plain consts (not hooks) — computed below the early-return guard, only
  // meaningful while a prompt is open.
  const replaceOptions =
    !pendingAdd || !deck
      ? null
      : (() => {
          const newRole = classifyCandidate(pendingAdd);
          const labelFor = (name: string): string | undefined => {
            const r = classifyCandidate(name);
            return r ? ROLE_LABEL[r] : undefined;
          };
          const toOpt = (
            c: { slotId: string; card: ScryfallCard },
            hint?: string
          ): SizePromptOption => ({
            key: c.slotId,
            name: c.card.name,
            roleLabel: labelFor(c.card.name),
            hint,
            onPick: () => void handleReplaceWhenFull(c.slotId),
          });
          const roleMatched = newRole
            ? deck.cards.filter((c) => classifyCandidate(c.card.name) === newRole)
            : [];
          const matchedSlots = new Set(roleMatched.map((c) => c.slotId));
          const weakNames = new Set(
            (deck.optimizeSwaps?.removals ?? []).map((r) => r.name.toLowerCase())
          );
          const weak = deck.cards.filter(
            (c) => weakNames.has(c.card.name.toLowerCase()) && !matchedSlots.has(c.slotId)
          );
          const suggested = [
            ...roleMatched.map((c) => toOpt(c, 'same role')),
            ...weak.map((c) => toOpt(c, 'weak slot')),
          ].slice(0, 8);
          const all = [...deck.cards]
            .sort((a, b) => a.card.name.localeCompare(b.card.name))
            .map((c) => toOpt(c));
          return { suggested, all };
        })();

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
      removeCard(deck.id, slotId);
      const allocations = buildAllocationMap(useDecksStore.getState().decks);
      const claim = pickCollectionCopy(newName, collectionCards, allocations, scry.id);
      addCard(deck.id, scry, claim?.copyId ?? null);
      pushToast({ message: `Swapped ${oldName} → ${newName}`, tone: 'success' });
      close();
    } catch {
      pushToast({ message: `Couldn't swap ${oldName}`, tone: 'error' });
    } finally {
      setSwappingSlot(null);
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
    const alternatives = sortOwnedFirst(
      gaps.map((g) => fromGapCard(g, ownershipFor(g.name)))
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

  // Apply budget swaps: each pair cuts the pricier card and adds the cheaper
  // role-equivalent. Same name→slot / resolve+allocate machinery as Optimize.
  const handleApplyCostSwaps = async (swaps: Array<{ removeName: string; addName: string }>) => {
    if (!deck) return;
    setApplyingCost(true);
    try {
      const slotsByName = new Map<string, string[]>();
      for (const c of deck.cards) {
        const k = c.card.name.toLowerCase();
        const arr = slotsByName.get(k) ?? [];
        arr.push(c.slotId);
        slotsByName.set(k, arr);
      }
      let done = 0;
      for (const { removeName, addName } of swaps) {
        const slotId = slotsByName.get(removeName.toLowerCase())?.shift();
        if (!slotId) continue;
        try {
          const scry = await getCardByName(addName);
          if (!scry) continue;
          removeCard(deck.id, slotId);
          const allocations = buildAllocationMap(useDecksStore.getState().decks);
          const claim = pickCollectionCopy(addName, collectionCards, allocations, scry.id);
          addCard(deck.id, scry, claim?.copyId ?? null);
          done += 1;
        } catch {
          /* skip cards that won't resolve — leave the original in place */
        }
      }
      pushToast({
        message: `Applied ${done} budget swap${done === 1 ? '' : 's'}`,
        tone: 'success',
      });
    } finally {
      setApplyingCost(false);
    }
  };

  const handleRemoveSideboardCard = (slotId: string) => {
    const slot = deck.sideboard.find((c) => c.slotId === slotId);
    if (!slot) return;
    removeSideboardCard(deck.id, slotId);
    pushToast({
      message: `Removed ${slot.card.name} from sideboard`,
      tone: 'info',
      actionLabel: 'Undo',
      onAction: () => addSideboardCard(deck.id, slot.card, slot.allocatedCopyId),
    });
  };

  const handleMoveToSideboard = (slotId: string) => {
    moveBetweenZones(deck.id, slotId, 'main');
  };

  const handleMoveToMainboard = (slotId: string) => {
    moveBetweenZones(deck.id, slotId, 'side');
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
      if (target.zone === 'main') removeCard(deck.id, slotId);
      else removeSideboardCard(deck.id, slotId);
      setCommander(deck.id, card, target.allocatedCopyId);
      pushToast({ message: `${card.name} is now the commander`, tone: 'success' });
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

    if (target.zone === 'main') removeCard(deck.id, target.slotId);
    else removeSideboardCard(deck.id, target.slotId);

    if (keepOldInDeck && oldCommander) {
      addCard(deck.id, oldCommander, oldAllocated);
    }
    setCommander(deck.id, target.card, target.allocatedCopyId);
    pushToast({
      message: `${target.card.name} is now the commander${
        keepOldInDeck && oldCommander ? ` · ${oldCommander.name} moved to the deck` : ''
      }`,
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
      if (target.zone === 'main') removeCard(deck.id, slotId);
      else removeSideboardCard(deck.id, slotId);
      setPartnerCommander(deck.id, card, target.allocatedCopyId);
      pushToast({ message: `${card.name} is now the partner commander`, tone: 'success' });
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

    if (target.zone === 'main') removeCard(deck.id, target.slotId);
    else removeSideboardCard(deck.id, target.slotId);

    if (keepOldInDeck && oldPartner) {
      addCard(deck.id, oldPartner, oldAllocated);
    }
    setPartnerCommander(deck.id, target.card, target.allocatedCopyId);
    pushToast({
      message: `${target.card.name} is now the partner commander${
        keepOldInDeck && oldPartner ? ` · ${oldPartner.name} moved to the deck` : ''
      }`,
      tone: 'success',
    });
  };

  // Picker entry point (hero): pair a legal partner that may not already be in
  // the deck. If the chosen card IS in the deck, reuse its slot/allocation and
  // pull it out (mirrors make-commander); otherwise claim a free owned copy.
  // Passing null clears the partner.
  const handleSelectPartnerFromPicker = (card: ScryfallCard | null) => {
    if (!card) {
      setPartnerCommander(deck.id, null, null);
      pushToast({ message: 'Partner commander removed', tone: 'success' });
      return;
    }
    const mainSlot = deck.cards.find((c) => c.card.name === card.name);
    const sideSlot = mainSlot ? null : deck.sideboard.find((c) => c.card.name === card.name);
    const slot = mainSlot ?? sideSlot;
    let allocated: string | null;
    if (slot) {
      allocated = slot.allocatedCopyId ?? null;
      if (mainSlot) removeCard(deck.id, slot.slotId);
      else removeSideboardCard(deck.id, slot.slotId);
    } else {
      const allocations = buildAllocationMap(useDecksStore.getState().decks);
      allocated =
        pickCollectionCopy(card.name, collectionCards, allocations, card.id)?.copyId ?? null;
    }
    setPartnerCommander(deck.id, card, allocated);
    setShowPartnerPicker(false);
    pushToast({ message: `${card.name} is now the partner commander`, tone: 'success' });
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
      // Reuse the live allocations between iterations so two adds don't
      // try to claim the same collection copy.
      const allocations = buildAllocationMap(useDecksStore.getState().decks);
      for (let i = 0; i < delta; i++) {
        const claim = pickCollectionCopy(card.name, collectionCards, allocations, card.id);
        const allocatedId = claim?.copyId ?? null;
        if (allocatedId) {
          allocations.set(allocatedId, {
            deckId: deck.id,
            deckName: deck.name,
            deckColor: deck.color,
            cardName: card.name,
          });
        }
        addCard(deck.id, card, allocatedId);
      }
      return;
    }
    // delta < 0 → drop the most-recent N slots; remember them so undo can
    // recreate the same allocations in one go.
    const dropping = current.slice(delta); // last |delta| items
    for (const slot of [...dropping].reverse()) removeCard(deck.id, slot.slotId);
    pushToast({
      message:
        dropping.length === 1
          ? `Removed ${card.name}`
          : `Removed ${dropping.length} × ${card.name}`,
      tone: 'info',
      actionLabel: 'Undo',
      onAction: () => {
        for (const slot of dropping) addCard(deck.id, slot.card, slot.allocatedCopyId);
      },
    });
  };

  const handleEditCard = (slotId: string, card: ScryfallCard) => {
    setEditingSlot({ slotId, card });
  };

  const handleEditConfirm = (selection: PrintingSelection) => {
    if (!editingSlot || !deck) return;
    const newCard = selection.card;
    const slotsForName = deck.cards.filter((c) => c.card.name === editingSlot.card.name);
    for (const slot of slotsForName) {
      updateCardPrinting(deck.id, slot.slotId, newCard);
    }
    setEditingSlot(null);
    pushToast({ message: `Updated printing for ${newCard.name}`, tone: 'info' });
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

  // Page-top hub tabs: Deck (card list) · Stats (mana + overview) · Tune
  // (power + improve). Stats always shows; Tune shows for commander formats
  // (bracket + combos) or any non-empty deck (roles + suggestions). The live
  const hasCommanderFormat = !!formatConfig?.hasCommander;
  // Bracket is glanceable info — it rides the hero meta line now (the old
  // feature-strip chip is gone); the Tune view still owns the override UI.
  const bracketValue = effectiveBracket(deck);
  // Power + Tune share the same gate: any non-empty deck (or a commander
  // format, which can have power signals before cards are added).
  const showAnalysisExtras = hasCommanderFormat || deck.cards.length > 0;
  // The Tune tab carries no count badge — a bare number there read as a
  // mystery (it was the in-deck combo count); the combo count is shown,
  // clearly labelled, on the "In deck" sub-tab of the embedded Combos panel.
  const viewTabs: Array<{ id: DeckView; label: string }> = [
    { id: 'deck', label: 'Deck' },
    { id: 'stats', label: 'Stats' },
    ...(showAnalysisExtras
      ? [
          { id: 'power' as DeckView, label: 'Power' },
          { id: 'tune' as DeckView, label: 'Tune' },
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
          <p className="binder-hero-meta">
            {formatConfig && <span className="deck-format-badge">{formatConfig.label}</span>}
            {deck.commander && (
              <>
                {formatConfig ? ' · ' : ''}
                {deck.commander.name}
                {/* Read-only pairing summary; add/change/remove lives in the
                    deck grid's Commander section (see onEditPartner). */}
                {deck.partnerCommander && ` + ${deck.partnerCommander.name}`}
              </>
            )}
            {/* Desktop-only totals chip — hidden on tablet/mobile via
                .deck-hero-totals to keep the meta line short there. */}
            <span className="deck-hero-totals">
              {' · '}
              {heroTotals.count} {heroTotals.count === 1 ? 'card' : 'cards'} · $
              {heroTotals.value.toFixed(2)}
            </span>
            {/* Bracket — glanceable on every view (it left the feature strip). */}
            {bracketValue != null && (
              <span className="deck-hero-bracket">{` · Bracket ${bracketValue}`}</span>
            )}
          </p>
        </div>
        <div className="deck-editor-actions">
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
          <button type="button" className="btn deck-editor-action-btn" onClick={handleDuplicate}>
            <Copy width={14} height={14} strokeWidth={2} aria-hidden />
            Duplicate
          </button>
          <button
            type="button"
            className="btn btn-danger deck-editor-action-btn"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 width={14} height={14} strokeWidth={2} aria-hidden />
            Delete
          </button>
        </div>
        <div className="deck-editor-mobile-actions">
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
            onPlaytest={() => navigate(`/decks/${deck.id}/playtest`)}
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
            canMakeCommander={formatConfig?.hasCommander ? isValidCommander : undefined}
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
            collectionByCopyId={collectionById}
            binderByCopyId={binderByCopyId}
            onAddFromSearch={(q) => {
              setShowAddPanel(true);
              window.requestAnimationFrame(() => searchPanelRef.current?.seed(q));
            }}
            roleCounts={deck.roleCounts}
            roleTargets={deck.roleTargets}
            buildReport={deck.buildReport}
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
            tuneDefaultLane={tuneDefaultLane}
            tuneFocusLane={tuneFocusLane}
            onTuneFocusHandled={clearTuneFocus}
            renderSwapSuggestions={renderSwapSuggestions}
            renderSimilarCards={renderSimilarCards}
            powerHeroSlot={
              formatConfig?.hasCommander ? (
                <PowerHero
                  bracket={effectiveBracket(deck) ?? null}
                  bracketOverridden={deck.bracketOverride != null}
                  bracketReasons={(deck.bracketEstimation?.hardFloors ?? []).map((f) => f.reason)}
                  engineLabel={deck.synergyAnalysis?.axes[0]?.label}
                  engineProducers={deck.synergyAnalysis?.axes[0]?.producers}
                  enginePayoffs={deck.synergyAnalysis?.axes[0]?.payoffs}
                  engineLopsided={(deck.synergyAnalysis?.warnings.length ?? 0) > 0}
                  comboInDeck={comboData.data?.inDeck.length ?? 0}
                  comboOwnedMissing={comboData.data?.almostInCollection.length ?? 0}
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
                />
              ) : undefined
            }
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
            improveSlot={
              formatConfig?.hasCommander &&
              ((deck.gapAnalysis?.length ?? 0) > 0 ||
                (deck.optimizeSwaps &&
                  (deck.optimizeSwaps.additions.length > 0 ||
                    deck.optimizeSwaps.removals.length > 0)) ||
                (deck.synergyAnalysis?.suggestions.length ?? 0) > 0) ? (
                <ImproveLane
                  gaps={deck.gapAnalysis ?? []}
                  optimize={deck.optimizeSwaps}
                  synergy={deck.synergyAnalysis?.suggestions ?? []}
                  substitutes={substitutionPlan?.rows ?? []}
                  resolveOwnership={ownershipFor}
                  onAdd={handleAddEngineCard}
                  onCut={handleCutEngineCard}
                  busyNames={addingEngineNames}
                  commanderName={deck.commander?.name}
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
                />
              ) : undefined
            }
            nextBestMoveSlot={
              nextBestMoves.length > 0 || (formatConfig?.hasCommander && comboData.loading) ? (
                <NextBestMove
                  moves={nextBestMoves}
                  onNavigate={handleNbmNavigate}
                  combosLoading={!!formatConfig?.hasCommander && comboData.loading}
                />
              ) : undefined
            }
            costSlot={
              formatConfig?.hasCommander &&
              deck.costPlan &&
              (deck.costPlan.spellRows.length > 0 || deck.costPlan.landRows.length > 0) ? (
                <CostPanel
                  plan={deck.costPlan}
                  onApply={handleApplyCostSwaps}
                  applying={applyingCost}
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
                />
              ) : undefined
            }
            winConditionSlot={
              formatConfig?.hasCommander && deck.winConditions ? (
                <WinConditionPanel analysis={deck.winConditions} />
              ) : undefined
            }
            bracketFitSlot={
              // Bracket Fit lives in the Power-tab Bracket panel. Only build it for
              // a commander deck with a target set and a non-aligned plan — the
              // aligned case renders its own tiny confirmation chip (no lane body).
              // Reuses the EXACT add/cut/swap apply paths the Tune lane uses, incl.
              // DeckSizePrompt-on-full via handleAddEngineCard.
              formatConfig?.hasCommander && deck.bracketOverride != null && deck.bracketFit ? (
                <BracketFitLane
                  plan={deck.bracketFit}
                  commanderName={deck.commander?.name}
                  resolveOwnership={ownershipFor}
                  onAdd={handleAddEngineCard}
                  onCut={handleCutEngineCard}
                  onSwap={(outName, inName) => {
                    // Guard against a double-submit before the cut re-renders: the
                    // cut name's busy gate disables the row, but also bail if a
                    // swap for this exact card is already in flight.
                    if (bracketFitSwapName === outName) return;
                    // Cut the in-deck card, add the replacement (1-for-1). Locate
                    // the slot from the cut name; no-op preview-close (no carousel).
                    const slotId = deck.cards.find((c) => c.card.name === outName)?.slotId;
                    if (!slotId) return;
                    setBracketFitSwapName(outName);
                    void handleSwapInDeck(slotId, outName, inName, () => {}).finally(() =>
                      setBracketFitSwapName(null)
                    );
                  }}
                  busyNames={
                    bracketFitSwapName
                      ? new Set([...addingEngineNames, bracketFitSwapName])
                      : addingEngineNames
                  }
                />
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
        <div
          className="card-picker-root"
          role="presentation"
          onClick={() => setShowTestHand(false)}
        >
          <div
            className="card-picker-sheet deck-test-hand-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Test hand"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-picker-handle" aria-hidden />
            <div className="deck-test-hand-sheet-header">
              <h2 className="deck-test-hand-sheet-title">Test hand</h2>
              <button
                type="button"
                className="deck-test-hand-sheet-close"
                onClick={() => setShowTestHand(false)}
                aria-label="Close test hand"
              >
                <X width={18} height={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div className="deck-test-hand-sheet-body">
              <DeckTestHandPanel embedded deckId={deck.id} />
            </div>
          </div>
        </div>
      )}

      {/* Add cards — a breakpoint-aware overlay (bottom sheet on
          mobile, centered modal ≥1024px) via the shared card-picker
          sheet, instead of an inline rail. */}
      {showAddPanel && (formatConfig?.hasCommander ? deck.commander : true) && (
        <div
          className="card-picker-root"
          role="presentation"
          onClick={() => setShowAddPanel(false)}
        >
          <div
            className="card-picker-sheet deck-add-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Add cards"
            onClick={(e) => e.stopPropagation()}
          >
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
              onAdd={({ card, allocatedCopyId }) => {
                if (addZone === 'side') {
                  addSideboardCard(deck.id, card, allocatedCopyId);
                } else {
                  addCard(deck.id, card, allocatedCopyId);
                }
              }}
              onClose={() => setShowAddPanel(false)}
            />
          </div>
        </div>
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

      {editingSlot && (
        <CardEditDialog
          cardName={editingSlot.card.name}
          currentScryfallId={editingSlot.card.id}
          currentFinish="nonfoil"
          onConfirm={handleEditConfirm}
          onCancel={() => setEditingSlot(null)}
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
          subtitle={`Replace a card with ${pendingAdd}?`}
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

      {/* Suppress unused-import lint */}
      <span hidden>{updateDeck.name}</span>
    </div>
  );
}

function DeckEditorOverflowMenu({
  onDuplicate,
  onDelete,
  onExport,
  onPlaytest,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onPlaytest: () => void;
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
