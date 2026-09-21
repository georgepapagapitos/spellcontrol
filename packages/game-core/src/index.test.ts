import { describe, it, expect } from 'vitest';
import {
  applyAction,
  cmdDamageKey,
  createGameState,
  gameToRecord,
  makePlayer,
  cardsToBottom,
  normalizeCounterName,
  seatCounters,
  selectNotableEvents,
  tableCounters,
  MAX_COUNTERS_PER_SCOPE,
  MAX_COUNTER_NAME_LENGTH,
  type GameEvent,
  type GamePlayer,
  type GameState,
} from './index';

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

  it('cmd-dmg negative delta clamps at 0, and refunds only the damage applied', () => {
    const s0 = applyAction(lobby(), { type: 'start' });
    const startingLife = s0.players[1].life;
    let s = applyAction(s0, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 5, actorSeat: 0 });
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: -20, actorSeat: 0 });
    expect(s.players[1].commanderDamage[0]).toBe(0);
    // The 15 points the clamp swallowed must not become bonus life.
    expect(s.players[1].life).toBe(startingLife);
  });

  it('records the on-the-play seat, and clears it on reset', () => {
    let s = applyAction(lobby(), { type: 'start' });
    expect(s.startingSeat).toBeNull();

    s = applyAction(s, { type: 'settings', patch: { startingSeat: 1 } });
    expect(s.startingSeat).toBe(1);
    // Not a rules change, so it earns no log row — the tool already writes its
    // own note, and a duplicate "Settings changed" would bury real moments.
    expect(s.events.some((e) => e.kind === 'settings')).toBe(false);

    // A reset is a fresh game at the same table: last game's first player is
    // stale, not inherited.
    s = applyAction(s, { type: 'reset' });
    expect(s.startingSeat).toBeNull();
  });

  it('drops the on-the-play seat when that player leaves', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'settings', patch: { startingSeat: 2 } });

    // Seats are reusable by a later joiner, so a stale seat number would
    // credit "went first" to whoever sits there next.
    s = applyAction(s, { type: 'remove-player', seat: 2 });
    expect(s.startingSeat).toBeNull();
  });

  it('leaves the on-the-play seat alone when a DIFFERENT player leaves', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'settings', patch: { startingSeat: 0 } });

    s = applyAction(s, { type: 'remove-player', seat: 2 });
    expect(s.startingSeat).toBe(0);
  });

  it('reads a legacy state with no startingSeat as null rather than undefined', () => {
    const legacy = applyAction(lobby(), { type: 'start' });
    // Simulate a persisted state written before the field existed.
    delete (legacy as { startingSeat?: number | null }).startingSeat;

    const s = applyAction(legacy, { type: 'life', seat: 0, delta: -1, actorSeat: 0 });
    expect(s.startingSeat).toBeNull();
  });

  it('tracks a partner pair as two independent commanders', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 7, actorSeat: 0 });
    s = applyAction(s, {
      type: 'cmd-dmg',
      seat: 1,
      fromSeat: 0,
      fromPartner: true,
      delta: 4,
      actorSeat: 0,
    });

    expect(s.players[1].commanderDamage[cmdDamageKey(0)]).toBe(7);
    expect(s.players[1].commanderDamage[cmdDamageKey(0, true)]).toBe(4);
    // Both still drain life 1:1 — the split is about the 21 rule, not damage.
    expect(s.players[1].life).toBe(40 - 11);
  });

  it('does NOT kill at 21 combined across a partner pair (rule 903.10a)', () => {
    let s = applyAction(lobby(), { type: 'start' });
    // 11 + 10 = 21 total, but neither commander reached 21 on its own, so
    // nobody dies. This is the false kill the per-seat bucket used to fire.
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 11, actorSeat: 0 });
    s = applyAction(s, {
      type: 'cmd-dmg',
      seat: 1,
      fromSeat: 0,
      fromPartner: true,
      delta: 10,
      actorSeat: 0,
    });

    expect(s.players[1].eliminated).toBe(false);
    expect(s.status).toBe('active');
  });

  it('kills at 21 from ONE partner even with the other untouched', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, {
      type: 'cmd-dmg',
      seat: 1,
      fromSeat: 0,
      fromPartner: true,
      delta: 21,
      actorSeat: 0,
    });

    expect(s.players[1].eliminated).toBe(true);
  });

  it('reads a pre-partner state as the primary commander (no migration)', () => {
    let s = applyAction(lobby(), { type: 'start' });
    // Exactly what a row written before partners existed looks like: a bare
    // seat number as the key, because JSON object keys were always strings.
    s = {
      ...s,
      players: s.players.map((p) => (p.seat === 1 ? { ...p, commanderDamage: { '0': 9 } } : p)),
    };

    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 2, actorSeat: 0 });

    expect(s.players[1].commanderDamage[cmdDamageKey(0)]).toBe(11);
    expect(s.players[1].commanderDamage[cmdDamageKey(0, true)]).toBeUndefined();
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
      partner: null,
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
      partner: null,
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

describe('phase', () => {
  it('is absent until set', () => {
    const s = applyAction(lobby(2), { type: 'start' });
    expect(s.phase).toBeUndefined();
  });

  it('sets the phase verbatim and pushes a phase event', () => {
    let s = applyAction(lobby(2), { type: 'start' });
    s = applyAction(s, { type: 'phase', phase: 'combat', actorSeat: 0, ts: 2000 });
    expect(s.phase).toBe('combat');
    expect(s.events.at(-1)).toMatchObject({
      kind: 'phase',
      actorSeat: 0,
      targetSeat: null,
      message: 'combat',
    });
  });

  it('allows jumping to any phase — no order validation', () => {
    let s = applyAction(lobby(2), { type: 'start' });
    s = applyAction(s, { type: 'phase', phase: 'end', actorSeat: 0 });
    expect(s.phase).toBe('end');
    // A table correcting itself: jump backward is allowed too.
    s = applyAction(s, { type: 'phase', phase: 'main1', actorSeat: 1 });
    expect(s.phase).toBe('main1');
  });

  it('pass-turn resets an already-running clock to beginning', () => {
    let s = applyAction(lobby(2), { type: 'start' });
    s = applyAction(s, { type: 'phase', phase: 'combat', actorSeat: 0 });
    s = applyAction(s, { type: 'pass-turn', actorSeat: 0 });
    expect(s.phase).toBe('beginning');
  });

  it('pass-turn leaves an unstarted clock absent', () => {
    let s = applyAction(lobby(2), { type: 'start' });
    expect(s.phase).toBeUndefined();
    s = applyAction(s, { type: 'pass-turn', actorSeat: null });
    expect(s.phase).toBeUndefined();
  });
});

describe('set-ready', () => {
  it("flips only the actor's own seat and announces it as a system note", () => {
    const s = applyAction(lobby(3), { type: 'set-ready', actorSeat: 1, ready: true, ts: 2000 });
    expect(s.players.map((p) => p.ready === true)).toEqual([false, true, false]);
    const ev = s.events[s.events.length - 1];
    expect(ev.kind).toBe('note');
    // actorSeat null = a system line, not something P1 typed.
    expect(ev.actorSeat).toBeNull();
    expect(ev.targetSeat).toBe(1);
    expect(ev.message).toBe('P1 is ready');
  });

  it('un-readies and says so', () => {
    let s = applyAction(lobby(2), { type: 'set-ready', actorSeat: 0, ready: true });
    s = applyAction(s, { type: 'set-ready', actorSeat: 0, ready: false });
    expect(s.players[0].ready).toBe(false);
    expect(s.events[s.events.length - 1].message).toBe('P0 is not ready');
  });

  it('is a no-op when the flag already reads that way — no duplicate log rows', () => {
    const s = applyAction(lobby(2), { type: 'set-ready', actorSeat: 0, ready: true });
    expect(applyAction(s, { type: 'set-ready', actorSeat: 0, ready: true })).toBe(s);
    // Legacy rows read `undefined`, which must mean the same as `false`.
    const legacy = lobby(2);
    expect(legacy.players[0].ready).toBeUndefined();
    expect(applyAction(legacy, { type: 'set-ready', actorSeat: 0, ready: false })).toBe(legacy);
  });

  it('throws on an unknown seat', () => {
    expect(() => applyAction(lobby(2), { type: 'set-ready', actorSeat: 7, ready: true })).toThrow();
  });

  it('clears on start and on reset', () => {
    let s = applyAction(lobby(2), { type: 'set-ready', actorSeat: 0, ready: true });
    s = applyAction(s, { type: 'start' });
    expect(s.players.every((p) => p.ready === false)).toBe(true);
    s = applyAction(s, { type: 'set-ready', actorSeat: 1, ready: true });
    s = applyAction(s, { type: 'reset' });
    expect(s.players.every((p) => p.ready === false)).toBe(true);
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

function ev(kind: GameEvent['kind'], overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    ts: 0,
    kind,
    actorSeat: null,
    targetSeat: null,
    ...overrides,
  };
}

describe('selectNotableEvents', () => {
  it('keeps only eliminate/end/designation, dropping every other kind', () => {
    const events: GameEvent[] = [
      ev('join'),
      ev('eliminate'),
      ev('life'),
      ev('note', { message: 'gg' }),
      ev('end'),
      ev('leave'),
      ev('designation'),
      ev('turn'),
      ev('set-life'),
      ev('poison'),
      ev('cmd-dmg'),
      ev('revive'),
      ev('start'),
      ev('reset'),
      ev('settings'),
    ];
    expect(selectNotableEvents(events).map((e) => e.kind)).toEqual([
      'eliminate',
      'end',
      'designation',
    ]);
  });

  it('never includes a note event, even one carrying free player-typed text', () => {
    // HARD PRIVACY BINDING: 'note' is player-typed free text (see GameTools'
    // announce()) with no consent from whoever it names — it must never reach
    // a shareable payload. This is the whitelist-exclusion test for that.
    const events: GameEvent[] = [
      ev('note', { actorSeat: 0, message: 'Player B rage-quit' }),
      ev('eliminate', { targetSeat: 1 }),
    ];
    const out = selectNotableEvents(events);
    expect(out.some((e) => e.kind === 'note')).toBe(false);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('eliminate');
  });

  it('preserves chronological input order', () => {
    const events: GameEvent[] = [
      ev('designation', { ts: 1 }),
      ev('eliminate', { ts: 2 }),
      ev('end', { ts: 3 }),
    ];
    expect(selectNotableEvents(events).map((e) => e.ts)).toEqual([1, 2, 3]);
  });

  it('caps at 20, keeping the most recent 20 when more qualify', () => {
    const events: GameEvent[] = Array.from({ length: 25 }, (_, i) =>
      ev('eliminate', { ts: i, targetSeat: i })
    );
    const out = selectNotableEvents(events);
    expect(out).toHaveLength(20);
    expect(out.map((e) => e.targetSeat)).toEqual(Array.from({ length: 20 }, (_, i) => i + 5));
  });

  it('returns [] for empty input', () => {
    expect(selectNotableEvents([])).toEqual([]);
  });

  it('returns [] when none of the input events are notable', () => {
    const events: GameEvent[] = [ev('start'), ev('join'), ev('life'), ev('note')];
    expect(selectNotableEvents(events)).toEqual([]);
  });
});

// ── Free-form counters ─────────────────────────────────────────────────────

describe('free-form counters', () => {
  function active(players = 2) {
    return applyAction(lobby(players), { type: 'start' });
  }

  it('springs a seat counter into existence on first use', () => {
    const s = applyAction(active(), {
      type: 'counter',
      seat: 0,
      name: 'Energy',
      delta: 3,
      actorSeat: 0,
    });
    expect(seatCounters(s.players[0])).toEqual({ Energy: 3 });
    // Only the acting seat gets it — a counter is not a table-wide schema.
    expect(seatCounters(s.players[1])).toEqual({});
  });

  it('creates at zero with a zero delta, so "add counter" needs no second action', () => {
    const s = applyAction(active(), {
      type: 'counter',
      seat: 0,
      name: 'Rad',
      delta: 0,
      actorSeat: 0,
    });
    expect(seatCounters(s.players[0])).toEqual({ Rad: 0 });
  });

  it('accumulates and clamps at zero rather than going negative', () => {
    let s = active();
    for (const delta of [2, 2, -10]) {
      s = applyAction(s, { type: 'counter', seat: 0, name: 'Energy', delta, actorSeat: 0 });
    }
    expect(seatCounters(s.players[0]).Energy).toBe(0);
  });

  it('keys a table counter separately from an identically named seat counter', () => {
    let s = applyAction(active(), {
      type: 'counter',
      seat: null,
      name: 'Storm',
      delta: 4,
      actorSeat: 0,
    });
    s = applyAction(s, { type: 'counter', seat: 0, name: 'Storm', delta: 1, actorSeat: 0 });
    expect(tableCounters(s)).toEqual({ Storm: 4 });
    expect(seatCounters(s.players[0])).toEqual({ Storm: 1 });
  });

  it('normalizes the name so whitespace variants are one counter, not two', () => {
    let s = applyAction(active(), {
      type: 'counter',
      seat: 0,
      name: '  Rad  counters ',
      delta: 1,
      actorSeat: 0,
    });
    s = applyAction(s, { type: 'counter', seat: 0, name: 'Rad counters', delta: 1, actorSeat: 0 });
    expect(seatCounters(s.players[0])).toEqual({ 'Rad counters': 2 });
  });

  it('rejects an empty or whitespace-only name instead of keying on ""', () => {
    expect(() => normalizeCounterName('   ')).toThrow();
    expect(() =>
      applyAction(active(), { type: 'counter', seat: 0, name: '', delta: 1, actorSeat: 0 })
    ).toThrow();
  });

  it('truncates an over-long name to the cap', () => {
    const name = normalizeCounterName('x'.repeat(MAX_COUNTER_NAME_LENGTH + 40));
    expect(name).toHaveLength(MAX_COUNTER_NAME_LENGTH);
  });

  it('caps the number of counters per scope but still allows adjusting existing ones', () => {
    let s = active();
    for (let i = 0; i < MAX_COUNTERS_PER_SCOPE; i++) {
      s = applyAction(s, { type: 'counter', seat: 0, name: `C${i}`, delta: 1, actorSeat: 0 });
    }
    expect(() =>
      applyAction(s, { type: 'counter', seat: 0, name: 'one-too-many', delta: 1, actorSeat: 0 })
    ).toThrow(/maximum/i);
    // The cap is on distinct counters, not on using them.
    const bumped = applyAction(s, { type: 'counter', seat: 0, name: 'C0', delta: 5, actorSeat: 0 });
    expect(seatCounters(bumped.players[0]).C0).toBe(6);
  });

  it('remove deletes the counter outright, distinct from decrementing to zero', () => {
    let s = applyAction(active(), {
      type: 'counter',
      seat: 0,
      name: 'Energy',
      delta: 2,
      actorSeat: 0,
    });
    s = applyAction(s, { type: 'counter', seat: 0, name: 'Energy', delta: -2, actorSeat: 0 });
    expect(seatCounters(s.players[0])).toEqual({ Energy: 0 });
    s = applyAction(s, { type: 'counter-remove', seat: 0, name: 'Energy', actorSeat: 0 });
    expect(seatCounters(s.players[0])).toEqual({});
  });

  it('removing a counter that was never there is a no-op, not a throw', () => {
    const s = applyAction(active(), {
      type: 'counter-remove',
      seat: 0,
      name: 'Nope',
      actorSeat: 0,
    });
    expect(seatCounters(s.players[0])).toEqual({});
  });

  it('throws for an unknown seat', () => {
    expect(() =>
      applyAction(active(), { type: 'counter', seat: 9, name: 'Energy', delta: 1, actorSeat: 0 })
    ).toThrow(/No player at seat 9/);
  });

  it('never causes a loss, even for a counter a user names "poison"', () => {
    let s = applyAction(lobby(2, { poisonEnabled: true }), { type: 'start' });
    s = applyAction(s, { type: 'counter', seat: 0, name: 'poison', delta: 50, actorSeat: 0 });
    expect(s.players[0].eliminated).toBe(false);
    expect(s.status).toBe('active');
  });

  it('logs a counter event carrying the normalized name and delta', () => {
    const s = applyAction(active(), {
      type: 'counter',
      seat: 1,
      name: ' Experience ',
      delta: 2,
      actorSeat: 0,
    });
    const last = s.events[s.events.length - 1];
    expect(last.kind).toBe('counter');
    expect(last.message).toBe('Experience');
    expect(last.delta).toBe(2);
    expect(last.targetSeat).toBe(1);
  });

  it('reset clears seat and table counters along with poison', () => {
    let s = active();
    s = applyAction(s, { type: 'counter', seat: 0, name: 'Energy', delta: 5, actorSeat: 0 });
    s = applyAction(s, { type: 'counter', seat: null, name: 'Storm', delta: 5, actorSeat: 0 });
    s = applyAction(s, { type: 'reset' });
    expect(seatCounters(s.players[0])).toEqual({});
    expect(tableCounters(s)).toEqual({});
  });

  it('reads a legacy state with no counters fields as empty and writes into it', () => {
    // A row persisted before this feature: neither field exists on the JSON.
    const legacy = active();
    const stripped: GameState = {
      ...legacy,
      tableCounters: undefined,
      players: legacy.players.map((p) => {
        const { counters: _drop, ...rest } = p;
        return rest as GamePlayer;
      }),
    };
    expect(seatCounters(stripped.players[0])).toEqual({});
    expect(tableCounters(stripped)).toEqual({});
    const s = applyAction(stripped, {
      type: 'counter',
      seat: 0,
      name: 'Energy',
      delta: 1,
      actorSeat: 0,
    });
    expect(seatCounters(s.players[0])).toEqual({ Energy: 1 });
  });
});

describe('undoOf — the log knows what an Undo took back', () => {
  it('flags the events after the anchor as undone and the compensating event as undo', () => {
    let g = applyAction(lobby(), { type: 'start' });
    const anchor = g.events[g.events.length - 1].id;
    g = applyAction(g, { type: 'life', seat: 0, delta: -3, actorSeat: 0 });
    g = applyAction(g, { type: 'life', seat: 0, delta: -2, actorSeat: 0 });
    g = applyAction(g, { type: 'set-life', seat: 0, value: 40, actorSeat: 0, undoOf: anchor });
    expect(g.players[0].life).toBe(40);
    const tail = g.events.slice(-3);
    expect(tail.map((e) => e.kind)).toEqual(['life', 'life', 'set-life']);
    expect(tail[0].undone).toBe(true);
    expect(tail[1].undone).toBe(true);
    expect(tail[2].undo).toBe(true);
    expect(tail[2].undone).toBeUndefined();
    // the anchor itself and everything before it stand
    expect(g.events.find((e) => e.id === anchor)?.undone).toBeUndefined();
  });

  it('a second compensating action of the same Undo keeps the first one marked undo, not undone', () => {
    let g = applyAction(lobby(), { type: 'start' });
    const anchor = g.events[g.events.length - 1].id;
    g = applyAction(g, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 4, actorSeat: 0 });
    g = applyAction(g, {
      type: 'cmd-dmg',
      seat: 1,
      fromSeat: 0,
      delta: -4,
      actorSeat: 1,
      undoOf: anchor,
    });
    g = applyAction(g, { type: 'set-life', seat: 1, value: 40, actorSeat: 1, undoOf: anchor });
    const marks = g.events.slice(-3).map((e) => [e.kind, !!e.undone, !!e.undo]);
    expect(marks).toEqual([
      ['cmd-dmg', true, false],
      ['cmd-dmg', false, true],
      ['set-life', false, true],
    ]);
  });

  it('an anchor the bounded log no longer holds voids nothing but the compensating event', () => {
    let g = applyAction(lobby(), { type: 'start' });
    g = applyAction(g, { type: 'life', seat: 0, delta: -3, actorSeat: 0 });
    g = applyAction(g, { type: 'set-life', seat: 0, value: 40, actorSeat: 0, undoOf: 'evt_gone' });
    expect(g.events.slice(-2).map((e) => !!e.undone)).toEqual([false, false]);
    expect(g.events[g.events.length - 1].undo).toBe(true);
  });

  it('actions without undoOf leave the log untouched, and notable events drop undone ones', () => {
    let g = applyAction(lobby(), { type: 'start' });
    g = applyAction(g, { type: 'life', seat: 0, delta: -3, actorSeat: 0 });
    expect(g.events.some((e) => e.undo || e.undone)).toBe(false);
    const anchor = g.events[g.events.length - 1].id;
    g = applyAction(g, { type: 'eliminate', seat: 1, eliminated: true });
    g = applyAction(g, { type: 'eliminate', seat: 1, eliminated: false, undoOf: anchor });
    expect(selectNotableEvents(g.events).map((e) => e.kind)).not.toContain('eliminate');
  });
});

describe('mulligan type', () => {
  it('defaults to commander, the variant legacy tables already played', () => {
    expect(lobby().mulliganType).toBe('commander');
    // A state persisted before the field existed reads as the same default.
    const legacy = { ...lobby(), mulliganType: undefined } as unknown as GameState;
    expect(applyAction(legacy, { type: 'start' }).mulliganType).toBe('commander');
  });

  it('owes the bottom a different count per variant', () => {
    // Commander: the first mulligan is free, then one per mulligan after it.
    expect([0, 1, 2, 3].map((n) => cardsToBottom('commander', n))).toEqual([0, 0, 1, 2]);
    // London: one per mulligan, from the first.
    expect([0, 1, 2, 3].map((n) => cardsToBottom('london', n))).toEqual([0, 1, 2, 3]);
    // Free: never anything owed.
    expect([0, 1, 2, 3].map((n) => cardsToBottom('free', n))).toEqual([0, 0, 0, 0]);
  });

  it('is a rules setting, so changing it logs an event', () => {
    const before = lobby();
    const after = applyAction(before, { type: 'settings', patch: { mulliganType: 'london' } });
    expect(after.mulliganType).toBe('london');
    expect(after.events.filter((e) => e.kind === 'settings')).toHaveLength(1);
  });
});

describe('turn timer', () => {
  it('is off by default and flips through settings', () => {
    const before = lobby();
    expect(before.turnTimerEnabled).toBe(false);
    expect(
      applyAction(before, { type: 'settings', patch: { turnTimerEnabled: true } }).turnTimerEnabled
    ).toBe(true);
  });
});

describe('reseat', () => {
  it('reorders seats to the given order and clears the stale on-the-play mark', () => {
    const before = applyAction(lobby(3), { type: 'settings', patch: { startingSeat: 2 } });
    const after = applyAction(before, { type: 'reseat', order: ['u2', 'u0', 'u1'] });
    expect(after.players.map((p) => [p.id, p.seat])).toEqual([
      ['u2', 0],
      ['u0', 1],
      ['u1', 2],
    ]);
    expect(after.startingSeat).toBeNull();
    expect(after.events.some((e) => e.message === 'Seats shuffled')).toBe(true);
  });

  it('refuses an order that is not a permutation of the seated players', () => {
    const before = lobby(3);
    for (const order of [
      ['u0', 'u1'],
      ['u0', 'u1', 'u1'],
      ['u0', 'u1', 'ghost'],
    ]) {
      expect(applyAction(before, { type: 'reseat', order })).toBe(before);
    }
  });

  it('refuses once the game is active, since seat numbers key live game state', () => {
    const active = applyAction(lobby(3), { type: 'start' });
    expect(applyAction(active, { type: 'reseat', order: ['u2', 'u1', 'u0'] })).toBe(active);
  });
});

describe('watching and voice', () => {
  it('starts closed: a new table is seats only, with nowhere to talk', () => {
    const s = lobby();
    expect(s.spectatorsAllowed).toBe(false);
    expect(s.voiceUrl).toBe(null);
  });

  it('reads a game persisted before either field as closed, not open', () => {
    const legacy = lobby() as Partial<GameState>;
    delete legacy.spectatorsAllowed;
    delete legacy.voiceUrl;
    const s = applyAction(legacy as GameState, { type: 'note', message: 'hi', actorSeat: 0 });
    expect(s.spectatorsAllowed).toBe(false);
    expect(s.voiceUrl).toBe(null);
  });

  it('opens and closes watching through settings', () => {
    const open = applyAction(lobby(), {
      type: 'settings',
      patch: { spectatorsAllowed: true },
    });
    expect(open.spectatorsAllowed).toBe(true);
    const shut = applyAction(open, { type: 'settings', patch: { spectatorsAllowed: false } });
    expect(shut.spectatorsAllowed).toBe(false);
  });

  it('tells the table when watching is opened, because the table has a right to know', () => {
    const before = lobby().events.length;
    const open = applyAction(lobby(), {
      type: 'settings',
      patch: { spectatorsAllowed: true },
    });
    expect(open.events.length).toBe(before + 1);
    expect(open.events.at(-1)?.kind).toBe('settings');
  });

  it('carries a voice link, and clears it, without announcing either', () => {
    const withUrl = applyAction(lobby(), {
      type: 'settings',
      patch: { voiceUrl: 'https://discord.gg/example' },
    });
    expect(withUrl.voiceUrl).toBe('https://discord.gg/example');
    expect(withUrl.events.length).toBe(lobby().events.length);
    const cleared = applyAction(withUrl, { type: 'settings', patch: { voiceUrl: null } });
    expect(cleared.voiceUrl).toBe(null);
  });
});
