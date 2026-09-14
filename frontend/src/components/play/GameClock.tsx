import type { GameState } from '../../lib/game-state';
import { describeClock, formatClock, gameElapsed, turnElapsed } from '../../lib/game-clock';
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
 */
export function GameClock({ game }: { game: GameState }) {
  const finished = game.status === 'finished';
  const now = useNow(!finished);
  const total = gameElapsed(game, now);
  if (total == null) return null;
  // The turn clock is only meaningful once the table is actually passing
  // turns. A pod that never touches the turn marker leaves activeSeat null,
  // and a "turn" reading equal to the whole game would be noise.
  const turn = game.activeSeat != null ? turnElapsed(game, now) : null;
  const active = game.players.find((p) => p.seat === game.activeSeat) ?? null;

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
    </div>
  );
}
