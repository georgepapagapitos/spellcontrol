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
