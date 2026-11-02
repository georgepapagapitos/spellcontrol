import { describe, expect, it } from 'vitest';
import { winnerOf } from './winners';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ seat: i, name: `P${i}` })) as never;

describe('winnerOf', () => {
  it('names the one winner at a free-for-all', () => {
    expect(winnerOf({ format: 'commander', players: players(4), winnerSeat: 2 })).toEqual({
      name: 'P2',
      plural: false,
    });
  });

  it('names both teammates at Two-Headed Giant', () => {
    expect(winnerOf({ format: '2hg', players: players(4), winnerSeat: 2 })).toEqual({
      name: 'P2 & P3',
      plural: true,
    });
  });

  it('is null for a draw, or when the winner is no longer seated', () => {
    expect(winnerOf({ format: '2hg', players: players(4), winnerSeat: null })).toBeNull();
    expect(winnerOf({ format: 'commander', players: players(2), winnerSeat: 7 })).toBeNull();
  });
});
