import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createGameState,
  makePlayer,
  startsGameClock,
  DUNGEONS,
  MAX_DUNGEONS_COMPLETED,
  dungeonDef,
  isLastRoom,
  type GameState,
} from './index';

function started(players = 2): GameState {
  const lobby = createGameState({
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u0',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: Array.from({ length: players }, (_, i) =>
      makePlayer({ id: `u${i}`, userId: `u${i}`, seat: i, name: `P${i}`, startingLife: 40 })
    ),
    ts: 1000,
  });
  return applyAction(lobby, { type: 'start', ts: 1001 });
}

const venture = (s: GameState, step: object, seat = 0) =>
  applyAction(s, { type: 'dungeon', seat, actorSeat: seat, ts: 2000, ...step } as never);

describe('dungeon data', () => {
  it('lists the four dungeons, each starting at its entrance', () => {
    expect(DUNGEONS.map((d) => d.id).sort()).toEqual([
      'lost-mine',
      'mad-mage',
      'tomb',
      'undercity',
    ]);
    for (const d of DUNGEONS) {
      expect(d.rooms[0].level).toBe(0);
      expect(new Set(d.rooms.map((r) => r.name)).size).toBe(d.rooms.length);
      expect(isLastRoom(d, d.rooms[d.rooms.length - 1].name)).toBe(true);
      expect(isLastRoom(d, d.rooms[0].name)).toBe(false);
    }
    expect(dungeonDef('undercity')?.rooms.map((r) => r.name)).toContain('Throne of the Dead Three');
    expect(dungeonDef('nope')).toBeUndefined();
  });
});

describe('dungeon action', () => {
  it('enters a dungeon at its entrance and logs it', () => {
    const s = venture(started(), { op: 'enter', dungeon: 'undercity' });
    expect(s.players[0].dungeon).toEqual({ id: 'undercity', room: 'Secret Entrance' });
    expect(s.players[1].dungeon ?? null).toBeNull();
    const ev = s.events[s.events.length - 1];
    expect(ev).toMatchObject({
      kind: 'dungeon',
      targetSeat: 0,
      message: 'entered Undercity',
    });
  });

  it('moves between rooms of the dungeon it is in', () => {
    let s = venture(started(), { op: 'enter', dungeon: 'undercity' });
    s = venture(s, { op: 'room', room: 'Arena' });
    expect(s.players[0].dungeon).toEqual({ id: 'undercity', room: 'Arena' });
    expect(s.events[s.events.length - 1].message).toBe('reached Arena');
  });

  it('completes a dungeon, clears the seat and counts it; a repeat counts again', () => {
    let s = started();
    for (let i = 0; i < 2; i++) {
      s = venture(s, { op: 'enter', dungeon: 'lost-mine' });
      s = venture(s, { op: 'complete' });
    }
    expect(s.players[0].dungeon).toBeNull();
    expect(s.players[0].dungeonsCompleted).toEqual(['lost-mine', 'lost-mine']);
    expect(s.events[s.events.length - 1].message).toBe('completed Lost Mine of Phandelver');
  });

  it('leaves without completing, and takes back a mis-tapped completion', () => {
    let s = venture(started(), { op: 'enter', dungeon: 'tomb' });
    s = venture(s, { op: 'leave' });
    expect(s.players[0].dungeon).toBeNull();
    expect(s.players[0].dungeonsCompleted ?? []).toEqual([]);
    s = venture(s, { op: 'enter', dungeon: 'tomb' });
    s = venture(s, { op: 'complete' });
    s = venture(s, { op: 'uncomplete' });
    expect(s.players[0].dungeonsCompleted).toEqual([]);
  });

  it('rejects steps that cannot apply', () => {
    const base = started();
    expect(() => venture(base, { op: 'enter', dungeon: 'nope' })).toThrow('Unknown dungeon');
    expect(() => venture(base, { op: 'room', room: 'Arena' })).toThrow('Not in a dungeon');
    expect(() => venture(base, { op: 'complete' })).toThrow('Not in a dungeon');
    expect(() => venture(base, { op: 'leave' })).toThrow('Not in a dungeon');
    expect(() => venture(base, { op: 'uncomplete' })).toThrow('No completed dungeon');
    const inside = venture(base, { op: 'enter', dungeon: 'undercity' });
    expect(() => venture(inside, { op: 'enter', dungeon: 'tomb' })).toThrow('Already in');
    expect(() => venture(inside, { op: 'room', room: 'Cave Entrance' })).toThrow('Unknown room');
    expect(() => venture(inside, { op: 'room', room: 7 })).toThrow('Unknown room');
    expect(() => venture(base, { op: 'enter', dungeon: 'tomb' }, 9)).toThrow('No player at seat 9');
  });

  it('caps the completed list', () => {
    let s = started();
    for (let i = 0; i < MAX_DUNGEONS_COMPLETED + 3; i++) {
      s = venture(s, { op: 'enter', dungeon: 'tomb' });
      s = venture(s, { op: 'complete' });
    }
    expect(s.players[0].dungeonsCompleted).toHaveLength(MAX_DUNGEONS_COMPLETED);
  });

  it('starts the game clock like any other play', () => {
    expect(
      startsGameClock({ type: 'dungeon', seat: 0, actorSeat: 0, op: 'enter', dungeon: 'tomb' })
    ).toBe(true);
  });

  it('reads a row written before dungeons existed as in no dungeon', () => {
    const legacy = started();
    for (const p of legacy.players) {
      delete p.dungeon;
      delete p.dungeonsCompleted;
    }
    const s = venture(legacy, { op: 'enter', dungeon: 'mad-mage' }, 1);
    expect(s.players[1].dungeon).toEqual({ id: 'mad-mage', room: 'Yawning Portal' });
  });

  it('clears every seat on a rematch', () => {
    let s = venture(started(), { op: 'enter', dungeon: 'undercity' });
    s = venture(s, { op: 'complete' });
    s = venture(s, { op: 'enter', dungeon: 'tomb' });
    s = applyAction(s, { type: 'reset', ts: 3000 });
    expect(s.players[0].dungeon).toBeNull();
    expect(s.players[0].dungeonsCompleted).toEqual([]);
  });
});
