import { describe, expect, it } from 'vitest';
import { rollupForUser } from './rollup';
import { userWon, userWonSql } from './team-win';

const seats = (ids: Array<string | null>) => ids.map((userId, seat) => ({ seat, userId }));

describe('userWon', () => {
  const four = seats(['a', 'b', 'c', 'd']);

  it('credits both teammates of a Two-Headed Giant win, not the other team', () => {
    const g = { format: '2hg', winnerSeat: 0, winnerUserId: 'a', participants: four };
    expect(['a', 'b', 'c', 'd'].map((u) => userWon(g, u))).toEqual([true, true, false, false]);
    const g2 = { ...g, winnerSeat: 2, winnerUserId: 'c' };
    expect(['a', 'b', 'c', 'd'].map((u) => userWon(g2, u))).toEqual([false, false, true, true]);
  });

  it('keeps every other format to the single stored winner', () => {
    const g = { format: 'commander', winnerSeat: 0, winnerUserId: 'a', participants: four };
    expect(['a', 'b', 'c', 'd'].map((u) => userWon(g, u))).toEqual([true, false, false, false]);
  });

  it('reads a draw and an unseated account as no win', () => {
    const draw = { format: '2hg', winnerSeat: null, winnerUserId: null, participants: four };
    expect(userWon(draw, 'a')).toBe(false);
    expect(userWon({ ...draw, winnerSeat: 0, winnerUserId: 'a' }, 'z')).toBe(false);
  });

  it('SQL twin reduces to the plain comparison for non-team rows and names the team rule', () => {
    const sql = userWonSql('g', '$1');
    expect(sql).toContain('g.winner_user_id = $1');
    expect(sql).toContain("g.format = '2hg'");
  });
});

describe('rollup wonGoingFirst', () => {
  it('counts the team win for the teammate who went first', () => {
    const game = (format: string) => ({
      format,
      participants: [
        { seat: 0, userId: 'a' },
        { seat: 1, userId: 'b' },
      ] as never,
      summary: {
        startingSeat: 1,
        winnerSeat: 0,
        seats: [
          { seat: 0, placement: 1 },
          { seat: 1, placement: 1 },
        ],
        firstBlood: null,
      } as never,
    });
    expect(rollupForUser([game('2hg')], 'b').wonGoingFirst).toBe(1);
    expect(rollupForUser([game('commander')], 'b').wonGoingFirst).toBe(0);
  });
});
