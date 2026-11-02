import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createGameState,
  isWinningSeat,
  makePlayer,
  teamOf,
  TWO_HEADED_GIANT_LIFE,
  TWO_HEADED_GIANT_POISON,
  type GameState,
} from './index';

function table(format: GameState['format'] = '2hg', players = 4): GameState {
  const lobby = createGameState({
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u0',
    format,
    startingLife: TWO_HEADED_GIANT_LIFE,
    commanderDamageEnabled: false,
    poisonEnabled: true,
    players: Array.from({ length: players }, (_, i) =>
      makePlayer({
        id: `u${i}`,
        userId: `u${i}`,
        seat: i,
        name: `P${i}`,
        startingLife: TWO_HEADED_GIANT_LIFE,
      })
    ),
    ts: 1000,
  });
  return applyAction(lobby, { type: 'start', ts: 1001 });
}

const life = (s: GameState, seat: number, delta: number) =>
  applyAction(s, { type: 'life', seat, delta, actorSeat: seat, ts: 2000 });
const poison = (s: GameState, seat: number, delta: number) =>
  applyAction(s, { type: 'poison', seat, delta, actorSeat: seat, ts: 2000 });

describe('Two-Headed Giant', () => {
  it('refuses to start an odd or single-team table', () => {
    expect(table('2hg', 3).status).toBe('lobby');
    expect(table('2hg', 2).status).toBe('lobby');
    expect(table('2hg', 4).status).toBe('active');
    expect(table('2hg', 6).status).toBe('active');
  });

  it('pairs seats into teams: 0+1, 2+3', () => {
    expect([0, 1, 2, 3, 4, 5].map(teamOf)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('shares one life total across a team and leaves the other team alone', () => {
    let s = life(table(), 1, -7);
    expect(s.players.map((p) => p.life)).toEqual([23, 23, 30, 30]);
    s = applyAction(s, { type: 'set-life', seat: 0, value: 12, actorSeat: 0, ts: 2001 });
    expect(s.players.map((p) => p.life)).toEqual([12, 12, 30, 30]);
    s = life(s, 3, 4);
    expect(s.players.map((p) => p.life)).toEqual([12, 12, 34, 34]);
  });

  it('shares poison across a team and loses the team at fifteen, not ten', () => {
    let s = poison(table(), 0, 10);
    expect(s.players.map((p) => p.poison)).toEqual([10, 10, 0, 0]);
    expect(s.players.every((p) => !p.eliminated)).toBe(true);
    s = poison(s, 1, 4);
    expect(s.players.every((p) => !p.eliminated)).toBe(true);
    s = poison(s, 1, 1);
    expect(s.players.map((p) => p.poison)).toEqual([15, 15, 0, 0]);
    expect(s.players.map((p) => p.eliminated)).toEqual([true, true, false, false]);
    expect(TWO_HEADED_GIANT_POISON).toBe(15);
  });

  it('eliminates both teammates together at zero life and ends the game for the other team', () => {
    const s = life(table(), 0, -30);
    expect(s.players.map((p) => p.eliminated)).toEqual([true, true, false, false]);
    expect(s.status).toBe('finished');
    expect(s.winnerSeat).toBe(2);
    expect(isWinningSeat(s, 2)).toBe(true);
    expect(isWinningSeat(s, 3)).toBe(true);
    expect(isWinningSeat(s, 0)).toBe(false);
  });

  it('keeps playing while two teams are standing, with a player down to one teammate left', () => {
    const s = life(table('2hg', 6), 0, -30);
    expect(s.status).toBe('active');
    expect(s.players.map((p) => p.eliminated)).toEqual([true, true, false, false, false, false]);
  });

  it('a concession takes the whole team out, and a revive brings it back', () => {
    let s = applyAction(table('2hg', 6), { type: 'eliminate', seat: 3, eliminated: true });
    expect(s.players.map((p) => p.eliminated)).toEqual([false, false, true, true, false, false]);
    s = applyAction(s, { type: 'eliminate', seat: 2, eliminated: false });
    expect(s.players.every((p) => !p.eliminated)).toBe(true);
  });

  it('does not share anything at a free-for-all table', () => {
    const s = poison(life(table('commander'), 0, -5), 0, 3);
    expect(s.players.map((p) => p.life)).toEqual([25, 30, 30, 30]);
    expect(s.players.map((p) => p.poison)).toEqual([3, 0, 0, 0]);
    expect(isWinningSeat({ format: 'commander', winnerSeat: 0 }, 1)).toBe(false);
    expect(isWinningSeat({ format: '2hg', winnerSeat: null }, 1)).toBe(false);
  });

  it('keeps poison per seat in a horde (shared life only)', () => {
    const s = poison(table('horde', 2), 0, 3);
    expect(s.players.map((p) => p.poison)).toEqual([3, 0]);
    expect(life(s, 0, -4).players.map((p) => p.life)).toEqual([26, 26]);
  });

  it('a free-for-all seat is out at ten poison', () => {
    const s = poison(table('commander'), 0, 10);
    expect(s.players[0].eliminated).toBe(true);
  });
});
