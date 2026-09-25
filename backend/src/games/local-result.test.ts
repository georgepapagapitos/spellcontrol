import { describe, expect, it } from 'vitest';
import { parseLocalResult } from './local-result';

/**
 * The local life board seats 2 to 10 players (Lotus goes to 10). A finished
 * game of any size it can seat must be recordable, and nothing larger.
 */
function game(count: number) {
  return {
    game: {
      id: `g_${count}`,
      mode: 'local',
      status: 'finished',
      format: 'commander',
      startingLife: 40,
      endedAt: 1_700_000_000_000,
      players: Array.from({ length: count }, (_, seat) => ({ seat, life: 40 - seat })),
      winnerSeat: count - 1,
    },
  };
}

describe('parseLocalResult player count', () => {
  it('records a ten-seat game, winner on the last seat', () => {
    const r = parseLocalResult(game(10));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(r.state.winnerSeat).toBe(9);
    }
  });

  it('refuses an eleventh seat', () => {
    const r = parseLocalResult(game(11));
    expect(r).toEqual({ ok: false, error: 'A game has 2 to 10 players.' });
  });
});

describe('parseLocalResult turnOrder', () => {
  it('accepts clockwise', () => {
    const body = game(2);
    (body.game as Record<string, unknown>).turnOrder = 'clockwise';
    const r = parseLocalResult(body);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.turnOrder).toBe('clockwise');
  });

  it('accepts counterclockwise', () => {
    const body = game(2);
    (body.game as Record<string, unknown>).turnOrder = 'counterclockwise';
    const r = parseLocalResult(body);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.turnOrder).toBe('counterclockwise');
  });

  it('rejects a bad value', () => {
    const body = game(2);
    (body.game as Record<string, unknown>).turnOrder = 'sideways';
    const r = parseLocalResult(body);
    expect(r).toEqual({ ok: false, error: 'Invalid turn order.' });
  });

  it('leaves it undefined (clockwise) when absent', () => {
    const r = parseLocalResult(game(2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.turnOrder).toBeUndefined();
  });
});

describe('parseLocalResult rule toggles + partner', () => {
  it('carries commanderDamageEnabled/poisonEnabled and a seat’s partner + colorIdentity into state', () => {
    const body = game(2);
    (body.game as Record<string, unknown>).commanderDamageEnabled = false;
    (body.game as Record<string, unknown>).poisonEnabled = true;
    (body.game.players[0] as Record<string, unknown>).partner = 'Silas Renn';
    (body.game.players[0] as Record<string, unknown>).colorIdentity = ['u', 'b'];
    const r = parseLocalResult(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.commanderDamageEnabled).toBe(false);
    expect(r.state.poisonEnabled).toBe(true);
    expect(r.state.players[0].partner).toBe('Silas Renn');
    expect(r.state.players[0].colorIdentity).toEqual(['U', 'B']);
    expect(r.state.players[1].partner).toBeNull();
  });

  it('defaults the toggles to on/off and partner to null when absent', () => {
    const r = parseLocalResult(game(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.commanderDamageEnabled).toBe(true);
    expect(r.state.poisonEnabled).toBe(false);
    expect(r.state.players[0].partner).toBeNull();
    expect(r.state.players[0].colorIdentity).toEqual([]);
  });
});
