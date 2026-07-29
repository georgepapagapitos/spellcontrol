import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createGameState,
  isKeyMoment,
  makePlayer,
  summarizeGame,
  type GameAction,
  type GameState,
} from './index';

function lobby(players = 4): GameState {
  return createGameState({
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u0',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: Array.from({ length: players }, (_, i) =>
      makePlayer({
        id: `u${i}`,
        userId: `u${i}`,
        seat: i,
        name: `P${i}`,
        startingLife: 40,
        isHost: i === 0,
      })
    ),
    ts: 1000,
  });
}

/** Apply a script of actions, auto-stamping monotonic timestamps 1s apart so
 *  nothing accidentally lands inside the 2s burst window. */
function run(state: GameState, actions: GameAction[], step = 1000): GameState {
  let s = state;
  let ts = 2000;
  for (const a of actions) {
    s = applyAction(s, { ...a, ts } as GameAction);
    ts += step;
  }
  return s;
}

const seat = (s: ReturnType<typeof summarizeGame>, n: number) => s.seats.find((x) => x.seat === n)!;

describe('summarizeGame', () => {
  it('returns zeroed seats and no first blood for an untouched game', () => {
    const s = summarizeGame(lobby(), 5000);
    expect(s.firstBlood).toBeNull();
    expect(s.turns).toBe(0);
    expect(s.seats).toHaveLength(4);
    expect(seat(s, 0)).toMatchObject({
      damageTaken: 0,
      lifeGained: 0,
      biggestHit: 0,
      lowestLife: 40,
      placement: null,
      killedBySeat: null,
    });
  });

  it('records first blood on the first damage taken', () => {
    const g = run(lobby(), [
      { type: 'start' },
      { type: 'life', seat: 2, delta: 3, actorSeat: 2 }, // a gain is not blood
      { type: 'life', seat: 1, delta: -6, actorSeat: 1 },
      { type: 'life', seat: 3, delta: -9, actorSeat: 3 },
    ]);
    const s = summarizeGame(g, 99_000);
    expect(s.firstBlood).toMatchObject({ seat: 1, amount: 6, bySeat: null, turn: null });
  });

  it('credits first blood and KOs to the seat holding the turn marker', () => {
    const g = run(lobby(), [
      { type: 'start' },
      { type: 'pass-turn', actorSeat: 0 }, // seat 0 takes the turn
      { type: 'life', seat: 2, delta: -7, actorSeat: 2 },
      { type: 'life', seat: 2, delta: -33, actorSeat: 2 }, // seat 2 dies on seat 0's turn
    ]);
    const s = summarizeGame(g, 99_000);
    expect(s.firstBlood).toMatchObject({ seat: 2, bySeat: 0, turn: 1 });
    expect(seat(s, 2).killedBySeat).toBe(0);
    expect(seat(s, 2).eliminatedOnTurn).toBe(1);
  });

  it('never credits a seat with killing itself', () => {
    const g = run(lobby(), [
      { type: 'start' },
      { type: 'pass-turn', actorSeat: 0, toSeat: 1 },
      { type: 'life', seat: 1, delta: -40, actorSeat: 1 },
    ]);
    expect(seat(summarizeGame(g, 99_000), 1).killedBySeat).toBeNull();
  });

  it('groups a burst of taps into one hit but sums them all as damage', () => {
    // Six -1 taps 100ms apart = one -6 hit; a -4 well past the window is its own.
    const burst = run(
      lobby(),
      [
        { type: 'start' },
        ...Array.from({ length: 6 }, () => ({
          type: 'life' as const,
          seat: 1,
          delta: -1,
          actorSeat: 1,
        })),
      ],
      100
    );
    const g = applyAction(burst, { type: 'life', seat: 1, delta: -4, actorSeat: 1, ts: 60_000 });
    const s = summarizeGame(g, 99_000);
    expect(seat(s, 1).damageTaken).toBe(10);
    expect(seat(s, 1).biggestHit).toBe(6);
    expect(seat(s, 1).lowestLife).toBe(30);
  });

  it('breaks a burst on a heal', () => {
    const g = run(
      lobby(),
      [
        { type: 'start' },
        { type: 'life', seat: 1, delta: -3, actorSeat: 1 },
        { type: 'life', seat: 1, delta: 2, actorSeat: 1 },
        { type: 'life', seat: 1, delta: -2, actorSeat: 1 },
      ],
      100
    );
    const s = summarizeGame(g, 99_000);
    expect(seat(s, 1).biggestHit).toBe(3);
    expect(seat(s, 1).lifeGained).toBe(2);
    expect(seat(s, 1).damageTaken).toBe(5);
  });

  it('counts set-life as damage or gain against the running total', () => {
    const g = run(lobby(), [
      { type: 'start' },
      { type: 'set-life', seat: 1, value: 12, actorSeat: 1 },
    ]);
    const s = summarizeGame(g, 99_000);
    expect(seat(s, 1).damageTaken).toBe(28);
    expect(seat(s, 1).lowestLife).toBe(12);
    expect(s.firstBlood).toMatchObject({ seat: 1, amount: 28 });
  });

  it('builds the commander-damage matrix and attributes the dealer', () => {
    const g = run(lobby(), [
      { type: 'start' },
      { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 7, actorSeat: 1 },
      { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 7, actorSeat: 1 },
      { type: 'cmd-dmg', seat: 2, fromSeat: 0, delta: 5, actorSeat: 2 },
    ]);
    const s = summarizeGame(g, 99_000);
    expect(s.commanderDamage).toEqual([
      { fromSeat: 0, toSeat: 1, amount: 14 },
      { fromSeat: 0, toSeat: 2, amount: 5 },
    ]);
    expect(seat(s, 0).commanderDamageDealt).toBe(19);
    // Commander damage also drains life, so the victim's totals move too.
    expect(seat(s, 1).damageTaken).toBe(14);
    expect(seat(s, 1).lowestLife).toBe(26);
  });

  it('ranks placements by elimination order with the winner first', () => {
    const g = run(lobby(), [
      { type: 'start' },
      { type: 'life', seat: 3, delta: -40, actorSeat: 3 }, // out first → 4th
      { type: 'life', seat: 1, delta: -40, actorSeat: 1 }, // out second → 3rd
      { type: 'life', seat: 2, delta: -40, actorSeat: 2 }, // out third → 2nd, seat 0 auto-wins
    ]);
    const s = summarizeGame(g, 99_000);
    expect(s.winnerSeat).toBe(0);
    expect(seat(s, 0).placement).toBe(1);
    expect(seat(s, 2).placement).toBe(2);
    expect(seat(s, 1).placement).toBe(3);
    expect(seat(s, 3).placement).toBe(4);
  });

  it('leaves the living without a placement in an unfinished game', () => {
    const g = run(lobby(), [
      { type: 'start' },
      { type: 'life', seat: 3, delta: -40, actorSeat: 3 },
    ]);
    const s = summarizeGame(g, 99_000);
    expect(seat(s, 3).placement).toBe(4);
    expect(seat(s, 0).placement).toBeNull();
  });

  it('drops a revived seat back out of the placement order', () => {
    const g = run(lobby(), [
      { type: 'start' },
      { type: 'eliminate', seat: 3, eliminated: true },
      { type: 'eliminate', seat: 3, eliminated: false },
      { type: 'eliminate', seat: 1, eliminated: true },
    ]);
    const s = summarizeGame(g, 99_000);
    expect(seat(s, 3).placement).toBeNull();
    expect(seat(s, 1).placement).toBe(4);
  });

  it('discards everything before a reset', () => {
    const g = run(lobby(), [
      { type: 'start' },
      { type: 'life', seat: 1, delta: -20, actorSeat: 1 },
      { type: 'pass-turn', actorSeat: 0 },
      { type: 'reset' },
      { type: 'start' },
      { type: 'life', seat: 2, delta: -4, actorSeat: 2 },
    ]);
    const s = summarizeGame(g, 99_000);
    expect(s.turns).toBe(0);
    expect(s.firstBlood).toMatchObject({ seat: 2, amount: 4 });
    expect(seat(s, 1).damageTaken).toBe(0);
    expect(seat(s, 1).lowestLife).toBe(40);
  });

  it('measures duration from start, using `now` while the game is live', () => {
    const live = run(lobby(), [{ type: 'start' }]); // startedAt = 2000
    expect(summarizeGame(live, 12_000).durationMs).toBe(10_000);
    const done = applyAction(live, { type: 'end', winnerSeat: 0, ts: 7000 });
    expect(summarizeGame(done, 99_000).durationMs).toBe(5000);
  });

  it('reports zero duration for a game that never started', () => {
    expect(summarizeGame(lobby(), 99_000).durationMs).toBe(0);
  });
});

describe('applyAction settings logging', () => {
  const logged = (g: GameState) => g.events.filter((e) => e.kind === 'settings').length;

  it('does not log cosmetic-only settings changes', () => {
    const g = run(lobby(), [
      { type: 'settings', patch: { layout: 'pod-alt' } },
      { type: 'settings', patch: { tapOrientation: 'vertical' } },
    ]);
    expect(logged(g)).toBe(0);
    expect(g.layout).toBe('pod-alt');
    expect(g.tapOrientation).toBe('vertical');
  });

  it('logs a rules change, once, and only when the value actually moves', () => {
    const g = run(lobby(), [
      { type: 'settings', patch: { startingLife: 20 } },
      { type: 'settings', patch: { startingLife: 20, layout: 'pod-alt' } }, // no-op rules
      { type: 'settings', patch: { poisonEnabled: true } },
    ]);
    expect(logged(g)).toBe(2);
    expect(g.startingLife).toBe(20);
    expect(g.poisonEnabled).toBe(true);
  });
});

describe('isKeyMoment', () => {
  it('keeps structural moments and drops turn passes', () => {
    expect(isKeyMoment({ kind: 'eliminate' })).toBe(true);
    expect(isKeyMoment({ kind: 'designation' })).toBe(true);
    expect(isKeyMoment({ kind: 'note' })).toBe(true);
    expect(isKeyMoment({ kind: 'turn' })).toBe(false);
  });

  it('promotes big life swings and drops small ones', () => {
    expect(isKeyMoment({ kind: 'life', delta: -5 })).toBe(true);
    expect(isKeyMoment({ kind: 'life', delta: 12 })).toBe(true);
    expect(isKeyMoment({ kind: 'life', delta: -4 })).toBe(false);
    expect(isKeyMoment({ kind: 'life' })).toBe(false);
    expect(isKeyMoment({ kind: 'cmd-dmg', delta: 7 })).toBe(true);
    expect(isKeyMoment({ kind: 'cmd-dmg', delta: 2 })).toBe(false);
  });
});
