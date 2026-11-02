import './DungeonControl.css';
import { useId } from 'react';
import { DUNGEONS, dungeonDef, type GameAction, type GamePlayer } from '@spellcontrol/game-core';

/**
 * One seat's dungeon tracker: which dungeon it is in, the room it stands in,
 * and how many it has completed. Shared by the local seat drawer and the
 * online "your seat" panel so the two cannot drift.
 *
 * Bookkeeping, not a rules engine: any room of the dungeon can be marked (the
 * branching choice is the player's), and nothing is ever blocked except what
 * cannot apply. Every step is one `dungeon` action, so the online table
 * applies the same reducer step server-side.
 */
export function DungeonControl({
  player,
  disabled,
  dispatch,
  initiative = false,
}: {
  player: GamePlayer;
  disabled: boolean;
  dispatch: (a: GameAction) => void;
  /** This seat holds the initiative: it is the one who ventures into the Undercity. */
  initiative?: boolean;
}) {
  const headingId = useId();
  const roomGroup = useId();
  const progress = player.dungeon ?? null;
  const def = progress ? dungeonDef(progress.id) : undefined;
  const completed = player.dungeonsCompleted ?? [];
  const step = (s: Record<string, unknown>) =>
    dispatch({ type: 'dungeon', seat: player.seat, actorSeat: player.seat, ...s } as GameAction);

  const levels: { level: number; rooms: string[] }[] = [];
  for (const room of def?.rooms ?? []) {
    const last = levels[levels.length - 1];
    if (last && last.level === room.level) last.rooms.push(room.name);
    else levels.push({ level: room.level, rooms: [room.name] });
  }

  return (
    <section className="pp-dungeon" aria-labelledby={headingId}>
      <span id={headingId} className="seat-menu-label">
        Dungeon
      </span>
      {def && progress ? (
        <>
          <p className="pp-dungeon-name">{def.name}</p>
          {/* Where the seat stands is one choice among the rooms, so native
              radios (arrow keys move through them, the checked one is the
              room). Rooms sit in rows by depth; the row is only layout. */}
          <fieldset className="pp-dungeon-levels">
            <legend className="visually-hidden">{`Room in ${def.name}`}</legend>
            {levels.map(({ level, rooms }) => (
              <div key={level} className="pp-dungeon-level">
                {rooms.map((room) => (
                  <label key={room} className="pp-dungeon-room">
                    <input
                      type="radio"
                      className="overlay-input"
                      name={roomGroup}
                      value={room}
                      checked={room === progress.room}
                      disabled={disabled}
                      onChange={() => step({ op: 'room', room })}
                    />
                    <span>{room}</span>
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
          <div className="pp-dungeon-actions">
            <button
              type="button"
              className="pp-dungeon-btn is-primary"
              disabled={disabled}
              onClick={() => step({ op: 'complete' })}
            >
              Complete dungeon
            </button>
            <button
              type="button"
              className="pp-dungeon-btn"
              disabled={disabled}
              onClick={() => step({ op: 'leave' })}
            >
              Leave
            </button>
          </div>
        </>
      ) : (
        <div className="pp-dungeon-enter" role="group" aria-label="Venture into a dungeon">
          {DUNGEONS.map((d) => (
            <button
              key={d.id}
              type="button"
              className="pp-dungeon-btn"
              disabled={disabled}
              onClick={() => step({ op: 'enter', dungeon: d.id })}
            >
              {d.name}
            </button>
          ))}
          {initiative && (
            <p className="pp-dungeon-hint">The initiative sends you into the Undercity.</p>
          )}
        </div>
      )}
      {completed.length > 0 && (
        <p className="pp-dungeon-done">
          <span>
            Completed {completed.length}
            {completed.length === 1 ? ' dungeon' : ' dungeons'}
          </span>
          <button
            type="button"
            className="pp-dungeon-btn"
            disabled={disabled}
            onClick={() => step({ op: 'uncomplete' })}
          >
            Take back last
          </button>
        </p>
      )}
    </section>
  );
}
