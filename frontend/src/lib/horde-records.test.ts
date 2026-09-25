import { describe, expect, it } from 'vitest';
import { aggregateHordeRecords, coopResultLabel } from './horde-records';
import type { GameRecord } from '@/lib/game-state';

function hordeGame(
  id: string,
  coopOutcome: 'won' | 'lost' | undefined,
  hordeId: string | undefined,
  endedAt = 1000
): GameRecord {
  return {
    id,
    code: id,
    format: 'horde',
    startingLife: 40,
    startedAt: endedAt - 60000,
    endedAt,
    durationMs: 60000,
    winnerSeat: null,
    mode: 'local',
    players: [
      {
        seat: 0,
        userId: null,
        name: 'P1',
        deckId: null,
        deckName: null,
        commander: null,
        finalLife: 40,
        eliminated: false,
      },
    ],
    ...(coopOutcome !== undefined ? { coopOutcome } : {}),
    ...(hordeId !== undefined ? { hordeId } : {}),
  };
}

describe('aggregateHordeRecords', () => {
  it('returns empty array for no records', () => {
    expect(aggregateHordeRecords([])).toEqual([]);
  });

  it('tallies won/lost per hordeId', () => {
    const rows = aggregateHordeRecords([
      hordeGame('g1', 'won', 'zombies'),
      hordeGame('g2', 'lost', 'zombies'),
      hordeGame('g3', 'won', 'zombies'),
      hordeGame('g4', 'won', 'dragons'),
    ]);
    expect(rows).toHaveLength(2);
    const zombies = rows.find((r) => r.hordeId === 'zombies')!;
    expect(zombies.won).toBe(2);
    expect(zombies.lost).toBe(1);
    expect(zombies.played).toBe(3);
    expect(zombies.winRate).toBeCloseTo(2 / 3);
    const dragons = rows.find((r) => r.hordeId === 'dragons')!;
    expect(dragons.won).toBe(1);
    expect(dragons.lost).toBe(0);
  });

  it('groups a game with no hordeId under the fallback key', () => {
    const rows = aggregateHordeRecords([hordeGame('g1', 'won', undefined)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].hordeId).toBe('Unknown horde');
  });

  it('ignores a horde game with no coopOutcome yet, and any non-horde game', () => {
    const rows = aggregateHordeRecords([
      hordeGame('g1', undefined, 'zombies'),
      { ...hordeGame('g2', 'won', 'zombies'), format: 'commander' },
    ]);
    expect(rows).toEqual([]);
  });
});

describe('coopResultLabel (the Play-history line for a co-op Horde game)', () => {
  it('names the horde and the result, won or lost', () => {
    expect(coopResultLabel(hordeGame('a', 'won', 'zombies'))).toBe(
      'Survivors beat the Zombies horde'
    );
    expect(coopResultLabel(hordeGame('b', 'lost', 'slivers'))).toBe('Overrun by the Slivers horde');
  });

  it('falls back to "the horde" when the horde id is unknown or missing', () => {
    expect(coopResultLabel(hordeGame('c', 'won', undefined))).toBe('Survivors beat the horde');
    expect(coopResultLabel(hordeGame('d', 'lost', 'retired-deck'))).toBe('Overrun by the horde');
  });

  it('is null for a PvP game or a Horde game with no recorded outcome', () => {
    expect(
      coopResultLabel({ ...hordeGame('e', 'won', 'zombies'), format: 'commander' })
    ).toBeNull();
    expect(coopResultLabel(hordeGame('f', undefined, 'zombies'))).toBeNull();
  });
});
