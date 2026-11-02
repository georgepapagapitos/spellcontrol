// Dungeon / Undercity tracking, split out of index.ts (which re-exports it).
//
// A venture is bookkeeping, not a rules engine: the table says which dungeon a
// seat entered and which room it stands in, and the reducer records it. Rooms
// are listed by depth (`level`, 0 at the entrance) and the reducer only
// checks that a named room belongs to the dungeon the seat is in. It never
// checks that the path between two rooms is legal, because the branching
// choice is the player's and the reducer never says no to a table correcting
// itself (the same stance `phase` takes).

export type DungeonId = 'lost-mine' | 'mad-mage' | 'tomb' | 'undercity';

export interface DungeonRoom {
  /** Printed room name; also the key stored on the seat. */
  name: string;
  /** 0 at the entrance, increasing toward the last room. */
  level: number;
}

export interface DungeonDef {
  id: DungeonId;
  name: string;
  /** Entrance first, last room last; rooms on one level are adjacent. */
  rooms: readonly DungeonRoom[];
}

const rooms = (levels: readonly (readonly string[])[]): DungeonRoom[] =>
  levels.flatMap((names, level) => names.map((name) => ({ name, level })));

export const DUNGEONS: readonly DungeonDef[] = [
  {
    id: 'undercity',
    name: 'Undercity',
    rooms: rooms([
      ['Secret Entrance'],
      ['Forge', 'Lost Well'],
      ['Trap!', 'Arena', 'Stash'],
      ['Archives', 'Catacombs'],
      ['Throne of the Dead Three'],
    ]),
  },
  {
    id: 'lost-mine',
    name: 'Lost Mine of Phandelver',
    rooms: rooms([
      ['Cave Entrance'],
      ['Goblin Lair', 'Mine Tunnels'],
      ['Storeroom', 'Dark Pool', 'Fungi Cavern'],
      ['Temple of Dumathoin'],
    ]),
  },
  {
    id: 'mad-mage',
    name: 'Dungeon of the Mad Mage',
    rooms: rooms([
      ['Yawning Portal'],
      ['Dungeon Level'],
      ['Goblin Bazaar', 'Twisted Caverns'],
      ['Lost Level'],
      ['Runestone Caverns', "Muiral's Graveyard"],
      ['Deep Mines'],
      ["Mad Wizard's Lair"],
    ]),
  },
  {
    id: 'tomb',
    name: 'Tomb of Annihilation',
    rooms: rooms([
      ['Trapped Entry'],
      ['Veils of Fear', 'Oubliette'],
      ['Sandfall Cell'],
      ['Cradle of the Death God'],
    ]),
  },
];

/** The dungeon taking the initiative sends its holder into. */
export const INITIATIVE_DUNGEON: DungeonId = 'undercity';

/** Storage bound on `GamePlayer.dungeonsCompleted`: one JSONB row per game. */
export const MAX_DUNGEONS_COMPLETED = 99;

export function dungeonDef(id: string): DungeonDef | undefined {
  return DUNGEONS.find((d) => d.id === id);
}

/** A seat's place in a dungeon: which one and the room it stands in. */
export interface DungeonProgress {
  id: DungeonId;
  room: string;
}

export function isLastRoom(def: DungeonDef, room: string): boolean {
  return def.rooms[def.rooms.length - 1].name === room;
}

/** What one venture step does to a seat. See the `dungeon` action. */
export type DungeonOp =
  | { op: 'enter'; dungeon: DungeonId }
  | { op: 'room'; room: string }
  | { op: 'complete' }
  | { op: 'leave' }
  | { op: 'uncomplete' };

export interface DungeonSeatState {
  dungeon: DungeonProgress | null;
  dungeonsCompleted: DungeonId[];
}

/**
 * Pure transition for one seat. Throws on a step that cannot apply (entering
 * while in a dungeon, a room that is not in the dungeon, completing outside
 * one): the route maps that to a 400, and the UI never offers it.
 * `text` is the log line, naming the dungeon.
 */
export function stepDungeon(
  seat: DungeonSeatState,
  step: DungeonOp
): { next: DungeonSeatState; text: string } {
  const cur = seat.dungeon;
  const curDef = cur ? dungeonDef(cur.id) : undefined;
  switch (step.op) {
    case 'enter': {
      const def = dungeonDef(step.dungeon);
      if (!def) throw new Error('Unknown dungeon.');
      if (cur) throw new Error('Already in a dungeon.');
      return {
        next: { ...seat, dungeon: { id: def.id, room: def.rooms[0].name } },
        text: `entered ${def.name}`,
      };
    }
    case 'room': {
      if (!cur || !curDef) throw new Error('Not in a dungeon.');
      if (typeof step.room !== 'string' || !curDef.rooms.some((r) => r.name === step.room)) {
        throw new Error('Unknown room.');
      }
      return {
        next: { ...seat, dungeon: { id: cur.id, room: step.room } },
        text: `reached ${step.room}`,
      };
    }
    case 'complete': {
      if (!cur || !curDef) throw new Error('Not in a dungeon.');
      return {
        next: {
          dungeon: null,
          dungeonsCompleted: [...seat.dungeonsCompleted, cur.id].slice(-MAX_DUNGEONS_COMPLETED),
        },
        text: `completed ${curDef.name}`,
      };
    }
    case 'leave': {
      if (!cur || !curDef) throw new Error('Not in a dungeon.');
      return { next: { ...seat, dungeon: null }, text: `left ${curDef.name}` };
    }
    case 'uncomplete': {
      const last = seat.dungeonsCompleted[seat.dungeonsCompleted.length - 1];
      if (!last) throw new Error('No completed dungeon to take back.');
      return {
        next: { ...seat, dungeonsCompleted: seat.dungeonsCompleted.slice(0, -1) },
        text: `takes back ${dungeonDef(last)?.name ?? 'a dungeon'}`,
      };
    }
  }
}
