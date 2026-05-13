import { describe, it, expect } from 'vitest';
import { applyAction, createGameState, gameToRecord, makePlayer } from './state';

function lobby(players = 2, opts: Partial<Parameters<typeof createGameState>[0]> = {}) {
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
    ...opts,
  });
}

describe('applyAction', () => {
  it('starts a lobby game and stamps version + event', () => {
    const s0 = lobby();
    const s1 = applyAction(s0, { type: 'start', ts: 2000 });
    expect(s1.status).toBe('active');
    expect(s1.startedAt).toBe(2000);
    expect(s1.version).toBe(1);
    expect(s1.events.at(-1)?.kind).toBe('start');
  });

  it('decrements life and appends an event', () => {
    const s0 = applyAction(lobby(), { type: 'start' });
    const s1 = applyAction(s0, { type: 'life', seat: 1, delta: -3, actorSeat: 0 });
    expect(s1.players[1].life).toBe(37);
    expect(s1.events.at(-1)).toMatchObject({
      kind: 'life',
      delta: -3,
      targetSeat: 1,
      actorSeat: 0,
    });
  });

  it('commander damage reduces life and tracks per-source', () => {
    const s0 = applyAction(lobby(), { type: 'start' });
    const s1 = applyAction(s0, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 7, actorSeat: 0 });
    expect(s1.players[1].life).toBe(33);
    expect(s1.players[1].commanderDamage[0]).toBe(7);
  });

  it('auto-eliminates at 21 commander damage from one source', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 21, actorSeat: 0 });
    expect(s.players[1].eliminated).toBe(true);
    // 2-player → last-one-standing → finished with seat 0 winning.
    expect(s.status).toBe('finished');
    expect(s.winnerSeat).toBe(0);
  });

  it('auto-eliminates at 0 life', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'life', seat: 2, delta: -40, actorSeat: 1 });
    expect(s.players[2].eliminated).toBe(true);
    expect(s.status).toBe('active'); // two still alive
  });

  it('does not auto-eliminate in lobby', () => {
    const s = applyAction(lobby(), {
      type: 'cmd-dmg',
      seat: 1,
      fromSeat: 0,
      delta: 25,
      actorSeat: 0,
    });
    expect(s.players[1].eliminated).toBe(false);
  });

  it('reset returns players to starting life and clears damage', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'life', seat: 1, delta: -20, actorSeat: 0 });
    s = applyAction(s, { type: 'reset' });
    expect(s.status).toBe('lobby');
    expect(s.players[1].life).toBe(40);
    expect(s.players[1].commanderDamage).toEqual({});
  });

  it('settings.startingLife rebases life in lobby', () => {
    const s = applyAction(lobby(), {
      type: 'settings',
      patch: { startingLife: 20 },
    });
    expect(s.startingLife).toBe(20);
    expect(s.players[0].life).toBe(20);
  });

  it('settings.startingLife does NOT rebase life mid-game', () => {
    const started = applyAction(lobby(), { type: 'start' });
    const s = applyAction(started, { type: 'settings', patch: { startingLife: 20 } });
    expect(s.players[0].life).toBe(40);
  });

  it('throws on unknown seat', () => {
    expect(() =>
      applyAction(lobby(), { type: 'life', seat: 99, delta: -1, actorSeat: 0 })
    ).toThrow();
  });

  it('gameToRecord captures players + winner + duration', () => {
    let s = applyAction(lobby(), { type: 'start', ts: 1_000_000 });
    s = applyAction(s, { type: 'life', seat: 1, delta: -40, actorSeat: 0, ts: 2_000_000 });
    const rec = gameToRecord(s, 2_000_000);
    expect(rec.winnerSeat).toBe(0);
    expect(rec.durationMs).toBe(1_000_000);
    expect(rec.players).toHaveLength(2);
  });
});
