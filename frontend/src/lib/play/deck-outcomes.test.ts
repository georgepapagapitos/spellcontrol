import { describe, expect, it } from 'vitest';
import type { GameRecord } from '@spellcontrol/game-core';
import { deckOutcomes, gameRounds, lowerMedian } from './deck-outcomes';

const V1 = '99:aaaaaaaa';
const V2 = '98:bbbbbbbb';

function game(
  over: {
    turns?: number | null;
    version?: string | null;
    won?: boolean;
    pod?: number;
    mode?: 'local' | 'online';
    format?: GameRecord['format'];
    userId?: string | null;
  } = {}
): GameRecord {
  const pod = over.pod ?? 4;
  const players = Array.from({ length: pod }, (_, seat) => ({
    seat,
    userId: seat === 0 ? (over.userId ?? null) : null,
    name: `P${seat}`,
    deckId: seat === 0 ? 'd1' : `x${seat}`,
    deckName: null,
    commander: null,
    ...(seat === 0 && over.version !== null ? { deckVersion: over.version ?? V1 } : {}),
    finalLife: 10,
    eliminated: false,
  }));
  return {
    id: Math.random().toString(36),
    code: 'C',
    format: over.format ?? 'commander',
    startingLife: 40,
    players,
    winnerSeat: over.won ? 0 : 1,
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    mode: over.mode ?? 'local',
    ...(over.turns === null
      ? {}
      : { summary: { turns: over.turns ?? 24, durationMs: 1 } as GameRecord['summary'] }),
  };
}

describe('gameRounds', () => {
  it('counts a pod pass as one turn and rounds up, like the recap', () => {
    expect(gameRounds(game({ turns: 24, pod: 4 }))).toBe(6);
    expect(gameRounds(game({ turns: 25, pod: 4 }))).toBe(7);
    expect(gameRounds(game({ turns: 1, pod: 4 }))).toBe(1);
  });
  it('is null when no turns were passed, not zero', () => {
    expect(gameRounds(game({ turns: 0 }))).toBeNull();
    expect(gameRounds(game({ turns: null }))).toBeNull();
  });
});

describe('lowerMedian', () => {
  it('takes the lower of two middle values', () => {
    expect(lowerMedian([5, 9, 6, 7])).toBe(6);
    expect(lowerMedian([3, 1, 2])).toBe(2);
    expect(lowerMedian([])).toBeNull();
  });
});

describe('deckOutcomes', () => {
  it('splits games by the list that played them', () => {
    const out = deckOutcomes(
      [
        game({ turns: 24, won: true }),
        game({ turns: 28 }),
        game({ version: V2 }),
        game({ version: null }),
        game({ turns: null }),
      ],
      null,
      'd1',
      V1
    );
    expect(out.current.games).toBe(3);
    expect(out.current.wins).toBe(1);
    expect(out.current.lengths).toEqual([6, 7]);
    expect(out.current.winLengths).toEqual([6]);
    expect(out.otherVersions).toBe(1);
    expect(out.unversioned).toBe(1);
  });

  it('counts the same games the Table record does: no horde, only your seat online', () => {
    const out = deckOutcomes(
      [
        game({ format: 'horde' }),
        game({ mode: 'online', userId: 'someone-else' }),
        game({ mode: 'online', userId: 'me', turns: 8, pod: 2 }),
      ],
      'me',
      'd1',
      V1
    );
    expect(out.current.games).toBe(1);
    expect(out.current.lengths).toEqual([4]);
  });
});
