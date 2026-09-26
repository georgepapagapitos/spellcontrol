import { isClockPaused, type GameState } from '../../lib/game-state';
import { describeClock, formatClock, msToNextSecond, seatTurnTotals } from '../../lib/game-clock';
import { useNow } from '../../lib/use-now';

/**
 * How long each seat has held the turn, longest first.
 *
 * Lives in the game menu rather than on the board: "who is taking the longest
 * turns" is a question you ask between games or when the round clock is
 * getting tight, not one you want ranked in front of the table all night.
 *
 * Renders nothing at all when the table has never passed a turn. A pod that
 * doesn't use the turn marker has no data here, and a row of zeroes would
 * read as a claim that everyone played instantly rather than as "we never
 * tracked this".
 */
export function TurnTimes({ game }: { game: GameState }) {
  // Keeps ticking while the menu is open: the active seat's total is still
  // accruing, and a list frozen at open would understate exactly the player
  // anyone opened this to check on. A pause freezes every total, so nothing
  // to redraw until it ends.
  const now = useNow(game.status !== 'finished' && !isClockPaused(game), (t) =>
    msToNextSecond(...Object.values(seatTurnTotals(game, t)))
  );
  const totals = seatTurnTotals(game, now);
  const rows = game.players
    .map((p) => ({ player: p, ms: totals[p.seat] }))
    .filter((r): r is { player: (typeof game.players)[number]; ms: number } => r.ms != null)
    .sort((a, b) => b.ms - a.ms);
  if (rows.length === 0) return null;

  const longest = rows[0].ms;
  return (
    <section className="turn-times" aria-label="Time per player">
      <h3 className="turn-times-title">Time on turn</h3>
      <ul className="turn-times-list">
        {rows.map(({ player, ms }) => (
          <li key={player.id} className="turn-times-row">
            <span className="turn-times-name" title={player.name}>
              {player.name}
            </span>
            {/* Proportional bar, not a percentage of the game: what a reader
                wants here is "who is slower than whom", and normalising to
                the longest turn-holder answers that at a glance. */}
            <span className="turn-times-bar" aria-hidden="true">
              <span
                className="turn-times-bar-fill"
                style={{ ['--fill' as never]: longest > 0 ? ms / longest : 0 }}
              />
            </span>
            <span className="turn-times-value" aria-label={describeClock(ms)}>
              {formatClock(ms)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
