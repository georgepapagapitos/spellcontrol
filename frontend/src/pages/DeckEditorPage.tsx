import { Copy, MoreVertical, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
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
import { DeckCombosPanel } from '../components/deck/DeckCombosPanel';
import { DeckAnalysisPanel } from '../components/deck/DeckAnalysisPanel';
import { DeckTestHandPanel } from '../components/deck/DeckTestHandPanel';
import { NextBestMove } from '../components/deck/NextBestMove';
import { OptimizePanel } from '../components/deck/OptimizePanel';
import { CostPanel } from '../components/deck/CostPanel';
import { buildNextBestMoves } from '@/deck-builder/services/deckBuilder/nextBestMove';
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
import { useToastsStore } from '../store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { getCardPrice, getCardByName } from '../deck-builder/services/scryfall/client';

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
  const duplicateDeck = useDecksStore((s) => s.duplicateDeck);
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
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Hoisted so the mobile action sheet can open Export without rendering
  // a duplicate button. Passed to DeckDisplay as a controlled prop pair.
  const [exportOpen, setExportOpen] = useState(false);
  const [addZone, setAddZone] = useState<'main' | 'side'>('main');
  const searchPanelRef = useRef<CardSearchPanelHandle>(null);
  // The deck editor is a set of page-top distinct views (Deck · Overview ·
  // Mana · Power · Improve) switched by the hub tab bar below the header. `view`
  // is the active one; the feature-strip chips + keyboard shortcuts deep-link
  // into a view and scroll it into reach. Test hand is NOT a view — it's its own
  // standalone overlay (goldfishing is a distinct activity), opened on demand
  // from the Deck-view toolbar — a modal on desktop, a bottom sheet on mobile
  // (same card-picker pattern as Add cards), so it's never pinned inline.
  const viewScrollRef = useRef<HTMLDivElement>(null);
  const [showTestHand, setShowTestHand] = useState(false);
  const [view, setView] = useState<DeckView>('deck');
  const [applyingOptimize, setApplyingOptimize] = useState(false);
  const [applyingCost, setApplyingCost] = useState(false);
  const openView = useCallback((next: DeckView) => {
    setView(next);
    window.requestAnimationFrame(() => {
      viewScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);
  // Chip / keyboard deep-links target a specific analysis view.
  const openAnalysisTab = useCallback((tab: AnalysisTabId) => openView(tab), [openView]);

  // Counts already in this deck — fed to the search panel so it can mark
  // duplicates with a live "in deck × N" hint and let users add basics
  // multiple times.
  const formatConfig = deck ? DECK_FORMAT_CONFIGS[deck.format] : null;

  const existingCardCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!deck) return m;
    for (const c of deck.cards) m.set(c.card.name, (m.get(c.card.name) ?? 0) + 1);
    for (const c of deck.sideboard) m.set(c.card.name, (m.get(c.card.name) ?? 0) + 1);
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
    });
  }, [deck, comboData.data]);

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
        openAnalysisTab('power'); // Combos live under the Power tab.
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        openAnalysisTab('improve'); // Suggestions live under the Improve tab.
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
  const handleApplyOptimize = async (removalNames: string[], additionNames: string[]) => {
    if (!deck) return;
    setApplyingOptimize(true);
    try {
      const slotsByName = new Map<string, string[]>();
      for (const c of deck.cards) {
        const k = c.card.name.toLowerCase();
        const arr = slotsByName.get(k) ?? [];
        arr.push(c.slotId);
        slotsByName.set(k, arr);
      }
      let cuts = 0;
      for (const name of removalNames) {
        const slotId = slotsByName.get(name.toLowerCase())?.shift();
        if (slotId) {
          removeCard(deck.id, slotId);
          cuts += 1;
        }
      }
      let adds = 0;
      for (const name of additionNames) {
        try {
          const scry = await getCardByName(name);
          if (!scry) continue;
          const allocations = buildAllocationMap(useDecksStore.getState().decks);
          const claim = pickCollectionCopy(name, collectionCards, allocations, scry.id);
          addCard(deck.id, scry, claim?.copyId ?? null);
          adds += 1;
        } catch {
          /* skip cards that won't resolve */
        }
      }
      pushToast({
        message: `Applied ${cuts} cut${cuts === 1 ? '' : 's'} and ${adds} addition${adds === 1 ? '' : 's'}`,
        tone: 'success',
      });
    } finally {
      setApplyingOptimize(false);
    }
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

  // Page-top hub tabs. Deck/Overview/Mana always show; Power (bracket + combos)
  // is gated to commander-family formats (matching the EDH-centric analysis),
  // and Improve (roles + suggestions) shows for any non-empty deck. The live
  // combo count rides on the Power tab as a count badge (the old Combos chip).
  const hasCommanderFormat = !!formatConfig?.hasCommander;
  const comboCount = comboData.data?.inDeck.length ?? null;
  // Bracket is glanceable info — it rides the hero meta line now (the old
  // feature-strip chip is gone); the Power view still owns the override UI.
  const bracketValue = effectiveBracket(deck);
  const viewTabs: Array<{ id: DeckView; label: string; count?: number | null }> = [
    { id: 'deck', label: 'Deck' },
    { id: 'overview', label: 'Overview' },
    { id: 'mana', label: 'Mana' },
    ...(hasCommanderFormat
      ? [{ id: 'power' as DeckView, label: 'Power', count: comboData.loading ? null : comboCount }]
      : []),
    ...(deck.cards.length > 0 ? [{ id: 'improve' as DeckView, label: 'Improve' }] : []),
  ];
  // Guard against a stale view that no longer has a tab (e.g. format change).
  const safeView: DeckView = viewTabs.some((t) => t.id === view) ? view : 'deck';

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

      {/* Page-top distinct-view tabs (Deck · Overview · Mana · Power · Improve),
          mirroring the Collection hub. Sticky so it stays in reach as the
          active view scrolls. */}
      <div className="deck-editor-view-tabs" ref={viewScrollRef}>
        <Tabs
          ariaLabel="Deck views"
          variant="underline"
          value={safeView}
          onChange={setView}
          tabs={viewTabs.map((t) => ({
            id: t.id,
            label: t.label,
            count: t.count,
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
            collectionByCopyId={collectionById}
            binderByCopyId={binderByCopyId}
            onAddFromSearch={(q) => {
              setShowAddPanel(true);
              window.requestAnimationFrame(() => searchPanelRef.current?.seed(q));
            }}
            roleCounts={deck.roleCounts}
            roleTargets={deck.roleTargets}
            gapAnalysis={deck.gapAnalysis}
            buildReport={deck.buildReport}
            ownedNames={ownedNames}
            cardInclusionMap={deck.cardInclusionMap}
            rampSubtypeCounts={deck.rampSubtypeCounts}
            removalSubtypeCounts={deck.removalSubtypeCounts}
            boardwipeSubtypeCounts={deck.boardwipeSubtypeCounts}
            cardDrawSubtypeCounts={deck.cardDrawSubtypeCounts}
            bracketEstimation={deck.bracketEstimation}
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
            combosSlot={
              formatConfig?.hasCommander ? (
                <DeckCombosPanel
                  embedded
                  deckId={deck.id}
                  deckOracleIds={deckOracleIds}
                  format={deck.format}
                  onAdd={(card, allocatedCopyId) => addCard(deck.id, card, allocatedCopyId)}
                />
              ) : undefined
            }
            suggestionsSlot={
              formatConfig?.hasCommander ? (
                <DeckAnalysisPanel
                  embedded
                  deckId={deck.id}
                  format={deck.format}
                  commander={deck.commander}
                  partnerCommander={deck.partnerCommander}
                  mainboard={deck.cards.map((c) => ({ slotId: c.slotId, card: c.card }))}
                  onAdd={(card, allocatedCopyId) => addCard(deck.id, card, allocatedCopyId)}
                />
              ) : undefined
            }
            nextBestMoveSlot={
              nextBestMoves.length > 0 ? (
                <NextBestMove moves={nextBestMoves} onNavigate={openView} />
              ) : undefined
            }
            optimizeSlot={
              formatConfig?.hasCommander &&
              deck.optimizeSwaps &&
              (deck.optimizeSwaps.removals.length > 0 ||
                deck.optimizeSwaps.additions.length > 0) ? (
                <OptimizePanel
                  swaps={deck.optimizeSwaps}
                  currentSize={deck.cards.length}
                  ownedNames={ownedNames}
                  onApply={handleApplyOptimize}
                  applying={applyingOptimize}
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
