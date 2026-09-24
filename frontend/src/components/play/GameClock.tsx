import { FastForward, Pause, Play } from 'lucide-react';
import type { GameAction, GameState } from '../../lib/game-state';
import { clockView, describeClock, formatClock } from '../../lib/game-clock';
import { haptics } from '../../lib/haptics';
import { useNow } from '../../lib/use-now';

/**
 * The table clock: total game time, and how long the current turn has been
 * running beside it. Either reading is optional at setup (`gameTimerEnabled`
 * / `turnTrackerEnabled` in the play store) — `showTotal`/`showTurn` say
 * which this table wants. `GameBoard` already gates the whole satellite on
 * the pair, but this component checks too so it never renders an empty pill.
 *
 * **Screen-relative, never rotated to a seat.** It reads upright for whoever
 * is holding the device, the same ruling the win celebration already carries
 * (B7-01): how long the table has been playing is a fact about the table, not
 * about a seat, and duplicating it per side would put two different-looking
 * numbers on one board a second apart.
 *
 * It ticks off the wall clock once a second rather than off game state, so a
 * table that sits untouched between turns still sees the time move. A
 * finished game's clocks freeze (`gameElapsed` reads `endedAt`), so this stops
 * on its own without the parent needing to unmount it. Pausing (tap the
 * total) is the one thing that stops it on purpose — `clockView` already
 * subtracts paused stretches from every reading, so this component only
 * renders what it's handed and never does that math itself.
 *
 * Mostly a readout, but it carries three controls: pause/resume, the cold
 * start (before any seat holds the turn) and, once one does, passing it.
 * Seats carry no buttons any more (they are all number, the Lotus model), so
 * these live in the board's one control cluster, the seam hub, inside this
 * existing chip rather than as a fourth satellite, because seam satellites
 * collide on column-seam layouts. A seat's drawer can also take the turn
 * directly ("Start turn here"), which is how passing the turn stays reachable
 * even with the turn tracker turned off.
 */
export function GameClock({
  game,
  dispatch,
  canEdit,
  showTotal,
  showTurn,
}: {
  game: GameState;
  dispatch: (a: GameAction) => void;
  canEdit: boolean;
  /** Show the total game time, and let it be paused. Setup: "Game timer". */
  showTotal: boolean;
  /** Show the active seat's turn time and the pass-turn control. Setup: "Turn tracker". */
  showTurn: boolean;
}) {
  const finished = game.status === 'finished';
  const now = useNow(!finished);
  const view = clockView(game, now);
  if (view.total == null || (!showTotal && !showTurn)) return null;
  const active = game.players.find((p) => p.seat === view.activeSeat) ?? null;
  // Cold start: whoever the table recorded as going first, else the first seat
  // still in the game. Guessing costs one tap to correct (tap the chip on the
  // right seat's panel, or "Start turn here" in its menu) and, unlike
  // `startingSeat`, the active seat feeds no stat — so this may guess where
  // `startingSeat` deliberately refuses to.
  const startSeat = game.startingSeat ?? game.players.find((p) => !p.eliminated)?.seat ?? null;
  const canStart =
    canEdit && showTurn && view.turn == null && game.status === 'active' && startSeat != null;
  const canPass = canEdit && showTurn && view.turn != null && game.status === 'active';
  const canPause = canEdit && game.status === 'active';

  return (
    <div className="game-clock" role="group" aria-label="Table clock">
      {showTotal &&
        (canPause ? (
          <button
            type="button"
            className={`game-clock-total ${view.paused ? 'is-paused' : ''}`}
            aria-label={`${view.paused ? 'Resume' : 'Pause'} the game clock, ${describeClock(view.total)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              haptics.tap();
              dispatch({ type: 'clock', paused: !view.paused, actorSeat: null });
            }}
          >
            {view.paused && (
              <Pause
                className="game-clock-pause-icon"
                width={11}
                height={11}
                strokeWidth={2.6}
                aria-hidden
              />
            )}
            <span aria-hidden="true">{formatClock(view.total)}</span>
          </button>
        ) : (
          <span
            className={`game-clock-total ${view.paused ? 'is-paused' : ''}`}
            aria-label={`Game time ${describeClock(view.total)}${view.paused ? ', paused' : ''}`}
          >
            {view.paused && (
              <Pause
                className="game-clock-pause-icon"
                width={11}
                height={11}
                strokeWidth={2.6}
                aria-hidden
              />
            )}
            {formatClock(view.total)}
          </span>
        ))}
      {showTurn &&
        view.turn != null &&
        (canPass ? (
          <button
            type="button"
            className="game-clock-turn"
            aria-label={`${active ? `${active.name}'s turn` : 'Turn'}, ${describeClock(view.turn)}. Pass to the next player`}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              haptics.tap();
              dispatch({ type: 'pass-turn', actorSeat: view.activeSeat });
            }}
          >
            <span className="game-clock-turn-name" aria-hidden="true">
              {active?.name ?? 'Turn'}
            </span>
            <span aria-hidden="true">{formatClock(view.turn)}</span>
            <FastForward
              className="game-clock-pass"
              width={12}
              height={12}
              strokeWidth={2.4}
              aria-hidden
            />
          </button>
        ) : (
          <span
            className="game-clock-turn"
            aria-label={`${active ? `${active.name}'s turn` : 'Turn'}, ${describeClock(view.turn)}`}
          >
            <span className="game-clock-turn-name" aria-hidden="true">
              {active?.name ?? 'Turn'}
            </span>
            <span aria-hidden="true">{formatClock(view.turn)}</span>
          </span>
        ))}
      {canStart && (
        <button
          type="button"
          className="game-clock-start"
          aria-label="Start tracking turns"
          title="Start tracking turns"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            haptics.tap();
            dispatch({ type: 'pass-turn', actorSeat: null, toSeat: startSeat });
          }}
        >
          <Play width={13} height={13} strokeWidth={2.4} aria-hidden />
        </button>
      )}
    </div>
  );
}
