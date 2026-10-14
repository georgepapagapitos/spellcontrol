import {
  useMemo,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { DndContext, DragOverlay, getClientRect } from '@dnd-kit/core';
import type { PlaytestAction, PlaytestState, Zone } from '@/lib/playtest';
import { haptics } from '@/lib/util/haptics';
import type { OnlineTable } from '../../hooks/use-online-table';
import type { TakebackStatus } from '../../hooks/use-takeback';
import { useTablePointer } from '../../hooks/use-table-pointer';
import { useTurnSweep } from '../../hooks/use-turn-sweep';
import type { HandMenuState, ViewerMode } from '../../lib/board-support';
import { Battlefield } from '../Battlefield';
import { CardHoverPreview } from '../CardHoverPreview';
import { Hand } from '../Hand';
import { HordeBand } from '../horde/HordeBand';
import { HordeHalf } from '../horde/HordeHalf';
import { LifeStrip } from '../LifeStrip';
import { OpenSeatQuadrant, OpponentQuadrant } from '../OpponentQuadrant';
import { OpponentRail } from '../OpponentRail';
import { PlaytestCardFace } from '../PlaytestCardFace';
import { TableTicker } from '../TableTicker';
import { TakebackPendingBanner } from '../TakebackPendingBanner';
import { BoardBanners } from './BoardBanners';
import type { deriveOnlineHorde } from './board-derive';
import { DragHintBanner } from './DragHintBanner';
import { TableCornerActions } from './TableCornerActions';
import { TablePiles } from './TablePiles';
import type { useBoardArrows } from './use-board-arrows';
import type { useBoardDrag } from './use-board-drag';
import type { useBoardLayout } from './use-board-layout';
import type { useBoardOnlineHorde, useSoloHorde } from './use-board-horde';
import type { useBoardSelection } from './use-board-selection';
import type { useHandPreview } from './use-hand-preview';
import type { useTurnActions } from './use-turn-actions';

type Hand = ReturnType<typeof useHandPreview>;
type Drag = ReturnType<typeof useBoardDrag>;
type Selection = ReturnType<typeof useBoardSelection>;
type Layout = ReturnType<typeof useBoardLayout>;
type Arrows = ReturnType<typeof useBoardArrows>;
type Turn = ReturnType<typeof useTurnActions>;
type SoloHorde = ReturnType<typeof useSoloHorde>;
type OnlineHordeDerived = ReturnType<typeof deriveOnlineHorde>;

interface BoardMainProps
  extends
    Pick<
      Drag,
      | 'activeId'
      | 'activeDrag'
      | 'dragCardBox'
      | 'dragGroup'
      | 'sensors'
      | 'collisionDetection'
      | 'handleDragStart'
      | 'handleDragMove'
      | 'handleDragEnd'
      | 'handleDragCancel'
    >,
    Pick<
      Hand,
      | 'tappedPreviewId'
      | 'holdHintSeen'
      | 'resolvePreview'
      | 'handleHandCardMenu'
      | 'handleHandCardPreview'
      | 'unpinPreview'
    >,
    Pick<
      Selection,
      | 'selected'
      | 'selectMode'
      | 'handleCardClick'
      | 'toggleSelectMode'
      | 'clearSelection'
      | 'selectArea'
    >,
    Pick<Layout, 'opponents' | 'gridMode'>,
    Pick<Arrows, 'arrowFrom' | 'finishArrow'>,
    Pick<
      Turn,
      'activeName' | 'myTurn' | 'hordeBlocksTurn' | 'canAdvanceTurn' | 'advanceTurn' | 'doDraw'
    >,
    Pick<SoloHorde, 'horde' | 'hordeVisible' | 'hordeFeltRef'>,
    Pick<
      OnlineHordeDerived,
      | 'onlineHordePhase'
      | 'onlineHordeStatusText'
      | 'onlineHordeBandStatusText'
      | 'onlineHordeLoadView'
      | 'onlineHordeBlocked'
      | 'onlineHordeExtraAction'
      | 'onlineHordeView'
    >,
    Pick<ReturnType<typeof useBoardOnlineHorde>, 'onlineHorde' | 'isOnlineHordeTable'> {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  onlineTable: OnlineTable | null;
  takeback: TakebackStatus;
  isNarrow: boolean;
  isPhone: boolean;
  isChoosingHand: boolean;
  resistanceLevel: ComponentProps<typeof BoardBanners>['resistanceLevel'];
  keyFor: ComponentProps<typeof TableCornerActions>['keyFor'];
  battlefieldRef: RefObject<HTMLDivElement | null>;
  /** True while any sheet or menu is open, so the hover preview stands down. */
  anySheetOpen: boolean;
  hasUnreadLog: boolean;
  showGameMenu: boolean;
  setShowGameMenu: (open: boolean) => void;
  setLifePanelOpen: (open: boolean) => void;
  viewingBoardSeat: number | null;
  setViewingBoardSeat: (seat: number | null) => void;
  /** Whether the hand pile's menu is the one open. */
  handMenuOpen: boolean;
  setPileMenu: (menu: { zone: Zone; x: number; y: number; origin?: 'bottom-end' } | null) => void;
  setHandMenu: Dispatch<SetStateAction<HandMenuState>>;
  setViewer: (viewer: ViewerMode) => void;
  libraryCount: number;
  libraryReveal: ComponentProps<typeof TablePiles>['libraryReveal'];
  faceDownExile: Set<string>;
  taxCards: ComponentProps<typeof TablePiles>['taxCards'];
  openTableMenu: (x: number, y: number) => void;
  handleCardContext: (cardId: string, e: React.MouseEvent) => void;
  handleCardLongPress: (cardId: string, x: number, y: number) => void;
  setHordeCardMenuId: (id: string | null) => void;
  setHordeDamageOpen: (open: boolean) => void;
  withHordeActions: (node: ReactNode) => ReactNode;
}

export function BoardMain({
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
  tappedPreviewId,
  holdHintSeen,
  resolvePreview,
  handleHandCardMenu,
  handleHandCardPreview,
  unpinPreview,
  selected,
  selectMode,
  handleCardClick,
  toggleSelectMode,
  clearSelection,
  selectArea,
  opponents,
  gridMode,
  arrowFrom,
  finishArrow,
  activeName,
  myTurn,
  hordeBlocksTurn,
  canAdvanceTurn,
  advanceTurn,
  doDraw,
  horde,
  hordeVisible,
  hordeFeltRef,
  onlineHordePhase,
  onlineHordeStatusText,
  onlineHordeBandStatusText,
  onlineHordeLoadView,
  onlineHordeBlocked,
  onlineHordeExtraAction,
  onlineHordeView,
  onlineHorde,
  isOnlineHordeTable,
  state,
  dispatch,
  onlineTable,
  takeback,
  isNarrow,
  isPhone,
  isChoosingHand,
  resistanceLevel,
  keyFor,
  battlefieldRef,
  anySheetOpen,
  hasUnreadLog,
  showGameMenu,
  setShowGameMenu,
  setLifePanelOpen,
  viewingBoardSeat,
  setViewingBoardSeat,
  handMenuOpen,
  setPileMenu,
  setHandMenu,
  setViewer,
  libraryCount,
  libraryReveal,
  faceDownExile,
  taxCards,
  openTableMenu,
  handleCardContext,
  handleCardLongPress,
  setHordeCardMenuId,
  setHordeDamageOpen,
  withHordeActions,
}: BoardMainProps) {
  // Measure drag sources and drop targets with the box the browser actually
  // paints. dnd-kit's default is "transform-agnostic": it reads the element's
  // own `transform` and inverts it, so a card dnd-kit itself has translated
  // still measures where it started. That routine understands translate and
  // scale only — it reads a rotation matrix's `a`/`d` as scaleX/scaleY, and
  // for `rotate(90deg)` both are 0, so the box it hands back is half a card
  // up and to the left of the real one. A TAPPED permanent wears exactly that
  // rotation: its drag copy jumped off the card as you picked it up, and the
  // attach-drop target sat beside the creature rather than on it. Nothing
  // here needs the inversion — the source card is never translated (the
  // moving copy is a top-level <DragOverlay>), and the hand's fan rotation
  // lives on the slot wrapper rather than the card, so this changes the
  // measurement of tapped permanents and nothing else.
  // Both signals the rail carries today, lit on the quadrant instead.
  const sweepSeat = useTurnSweep(onlineTable?.activeSeat ?? undefined);
  const tablePointer = useTablePointer();

  const measuring = useMemo(
    () => ({ draggable: { measure: getClientRect }, droppable: { measure: getClientRect } }),
    []
  );

  // Playing with the hand revealed marks every card, the same way the
  // projection shows every card.
  const revealedIds = useMemo(
    () => new Set(state.handRevealed ? state.zones.hand.map((c) => c.id) : (state.revealed ?? [])),
    [state.handRevealed, state.zones.hand, state.revealed]
  );
  const stackIdSet = useMemo(() => new Set(state.stack ?? []), [state.stack]);

  const trackers = (
    <div className="playtest-trackers playtest-trackers--corner">
      <LifeStrip
        life={state.life}
        isNarrow={isNarrow}
        monarch={state.monarch}
        initiative={state.initiative}
        citysBlessing={state.citysBlessing}
        playerCounters={state.playerCounters ?? {}}
        onAdjustLife={(delta) => {
          haptics.tap();
          dispatch({ type: 'ADJUST_LIFE', delta });
        }}
        onAdjustCounter={(kind, delta) => {
          haptics.tap();
          dispatch({ type: 'SET_PLAYER_COUNTER', counter: kind, delta });
        }}
        onOpenChange={setLifePanelOpen}
        onlineTable={onlineTable}
        onViewOpponentBoard={setViewingBoardSeat}
        variant="table"
      />
    </div>
  );

  const pendingBanner = takeback.pendingRequest && (
    <TakebackPendingBanner
      request={takeback.pendingRequest}
      onCancel={takeback.cancelPending}
      message={takeback.pendingOutcomeMessage ?? undefined}
    />
  );

  // Whoever holds the TOP-RIGHT cell sits under the viewport-fixed turn/menu
  // stack: the right column at two seats, the second of the upper pair at
  // three or four. That quadrant insets its battlefield so no permanent of
  // theirs can render beneath the stack (see OpponentQuadrant.css).
  const topRightSeat = (opponents.length === 1 ? opponents[0] : opponents[1])?.board.seat;
  const renderQuadrant = (opp: (typeof opponents)[number]) => (
    <OpponentQuadrant
      key={opp.board.seat}
      opp={opp}
      active={onlineTable?.activeSeat === opp.board.seat}
      sweeping={sweepSeat === opp.board.seat}
      pointed={tablePointer?.targetSeat === opp.board.seat}
      watching={viewingBoardSeat === opp.board.seat}
      underTurnStack={opp.board.seat === topRightSeat}
      onOpen={() => setViewingBoardSeat(opp.board.seat)}
      onPickCard={arrowFrom ? (cardId) => finishArrow(opp.board.seat, cardId) : undefined}
    />
  );

  const cornerActions = (
    <TableCornerActions
      onlineTable={onlineTable}
      onlineHorde={onlineHorde}
      onlineHordePhase={onlineHordePhase}
      isOnlineHordeTable={isOnlineHordeTable}
      hordeBlocksTurn={hordeBlocksTurn}
      isNarrow={isNarrow}
      turn={state.turn}
      canAdvanceTurn={canAdvanceTurn}
      advanceTurn={advanceTurn}
      activeName={activeName}
      keyFor={keyFor}
      showGameMenu={showGameMenu}
      onOpenGameMenu={() => setShowGameMenu(true)}
      hasUnreadLog={hasUnreadLog}
      takebackPending={Boolean(takeback.pendingRequest)}
      selectMode={selectMode}
      selectedCount={selected.size}
      onToggleSelectMode={toggleSelectMode}
    />
  );

  const openPileMenu = (zone: Zone) => (x: number, y: number) => setPileMenu({ zone, x, y });

  /* Which piles stand on the felt, and which live behind the edge tab. Four
     card-width tiles plus a hand do not fit a PHONE, and the two that earn
     the room are the ones you touch every turn: the library (its click
     draws) and the graveyard. Exile and the command zone are a tap away in
     the tab — the same split EDHPlay makes, for the same reason. A tablet
     has the width for all four, so it keeps them. */
  const piles = (
    <TablePiles
      state={state}
      dispatch={dispatch}
      libraryCount={libraryCount}
      libraryReveal={libraryReveal}
      faceDownExile={faceDownExile}
      taxCards={taxCards}
      isPhone={isPhone}
      handMenuOpen={handMenuOpen}
      onOpenHandMenu={(x, y) => setPileMenu({ zone: 'hand', x, y, origin: 'bottom-end' })}
      doDraw={doDraw}
      openPileMenu={openPileMenu}
      onViewZone={(zone) => setViewer({ zone })}
      onCommanderMenu={(cardId, x, y) => setHandMenu({ cardId, x, y, zone: 'command' })}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={measuring}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className={`playtest-main${gridMode ? ' playtest-main--grid' : ''}${
          gridMode && opponents.length === 1 ? ' playtest-main--seats-2' : ''
        }${(!onlineTable ? hordeVisible : isOnlineHordeTable) && !isNarrow ? ' playtest-main--horde' : ''}${
          isOnlineHordeTable && !isNarrow ? ' playtest-main--horde-rail' : ''
        }`}
      >
        {onlineTable && !gridMode && (
          <OpponentRail
            opponents={
              onlineHorde
                ? onlineTable.opponents.map((opp) => ({
                    ...opp,
                    status: (onlineTable.players.find((p) => p.seat === opp.board.seat)
                      ?.connected === false
                      ? 'Offline'
                      : onlineHorde.team.done.includes(opp.board.seat)
                        ? 'Done'
                        : 'Playing') as 'Playing' | 'Done' | 'Offline',
                  }))
                : onlineTable.opponents
            }
            activeSeat={onlineTable.activeSeat ?? undefined}
          >
            <TableTicker onlineTable={onlineTable} />
          </OpponentRail>
        )}
        {/* Grid order is the table's seating: your own board is bottom-left,
              so with two seats the single opponent sits beside you and with
              three or four the others fill the row above. */}
        {gridMode && opponents.length > 1 && opponents.slice(0, 2).map(renderQuadrant)}
        {/* Solo Horde never exists at an online table, and a horde at an
              online table (E387 online co-op, lane F2) never exists solo —
              `hordeUiActive` below is exactly one or the other. The desktop
              half sits above your board (fixed two-row grid via
              `.playtest-main--horde`, plus a rail column online);
              the phone band folds above it inline. */}
        {(!onlineTable ? hordeVisible : isOnlineHordeTable) &&
          withHordeActions(
            isNarrow ? (
              <HordeBand
                horde={onlineTable ? onlineHordeView : horde}
                hordeLoad={onlineHordeLoadView}
                playerTurn={onlineTable ? (onlineHorde?.team.survivorTurn ?? 1) : state.turn}
                feltRef={hordeFeltRef}
                onCardMenu={setHordeCardMenuId}
                onOpenDamage={() => setHordeDamageOpen(true)}
                statusText={onlineHordeBandStatusText}
                blocked={onlineHordeBlocked}
                extraAction={onlineHordeExtraAction}
              />
            ) : (
              <HordeHalf
                horde={onlineTable ? onlineHordeView : horde}
                hordeLoad={onlineHordeLoadView}
                playerTurn={onlineTable ? (onlineHorde?.team.survivorTurn ?? 1) : state.turn}
                feltRef={hordeFeltRef}
                onCardMenu={setHordeCardMenuId}
                onOpenDamage={() => setHordeDamageOpen(true)}
                statusText={onlineHordeStatusText}
                blocked={onlineHordeBlocked}
              />
            )
          )}
        <div
          ref={battlefieldRef}
          // Solo play has no seat order, so every turn is yours and the
          // ring is always lit — the same expression the trigger reminder
          // already reads the board's turn with.
          className={`playtest-battlefield-wrap${onlineTable === null || myTurn ? ' is-my-turn' : ''}`}
          data-seat-anchor={onlineTable?.mySeat}
        >
          <Battlefield
            cards={state.battlefield}
            selectedIds={selected}
            ridingIds={dragGroup?.riding}
            stackIds={stackIdSet}
            onBackgroundClick={clearSelection}
            onMarqueeSelect={selectArea}
            onBackgroundContextMenu={openTableMenu}
            onCardClick={handleCardClick}
            onCardContextMenu={handleCardContext}
            onCardLongPress={handleCardLongPress}
            onAdjustPT={(cardId, power, toughness) =>
              dispatch({ type: 'ADJUST_PT', cardId, power, toughness })
            }
            onStepCounter={(cardId, counter, delta) =>
              dispatch({ type: 'SET_COUNTER', cardId, counter, delta })
            }
          />
          {/* The four corner clusters, floating over the felt rather than
                taking rows off the board's height — at EVERY width. A phone
                used to get a different board entirely: a title bar, eleven
                buttons in two rows, a life row and a mana row, which between
                them ate 40% of the screen before a single card was played.
                The felt is the thing worth the pixels, so the phone gets the
                same table the desktop does, sized for a thumb. */}
          {
            <>
              <div className="playtest-banners">
                {pendingBanner}
                <BoardBanners resistanceLevel={resistanceLevel} />
                <DragHintBanner
                  handCount={state.zones.hand.length}
                  battlefieldCount={state.battlefield.length}
                  isChoosingHand={isChoosingHand}
                />
              </div>
              {trackers}
              {cornerActions}
              {/* The ticker's home when there is no rail to hold it: the top
                    right of your own quadrant, so the feed stays visible
                    without parking chrome over somebody else's board. */}
              {gridMode && onlineTable && (
                <div className="playtest-ticker-dock">
                  <TableTicker onlineTable={onlineTable} />
                </div>
              )}
              {piles}
              <Hand
                cards={state.zones.hand}
                fan
                onCardMenu={handleHandCardMenu}
                onCardPreview={handleHandCardPreview}
                revealedIds={revealedIds}
              />
            </>
          }
        </div>
        {gridMode &&
          (opponents.length === 1
            ? opponents.map(renderQuadrant)
            : opponents.slice(2).map(renderQuadrant))}
        {gridMode && opponents.length === 2 && <OpenSeatQuadrant />}
      </div>
      <CardHoverPreview
        suspended={activeId !== null || anySheetOpen}
        resolve={resolvePreview}
        pinned={tappedPreviewId}
        onUnpin={unpinPreview}
        holdHint={!holdHintSeen}
      />
      {/* Above `--z-overlay` so a card dragged out of a sheet renders over
            the sheet, not behind it. */}
      {/* `playtest-drag-overlay` centres the copy in the wrapper, which
            dnd-kit sizes from the source's box. For a TAPPED card that box is
            the rotated one — width and height swapped — while the copy inside
            keeps the printed card's size and rotates about its own centre, so
            left at the wrapper's top-left it sits half the difference off the
            card. A no-op for an untapped card: the two boxes are the same. */}
      <DragOverlay dropAnimation={null} zIndex={1200} className="playtest-drag-overlay">
        {activeDrag && (
          <PlaytestCardFace
            card={activeDrag.card}
            bf={activeDrag.bf}
            size={activeDrag.size}
            className="playtest-card--dragging"
            style={{
              ...dragCardBox,
              transform: activeDrag.bf?.tapped ? 'rotate(90deg)' : undefined,
            }}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
