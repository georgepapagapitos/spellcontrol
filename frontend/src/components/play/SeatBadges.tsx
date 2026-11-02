import {
  dungeonDef,
  poisonLimit,
  seatCounters,
  teamOf,
  type GamePlayer,
  type GameState,
} from '@spellcontrol/game-core';
import { Chip } from '../shared/Chip';

/**
 * What a seat is carrying, read-only: poison, the highest commander damage,
 * its free-form counters, its dungeon, and in Two-Headed Giant its team. Only
 * non-zero state appears, so a fresh seat is just its number. The board shows
 * state and the seat drawer changes it (STYLE_GUIDE "a seat is all number").
 */
export function seatHasBadges(game: GameState, player: GamePlayer, maxCmdDmg: number): boolean {
  return (
    (game.poisonEnabled && player.poison > 0) ||
    maxCmdDmg > 0 ||
    Object.values(seatCounters(player)).some((v) => v !== 0) ||
    dungeonBadge(player) !== null ||
    game.format === '2hg'
  );
}

/** "Undercity" + the room, or the count of dungeons completed, or nothing. */
function dungeonBadge(player: GamePlayer): { label: string; value: string } | null {
  if (player.dungeon) {
    const def = dungeonDef(player.dungeon.id);
    return { label: def?.name ?? 'Dungeon', value: player.dungeon.room };
  }
  const done = player.dungeonsCompleted?.length ?? 0;
  return done > 0 ? { label: 'Dungeons', value: String(done) } : null;
}

export function SeatBadges({
  game,
  player,
  maxCmdDmg,
}: {
  game: GameState;
  player: GamePlayer;
  maxCmdDmg: number;
}) {
  const customCounters = Object.entries(seatCounters(player)).filter(([, v]) => v !== 0);
  const dungeon = dungeonBadge(player);
  return (
    <div className="player-panel-counters">
      {game.format === '2hg' && (
        <Chip
          className="pp-counter-badge is-custom"
          labelClassName="pp-counter-badge-name"
          trailing={teamOf(player.seat) + 1}
        >
          Team
        </Chip>
      )}
      {game.poisonEnabled && player.poison > 0 && (
        <Chip
          className={`pp-counter-badge ${player.poison >= poisonLimit(game.format) ? 'is-lethal' : ''}`}
          role="img"
          aria-label={`Poison ${player.poison}`}
        >
          ☠ {player.poison}
        </Chip>
      )}
      {maxCmdDmg > 0 && (
        <Chip
          className={`pp-counter-badge ${maxCmdDmg >= 21 ? 'is-lethal' : ''}`}
          role="img"
          aria-label={`Commander damage, highest ${maxCmdDmg}`}
        >
          ⚔ {maxCmdDmg}
        </Chip>
      )}
      {dungeon && (
        <Chip
          className="pp-counter-badge is-custom"
          labelClassName="pp-counter-badge-name"
          trailing={dungeon.value}
        >
          {dungeon.label}
        </Chip>
      )}
      {customCounters.map(([name, value]) => (
        <Chip
          key={name}
          className="pp-counter-badge is-custom"
          labelClassName="pp-counter-badge-name"
          trailing={value}
        >
          {name}
        </Chip>
      ))}
    </div>
  );
}
