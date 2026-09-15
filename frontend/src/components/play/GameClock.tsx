import { Play } from 'lucide-react';
import type { GameAction, GameState } from '../../lib/game-state';
import { describeClock, formatClock, gameElapsed, turnElapsed } from '../../lib/game-clock';
import { haptics } from '../../lib/haptics';
import { useNow } from '../../lib/use-now';

/**
 * The table clock: total game time, and how long the current turn has been
 * running beside it.
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
 * on its own without the parent needing to unmount it.
 *
 * Mostly a readout — but it carries the one control that *starts* turn
 * tracking, which reverses this file's older "readout, never a control"
 * ruling. The reason: with the marker reachable only through a seat's ⋯ menu,
 * tables never found turn tracking at all. It has to be offered in the board's
 * own chrome, and the seam hub is already the board's one control cluster — so
 * the button lives inside the existing chip rather than becoming a fourth
 * satellite, because seam satellites collide on column-seam layouts.
 * *Passing* the turn is the active seat's control and lives on their panel,
 * rotated to them; this button is only the cold start, before any seat holds
 * the turn.
 */
export function GameClock({
  game,
  dispatch,
  canEdit,
}: {
  game: GameState;
  dispatch: (a: GameAction) => void;
  canEdit: boolean;
}) {
  const finished = game.status === 'finished';
  const now = useNow(!finished);
  const total = gameElapsed(game, now);
  if (total == null) return null;
  // The turn clock is only meaningful once the table is actually passing
  // turns. A pod that never touches the turn marker leaves activeSeat null,
  // and a "turn" reading equal to the whole game would be noise.
  const turn = game.activeSeat != null ? turnElapsed(game, now) : null;
  const active = game.players.find((p) => p.seat === game.activeSeat) ?? null;
  // Cold start: whoever the table recorded as going first, else the first seat
  // still in the game. Guessing costs one tap to correct (tap the chip on the
  // right seat's panel, or "Start turn here" in its menu) and, unlike
  // `startingSeat`, the active seat feeds no stat — so this may guess where
  // `startingSeat` deliberately refuses to.
  const startSeat = game.startingSeat ?? game.players.find((p) => !p.eliminated)?.seat ?? null;
  const canStart = canEdit && turn == null && game.status === 'active' && startSeat != null;

  return (
    <div className="game-clock" role="group" aria-label="Table clock">
      <span className="game-clock-total" aria-label={`Game time ${describeClock(total)}`}>
        {formatClock(total)}
      </span>
      {turn != null && (
        <span
          className="game-clock-turn"
          aria-label={`${active ? `${active.name}'s turn` : 'Turn'}, ${describeClock(turn)}`}
        >
          <span className="game-clock-turn-name" aria-hidden="true">
            {active?.name ?? 'Turn'}
          </span>
          <span aria-hidden="true">{formatClock(turn)}</span>
        </span>
      )}
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
