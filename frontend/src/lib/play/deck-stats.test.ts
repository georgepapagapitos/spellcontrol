import { describe, expect, it } from 'vitest';
import type { GameRecord } from '@spellcontrol/game-core';
import { DECK_RATE_MIN_GAMES, deckPilots, formatRate, rateAboveFloor } from './deck-stats';

function game(
  id: string,
  winnerSeat: number | null,
  seats: Array<[name: string, userId: string | null, deckId: string | null]>,
  mode: GameRecord['mode'] = 'local'
): GameRecord {
  return {
    id,
    code: id,
    format: 'commander',
    startingLife: 40,
    players: seats.map(([name, userId, deckId], seat) => ({
      seat,
      userId,
      name,
      deckId,
      deckName: deckId,
      commander: null,
      finalLife: 10,
      eliminated: false,
    })),
    winnerSeat,
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    mode,
  };
}

describe('win-rate sample floor', () => {
  it('hides a rate below the floor and shows it at the floor', () => {
    expect(DECK_RATE_MIN_GAMES).toBe(5);
    expect(rateAboveFloor(1, 0)).toBeNull();
    expect(formatRate(4, 0)).toBe('—');
    expect(formatRate(3, 2)).toBe('60%');
    expect(rateAboveFloor(0, 5)).toBe(0);
  });
});

describe('deckPilots', () => {
  it('splits a deck record by who sat behind it, you first', () => {
    const history = [
      game('a', 0, [
        ['Me', 'u1', 'atraxa'],
        ['Sam', null, 'x'],
      ]),
      game('b', 1, [
        ['Jo', null, 'y'],
        ['Sam', null, 'atraxa'],
      ]),
      game('c', 1, [
        ['Me', 'u1', 'atraxa'],
        ['sam ', null, 'atraxa'],
      ]),
    ];
    const rows = deckPilots(history, 'atraxa', 'u1');
    expect(rows.map((r) => [r.name, r.isYou, r.played, r.wins, r.losses])).toEqual([
      ['Me', true, 2, 1, 1],
      ['Sam', false, 2, 2, 0],
    ]);
  });

  it('counts only your own seat of an online game', () => {
    const history = [
      game(
        'o',
        0,
        [
          ['Me', 'u1', 'atraxa'],
          ['Ann', 'u2', 'atraxa'],
        ],
        'online'
      ),
    ];
    expect(deckPilots(history, 'atraxa', 'u1').map((r) => r.name)).toEqual(['Me']);
  });
});
