import { describe, it, expect } from 'vitest';
import { applyAction, createGameState, gameToRecord, makePlayer, type GameState } from './index';

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

  it('eliminate throws on unknown seat (F23: no phantom no-op event)', () => {
    const s = applyAction(lobby(), { type: 'start' });
    expect(() => applyAction(s, { type: 'eliminate', seat: 99, eliminated: true })).toThrow();
  });

  it('end ignores an eliminated seat as winner (F3: no forged self-win)', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'eliminate', seat: 2, eliminated: true });
    // Eliminated seat 2 tries to declare itself the winner.
    s = applyAction(s, { type: 'end', winnerSeat: 2 });
    expect(s.status).toBe('finished');
    expect(s.winnerSeat).toBeNull();
    expect(s.events.at(-1)).toMatchObject({ kind: 'end', targetSeat: null });
  });

  it('end ignores a nonexistent seat as winner', () => {
    const s = applyAction(applyAction(lobby(), { type: 'start' }), {
      type: 'end',
      winnerSeat: 99,
    });
    expect(s.winnerSeat).toBeNull();
  });

  it('end honors a live seat as winner', () => {
    const s = applyAction(applyAction(lobby(3), { type: 'start' }), {
      type: 'end',
      winnerSeat: 1,
    });
    expect(s.winnerSeat).toBe(1);
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
      colorIdentity: [],
      panelColorKey: null,
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
      colorIdentity: [],
      panelColorKey: null,
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

describe('pass-turn', () => {
  it('from null starts at the first non-eliminated seat', () => {
    const s0 = applyAction(lobby(3), { type: 'start' });
    expect(s0.activeSeat).toBeNull();
    const s1 = applyAction(s0, { type: 'pass-turn', actorSeat: null, ts: 2000 });
    expect(s1.activeSeat).toBe(0); // seat 0 is the lowest seat
    expect(s1.events.at(-1)?.kind).toBe('turn');
    expect(s1.events.at(-1)?.targetSeat).toBe(0);
  });

  it('advances to the next seat in order', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'pass-turn', actorSeat: null }); // → seat 0
    s = applyAction(s, { type: 'pass-turn', actorSeat: 0 }); // → seat 1
    expect(s.activeSeat).toBe(1);
    s = applyAction(s, { type: 'pass-turn', actorSeat: 1 }); // → seat 2
    expect(s.activeSeat).toBe(2);
  });

  it('wraps from last seat back to first', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    // Start at seat 2 manually by passing turn twice.
    s = applyAction(s, { type: 'pass-turn', actorSeat: null }); // seat 0
    s = applyAction(s, { type: 'pass-turn', actorSeat: 0 }); // seat 1
    s = applyAction(s, { type: 'pass-turn', actorSeat: 1 }); // seat 2
    s = applyAction(s, { type: 'pass-turn', actorSeat: 2 }); // wraps → seat 0
    expect(s.activeSeat).toBe(0);
  });

  it('skips eliminated seats', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'pass-turn', actorSeat: null }); // → seat 0
    s = applyAction(s, { type: 'pass-turn', actorSeat: 0 }); // → seat 1
    // Eliminate seat 2 — next pass should skip it and wrap to seat 0.
    s = applyAction(s, { type: 'life', seat: 2, delta: -40, actorSeat: 0 });
    expect(s.players[2].eliminated).toBe(true);
    s = applyAction(s, { type: 'pass-turn', actorSeat: 1 }); // seat 2 is out → seat 0
    expect(s.activeSeat).toBe(0);
  });

  it('toSeat sets the marker directly ("start turn here" on any live seat)', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    // From null, a targeted move lands on the target, not the lowest seat.
    s = applyAction(s, { type: 'pass-turn', actorSeat: 2, toSeat: 2 });
    expect(s.activeSeat).toBe(2);
    expect(s.events.at(-1)?.targetSeat).toBe(2);
    // From a live marker, a targeted move also lands on the target.
    s = applyAction(s, { type: 'pass-turn', actorSeat: 1, toSeat: 1 });
    expect(s.activeSeat).toBe(1);
  });

  it('toSeat falls back to advance when the target is eliminated or unknown', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'pass-turn', actorSeat: null }); // → seat 0
    s = applyAction(s, { type: 'life', seat: 2, delta: -40, actorSeat: 0 });
    expect(s.players[2].eliminated).toBe(true);
    // Targeting the eliminated seat 2 falls back to advancing 0 → 1.
    s = applyAction(s, { type: 'pass-turn', actorSeat: 0, toSeat: 2 });
    expect(s.activeSeat).toBe(1);
    // Targeting a nonexistent seat also falls back to the advance.
    s = applyAction(s, { type: 'pass-turn', actorSeat: 1, toSeat: 9 });
    expect(s.activeSeat).toBe(0);
  });

  it('returns null activeSeat when all players are eliminated', () => {
    let s = applyAction(lobby(2), { type: 'start' });
    // Eliminate both players manually (bypasses auto-win by using eliminate directly).
    // We need to test the helper in isolation; in practice the game ends when the last
    // player falls. Use the internal scenario where we force both eliminated.
    s = applyAction(s, { type: 'pass-turn', actorSeat: null }); // → seat 0
    // Eliminate seat 0 directly — in a 2-player game seat 1 auto-wins, so we test
    // with a pre-built state that has both eliminated.
    const allElim: GameState = {
      ...s,
      players: s.players.map((p) => ({ ...p, eliminated: true })),
      status: 'finished',
    };
    // pass-turn on an all-eliminated state: activeSeat should become null.
    const res = applyAction(allElim, { type: 'pass-turn', actorSeat: null });
    expect(res.activeSeat).toBeNull();
  });

  it('reset clears activeSeat', () => {
    let s = applyAction(lobby(2), { type: 'start' });
    s = applyAction(s, { type: 'pass-turn', actorSeat: null }); // activeSeat = 0
    s = applyAction(s, { type: 'reset' });
    expect(s.activeSeat).toBeNull();
    expect(s.status).toBe('lobby');
  });

  it('legacy state missing activeSeat defaults to null and passes turn correctly', () => {
    const base = lobby(3);
    // Simulate a legacy persisted state by removing activeSeat and designations.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy: GameState = { ...base } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (legacy as any).activeSeat;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (legacy as any).designations;
    const started = applyAction(legacy, { type: 'start' });
    expect(started.activeSeat).toBeNull(); // legacy tolerance
    expect(started.designations).toEqual({ monarch: null, initiative: null });
    const passed = applyAction(started, { type: 'pass-turn', actorSeat: null });
    expect(passed.activeSeat).toBe(0);
  });
});

describe('set-designation', () => {
  it('claims monarch — single holder', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'set-designation', designation: 'monarch', seat: 1, actorSeat: 1 });
    expect(s.designations.monarch).toBe(1);
    expect(s.events.at(-1)?.kind).toBe('designation');
    expect(s.events.at(-1)?.targetSeat).toBe(1);
    expect(s.events.at(-1)?.message).toBe('monarch');
  });

  it('transfers monarch from previous holder', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'set-designation', designation: 'monarch', seat: 0, actorSeat: 0 });
    expect(s.designations.monarch).toBe(0);
    s = applyAction(s, { type: 'set-designation', designation: 'monarch', seat: 2, actorSeat: 2 });
    expect(s.designations.monarch).toBe(2); // transferred; seat 0 no longer holds it
  });

  it('claims initiative independently of monarch', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'set-designation', designation: 'monarch', seat: 0, actorSeat: 0 });
    s = applyAction(s, {
      type: 'set-designation',
      designation: 'initiative',
      seat: 1,
      actorSeat: 1,
    });
    expect(s.designations.monarch).toBe(0);
    expect(s.designations.initiative).toBe(1);
  });

  it('explicitly clears a designation with seat: null', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'set-designation', designation: 'monarch', seat: 0, actorSeat: 0 });
    s = applyAction(s, {
      type: 'set-designation',
      designation: 'monarch',
      seat: null,
      actorSeat: 0,
    });
    expect(s.designations.monarch).toBeNull();
    // Event should record the clear: targetSeat = null, fromSeat = previous holder.
    const ev = s.events.at(-1)!;
    expect(ev.kind).toBe('designation');
    expect(ev.targetSeat).toBeNull();
    expect(ev.fromSeat).toBe(0);
  });

  it('throws when target seat does not exist', () => {
    const s = applyAction(lobby(3), { type: 'start' });
    expect(() =>
      applyAction(s, { type: 'set-designation', designation: 'monarch', seat: 99, actorSeat: 0 })
    ).toThrow();
  });

  it('reset clears all designations', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'set-designation', designation: 'monarch', seat: 0, actorSeat: 0 });
    s = applyAction(s, {
      type: 'set-designation',
      designation: 'initiative',
      seat: 1,
      actorSeat: 1,
    });
    s = applyAction(s, { type: 'reset' });
    expect(s.designations.monarch).toBeNull();
    expect(s.designations.initiative).toBeNull();
  });

  it('legacy state missing designations tolerates set-designation', () => {
    const base = lobby(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy: GameState = { ...base } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (legacy as any).designations;
    const s = applyAction(legacy, {
      type: 'set-designation',
      designation: 'monarch',
      seat: 0,
      actorSeat: 0,
    });
    expect(s.designations.monarch).toBe(0);
    expect(s.designations.initiative).toBeNull();
  });
});
