/**
 * Mirror of backend reducer tests. The two files share a copied-by-value
 * module ([backend|frontend]/.../game-state.ts) — keeping the tests in lockstep
 * is the cheapest way to make sure a divergence in either copy gets caught.
 */
import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createGameState,
  gameToRecord,
  makePlayer,
  type GamePlayer,
} from './game-state';

function lobby(players = 2) {
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

describe('applyAction (frontend mirror)', () => {
  it('starts a lobby game', () => {
    const s = applyAction(lobby(), { type: 'start', ts: 2000 });
    expect(s.status).toBe('active');
    expect(s.startedAt).toBe(2000);
    expect(s.version).toBe(1);
  });

  it('start is a no-op when not in lobby', () => {
    const started = applyAction(lobby(), { type: 'start' });
    expect(applyAction(started, { type: 'start' })).toBe(started);
  });

  it('end then end again is a no-op', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'end', winnerSeat: 0 });
    expect(applyAction(s, { type: 'end', winnerSeat: 1 })).toBe(s);
  });

  it('life delta + auto-eliminate to 0', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'life', seat: 2, delta: -40, actorSeat: 1 });
    expect(s.players[2].eliminated).toBe(true);
    expect(s.status).toBe('active');
  });

  it('set-life replaces life', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'set-life', seat: 1, value: 7, actorSeat: 1 });
    expect(s.players[1].life).toBe(7);
    expect(s.events.at(-1)?.kind).toBe('set-life');
  });

  it('poison clamps at 0 and auto-eliminates at 10', () => {
    const poisonGame = createGameState({
      id: 'g',
      code: '',
      mode: 'local',
      hostUserId: null,
      format: 'standard',
      startingLife: 20,
      commanderDamageEnabled: false,
      poisonEnabled: true,
      players: Array.from({ length: 2 }, (_, i) =>
        makePlayer({ id: `u${i}`, userId: null, seat: i, name: `P${i}`, startingLife: 20 })
      ),
    });
    let s = applyAction(poisonGame, { type: 'start' });
    s = applyAction(s, { type: 'poison', seat: 0, delta: -5, actorSeat: 0 });
    expect(s.players[0].poison).toBe(0);
    s = applyAction(s, { type: 'poison', seat: 1, delta: 10, actorSeat: 1 });
    expect(s.players[1].eliminated).toBe(true);
    expect(s.status).toBe('finished');
    expect(s.winnerSeat).toBe(0);
  });

  it('commander damage reduces life and tracks per-source; clamps at 0 on undo', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 5, actorSeat: 0 });
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: -20, actorSeat: 0 });
    expect(s.players[1].commanderDamage[0]).toBe(0);
  });

  it('commander damage auto-eliminates at 21 from one source', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 21, actorSeat: 0 });
    expect(s.players[1].eliminated).toBe(true);
  });

  it('manual eliminate/revive logs the right event kind', () => {
    let s = applyAction(lobby(3), { type: 'start' });
    s = applyAction(s, { type: 'eliminate', seat: 1, eliminated: true });
    expect(s.events.at(-1)?.kind).toBe('eliminate');
    s = applyAction(s, { type: 'eliminate', seat: 1, eliminated: false });
    expect(s.events.at(-1)?.kind).toBe('revive');
  });

  it('reset returns players to starting life and clears damage', () => {
    let s = applyAction(lobby(), { type: 'start' });
    s = applyAction(s, { type: 'life', seat: 1, delta: -20, actorSeat: 0 });
    s = applyAction(s, { type: 'cmd-dmg', seat: 1, fromSeat: 0, delta: 5, actorSeat: 0 });
    s = applyAction(s, { type: 'reset' });
    expect(s.status).toBe('lobby');
    expect(s.players[1].life).toBe(40);
    expect(s.players[1].commanderDamage).toEqual({});
  });

  it('settings.startingLife rebases life in lobby, not mid-game', () => {
    const lobbied = applyAction(lobby(), { type: 'settings', patch: { startingLife: 20 } });
    expect(lobbied.players[0].life).toBe(20);
    const started = applyAction(lobby(), { type: 'start' });
    const mid = applyAction(started, { type: 'settings', patch: { startingLife: 20 } });
    expect(mid.players[0].life).toBe(40);
  });

  it('add-player + remove-player', () => {
    const newPlayer: GamePlayer = {
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
    let s = applyAction(lobby(), { type: 'add-player', player: newPlayer });
    expect(s.players).toHaveLength(3);
    s = applyAction(s, { type: 'remove-player', seat: 3 });
    expect(s.players).toHaveLength(2);
  });

  it('add-player throws on taken seat; remove-player throws on unknown', () => {
    const dup: GamePlayer = {
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
    expect(() => applyAction(lobby(), { type: 'add-player', player: dup })).toThrow();
    expect(() => applyAction(lobby(), { type: 'remove-player', seat: 9 })).toThrow();
  });

  it('update-player patches fields', () => {
    const s = applyAction(lobby(), {
      type: 'update-player',
      seat: 0,
      patch: { name: 'Renamed', deckName: 'D' },
    });
    expect(s.players[0].name).toBe('Renamed');
    expect(s.players[0].deckName).toBe('D');
  });

  it('note appends event only', () => {
    const before = lobby();
    const s = applyAction(before, { type: 'note', actorSeat: 0, message: 'hi' });
    expect(s.players).toEqual(before.players);
    expect(s.events.at(-1)?.message).toBe('hi');
  });

  it('throws on unknown seat for gameplay actions', () => {
    expect(() =>
      applyAction(lobby(), { type: 'life', seat: 9, delta: -1, actorSeat: 0 })
    ).toThrow();
    expect(() =>
      applyAction(lobby(), { type: 'set-life', seat: 9, value: 1, actorSeat: 0 })
    ).toThrow();
    expect(() =>
      applyAction(lobby(), { type: 'poison', seat: 9, delta: 1, actorSeat: 0 })
    ).toThrow();
    expect(() =>
      applyAction(lobby(), { type: 'cmd-dmg', seat: 9, fromSeat: 0, delta: 1, actorSeat: 0 })
    ).toThrow();
    expect(() =>
      applyAction(lobby(), { type: 'update-player', seat: 9, patch: { name: 'x' } })
    ).toThrow();
  });

  it('event log is bounded', () => {
    let s = applyAction(lobby(), { type: 'start' });
    for (let i = 0; i < 600; i++) {
      s = applyAction(s, { type: 'note', actorSeat: null, message: String(i) });
    }
    expect(s.events.length).toBeLessThanOrEqual(500);
    expect(s.events.at(-1)?.message).toBe('599');
  });

  it('gameToRecord captures winner and duration; zero duration without startedAt', () => {
    let s = applyAction(lobby(), { type: 'start', ts: 1000 });
    s = applyAction(s, { type: 'life', seat: 1, delta: -40, actorSeat: 0, ts: 5000 });
    const rec = gameToRecord(s, 5000);
    expect(rec.winnerSeat).toBe(0);
    expect(rec.durationMs).toBe(4000);

    const noStart = applyAction(lobby(), { type: 'end', winnerSeat: null });
    const r2 = gameToRecord(noStart, 1234);
    expect(r2.durationMs).toBe(0);
  });
});
