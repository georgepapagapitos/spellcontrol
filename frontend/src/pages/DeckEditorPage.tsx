import { canRegenerate, regenerateHref, regenerateState } from '@/lib/deck/regenerate-prefill';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
// Editor-only stylesheets ship with this chunk, not the boot payload (E265).
import '@/styles/deck-builder-export.css';
import '@/styles/deck-builder-editor.css';
import '@/styles/deck-builder-test-hand.css';
import '@/styles/deck-builder-combos-list.css';
import '@/styles/deck-builder-row-qty.css';
import '@/styles/deck-builder-import-dialog.css';
import '@/styles/deck-builder-analysis-panel.css';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { useBinderLayoutInputs } from '@/lib/binder/use-binder-layout-inputs';
import { useLocation, useNavigate, useParams, Navigate } from 'react-router-dom';
import { useDecksStore, effectiveBracket, type Deck } from '../store/decks';
import { useDeckHistoryStore } from '../store/deck-history';
import { type DeckView } from '@/lib/deck-analysis/deck-view';
import { Tabs } from '@/components/overlays/Tabs';
import { buildAlternativeIndex } from '@/lib/ai/refine-alternatives';
import { DeckPublishNudge } from '../components/deck/DeckPublishNudge';
import { useSealMoment } from '../components/shared/SealMoment';
import { shouldCelebrateFirstPublish } from '@/lib/social/first-publish-celebration';
import { useDeckTokens } from '../components/deck/use-deck-tokens';
import { type Change } from '@/lib/coach/deck-change';
import '../styles/deck-builder-card-search.css';
import { classifyCandidate } from '@/lib/deck-analysis/deck-analysis';
import { heroBracketReadout } from '@/lib/deck-analysis/format-bracket-label';
import { loadTaggerData, hasTaggerData } from '@/deck-builder/services/tagger/client';
import { useUndoRedoKeyboard } from '@/lib/deck/use-undo-redo-keyboard';
import { useRegisterShortcuts } from '@/components/app-shell/shortcut-registry';
import type { ComboSeedContext } from '../types/combos';
import { useToastsStore } from '../store/toasts';
import { getCardByName } from '../deck-builder/services/scryfall/client';
import { getSyncState, onSyncedChange } from '@/lib/sync';
import { Button } from '@/components/shared/Button';
import { DECK_EDITOR_SHORTCUTS } from './deck-editor/deck-editor-helpers';
import { DeckEditorHero } from './deck-editor/DeckEditorHero';
import { DeckEditorOverflowMenu } from './deck-editor/DeckEditorOverflowMenu';
import { deckViewTabs } from './deck-editor/deck-page-chrome';
import { DeckScryfallDropOverlay } from './deck-editor/DeckScryfallDropOverlay';
import { useSuggestionContext } from '@/lib/util/use-suggestion-context';
import { useDeckArrivals } from './deck-editor/use-deck-arrivals';
import { useDeckPrintingEdits } from './deck-editor/use-deck-printing-edits';
import { useDeckCommanderEdits } from './deck-editor/use-deck-commander-edits';
import { useDeckEditorUi } from './deck-editor/use-deck-editor-ui';
import { useDeckView } from './deck-editor/use-deck-view';
import { useDeckAddFlow } from './deck-editor/use-deck-add-flow';
import { useDeckReallocation } from './deck-editor/use-deck-reallocation';
import { useDeckCoachApply } from './deck-editor/use-deck-coach-apply';
import { useDeckDerived } from './deck-editor/use-deck-derived';
import { useDeckOwnership } from './deck-editor/use-deck-ownership';
import { useDeckCombosView } from './deck-editor/use-deck-combos-view';
import { useDeckAnalysisData } from './deck-editor/use-deck-analysis-data';
import { useDeckRefineData } from './deck-editor/use-deck-refine-data';
import { useCoachArrivals } from './deck-editor/use-coach-arrivals';
import { useDeckEditorHotkeys } from './deck-editor/use-deck-editor-hotkeys';
import { useDeckHeroData } from './deck-editor/use-deck-hero-data';
import { useDeckZoneEdits } from './deck-editor/use-deck-zone-edits';
import { useDeckCardRenderers } from './deck-editor/use-deck-card-renderers';
import { DeckEditorLayout } from './deck-editor/DeckEditorLayout';
import { DeckEditorOverlays } from './deck-editor/DeckEditorOverlays';

export function DeckEditorPage() {
  const { id } = useParams<{ id: string }>();
  const deck = useDecksStore((s) => s.decks.find((d) => d.id === id) ?? null);
  // Names the print job and tab: the print stylesheet can't label a checklist.
  useDocumentTitle(deck?.name);
  useSuggestionContext(deck);
  const decksHydrated = useDecksStore((s) => s.hydrated);
  // A fresh device hydrates an EMPTY IndexedDB first; the deck arrives with the first
  // server pull. Count that pull as loading, or a bookmark reads as deleted (sweep-3 B6-01).
  const syncing = useSyncExternalStore(onSyncedChange, () => getSyncState() === 'syncing');
  const pushToast = useToastsStore((s) => s.push);

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
  useRegisterShortcuts('Deck editor', DECK_EDITOR_SHORTCUTS);

  if (!id) return <Navigate to="/decks" replace />;
  if (!deck) {
    if (!decksHydrated || syncing) {
      return (
        <div className="page-loader page-loader--message" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="page-loader-message">Loading deck…</span>
        </div>
      );
    }
    return (
      <div className="deck-editor-missing">
        <p>That deck no longer exists.</p>
        <Button variant="primary" to="/decks">
          Back to decks
        </Button>
      </div>
    );
  }
  return <DeckEditor deck={deck} />;
}

function DeckEditor({ deck }: { deck: Deck }) {
  const id = deck.id;
  const navigate = useNavigate();
  const location = useLocation();
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const renameDeck = useDecksStore((s) => s.renameDeck);
  const deleteDeck = useDecksStore((s) => s.deleteDeck);
  const duplicateDeck = useDecksStore((s) => s.duplicateDeck);
  // BinderPage's decorated cards (tags, Secret Lair drops, release dates, each
  // only when a binder uses it), so every binder answer on this page agrees
  // with the binder view.
  const { cards: collectionCards, binders: binderDefs } = useBinderLayoutInputs();
  const undoEdit = useDeckHistoryStore((s) => s.undo);
  const redoEdit = useDeckHistoryStore((s) => s.redo);
  const canUndoEdit = useDeckHistoryStore((s) => (id ? s.canUndo(id) : false));
  const canRedoEdit = useDeckHistoryStore((s) => (id ? s.canRedo(id) : false));
  const undoEditLabel = useDeckHistoryStore((s) => (id ? s.undoLabel(id) : null));
  const redoEditLabel = useDeckHistoryStore((s) => (id ? s.redoLabel(id) : null));
  // The header's action tiers (STYLE_GUIDE § Layout system): a phone shows
  // Add cards + ⋮, a tablet adds Playtest, a desktop adds undo/redo. The ⋮
  // holds exactly what isn't on screen at that width.
  const isPhone = useMediaQuery('(max-width: 599px)');
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const ownership = useDeckOwnership({ collectionCards, deck });
  const {
    collectionById,
    ownedOracleIds,
    ownedOracleIdSet,
    printingAllocationMap,
    ownedNames,
    ownershipFor,
    binderByCardName,
    freeCountFor,
  } = ownership;
  const deckArrivals = useDeckArrivals({ deck, collectionById });
  const { arrivalsByType } = deckArrivals;
  const [renaming, setRenaming] = useState(false);
  const commanderEdits = useDeckCommanderEdits({ deck, collectionCards });
  const ui = useDeckEditorUi({ deck });
  const {
    showAddPanel,
    setShowAddPanel,
    searchPanelRef,
    ownedOnly,
    handleToggleAddPanel,
    setFeedbackOpen,
    setPrimerOpen,
    setShowBuildReport,
    setTokensOpen,
    setPullListOpen,
  } = ui;
  // First-publish seal + post-create visibility nudge (E150) — two more
  // one-shot router-state flags in the same `justGenerated` shape, set by
  // whichever creation flow the deck just came from:
  //   - justPublished: the creation-time fieldset (DeckNewPage,
  //     ImportDeckDialog) already published it. Firing the seal HERE rather
  //     than on the creating page is deliberate — that page navigates away
  //     the instant publish resolves, which would unmount the portal
  //     mid-animation (see usePublishOnCreate's doc comment).
  //   - promptVisibility: the flow (CopyDeckButton, a multi-file import that
  //     landed on one deck, the guided/brew builders) skipped the fieldset
  //     entirely — show the lighter DeckPublishNudge instead of celebrating.
  // justPublished and promptVisibility stay mutually exclusive by construction
  // (a flow either offered the choice or didn't). promptVisibility DOES pair
  // with justGenerated — a guided/brew build gets the build-report sheet and
  // the nudge; the sheet is an overlay and the nudge an in-flow row above the
  // header, so neither hides the other. Captured once at mount like
  // showBuildReport above.
  const [justPublished] = useState(
    () => !!(location.state as { justPublished?: boolean } | null)?.justPublished
  );
  const [showPublishNudge] = useState(
    () => !!(location.state as { promptVisibility?: boolean } | null)?.promptVisibility
  );
  // E215 — combo the build was seeded from, relayed by useDeckGeneration in
  // the same one-shot router state as justGenerated. Captured once at mount
  // like the flags above; a refresh loses it exactly like they do (fine —
  // it's build intent, not a saved property of the deck).
  const [comboSeedContext] = useState(
    () => (location.state as { comboContext?: ComboSeedContext } | null)?.comboContext ?? null
  );
  const [addZone, setAddZone] = useState<'main' | 'side' | 'considering'>('main');
  const deckView = useDeckView();
  const {
    combosRef,
    planOpen,
    setPlanOpen,
    viewScrollRef,
    setView,
    setStatSlot,
    setExportOpen,
    setShowTestHand,
    openAnalysisTab,
    view,
  } = deckView;
  const realloc = useDeckReallocation({ deck, collectionCards });
  const { executeReallocation, applyDonorOutcome } = realloc;
  const printingEdits = useDeckPrintingEdits({
    deck,
    collectionCards,
    executeReallocation,
    applyDonorOutcome,
  });
  const { setEditingSlot } = printingEdits;

  // Load tagger role data on mount (deduped) so the in-context "Swap this card"
  // section can scope alternatives to a card's role even when the preview is
  // opened from the Deck tab, where the Analysis panel isn't mounted.
  useEffect(() => {
    if (!hasTaggerData()) void loadTaggerData();
  }, []);
  const derived = useDeckDerived({ deck, addZone, collectionById });
  const {
    deckScryCards,
    commanderColorIdentity,
    comboColorIdentity,
    mainboardOracleIds,
    formatConfig,
    mainboardLimit,
    deckCards,
    deckCardNames,
    deckIsFull,
    commanderNames,
    existingCardCounts,
    atCopyLimit,
    commanderKey,
    isCommander,
    hasPullSlots,
    deckOracleIds,
  } = derived;
  const deckTokens = useDeckTokens(deckScryCards);

  // First-publish seal moment (E150), driven by the justPublished router
  // state set above. Fires here rather than on the creating page (DeckNewPage
  // / ImportDeckDialog navigate away the instant publish resolves, which
  // would unmount the portal mid-animation — see usePublishOnCreate's doc
  // comment). `shouldCelebrateFirstPublish` is the single dedup guard shared
  // with ShareDialog's own direct-fire path (the chip + DeckPublishNudge),
  // so a deck's first publish celebrates exactly once regardless of entry
  // surface. Deliberately narrow deps — a one-shot flag that never resets,
  // re-run only to catch `deck` resolving after the initial render (async
  // store hydration); re-firing on a later commander edit would be a no-op
  // anyway (the guard is keyed on deckId), so there's nothing to gain by
  // tracking commanderColorIdentity here too.
  const { fire: fireSealMoment, moment: sealMoment } = useSealMoment();
  useEffect(() => {
    if (!justPublished || !deck) return;
    if (shouldCelebrateFirstPublish(deck.id, true)) {
      fireSealMoment(commanderColorIdentity);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justPublished, deck?.id]);
  const combosView = useDeckCombosView({
    deckOracleIds,
    ownedOracleIds,
    deck,
    comboColorIdentity,
    mainboardOracleIds,
    ownedOracleIdSet,
    combosRef,
  });
  const {
    mainboardComboData,
    comboData,
    handleViewCombos,
    handleViewWinConditions,
    handleViewBracket,
  } = combosView;
  const analysis = useDeckAnalysisData({
    deck,
    mainboardComboData,
    comboData,
    commanderColorIdentity,
    collectionCards,
    printingAllocationMap,
    formatConfig,
    planOpen,
    ownedNames,
    mainboardLimit,
    ownershipFor,
    ownedOnly,
  });
  const {
    liveRoleCounts,
    taggerReady,
    buildTimeNudge,
    analysisState,
    bracketAnalysis,
    replaceCuts,
    crossDeckMoves,
  } = analysis;
  const addFlow = useDeckAddFlow({
    deckIsFull,
    addZone,
    setShowAddPanel,
    buildTimeNudge,
    deck,
    commanderNames,
    formatConfig,
    mainboardLimit,
    commanderColorIdentity,
    collectionCards,
    isCommander,
    replaceCuts,
    mainboardComboData,
    ownershipFor,
    executeReallocation,
  });
  const {
    setAuditionPinnedCutName,
    setAuditionCard,
    addChosenCard,
    setPendingMove,
    setPendingAdd,
    setPendingAddPrinting,
    setPendingAddGroup,
    commitCrossDeckMove,
    handleAddEngineCard,
    handleCutEngineCard,
    addZoneLabel,
    handleScryfallDrop,
  } = addFlow;
  const coachApply = useDeckCoachApply({
    deck,
    collectionCards,
    crossDeckMoves,
    deckIsFull,
    setPendingMove,
    setPendingAdd,
    setPendingAddPrinting,
    setPendingAddGroup,
    commitCrossDeckMove,
    handleAddEngineCard,
    handleCutEngineCard,
    setPlanOpen,
  });
  const { handleApplyCoachMove, handleApplyCostSwaps, swappingSlot, handleSwapInDeck } = coachApply;
  const refine = useDeckRefineData({
    collectionCards,
    view,
    deck,
    ownedNames,
    liveRoleCounts,
    commanderColorIdentity,
    deckCards,
    deckCardNames,
  });
  const { refinePool, aiScope } = refine;
  const arrivals = useCoachArrivals({
    deck,
    mainboardComboData,
    arrivalsByType,
    comboData,
  });
  // Same-role re-roll index for the AI panel's swap rows — built from the engine
  // pool so a re-roll never needs another model call.
  //
  // ⚠️ Gated on `taggerReady`, not just the pool. `classifyCandidate` reads the
  // tagger's tag sets, and `getCardRole` returns null for EVERY card until they
  // finish loading — so computing this before they land yields an all-empty
  // index, and without the dependency it would never recompute once they do.
  // The re-roll control would then be permanently absent rather than late.
  const refineAlternatives = useMemo(
    () =>
      taggerReady
        ? buildAlternativeIndex(refinePool, classifyCandidate)
        : new Map<string, string[]>(),
    [refinePool, taggerReady]
  );
  useDeckEditorHotkeys({ setShowAddPanel, searchPanelRef, openAnalysisTab, handleViewCombos });
  const { heroArt, heroTotals, cover } = useDeckHeroData({ deck, deckCards });

  // CoachFeed "Fit?" button — open the audition for a feed row's incoming card.
  // For swap rows, also store the outgoing card name so CardFitPanel can pin it
  // as the first cut suggestion (pre-seeding the natural swap target).
  // Reuses the same getCardByName + setAuditionCard flow as the card-search path.
  const handleCoachPreviewFit = useCallback(
    async (change: Change) => {
      if (!deck) return;
      const scry = await getCardByName(change.name);
      if (!scry) return;
      setAuditionPinnedCutName(change.type === 'swap' && change.inName ? change.inName : null);
      setAuditionCard(scry);
    },
    [deck, setAuditionCard, setAuditionPinnedCutName]
  );

  const handleCommitRename = (name: string) => renameDeck(deck.id, name);
  // Undoable from the toast, so it doesn't confirm first (T157) — deleteDeck
  // shows the Undo toast itself, which survives the navigate below (the toast
  // store is global, not page state).
  const handleDelete = () => {
    deleteDeck(deck.id);
    navigate('/decks');
  };
  const handleDuplicate = () => {
    const newId = duplicateDeck(deck.id);
    if (newId) navigate(`/decks/${newId}`);
  };
  const renderers = useDeckCardRenderers({
    addZone,
    setAddZone,
    formatConfig,
    buildTimeNudge,
    openAnalysisTab,
    handleViewCombos,
    handleViewWinConditions,
    handleViewBracket,
    searchPanelRef,
    deck,
    commanderColorIdentity,
    commanderNames,
    existingCardCounts,
    atCopyLimit,
    binderByCardName,
    addChosenCard,
    setAuditionCard,
    mainboardComboData,
    ownershipFor,
    analysisState,
    bracketAnalysis,
    commanderKey,
    refinePool,
    aiScope,
    refineAlternatives,
    deckIsFull,
    setShowAddPanel,
    handleApplyCoachMove,
    handleApplyCostSwaps,
    swappingSlot,
    handleSwapInDeck,
    collectionCards,
    freeCountFor,
  });
  const zoneEdits = useDeckZoneEdits({ deck, formatConfig, collectionCards, setEditingSlot });

  // Page-top hub tabs: Deck (card list) · Stats (mana + overview) · Power +
  // Tune. Stats always shows for every format.
  const hasCommanderFormat = !!formatConfig?.hasCommander;
  // Bracket is glanceable info — it rides the hero meta line now (the old
  // feature-strip chip is gone); the Tune view still owns the override UI.
  // A Commander bracket only: a deck switched to a 60-card format can still
  // carry one from before (an analysis that landed late, an older device).
  const bracketValue = hasCommanderFormat ? effectiveBracket(deck) : undefined;
  // An estimate made before the combo match answered is a floor (combos only
  // raise a bracket); the glanceable readouts say "2+" like the hero's "At least".
  const heroBracket =
    bracketValue === undefined
      ? undefined
      : heroBracketReadout({
          bracket: bracketValue,
          stated: deck.bracketOverride,
          estimate: deck.bracketEstimation?.bracket,
          missesCombos: bracketAnalysis.missesCombos,
        });
  const bracketText =
    bracketValue === undefined
      ? undefined
      : bracketAnalysis.missesCombos && deck.bracketOverride == null
        ? `${bracketValue}+`
        : String(bracketValue);
  // Power + Coach are Commander-only (deckViewTabs says why).
  const viewTabs = deckViewTabs(hasCommanderFormat, bracketValue, bracketText);
  // Guard against a stale view that no longer has a tab. Map any legacy
  // analysis id that might still be in `view` from an earlier restructure, then
  // fall back to the Deck tab. (improve → tune; stats and its older names are
  // handled by the effect above, which scrolls to the stats under the list.)
  const legacyViewMap: Record<string, DeckView> = { improve: 'tune' };
  const mappedView = legacyViewMap[view] ?? view;
  const safeView: DeckView = viewTabs.some((t) => t.id === mappedView) ? mappedView : 'deck';

  return (
    <div className="deck-editor-page">
      {sealMoment}
      {showPublishNudge && <DeckPublishNudge deckId={deck.id} />}
      <DeckEditorHero
        deck={deck}
        art={heroArt}
        formatConfig={formatConfig}
        heroTotals={heroTotals}
        bracketValue={bracketValue}
        heroBracket={heroBracket}
        commanderColorIdentity={commanderColorIdentity}
        renaming={renaming}
        setRenaming={setRenaming}
        onCommitRename={handleCommitRename}
        updateDeck={updateDeck}
        isDesktop={isDesktop}
        isPhone={isPhone}
        undoEdit={undoEdit}
        redoEdit={redoEdit}
        canUndoEdit={canUndoEdit}
        canRedoEdit={canRedoEdit}
        undoEditLabel={undoEditLabel}
        redoEditLabel={redoEditLabel}
        showAddPanel={showAddPanel}
        onToggleAddPanel={handleToggleAddPanel}
        overflowMenu={
          <DeckEditorOverflowMenu
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            onExport={() => setExportOpen(true)}
            onTestHand={() => setShowTestHand(true)}
            onFeedback={() => setFeedbackOpen(true)}
            onPrimer={() => setPrimerOpen(true)}
            onBuildReport={deck.buildReport ? () => setShowBuildReport(true) : undefined}
            onRegenerate={
              canRegenerate(deck)
                ? () => navigate(regenerateHref(deck), { state: regenerateState(deck) })
                : undefined
            }
            onPlaytest={isPhone ? () => navigate(`/decks/${deck.id}/playtest`) : undefined}
            onTokens={deckTokens.length > 0 ? () => setTokensOpen(true) : undefined}
            onPullList={hasPullSlots ? () => setPullListOpen(true) : undefined}
            onPrintProxies={hasPullSlots ? () => navigate(`/decks/${deck.id}/proxies`) : undefined}
            onUndo={!isDesktop && canUndoEdit ? () => undoEdit(deck.id) : undefined}
            onRedo={!isDesktop && canRedoEdit ? () => redoEdit(deck.id) : undefined}
            undoLabel={undoEditLabel}
            redoLabel={redoEditLabel}
          />
        }
      />

      {/* Page-top distinct-view tabs (Deck · Power · Coach; Power/Coach appear
          only with analysis extras), mirroring the Collection hub. Sticky so it
          stays in reach as the active view scrolls. A lone Deck tab is not a
          choice, so a non-Commander deck shows no bar at all. */}
      {viewTabs.length > 1 && (
        <div className="deck-editor-view-tabs" ref={viewScrollRef}>
          <Tabs
            ariaLabel="Deck views"
            variant="underline"
            value={safeView}
            onChange={setView}
            tabs={viewTabs.map((t) => ({
              id: t.id,
              label: t.label,
              badge: t.badge,
              controls: `deck-view-panel-${t.id}`,
            }))}
          />
          {/* Desktop: the Deck view's stat strip sits on this row, beside the
              tabs and sticky with them (STYLE_GUIDE § Deck view). */}
          {isDesktop && <div className="deck-tabs-stats" ref={setStatSlot} />}
        </div>
      )}

      <DeckEditorLayout
        deck={deck}
        collectionCards={collectionCards}
        chrome={{ safeView, viewTabs, isDesktop, cover }}
        ui={ui}
        zoneEdits={zoneEdits}
        printingEdits={printingEdits}
        commanderEdits={commanderEdits}
        realloc={realloc}
        ownership={ownership}
        addFlow={addFlow}
        derived={derived}
        view={deckView}
        combosView={combosView}
        analysis={analysis}
        refine={refine}
        refineAlternatives={refineAlternatives}
        coachApply={coachApply}
        arrivals={arrivals}
        renderers={renderers}
        onCoachPreviewFit={handleCoachPreviewFit}
      />

      <DeckEditorOverlays
        deck={deck}
        collectionCards={collectionCards}
        binderDefs={binderDefs}
        deckTokens={deckTokens}
        comboSeedContext={comboSeedContext}
        ui={ui}
        view={deckView}
        ownership={ownership}
        addFlow={addFlow}
        printingEdits={printingEdits}
        commanderEdits={commanderEdits}
        realloc={realloc}
        derived={derived}
        analysis={analysis}
        combosView={combosView}
        coachApply={coachApply}
        refine={refine}
        refineAlternatives={refineAlternatives}
        renderers={renderers}
      />

      <DeckScryfallDropOverlay zoneLabel={addZoneLabel} onDropText={handleScryfallDrop} />

      {/* Suppress unused-import lint */}
      <span hidden>{updateDeck.name}</span>
    </div>
  );
}
