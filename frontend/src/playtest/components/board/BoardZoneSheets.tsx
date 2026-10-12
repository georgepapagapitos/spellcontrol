import type { Dispatch, SetStateAction } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { PlaytestAction, PlaytestCard, PlaytestState, Zone } from '@/lib/playtest';
import { haptics } from '@/lib/util/haptics';
import type { OnlineTable } from '../../hooks/use-online-table';
import { FALLBACK_DROP_POS } from '../../lib/board-support';
import type { ContextState, HandMenuState, ViewerMode } from '../../lib/board-support';
import type { ShortcutId } from '../../lib/shortcuts';
import { DiceRoller } from '../DiceRoller';
import { HandCardMenu } from '../HandCardMenu';
import type { MadeToken } from '../menu-entries';
import { ScrySheet } from '../ScrySheet';
import { TokenCreator } from '../TokenCreator';
import { ZoneViewerModal } from '../ZoneViewerModal';
import { BoardCardContextMenu } from './BoardCardContextMenu';
import { BoardCardInfo } from './BoardCardInfo';
import { PeekModal, type PeekState } from './PeekModal';

interface BoardZoneSheetsProps {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  onlineTable: OnlineTable | null;
  cardLookup: Map<string, ScryfallCard> | undefined;
  keyFor: (id: ShortcutId) => string | undefined;
  libraryCount: number;
  faceDownExile: Set<string>;
  /** Reads live DOM geometry and is redefined every render by design. */
  placeOnBattlefield: (card: PlaytestCard) => { x: number; y: number };
  playFromHand: (cardId: string, opts?: { tapped?: boolean; faceDown?: boolean }) => void;
  castCommander: (card: PlaytestCard) => void;
  // Zone viewer.
  viewer: ViewerMode;
  setViewer: (viewer: ViewerMode) => void;
  // Battlefield card menu.
  ctx: ContextState;
  setCtx: (ctx: ContextState) => void;
  selected: ReadonlySet<string>;
  tapSelection: () => void;
  moveSelection: (to: Zone, toIndex?: number) => void;
  cloneCards: (sourceIds: readonly string[]) => string[] | undefined;
  beginArrow: (cardIds: ReadonlySet<string>) => boolean | void;
  copyOntoStack: (cardIds: readonly string[]) => unknown;
  putOnStack: (cardIds: readonly string[]) => unknown;
  adjustAllCounters: (
    cardIds: readonly string[],
    op: 'inc' | 'double' | 'dec' | 'clear'
  ) => unknown;
  setPreviewCardId: (cardId: string | null) => void;
  setCountersFor: (cardId: string | null) => void;
  // Tokens.
  tokensMadeBy: (name: string) => MadeToken[];
  createToken: (token: MadeToken & { imageUrl?: string }) => void;
  deckTokenSources: ScryfallCard[];
  tokenCreator: boolean;
  setTokenCreator: (open: boolean) => void;
  // Hand menu.
  handMenu: HandMenuState;
  handMenuZone: 'hand' | 'command';
  handMenuCard: PlaytestCard | null | undefined;
  setHandMenu: Dispatch<SetStateAction<HandMenuState>>;
  // Card info, scry, peek, dice.
  previewCardId: string | null;
  showScry: boolean;
  scryFrom: 'top' | 'bottom';
  setShowScry: (open: boolean) => void;
  peek: PeekState | null;
  setPeek: (peek: PeekState | null) => void;
  handlePeekMove: (card: PlaytestCard, to: 'hand' | 'battlefield' | 'graveyard' | 'exile') => void;
  showDice: boolean;
  setShowDice: (open: boolean) => void;
}

/** The sheets and menus that act on cards and zones: the zone viewer, the
 *  battlefield and hand card menus, card info, the token creator, scry, peek
 *  and the dice. Each opens from a gesture on the felt and closes back to it. */
export function BoardZoneSheets({
  state,
  dispatch,
  onlineTable,
  cardLookup,
  keyFor,
  libraryCount,
  faceDownExile,
  placeOnBattlefield,
  playFromHand,
  castCommander,
  viewer,
  setViewer,
  ctx,
  setCtx,
  selected,
  tapSelection,
  moveSelection,
  cloneCards,
  beginArrow,
  copyOntoStack,
  putOnStack,
  adjustAllCounters,
  setPreviewCardId,
  setCountersFor,
  tokensMadeBy,
  createToken,
  deckTokenSources,
  tokenCreator,
  setTokenCreator,
  handMenu,
  handMenuZone,
  handMenuCard,
  setHandMenu,
  previewCardId,
  showScry,
  scryFrom,
  setShowScry,
  peek,
  setPeek,
  handlePeekMove,
  showDice,
  setShowDice,
}: BoardZoneSheetsProps) {
  return (
    <>
      {viewer && (
        <ZoneViewerModal
          zone={viewer.zone}
          cards={state.zones[viewer.zone]}
          commanderTax={state.commanderTax}
          onClose={() => setViewer(null)}
          onMove={(cardId, to, toIndex) => {
            if (to === 'battlefield') {
              const c = state.zones[viewer.zone].find((card) => card.id === cardId) ?? null;
              const pos = c ? placeOnBattlefield(c) : FALLBACK_DROP_POS;
              dispatch({ type: 'MOVE_TO_BATTLEFIELD', cardId, x: pos.x, y: pos.y });
            } else {
              dispatch({ type: 'MOVE_TO_ZONE', cardId, to, toIndex });
            }
          }}
          onShuffleAfter={
            viewer.zone === 'library'
              ? () => {
                  dispatch({ type: 'SHUFFLE_LIBRARY' });
                  setViewer(null);
                }
              : undefined
          }
          hiddenIds={viewer.zone === 'exile' ? faceDownExile : undefined}
          libraryCount={libraryCount}
          onShuffleIntoLibrary={
            viewer.zone === 'graveyard' || viewer.zone === 'exile'
              ? () => {
                  dispatch({
                    type: 'SHUFFLE_ZONE_INTO_LIBRARY',
                    zone: viewer.zone as 'graveyard' | 'exile',
                  });
                  setViewer(null);
                }
              : undefined
          }
          cardLookup={cardLookup}
        />
      )}

      {ctx && (
        <BoardCardContextMenu
          ctx={ctx}
          battlefield={state.battlefield}
          libraryCount={libraryCount}
          cardLookup={cardLookup}
          selected={selected}
          onlineTable={onlineTable}
          dispatch={dispatch}
          keyFor={keyFor}
          tokensMadeBy={tokensMadeBy}
          createToken={createToken}
          tapSelection={tapSelection}
          moveSelection={moveSelection}
          cloneCards={cloneCards}
          beginArrow={beginArrow}
          copyOntoStack={copyOntoStack}
          putOnStack={putOnStack}
          adjustAllCounters={adjustAllCounters}
          onPreview={setPreviewCardId}
          onOpenCustomCounters={setCountersFor}
          onClose={() => setCtx(null)}
        />
      )}

      {handMenu && handMenuCard && (
        <HandCardMenu
          x={handMenu.x}
          y={handMenu.y}
          cardName={handMenuCard.name}
          zone={handMenuZone}
          libraryCount={libraryCount}
          tokens={tokensMadeBy(handMenuCard.name)}
          onCreateToken={createToken}
          keyFor={keyFor}
          onClose={() => setHandMenu(null)}
          onPreview={
            cardLookup?.has(handMenu.cardId) ? () => setPreviewCardId(handMenu.cardId) : undefined
          }
          onPlay={(opts) => {
            if (handMenuZone === 'command') {
              castCommander(handMenuCard);
              return;
            }
            playFromHand(handMenu.cardId, opts);
          }}
          onMoveTo={(zone, toIndex) =>
            dispatch({ type: 'MOVE_TO_ZONE', cardId: handMenu.cardId, to: zone, toIndex })
          }
          revealed={(state.revealed ?? []).includes(handMenu.cardId)}
          // With the whole hand revealed there is nothing one card can add.
          onToggleReveal={
            onlineTable && !state.handRevealed
              ? () => dispatch({ type: 'TOGGLE_REVEAL', cardId: handMenu.cardId })
              : undefined
          }
          onPutOnStack={() => putOnStack([handMenu.cardId])}
          onMove={
            handMenuZone === 'hand'
              ? (direction) => {
                  const from = state.zones.hand.findIndex((c) => c.id === handMenu.cardId);
                  if (from >= 0)
                    dispatch({
                      type: 'REORDER_HAND',
                      cardId: handMenu.cardId,
                      toIndex: from + direction,
                    });
                }
              : undefined
          }
          canMoveEarlier={state.zones.hand.findIndex((c) => c.id === handMenu.cardId) > 0}
          canMoveLater={
            state.zones.hand.findIndex((c) => c.id === handMenu.cardId) <
            state.zones.hand.length - 1
          }
        />
      )}

      {previewCardId && (
        <BoardCardInfo
          previewCardId={previewCardId}
          cardLookup={cardLookup}
          state={state}
          onClose={() => setPreviewCardId(null)}
        />
      )}

      {tokenCreator && (
        <TokenCreator
          deckCards={deckTokenSources}
          onClose={() => setTokenCreator(false)}
          onCreate={(token) => {
            createToken(token);
            setTokenCreator(false);
          }}
        />
      )}

      {showScry && (
        <ScrySheet
          library={state.zones.library}
          from={scryFrom}
          onClose={() => setShowScry(false)}
          onResolve={(resolution) => {
            haptics.tap();
            dispatch({ type: 'RESOLVE_TOP', ...resolution });
          }}
        />
      )}

      {peek && <PeekModal peek={peek} onClose={() => setPeek(null)} onMoveTo={handlePeekMove} />}
      {showDice && <DiceRoller onClose={() => setShowDice(false)} />}
    </>
  );
}
