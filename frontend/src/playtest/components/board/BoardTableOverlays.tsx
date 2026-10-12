import type { PlaytestState } from '@/lib/playtest';
import { Button } from '@/components/shared/Button';
import type { OnlineTable } from '../../hooks/use-online-table';
import type { ShortcutId } from '../../lib/shortcuts';
import { OpponentBoardModal } from '../OpponentBoardModal';
import { StackPanel } from '../StackPanel';
import { TableArrows } from '../TableArrows';
import { TableFinishedBanner } from '../TableFinishedBanner';
import { TableMoments } from '../TableMoments';
import { TablePings } from '../TablePings';
import { TakebackConsentPrompt } from '../TakebackConsentPrompt';
import { TriggerReminder } from '../TriggerReminder';
import type { useBoardArrows } from './use-board-arrows';
import type { useCardActions } from './use-card-actions';

type CardActions = ReturnType<typeof useCardActions>;
type Arrows = ReturnType<typeof useBoardArrows>;

interface BoardTableOverlaysProps
  extends
    Pick<Arrows, 'arrowFrom' | 'setArrowFrom' | 'finishArrow' | 'beginArrow' | 'pings'>,
    Pick<
      CardActions,
      'stackItems' | 'copyOntoStack' | 'resolveStack' | 'triggerCards' | 'locateCard'
    > {
  state: PlaytestState;
  onlineTable: OnlineTable | null;
  myTurn: boolean;
  keyFor: (id: ShortcutId) => string | undefined;
  viewingBoardSeat: number | null;
  setViewingBoardSeat: (seat: number | null) => void;
}

/** What floats over the whole table rather than sitting in the layout: the
 *  online prompts and banners, the trigger reminder, an opponent's board
 *  inspector, arrow mode, pings and the stack. */
export function BoardTableOverlays({
  state,
  onlineTable,
  myTurn,
  keyFor,
  viewingBoardSeat,
  setViewingBoardSeat,
  arrowFrom,
  setArrowFrom,
  finishArrow,
  beginArrow,
  pings,
  stackItems,
  copyOntoStack,
  resolveStack,
  triggerCards,
  locateCard,
}: BoardTableOverlaysProps) {
  return (
    <>
      {/* All three portal to <body> (see their own doc comments) so placement
          here only decides conditional gating, not layout. */}
      {onlineTable && <TakebackConsentPrompt onlineTable={onlineTable} />}
      {onlineTable && <TableMoments onlineTable={onlineTable} />}
      {onlineTable && <TableFinishedBanner />}
      <TriggerReminder
        cards={triggerCards}
        beat={onlineTable?.phase ?? null}
        turn={state.turn}
        myTurn={onlineTable === null || myTurn}
        onLocate={locateCard}
      />
      {onlineTable &&
        viewingBoardSeat != null &&
        (() => {
          const opp = onlineTable.opponents.find((o) => o.board.seat === viewingBoardSeat);
          return opp ? (
            <OpponentBoardModal
              opp={opp}
              active={onlineTable.activeSeat === viewingBoardSeat}
              onClose={() => setViewingBoardSeat(null)}
              onArrowTarget={
                arrowFrom
                  ? (cardId) => {
                      finishArrow(opp.board.seat, cardId);
                      setViewingBoardSeat(null);
                    }
                  : undefined
              }
            />
          ) : null;
        })()}
      {arrowFrom && (
        <div className="playtest-arrow-mode" role="status">
          <span>
            Arrow from{' '}
            <b>
              {state.battlefield.find((b) => b.card.id === arrowFrom.cardId)?.card.name ??
                'your card'}
            </b>
            . Tap the card it points to.
          </span>
          <Button onClick={() => setArrowFrom(null)}>Cancel</Button>
        </div>
      )}
      {onlineTable && <TableArrows mySeat={onlineTable.mySeat} />}
      <TablePings pings={pings} mySeat={onlineTable?.mySeat ?? null} />
      {/* Renders nothing on an empty stack, which is most of a game. */}
      <StackPanel
        items={stackItems}
        onDrawArrow={(id) => beginArrow(new Set([id]))}
        onCopy={(id) => copyOntoStack([id])}
        onResolve={(id) => resolveStack(id)}
        arrowKey={keyFor('arrow')}
        copyKey={keyFor('stack-copy')}
        resolveKey={keyFor('stack-resolve')}
      />
    </>
  );
}
