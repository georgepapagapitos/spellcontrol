import { ChevronRight, Pause, Play } from 'lucide-react';
import { isClockPaused, type GameAction, type GameState } from '../../lib/game-state';
import {
  clockView,
  describeClock,
  formatClock,
  gameElapsed,
  msToNextSecond,
  turnElapsed,
} from '../../lib/game-clock';
import { haptics } from '../../lib/haptics';
import { useNow } from '../../lib/use-now';

/**
 * The table clock: an edge strip along the board's bottom (2026-09-24 ruling
 * — replaces the earlier floating seam pill; see STYLE_GUIDE "Play board: the
 * table clock is an edge strip"). `GameBoard` renders it as a normal flex
 * sibling below the seat grid, which shrinks to fit — it is never an overlay,
 * so unlike the old satellite this needs no pointer-events choreography to
 * stay out of a panel's way.
 *
 * Total game time and turn time are each optional at setup (`gameTimerEnabled`
 * / `turnTrackerEnabled` in the play store) — `showTotal`/`showTurn` say which
 * this table wants. Turn time is the tracker's own reading, not the timer's:
 * it shows whenever `showTurn` is on, with or without the total. `GameBoard`
 * gates the whole strip's existence on the pair, but this component checks
 * too so it never renders empty.
 *
 * **Screen-relative, never rotated to a seat** — same ruling as the win
 * celebration (B7-01): how long the table has been playing is a fact about
 * the table, not about a seat.
 *
 * Ticks off the wall clock every second so a table sitting untouched between
 * turns still sees the time move; a finished game freezes (`gameElapsed`
 * reads `endedAt`). Pausing is the one thing that stops it on purpose —
 * `clockView` already subtracts paused stretches from every reading, so this
 * component only renders what it's handed. When paused, the note lands on
 * whichever reading is shown first (total, else turn) rather than on both, so
 * the state is said exactly once — never colour alone (a `Pause` glyph on the
 * button plus the word "paused" in the text).
 *
 * Three controls, each a real button: **Start** (before any seat holds the
 * turn — the same recorded-first-player guess `startSeat` always made),
 * **Pause/Resume** (only when the total is shown; pausing pauses the whole
 * table clock, not just the turn), and **Pass** (once a seat holds the turn;
 * still active while paused, same as start/reset). A seat's drawer can also
 * take the turn directly ("Start turn here"), which is how passing stays
 * reachable even with the turn tracker off.
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
  // Redraws on the readings' own second boundaries (see `msToNextSecond`), so
  // the digit on screen is always the current one and a pause freezes it
  // where the tap found it. Paused, nothing moves, so nothing ticks.
  const now = useNow(!finished && !isClockPaused(game), (t) =>
    msToNextSecond(gameElapsed(game, t), game.activeSeat != null ? turnElapsed(game, t) : null)
  );
  const view = clockView(game, now);
  if (view.total == null || (!showTotal && !showTurn)) return null;
  const active = game.players.find((p) => p.seat === view.activeSeat) ?? null;
  const started = view.activeSeat != null;
  // Cold start: whoever the table recorded as going first, else the first seat
  // still in the game. Guessing costs one tap to correct (tap "Start turn
  // here" in a seat's drawer) and, unlike `startingSeat`, the active seat
  // feeds no stat — so this may guess where `startingSeat` deliberately
  // refuses to.
  const startSeat = game.startingSeat ?? game.players.find((p) => !p.eliminated)?.seat ?? null;
  const isLive = canEdit && game.status === 'active';
  const canStart = isLive && showTurn && !started && startSeat != null;
  const canPass = isLive && showTurn && started;
  const canPause = isLive && showTotal;

  // The paused note is said exactly once, on whichever reading exists first —
  // never on "Turn not started", which has nothing running to freeze.
  const totalNote = showTotal && view.paused ? ' (paused)' : '';
  const turnNote = !showTotal && showTurn && started && view.paused ? ' (paused)' : '';

  return (
    <div
      className={`game-clock-strip ${view.paused ? 'is-paused' : ''}`}
      role="group"
      aria-label="Table clock"
    >
      <span className="game-clock-strip-text">
        {showTotal && (
          <span className="game-clock-strip-fixed">{`Game ${formatClock(view.total)}${totalNote}`}</span>
        )}
        {showTotal && showTurn && <span className="game-clock-strip-dot" aria-hidden="true" />}
        {showTurn &&
          (started ? (
            <span className="game-clock-strip-turn">
              <span className="game-clock-strip-name">{active?.name ?? 'Turn'}</span>
              <span className="game-clock-strip-fixed">{`'s turn ${formatClock(view.turn ?? 0)}${turnNote}`}</span>
            </span>
          ) : (
            <span className="game-clock-strip-fixed">Turn not started</span>
          ))}
      </span>
      <div className="game-clock-strip-actions">
        {canStart && (
          <button
            type="button"
            className="game-clock-strip-btn"
            aria-label="Start tracking turns"
            onClick={() => {
              haptics.tap();
              dispatch({ type: 'pass-turn', actorSeat: null, toSeat: startSeat });
            }}
          >
            <Play width={13} height={13} strokeWidth={2.4} aria-hidden />
            Start
          </button>
        )}
        {canPause && (
          <button
            type="button"
            className="game-clock-strip-btn"
            aria-label={`${view.paused ? 'Resume' : 'Pause'} the game clock, ${describeClock(view.total)}`}
            onClick={() => {
              haptics.tap();
              dispatch({ type: 'clock', paused: !view.paused, actorSeat: null });
            }}
          >
            {view.paused ? (
              <Play width={13} height={13} strokeWidth={2.4} aria-hidden />
            ) : (
              <Pause width={13} height={13} strokeWidth={2.4} aria-hidden />
            )}
          </button>
        )}
        {canPass && (
          <button
            type="button"
            className="game-clock-strip-btn"
            aria-label={`Pass ${active ? `${active.name}'s turn` : 'the turn'} to the next seat`}
            onClick={() => {
              haptics.tap();
              dispatch({ type: 'pass-turn', actorSeat: view.activeSeat });
            }}
          >
            Pass
            <ChevronRight width={14} height={14} strokeWidth={2.6} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
