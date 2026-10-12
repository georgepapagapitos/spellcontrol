import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useConfirm } from '@/components/overlays/use-confirm';
import type { Designation, PlaytestCard, PlaytestState, Zone } from '@/lib/playtest';
import { usePlaytestStore } from '../store';

import { PHONE_QUERY, useNarrowViewport } from '../hooks/use-narrow-viewport';
import { useTurnAlert } from '../hooks/use-turn-alert';
import { useHoverTarget } from '../hooks/use-hover-target';
import {} from './TablePings';
import {} from './StackPanel';
import { useOnlineTable } from '../hooks/use-online-table';
import {} from '@/components/shared/Button';
import { useTakeback } from '../hooks/use-takeback';
import {} from './OpponentBoardModal';
import {} from './TableMoments';
import {} from './TableFinishedBanner';
import {} from './TriggerReminder';
import {} from './TakebackConsentPrompt';
import { haptics } from '@/lib/util/haptics';
import { suppressNativeContextMenu } from '@/lib/play/suppress-context-menu';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { TableContextMenu, type MenuEntry } from './TableContextMenu';
import { useRulesReferenceStore } from '@/store/rules-reference';
import {} from './TableArrows';
import type {} from './menu-entries';
import { MobileZonesPanel } from './MobileZonesPanel';
import { RotatePrompt } from './RotatePrompt';
import { HordeActionsProvider } from './horde/horde-actions';
import type {} from '../lib/auto-place';
import { ZONE_VIEWER_LABEL } from '../lib/zones';
import { useCardZoom } from '../hooks/use-card-zoom';
import { type ContextState, type ViewerMode } from '../lib/board-support';
import { deriveOnlineHorde } from './board/board-derive';
import { BoardHordeSheets } from './board/BoardHordeSheets';
import { buildPileMenuItems } from './board/pile-menu-items';
import { useCardActions } from './board/use-card-actions';
import { BoardTableOverlays } from './board/BoardTableOverlays';
import { useBoardOnlineHorde, useSoloHorde } from './board/use-board-horde';
import { BoardMain } from './board/BoardMain';
import { BoardOpeningHand } from './board/BoardOpeningHand';
import { useBattlefieldPlacement } from './board/use-battlefield-placement';
import { useBoardDeck } from './board/use-board-deck';
import { useOpeningHand } from './board/use-opening-hand';
import { useTakebackFeedback } from './board/use-takeback-feedback';
import { BoardEndSheets } from './board/BoardEndSheets';
import { BoardLeftDock } from './board/BoardLeftDock';
import { BoardSettingsSheets } from './board/BoardSettingsSheets';
import { BoardZoneSheets } from './board/BoardZoneSheets';
import { useBoardArrows } from './board/use-board-arrows';
import { useBoardDrag } from './board/use-board-drag';
import { useBoardLayout } from './board/use-board-layout';
import { useBoardLog } from './board/use-board-log';
import { useBoardPrefs } from './board/use-board-prefs';
import { useBoardSelection } from './board/use-board-selection';
import { useBoardShortcuts } from './board/use-board-shortcuts';
import { useHandPreview } from './board/use-hand-preview';
import { useTurnActions } from './board/use-turn-actions';
import {
  buildGameMenuFooter,
  buildGameMenuSections,
  buildSettingsLinks,
  buildSettingsToggles,
  buildTableMenuItems,
} from './board/board-menus';

interface Props {
  state: PlaytestState;
  /** The page's way back: the game menu's "Back to …" row and the opening
   *  hand's exit. The page has no header row of its own (E450), so this is
   *  the only one. Optional so PlaytestBoard's tests don't need to supply it. */
  backLabel?: string;
  onBack?(): void;
}

export function PlaytestBoard({ state, backLabel, onBack }: Props) {
  const dispatch = usePlaytestStore((s) => s.dispatch);
  const resistanceLevel = usePlaytestStore((s) => s.resistanceLevel);
  const setResistanceLevel = usePlaytestStore((s) => s.setResistanceLevel);
  const resistanceOptions = usePlaytestStore((s) => s.resistanceOptions);
  const setResistanceOptions = usePlaytestStore((s) => s.setResistanceOptions);
  const {
    horde,
    hordeLoad,
    disarmHorde,
    startHordeTurn,
    confirmHordeReveal,
    showHordeSetup,
    setShowHordeSetup,
    hordeCardMenuId,
    setHordeCardMenuId,
    hordeDamageOpen,
    setHordeDamageOpen,
    hordeFeltRef,
    hordeVisible,
  } = useSoloHorde();
  const gameLog = usePlaytestStore((s) => s.gameLog);
  const playtestDeckId = usePlaytestStore((s) => s.deckId);

  const { deck, taxCards, cardLookup, hordeDeckCardNames, deckTokenSources, tokensMadeBy } =
    useBoardDeck(state, playtestDeckId);

  const { confirm, dialog: confirmDialog } = useConfirm();

  const battlefieldRef = useRef<HTMLDivElement | null>(null);
  const [viewer, setViewer] = useState<ViewerMode>(null);
  const [ctx, setCtx] = useState<ContextState>(null);
  /** The card whose Custom counters dialog is open. */
  const [countersFor, setCountersFor] = useState<string | null>(null);
  // "View information" on a battlefield permanent or a card in hand — one
  // card, read in a centered dialog (`CardInfoDialog`). Browsing a whole zone
  // is still the shared `CardPreview` carousel (OpeningHandSheet /
  // ZoneViewerModal); a single card is not a carousel.
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [tokenCreator, setTokenCreator] = useState(false);
  const [showScry, setShowScry] = useState(false);
  // Which end of the library the scry sheet is looking at (P vs Shift+P).
  const [scryFrom, setScryFrom] = useState<'top' | 'bottom'>('top');
  // A single card off one end of the library, looked at without moving it —
  // the "is my top card a land" check that a whole scry sheet is too much
  // ceremony for. Holds the card itself, not an index, so the panel can't
  // end up showing a different card than the one that was peeked.
  const [peek, setPeek] = useState<{
    card: PlaytestCard;
    where: 'top' | 'bottom' | 'random';
    zone: Zone;
  } | null>(null);
  const [showStats, setShowStats] = useState(false);
  // The corner hamburger's drawer, and the host-only winner picker it opens.
  const [showGameMenu, setShowGameMenu] = useState(false);
  const [endingTable, setEndingTable] = useState(false);
  const { showLog, setShowLog, logOnTable, hasUnreadLog, handleOpenLog, toggleTableLog } =
    useBoardLog(gameLog);
  const [showDice, setShowDice] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTableSettings, setShowTableSettings] = useState(false);
  const isNarrow = useNarrowViewport();
  // Card size: a multiplier on the tier's card box (density-driven at the
  // desk, thumb-sized below 1024px), persisted per device and applied on
  // <body> (where `--pt-card-w` lives so the drag overlay inherits it). 1 is
  // the size the tier computes.
  const { zoom, stepZoom, setZoomTo } = useCardZoom(battlefieldRef, isNarrow);
  const [showResistancePicker, setShowResistancePicker] = useState(false);
  const [showDesignations, setShowDesignations] = useState(false);
  const [showTakebackSettings, setShowTakebackSettings] = useState(false);
  const [lifePanelOpen, setLifePanelOpen] = useState(false);
  // Table-tier chrome: the right-click menu on bare felt, and the mana
  // tracker's collapsed-when-empty state (M, or the "Mana" chip).
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null);
  // Which zone pile's menu is open, and where. Same menu component the felt
  // uses; the pile just supplies its own title and its own items.
  const [pileMenu, setPileMenu] = useState<{
    zone: Zone;
    x: number;
    y: number;
    /** Set when a button opened it rather than a pointer (the Hand button). */
    origin?: 'bottom-end';
  } | null>(null);
  const [manaOpen, setManaOpen] = useState(false);
  // "View board" from an online opponent's LifeStrip panel — opens the same
  // full-board inspector OpponentRail's own tap-to-open already uses.
  const [viewingBoardSeat, setViewingBoardSeat] = useState<number | null>(null);
  /* A phone, specifically. `isNarrow` is the tier boundary the CSS uses for
     sizing (≤1023px covers a tablet too); this one answers the narrower
     question of whether four card-width piles fit along the bottom beside
     the hand. On a tablet they do. A phone on its side is wider than the
     phone line, so this asks about its height too. */
  const isPhone = useMediaQuery(PHONE_QUERY);
  const {
    shortcutOverrides,
    bindings,
    keyFor,
    changeShortcuts,
    isFullscreen,
    felt,
    setFelt,
    snap,
    setSnap,
    turnAlert,
    setTurnAlert,
  } = useBoardPrefs();
  // The conditional multiplayer seam (see use-online-table.ts): non-null only
  // when there's an active online game AND this device holds a seat in it.
  // Publishes `state` internally; solo playtest never touches it beyond this
  // one hook call, and null here means the rail below never renders.
  const onlineTable = useOnlineTable(state);
  const { phase, mulliganCount, onlineMulliganType, openingOnline, isChoosingHand } =
    useOpeningHand(onlineTable);
  const { onlineHorde, isOnlineHordeTable } = useBoardOnlineHorde(
    onlineTable,
    isNarrow,
    hordeFeltRef
  );
  useTurnAlert(onlineTable !== null && onlineTable.activeSeat === onlineTable.mySeat, turnAlert);
  // The card a per-card shortcut acts on when nothing is selected — see
  // hooks/use-hover-target. A ref, not state: it changes on every card the
  // pointer crosses and is only ever read inside a keydown.
  const hoverTarget = useHoverTarget();

  const {
    sendSignal,
    arrowFrom,
    setArrowFrom,
    beginArrow,
    finishArrow,
    clearMyArrows,
    myArrowCount,
    pings,
    ping,
  } = useBoardArrows(onlineTable);

  const { opponents, gridFits, gridMode, toggleLayout } = useBoardLayout(
    onlineTable,
    isNarrow,
    isOnlineHordeTable
  );
  const {
    handMenu,
    setHandMenu,
    handMenuZone,
    handMenuCard,
    tappedPreviewId,
    setTappedPreviewId,
    holdHintSeen,
    retireHoldHint,
    resolvePreview,
    handleHandCardMenu,
    handleHandCardPreview,
    unpinPreview,
  } = useHandPreview(state, opponents);
  const {
    selected,
    setSelected,
    selectMode,
    setSelectMode,
    clipboard,
    setClipboard,
    handleCardClick,
    toggleSelectMode,
    clearSelection,
    selectArea,
    tapSelection,
    moveSelection,
  } = useBoardSelection({ state, dispatch, onlineTable, arrowFrom, finishArrow, ping });
  const {
    activeId,
    activeDrag,
    dragCardBox,
    dragGroup,
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  } = useBoardDrag({
    state,
    dispatch,
    battlefieldRef,
    selected,
    snap,
    onPickUp: () => setTappedPreviewId(null),
  });
  const takeback = useTakeback(onlineTable);

  /**
   * Token-copy `sourceIds`, minting each clone's instance id here so the
   * reducer stays pure. The clipboard then re-points at the clones it just
   * made, which is what makes repeated pastes cascade across the battlefield
   * instead of restacking on the same spot.
   */
  const cloneCards = useCallback(
    (sourceIds: readonly string[]) => {
      if (sourceIds.length === 0) return;
      // Same id shape as TokenCreator's: wall-clock + entropy, so an id can't
      // collide with one already in a resumed snapshot.
      const batch = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const clones = sourceIds.map((sourceId, i) => ({ sourceId, id: `copy-${batch}-${i}` }));
      dispatch({ type: 'CLONE_BF_CARDS', clones });
      haptics.tap();
      return clones.map((c) => c.id);
    },
    [dispatch]
  );

  const handleCardContext = useCallback((cardId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setCtx({ cardId, x: e.clientX, y: e.clientY });
  }, []);

  const handleCardLongPress = useCallback(
    (cardId: string, x: number, y: number) => {
      setCtx({ cardId, x, y });
      retireHoldHint();
    },
    [retireHoldHint]
  );

  const openTableMenu = useCallback((x: number, y: number) => setTableMenu({ x, y }), []);

  const { placeOnBattlefield, playFromHand, createToken, castCommander, handlePeekMove } =
    useBattlefieldPlacement(state, dispatch, battlefieldRef);

  // Gone from the battlefield (moved, or taken back) closes the dialog with it.
  const countersBf = countersFor
    ? state.battlefield.find((b) => b.card.id === countersFor)
    : undefined;
  const anySheetOpen =
    phase !== 'playing' ||
    viewer !== null ||
    ctx !== null ||
    handMenu !== null ||
    tokenCreator ||
    showScry ||
    showStats ||
    // The docked log (table tier) is deliberately NOT here: it is non-modal
    // chrome, so shortcuts and the hover preview keep working beside it. The
    // narrow tier's log is a real sheet and still counts.
    (showLog && isNarrow) ||
    tableMenu !== null ||
    pileMenu !== null ||
    showDice ||
    peek !== null ||
    showShortcuts ||
    showGameMenu ||
    endingTable ||
    showTableSettings ||
    showResistancePicker ||
    showDesignations ||
    countersFor !== null ||
    showTakebackSettings ||
    lifePanelOpen ||
    Boolean(confirmDialog);

  const handleTakebackClick = useTakebackFeedback(takeback);

  const {
    activeName,
    myTurn,
    canPassTurn,
    hordeBlocksTurn,
    canAdvanceTurn,
    doDraw,
    doNextTurn,
    doNextTurnHordeAware,
    doUntapAll,
    doPassTurn,
    doReset,
    concedeOnline,
    leaveTable,
    adjustMyLife,
    advanceTurn,
    advancePhase,
  } = useTurnActions({
    state,
    dispatch,
    onlineTable,
    onlineHorde,
    horde,
    hordeFeltRef,
    startHordeTurn,
    confirm,
  });

  // A horde at an online table (E387 online co-op): 'setup' and 'survivors'
  // read as one "team's turn" phase everywhere the chip/half/band/rail wording
  // groups them (STYLE_GUIDE "Horde at an online table") — 'reveal'/'combat'
  // are the horde's own turn, and 'ended' overrides all of it once the
  // replay has an outcome.
  const {
    onlineHordePhase,
    onlineHordeStatusText,
    onlineHordeBandStatusText,
    onlineHordeLoadView,
    onlineHordeBlocked,
    onlineHordeExtraAction,
    onlineHordeView,
    onlineHordeOutcome,
    onlineHordePendingReveal,
  } = deriveOnlineHorde(onlineHorde);
  // The online horde's actions (lane F1's `useOnlineHorde`) route through
  // the server instead of the solo playtest store. Only the horde's own
  // mounts are wrapped, so the rest of the board is untouched.
  const withHordeActions = (node: ReactNode) => (
    <HordeActionsProvider value={onlineHorde?.actions ?? null}>{node}</HordeActionsProvider>
  );

  const libraryCount = state.zones.library.length;
  const libraryReveal = state.libraryReveal ?? 'none';
  // Exile's face-down cards, as a set for the viewer's per-card badge.
  const faceDownExile = useMemo(() => new Set(state.faceDownExile ?? []), [state.faceDownExile]);
  const openRules = useRulesReferenceStore((s) => s.open);

  const {
    stackItems,
    putOnStack,
    copyOntoStack,
    resolveStack,
    locatable,
    toggleReveal,
    moveToBattlefield,
    adjustPT,
    adjustAllCounters,
    openCounters,
    triggerCards,
    locateCard,
    peekZone,
    sendReaction,
  } = useCardActions({
    state,
    dispatch,
    onlineTable,
    sendSignal,
    cardLookup,
    placeOnBattlefield,
    cloneCards,
    setSelected,
    setCountersFor,
    setPeek,
  });

  // City's Blessing is a genuine one-time accomplishment (never lost this
  // game) — a stronger haptic cue than the routine tap monarch/initiative get.
  function handleSetDesignation(designation: Designation, held: boolean) {
    if (designation === 'citysBlessing') haptics.success();
    else haptics.tap();
    dispatch({ type: 'SET_DESIGNATION', designation, held });
    // Mirror monarch/initiative onto the table so its published board (and
    // every opponent's rail) agrees with what this seat just claimed/dropped.
    // City's Blessing has no table-level field (GameDesignations tracks only
    // monarch/initiative) — it stays local-only, same as solo playtest.
    if (onlineTable && (designation === 'monarch' || designation === 'initiative')) {
      onlineTable.dispatch({
        type: 'set-designation',
        designation,
        seat: held ? onlineTable.mySeat : null,
        actorSeat: onlineTable.mySeat,
      });
    }
  }

  useBoardShortcuts({
    anySheetOpen,
    bindings,
    state,
    dispatch,
    onlineTable,
    isNarrow,
    libraryCount,
    hoverTarget,
    selected,
    clipboard,
    clearSelection,
    cloneCards,
    setSelected,
    setSelectMode,
    setClipboard,
    arrowFrom,
    setArrowFrom,
    beginArrow,
    clearMyArrows,
    myArrowCount,
    handleTakebackClick,
    handleOpenLog,
    showLog,
    setShowLog,
    canPassTurn,
    advanceTurn,
    doDraw,
    doNextTurn,
    doNextTurnHordeAware,
    doPassTurn,
    doUntapAll,
    advancePhase,
    adjustMyLife,
    toggleLayout,
    stepZoom,
    setTableMenu,
    setViewingBoardSeat,
    setShowShortcuts,
    setViewer,
    setScryFrom,
    setShowScry,
    setShowDice,
    setTokenCreator,
    setManaOpen,
    locatable,
    putOnStack,
    copyOntoStack,
    resolveStack,
    toggleReveal,
    moveToBattlefield,
    adjustPT,
    adjustAllCounters,
    openCounters,
    peekZone,
    sendReaction,
  });

  // ── Table-tier chrome (≥1024px) ─────────────────────────────────────────
  // Everything the deleted rows used to offer, regrouped into the four
  // corners. Built here rather than in a component of its own because every
  // item is one of this component's own handlers — a wrapper would be thirty
  // props of pure pass-through.
  const heldDesignations = [
    state.monarch && 'Monarch',
    state.initiative && 'Initiative',
    state.citysBlessing && "City's Blessing",
  ].filter((label): label is string => Boolean(label));

  // Everything you set once and forget lives behind "Table settings" (see
  // `TableSettingsSheet`); the menu itself is actions. Library actions
  // (Shuffle, Top cards) moved onto the library pile, where the cards are,
  // and Mulligan is offered by the opening-hand takeover that owns it.
  const settingsLinks = buildSettingsLinks({
    takeback,
    onlineTable,
    horde,
    resistanceLevel,
    setShowTableSettings,
    setShowTakebackSettings,
    setShowHordeSetup,
    setShowResistancePicker,
  });
  const settingsToggles = buildSettingsToggles({
    snap,
    setSnap,
    turnAlert,
    setTurnAlert,
    onlineTable,
  });

  const gameMenuSections = buildGameMenuSections({
    hasUnreadLog,
    handleOpenLog,
    gridFits,
    gridMode,
    toggleLayout,
    myArrowCount,
    clearMyArrows,
    openRules,
    heldDesignations,
    onlineHorde,
    isFullscreen,
    setShowStats,
    setShowDesignations,
    setShowTableSettings,
    setShowShortcuts,
  });
  // Online, the table is shared: conceding marks this seat out for everyone,
  // ending it finishes the game for the whole pod, and leaving gives the seat
  // up. All three ask first; all three are the game's truth, not this
  // device's, so they go through the session.
  const gameMenuFooter = buildGameMenuFooter({
    onBack,
    backLabel,
    onlineTable,
    doReset,
    concedeOnline,
    leaveTable,
    setEndingTable,
  });

  const tableMenuItems = buildTableMenuItems({
    state,
    onlineTable,
    takeback,
    canPassTurn,
    hordeBlocksTurn,
    manaOpen,
    selectMode,
    keyFor,
    doPassTurn,
    doNextTurnHordeAware,
    doUntapAll,
    setManaOpen,
    setTokenCreator,
    setViewer,
    setShowDice,
    setShowDesignations,
    sendReaction,
    toggleSelectMode,
    handleTakebackClick,
  });

  const pileMenuItems = (zone: Zone): MenuEntry[] =>
    buildPileMenuItems(zone, {
      state,
      dispatch,
      onlineTable,
      keyFor,
      libraryCount,
      libraryReveal,
      doDraw,
      peekZone,
      setViewer,
      setPileMenu,
      setScryFrom,
      setShowScry,
    });

  return (
    <div
      className={`playtest-board${isNarrow ? ' playtest-board--narrow' : ''}${
        selectMode ? ' is-selecting' : ''
      }`}
      // The catch-all below the card/felt handlers, which open the real menus:
      // by the time it runs the board has had its say, and everything it did
      // not claim (badges, zone piles, chrome, gaps) loses the native menu too.
      onContextMenu={suppressNativeContextMenu}
    >
      <BoardTableOverlays
        state={state}
        onlineTable={onlineTable}
        myTurn={myTurn}
        keyFor={keyFor}
        viewingBoardSeat={viewingBoardSeat}
        setViewingBoardSeat={setViewingBoardSeat}
        arrowFrom={arrowFrom}
        setArrowFrom={setArrowFrom}
        finishArrow={finishArrow}
        beginArrow={beginArrow}
        pings={pings}
        stackItems={stackItems}
        copyOntoStack={copyOntoStack}
        resolveStack={resolveStack}
        triggerCards={triggerCards}
        locateCard={locateCard}
      />

      <BoardMain
        activeId={activeId}
        activeDrag={activeDrag}
        dragCardBox={dragCardBox}
        dragGroup={dragGroup}
        sensors={sensors}
        collisionDetection={collisionDetection}
        handleDragStart={handleDragStart}
        handleDragMove={handleDragMove}
        handleDragEnd={handleDragEnd}
        handleDragCancel={handleDragCancel}
        tappedPreviewId={tappedPreviewId}
        holdHintSeen={holdHintSeen}
        resolvePreview={resolvePreview}
        handleHandCardMenu={handleHandCardMenu}
        handleHandCardPreview={handleHandCardPreview}
        unpinPreview={unpinPreview}
        selected={selected}
        selectMode={selectMode}
        handleCardClick={handleCardClick}
        toggleSelectMode={toggleSelectMode}
        clearSelection={clearSelection}
        selectArea={selectArea}
        opponents={opponents}
        gridMode={gridMode}
        arrowFrom={arrowFrom}
        finishArrow={finishArrow}
        activeName={activeName}
        myTurn={myTurn}
        hordeBlocksTurn={hordeBlocksTurn}
        canAdvanceTurn={canAdvanceTurn}
        advanceTurn={advanceTurn}
        doDraw={doDraw}
        horde={horde}
        hordeVisible={hordeVisible}
        hordeFeltRef={hordeFeltRef}
        onlineHordePhase={onlineHordePhase}
        onlineHordeStatusText={onlineHordeStatusText}
        onlineHordeBandStatusText={onlineHordeBandStatusText}
        onlineHordeLoadView={onlineHordeLoadView}
        onlineHordeBlocked={onlineHordeBlocked}
        onlineHordeExtraAction={onlineHordeExtraAction}
        onlineHordeView={onlineHordeView}
        onlineHorde={onlineHorde}
        isOnlineHordeTable={isOnlineHordeTable}
        state={state}
        dispatch={dispatch}
        onlineTable={onlineTable}
        takeback={takeback}
        isNarrow={isNarrow}
        isPhone={isPhone}
        isChoosingHand={isChoosingHand}
        resistanceLevel={resistanceLevel}
        keyFor={keyFor}
        battlefieldRef={battlefieldRef}
        anySheetOpen={anySheetOpen}
        hasUnreadLog={hasUnreadLog}
        showGameMenu={showGameMenu}
        setShowGameMenu={setShowGameMenu}
        setLifePanelOpen={setLifePanelOpen}
        viewingBoardSeat={viewingBoardSeat}
        setViewingBoardSeat={setViewingBoardSeat}
        setPileMenu={setPileMenu}
        setHandMenu={setHandMenu}
        setViewer={setViewer}
        libraryCount={libraryCount}
        libraryReveal={libraryReveal}
        faceDownExile={faceDownExile}
        taxCards={taxCards}
        openTableMenu={openTableMenu}
        handleCardContext={handleCardContext}
        handleCardLongPress={handleCardLongPress}
        setHordeCardMenuId={setHordeCardMenuId}
        setHordeDamageOpen={setHordeDamageOpen}
        withHordeActions={withHordeActions}
        handMenuOpen={pileMenu?.zone === 'hand'}
      />

      <BoardLeftDock
        state={state}
        dispatch={dispatch}
        onlineTable={onlineTable}
        manaOpen={manaOpen}
        setManaOpen={setManaOpen}
        showLog={showLog}
        setShowLog={setShowLog}
        logOnTable={logOnTable}
        toggleTableLog={toggleTableLog}
        gameLog={gameLog}
        playtestDeckId={playtestDeckId}
      />

      {tableMenu && (
        <TableContextMenu
          x={tableMenu.x}
          y={tableMenu.y}
          items={tableMenuItems}
          onClose={() => setTableMenu(null)}
        />
      )}

      {pileMenu && (
        <TableContextMenu
          x={pileMenu.x}
          y={pileMenu.y}
          // One menu, two presentations: a cursor-anchored popover where
          // there is a cursor, the shared bottom sheet where there is a thumb.
          origin={pileMenu.origin}
          title={ZONE_VIEWER_LABEL[pileMenu.zone]}
          items={pileMenuItems(pileMenu.zone)}
          onClose={() => setPileMenu(null)}
        />
      )}

      {isPhone && (
        <MobileZonesPanel
          zones={state.zones}
          hiddenIds={faceDownExile}
          commanderTax={state.commanderTax}
          taxCards={taxCards}
          onAdjustTax={(cardId, delta) => dispatch({ type: 'ADJUST_COMMANDER_TAX', cardId, delta })}
          onOpenZone={(zone) => setViewer({ zone })}
          // The sheet variant is anchored by the viewport, not the pointer,
          // so the coordinates are unused here — 0,0 says so.
          onMenu={(zone) => setPileMenu({ zone, x: 0, y: 0 })}
        />
      )}

      <BoardZoneSheets
        state={state}
        dispatch={dispatch}
        onlineTable={onlineTable}
        cardLookup={cardLookup}
        keyFor={keyFor}
        libraryCount={libraryCount}
        faceDownExile={faceDownExile}
        placeOnBattlefield={placeOnBattlefield}
        playFromHand={playFromHand}
        castCommander={castCommander}
        viewer={viewer}
        setViewer={setViewer}
        ctx={ctx}
        setCtx={setCtx}
        selected={selected}
        tapSelection={tapSelection}
        moveSelection={moveSelection}
        cloneCards={cloneCards}
        beginArrow={beginArrow}
        copyOntoStack={copyOntoStack}
        putOnStack={putOnStack}
        adjustAllCounters={adjustAllCounters}
        setPreviewCardId={setPreviewCardId}
        setCountersFor={setCountersFor}
        tokensMadeBy={tokensMadeBy}
        createToken={createToken}
        deckTokenSources={deckTokenSources}
        tokenCreator={tokenCreator}
        setTokenCreator={setTokenCreator}
        handMenu={handMenu}
        handMenuZone={handMenuZone}
        handMenuCard={handMenuCard}
        setHandMenu={setHandMenu}
        previewCardId={previewCardId}
        showScry={showScry}
        scryFrom={scryFrom}
        setShowScry={setShowScry}
        peek={peek}
        setPeek={setPeek}
        handlePeekMove={handlePeekMove}
        showDice={showDice}
        setShowDice={setShowDice}
      />

      <BoardSettingsSheets
        state={state}
        dispatch={dispatch}
        deck={deck}
        onlineTable={onlineTable}
        takeback={takeback}
        isNarrow={isNarrow}
        showTableSettings={showTableSettings}
        setShowTableSettings={setShowTableSettings}
        zoom={zoom}
        setZoomTo={setZoomTo}
        felt={felt}
        setFelt={setFelt}
        settingsToggles={settingsToggles}
        settingsLinks={settingsLinks}
        showShortcuts={showShortcuts}
        setShowShortcuts={setShowShortcuts}
        shortcutOverrides={shortcutOverrides}
        changeShortcuts={changeShortcuts}
        showResistancePicker={showResistancePicker}
        setShowResistancePicker={setShowResistancePicker}
        resistanceLevel={resistanceLevel}
        setResistanceLevel={setResistanceLevel}
        resistanceOptions={resistanceOptions}
        setResistanceOptions={setResistanceOptions}
        countersBf={countersBf}
        setCountersFor={setCountersFor}
        showDesignations={showDesignations}
        setShowDesignations={setShowDesignations}
        handleSetDesignation={handleSetDesignation}
        showTakebackSettings={showTakebackSettings}
        setShowTakebackSettings={setShowTakebackSettings}
      />

      <BoardOpeningHand
        phase={phase}
        mulliganCount={mulliganCount}
        onlineMulliganType={onlineMulliganType}
        openingOnline={openingOnline}
        state={state}
        onlineTable={onlineTable}
        horde={horde}
        cardLookup={cardLookup}
        deckName={deck?.name}
        playtestDeckId={playtestDeckId}
        backLabel={backLabel}
        onBack={onBack}
        onOpenHordeSetup={() => setShowHordeSetup(true)}
      />

      {/* Solo Horde (E387 PR 5) — a horde never exists at an online table.
          Mounted AFTER `OpeningHandSheet`, not before it: both use the same
          `.card-picker-root` overlay layer, and that layer has no z-index
          ordering of its own — later in the DOM paints (and receives
          pointer events) on top. The setup sheet opens FROM the opening-hand
          takeover's own row, so it has to out-rank the takeover it was
          opened from, the same way a sheet opened from within a component
          (e.g. this file's own CardPreview, mounted last in its return)
          always sits after its opener. Mounted before this comment once,
          which put "Fight the horde" under the takeover and ate the click. */}
      <BoardHordeSheets
        onlineTable={onlineTable}
        onlineHorde={onlineHorde}
        onlineHordeView={onlineHordeView}
        onlineHordeOutcome={onlineHordeOutcome}
        onlineHordePendingReveal={onlineHordePendingReveal}
        horde={horde}
        hordeLoad={hordeLoad}
        hordeDeckCardNames={hordeDeckCardNames}
        hordeFeltRef={hordeFeltRef}
        showHordeSetup={showHordeSetup}
        resistanceOn={resistanceLevel !== 'off'}
        hordeCardMenuId={hordeCardMenuId}
        hordeDamageOpen={hordeDamageOpen}
        turn={state.turn}
        dispatch={dispatch}
        disarmHorde={disarmHorde}
        confirmHordeReveal={confirmHordeReveal}
        leaveTable={leaveTable}
        withHordeActions={withHordeActions}
        onCloseSetup={() => setShowHordeSetup(false)}
        onCloseCardMenu={() => setHordeCardMenuId(null)}
        onCloseDamage={() => setHordeDamageOpen(false)}
      />

      <BoardEndSheets
        state={state}
        deck={deck}
        cardLookup={cardLookup}
        mulliganCount={mulliganCount}
        onlineTable={onlineTable}
        isNarrow={isNarrow}
        gameLog={gameLog}
        showStats={showStats}
        setShowStats={setShowStats}
        showGameMenu={showGameMenu}
        setShowGameMenu={setShowGameMenu}
        gameMenuSections={gameMenuSections}
        gameMenuFooter={gameMenuFooter}
        endingTable={endingTable}
        setEndingTable={setEndingTable}
        showLog={showLog}
        setShowLog={setShowLog}
      />

      <RotatePrompt fullscreen={isFullscreen} />

      {confirmDialog}
    </div>
  );
}
