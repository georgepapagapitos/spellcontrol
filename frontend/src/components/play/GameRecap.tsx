import type { GameState } from '../../lib/game-state';
import { buildGameRecap } from '../../lib/game-recap';
import './GameRecap.css';

/**
 * "The story of the game" — a short list of narrative stats shown under the
 * winner announcement (or draw notice) in the finished-game overlay. Works
 * for both local and online games alike, since both populate `game.events`.
 *
 * Renders nothing at all when the log doesn't support any stat (see
 * `buildGameRecap`'s absent-data discipline) — never an empty-state box.
 */
export function GameRecap({ game }: { game: GameState }) {
  const stats = buildGameRecap(game);
  if (stats.length === 0) return null;
  return (
    <div className="game-recap">
      <h3 className="game-recap-title">The story of the game</h3>
      <ul className="game-recap-list">
        {stats.map((stat) => (
          <li key={stat.id} className="game-recap-row">
            <span className="game-recap-label">{stat.label}</span>
            <span className="game-recap-detail">{stat.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
