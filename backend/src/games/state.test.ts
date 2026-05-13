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

  it('gameToRecord with no startedAt yields zero duration', () => {
    const s = applyAction(lobby(), { type: 'end', winnerSeat: null });
    const rec = gameToRecord(s, 9999);
    expect(rec.durationMs).toBe(0);
    expect(rec.startedAt).toBeNull();
    expect(rec.winnerSeat).toBeNull();
  });

  it('end is a no-op when already finished', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'end', winnerSeat: 0 });
    const v = s.version;
    const again = applyAction(s, { type: 'end', winnerSeat: 1 });
    expect(again).toBe(s); // identity — short-circuit returns prev
    expect(again.version).toBe(v);
  });

  it('start is a no-op when not in lobby', () => {
    const started = applyAction(lobby(), { type: 'start' });
    const again = applyAction(started, { type: 'start' });
    expect(again).toBe(started);
  });

  it('set-life replaces life and logs set-life event', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'set-life', seat: 0, value: 12, actorSeat: 0 });
    expect(s.players[0].life).toBe(12);
    expect(s.events.at(-1)?.kind).toBe('set-life');
  });

  it('set-life throws on unknown seat', () => {
    expect(() =>
      applyAction(lobby(), { type: 'set-life', seat: 99, value: 1, actorSeat: 0 })
    ).toThrow();
  });

  it('poison cannot go below 0', () => {
    const s = applyAction(lobby(), { type: 'poison', seat: 0, delta: -5, actorSeat: 0 });
    expect(s.players[0].poison).toBe(0);
  });

  it('poison throws on unknown seat', () => {
    expect(() =>
      applyAction(lobby(), { type: 'poison', seat: 99, delta: 1, actorSeat: 0 })
    ).toThrow();
  });

  it('cmd-dmg negative delta clamps at 0', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 5, actorSeat: 0 });
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: -20, actorSeat: 0 });
    expect(s.players[1].commanderDamage[0]).toBe(0);
  });

  it('cmd-dmg throws on unknown seat', () => {
    expect(() =>
      applyAction(lobby(), { type: 'cmd-dmg', seat: 99, fromSeat: 0, delta: 1, actorSeat: 0 })
    ).toThrow();
  });

  it('eliminate manual and revive cycle (mid-game)', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'eliminate', seat: 1, eliminated: true });
    expect(s.players[1].eliminated).toBe(true);
    expect(s.events.at(-1)?.kind).toBe('eliminate');
    s = applyAction(s, { type: 'eliminate', seat: 1, eliminated: false });
    expect(s.players[1].eliminated).toBe(false);
    expect(s.events.at(-1)?.kind).toBe('revive');
  });

  it('manual eliminate of the second-to-last alive triggers auto-win', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'eliminate', seat: 1, eliminated: true });
    s = applyAction(s, { type: 'eliminate', seat: 2, eliminated: true });
    expect(s.status).toBe('finished');
    expect(s.winnerSeat).toBe(0);
  });

  it('add-player inserts and sorts by seat; remove-player drops', () => {
    let s = lobby(2);
    const extra = {
      id: 'u9',
      userId: 'u9',
      seat: 3,
      name: 'late',
      deckId: null,
      deckName: null,
      commander: null,
      life: 40,
      poison: 0,
      commanderDamage: {},
      eliminated: false,
      isHost: false,
      connected: true,
    };
    s = applyAction(s, { type: 'add-player', player: extra });
    expect(s.players.map((p) => p.seat)).toEqual([0, 1, 3]);
    expect(s.events.at(-1)?.kind).toBe('join');

    s = applyAction(s, { type: 'remove-player', seat: 3 });
    expect(s.players).toHaveLength(2);
    expect(s.events.at(-1)?.kind).toBe('leave');
  });

  it('add-player throws on a taken seat', () => {
    const player = {
      id: 'x',
      userId: 'x',
      seat: 0,
      name: 'x',
      deckId: null,
      deckName: null,
      commander: null,
      life: 40,
      poison: 0,
      commanderDamage: {},
      eliminated: false,
      isHost: false,
      connected: true,
    };
    expect(() => applyAction(lobby(), { type: 'add-player', player })).toThrow();
  });

  it('remove-player throws on unknown seat', () => {
    expect(() => applyAction(lobby(), { type: 'remove-player', seat: 9 })).toThrow();
  });

  it('update-player patches profile fields', () => {
    const s = applyAction(lobby(), {
      type: 'update-player',
      seat: 0,
      patch: { name: 'Renamed', deckName: 'D' },
    });
    expect(s.players[0].name).toBe('Renamed');
    expect(s.players[0].deckName).toBe('D');
  });

  it('update-player throws on unknown seat', () => {
    expect(() =>
      applyAction(lobby(), { type: 'update-player', seat: 9, patch: { name: 'x' } })
    ).toThrow();
  });

  it('note appends to event log without changing players', () => {
    const before = lobby();
    const s = applyAction(before, { type: 'note', actorSeat: 0, message: 'hello' });
    expect(s.players).toEqual(before.players);
    expect(s.events.at(-1)).toMatchObject({ kind: 'note', message: 'hello' });
  });

  it('settings without startingLife leaves life alone', () => {
    const s = applyAction(lobby(), { type: 'settings', patch: { poisonEnabled: true } });
    expect(s.poisonEnabled).toBe(true);
    expect(s.players[0].life).toBe(40);
  });

  it('event log is bounded to MAX_EVENTS', () => {
    let s = applyAction(lobby(), { type: 'start' });
    for (let i = 0; i < 600; i++) {
      s = applyAction(s, { type: 'note', actorSeat: null, message: `n${i}` });
    }
    expect(s.events.length).toBeLessThanOrEqual(500);
    // Newest events should be retained
    expect(s.events.at(-1)?.message).toBe('n599');
  });

  it('auto-win seat-0 wins when all opponents draw to 0', () => {
    // 3p game; eliminate both opponents simultaneously via lethal damage and
    // verify last-one-standing wins.
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'life', seat: 1, delta: -40, actorSeat: 0 });
    expect(s.status).toBe('active');
    s = applyAction(s, { type: 'life', seat: 2, delta: -40, actorSeat: 0 });
    expect(s.status).toBe('finished');
    expect(s.winnerSeat).toBe(0);
  });
});
