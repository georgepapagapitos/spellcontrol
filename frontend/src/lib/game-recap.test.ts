import { describe, expect, it } from 'vitest';
import type { GameAction, GamePlayer, GameState } from './game-state';
import { applyAction, createGameState, makePlayer } from './game-state';
import { buildGameRecap } from './game-recap';

function player(seat: number, name: string, startingLife: number): GamePlayer {
  return makePlayer({ id: `p${seat}`, userId: null, seat, name, startingLife });
}

/** Build a game by replaying actions through the real reducer, so every event
 *  in the log has exactly the shape `applyAction` actually produces. */
function play(players: GamePlayer[], startingLife: number, actions: GameAction[]): GameState {
  let state = createGameState({
    id: 'g1',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players,
    ts: 0,
  });
  for (const action of actions) state = applyAction(state, action);
  return state;
}

describe('buildGameRecap', () => {
  it('derives the full spread of stats a well-tracked game supports', () => {
    const maya = player(0, 'Maya', 40);
    const priya = player(1, 'Priya', 40);
    const sam = player(2, 'Sam', 40);

    const game = play([maya, priya, sam], 40, [
      { type: 'start', ts: 60_000 },
      { type: 'pass-turn', actorSeat: null, ts: 61_000 }, // turn 1 -> seat 0
      { type: 'life', seat: 1, delta: -5, actorSeat: 1, ts: 65_000 }, // first blood
      { type: 'pass-turn', actorSeat: null, ts: 70_000 }, // turn 2 -> seat 1
      // Biggest hit, and also lethal (>=21 commander damage) — auto-eliminates Priya here.
      { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 25, actorSeat: 0, ts: 75_000 },
      { type: 'life', seat: 1, delta: -20, actorSeat: 1, ts: 80_000 }, // no-op on an already-eliminated seat
      { type: 'pass-turn', actorSeat: null, ts: 85_000 }, // turn 3 -> seat 2
      { type: 'set-designation', designation: 'monarch', seat: 0, actorSeat: 0, ts: 90_000 },
      { type: 'set-designation', designation: 'monarch', seat: 2, actorSeat: 2, ts: 95_000 },
      { type: 'set-designation', designation: 'initiative', seat: 0, actorSeat: 0, ts: 100_000 },
      { type: 'set-life', seat: 0, value: 3, actorSeat: 0, ts: 110_000 }, // Maya's comeback dip
      { type: 'life', seat: 0, delta: 30, actorSeat: 0, ts: 120_000 },
      { type: 'pass-turn', actorSeat: null, ts: 130_000 }, // turn 4 -> seat 0
      { type: 'pass-turn', actorSeat: null, ts: 140_000 }, // turn 5 -> seat 2
      { type: 'pass-turn', actorSeat: null, ts: 150_000 }, // turn 6 -> seat 0
      { type: 'end', winnerSeat: 0, ts: 2_580_000 }, // 43 minutes after createdAt=0
    ]);

    const stats = buildGameRecap(game);
    const byId = Object.fromEntries(stats.map((s) => [s.id, s.detail]));

    expect(byId.length).toBe('43 minutes');
    expect(byId.rounds).toBe('2 rounds (6 turns)');
    expect(byId['first-blood']).toBe('Maya drew first blood on Priya, for 5.');
    expect(byId['biggest-hit']).toBe('Maya hit Priya for 25 in one swing.');
    expect(byId.comeback).toBe('Maya won from as low as 3 life.');
    expect(byId.eliminations).toBe('Priya fell first.');
    expect(byId['designation-monarch']).toBe(
      'Sam held it at the end, after it changed hands 2 times.'
    );
    expect(byId['designation-initiative']).toBe('Maya claimed it and never let go.');
  });

  it('omits first blood and the comeback once the log has been truncated, keeps the rest', () => {
    const maya = player(0, 'Maya', 40);
    const priya = player(1, 'Priya', 40);

    const full = play([maya, priya], 40, [
      { type: 'start', ts: 0 },
      { type: 'pass-turn', actorSeat: null, ts: 1_000 },
      { type: 'life', seat: 1, delta: -5, actorSeat: 1, ts: 2_000 },
      // Kept below the 21-commander-damage lethal threshold — this is a
      // 2-player game, so an auto-eliminate here would auto-win it early
      // (with a non-deterministic Date.now() endedAt) and short-circuit the
      // explicit 'end' below.
      { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 15, actorSeat: 0, ts: 3_000 },
      { type: 'set-life', seat: 0, value: 3, actorSeat: 0, ts: 4_000 },
      { type: 'end', winnerSeat: 0, ts: 100_000 },
    ]);

    // The first event is always 'start'; a real 500-cap eviction always drops
    // from the front, so simulating truncation by slicing the head is exact.
    expect(full.events[0].kind).toBe('start');
    const truncated: GameState = { ...full, events: full.events.slice(1) };
    expect(truncated.events[0].kind).not.toBe('start');

    const untruncatedStats = buildGameRecap(full);
    const truncatedStats = buildGameRecap(truncated);

    expect(untruncatedStats.some((s) => s.id === 'first-blood')).toBe(true);
    expect(untruncatedStats.some((s) => s.id === 'comeback')).toBe(true);

    expect(truncatedStats.some((s) => s.id === 'first-blood')).toBe(false);
    expect(truncatedStats.some((s) => s.id === 'comeback')).toBe(false);
    // Timestamp- and window-based stats survive truncation.
    expect(truncatedStats.some((s) => s.id === 'length')).toBe(true);
    expect(truncatedStats.some((s) => s.id === 'biggest-hit')).toBe(true);
  });

  it('omits every stat a bare game has no events to support — never a zeroed placeholder', () => {
    const maya = player(0, 'Maya', 40);
    const priya = player(1, 'Priya', 40);

    const game = play([maya, priya], 40, [
      { type: 'start', ts: 0 },
      { type: 'end', winnerSeat: 0, ts: 60_000 },
    ]);

    const stats = buildGameRecap(game);
    // Only game length is derivable from timestamps alone; nothing else
    // happened, so nothing else should be reported (not a 0/false entry).
    expect(stats.map((s) => s.id)).toEqual(['length']);
  });

  it('gives a draw its non-winner-dependent stats but never a comeback', () => {
    const maya = player(0, 'Maya', 40);
    const priya = player(1, 'Priya', 40);

    const game = play([maya, priya], 40, [
      { type: 'start', ts: 0 },
      { type: 'pass-turn', actorSeat: null, ts: 1_000 },
      { type: 'life', seat: 1, delta: -8, actorSeat: 1, ts: 2_000 },
      // Kept below the 21-commander-damage lethal threshold so this doesn't
      // auto-eliminate Maya (and thus auto-win the game) before the explicit
      // draw below — this test wants a genuine still-active-until-'end' draw.
      { type: 'cmd-dmg', seat: 0, fromSeat: 1, delta: 15, actorSeat: 1, ts: 3_000 },
      { type: 'end', winnerSeat: null, ts: 50_000 },
    ]);

    expect(game.winnerSeat).toBeNull();
    const stats = buildGameRecap(game);
    const ids = stats.map((s) => s.id);

    expect(ids).toContain('length');
    expect(ids).toContain('first-blood');
    expect(ids).toContain('biggest-hit');
    expect(ids).not.toContain('comeback');
  });

  it('reads set-life as an absolute value, not a further delta, when reconstructing running life', () => {
    const maya = player(0, 'Maya', 40);
    const priya = player(1, 'Priya', 40);

    const game = play([maya, priya], 40, [
      { type: 'start', ts: 0 },
      { type: 'life', seat: 0, delta: -10, actorSeat: 0, ts: 1_000 }, // Maya: 40 -> 30
      // A judge ruling sets Maya's life to the absolute value 3 (NOT "-3").
      // Mishandled as a naive delta this would read 30 - 3 = 27 and the dip
      // below would never register.
      { type: 'set-life', seat: 0, value: 3, actorSeat: 0, ts: 2_000 },
      { type: 'life', seat: 0, delta: 22, actorSeat: 0, ts: 3_000 }, // Maya: 3 -> 25
      { type: 'end', winnerSeat: 0, ts: 60_000 },
    ]);

    const stats = buildGameRecap(game);
    const comeback = stats.find((s) => s.id === 'comeback');
    expect(comeback?.detail).toBe('Maya won from as low as 3 life.');
  });

  it('does not credit a designation that was never claimed', () => {
    const maya = player(0, 'Maya', 40);
    const priya = player(1, 'Priya', 40);
    const game = play([maya, priya], 40, [
      { type: 'start', ts: 0 },
      { type: 'end', winnerSeat: 0, ts: 10_000 },
    ]);
    const stats = buildGameRecap(game);
    expect(stats.some((s) => s.id.startsWith('designation-'))).toBe(false);
  });
});
