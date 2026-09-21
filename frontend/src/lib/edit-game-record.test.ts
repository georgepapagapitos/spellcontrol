import { describe, it, expect } from 'vitest';
import { applyEditToRecord, applyEditToState } from './edit-game-record';
import type { GameRecord, GameState, GameSummary } from './game-state';

function player(seat: number, over: Partial<GameRecord['players'][number]> = {}) {
  return {
    seat,
    userId: null,
    name: `P${seat}`,
    deckId: null,
    deckName: null,
    commander: null,
    finalLife: 40,
    eliminated: false,
    ...over,
  };
}

function summary(winnerSeat: number | null): GameSummary {
  return {
    turns: 2,
    durationMs: 10,
    firstBlood: null,
    startingSeat: 0,
    winnerSeat,
    seats: [0, 1].map((seat) => ({
      seat,
      damageTaken: 0,
      lifeGained: 0,
      biggestHit: 0,
      lowestLife: 40,
      commanderDamageDealt: 0,
      placement: seat === winnerSeat ? 1 : null,
      eliminatedOnTurn: null,
      killedBySeat: null,
    })),
    commanderDamage: [],
  };
}

function baseRecord(over: Partial<GameRecord> = {}): GameRecord {
  return {
    id: 'g',
    code: '',
    format: 'commander',
    startingLife: 40,
    players: [player(0), player(1)],
    winnerSeat: 0,
    startedAt: null,
    endedAt: 100,
    durationMs: 0,
    mode: 'local',
    ...over,
  };
}

describe('applyEditToRecord', () => {
  it('moves the winner and the first place together', () => {
    const out = applyEditToRecord(baseRecord({ summary: summary(0) }), {
      winnerSeat: 1,
      decks: [],
    });
    expect(out.winnerSeat).toBe(1);
    expect(out.summary?.seats.filter((s) => s.placement === 1).map((s) => s.seat)).toEqual([1]);
  });

  it('writes deck attribution only for the seats it was given', () => {
    const out = applyEditToRecord(
      baseRecord({ players: [player(0, { deckName: 'Old' }), player(1, { deckName: 'Keep' })] }),
      {
        winnerSeat: 0,
        decks: [
          { seat: 0, deckId: 'd1', deckName: 'New', commander: 'Kenrith', colorIdentity: ['W'] },
        ],
      }
    );
    expect(out.players[0]).toMatchObject({ deckId: 'd1', deckName: 'New', commander: 'Kenrith' });
    expect(out.players[1].deckName).toBe('Keep');
  });

  it('leaves a record with no summary without one', () => {
    const out = applyEditToRecord(baseRecord(), { winnerSeat: null, decks: [] });
    expect(out.summary).toBeUndefined();
    expect(out.winnerSeat).toBe(null);
  });
});

describe('applyEditToState', () => {
  it('carries the correction into the game still waiting to upload', () => {
    const state = {
      id: 'g',
      winnerSeat: 0,
      players: [
        { seat: 0, deckId: null, deckName: null, commander: null, colorIdentity: [] },
        { seat: 1, deckId: 'keep', deckName: 'Keep', commander: null, colorIdentity: ['U'] },
      ],
    } as unknown as GameState;
    const out = applyEditToState(state, {
      winnerSeat: 1,
      decks: [
        { seat: 0, deckId: 'd', deckName: 'New', commander: 'Atraxa', colorIdentity: ['G', 'W'] },
      ],
    });
    expect(out.winnerSeat).toBe(1);
    expect(out.players[0]).toMatchObject({ deckName: 'New', colorIdentity: ['G', 'W'] });
    // An untouched seat keeps every field, colors included.
    expect(out.players[1]).toMatchObject({ deckName: 'Keep', colorIdentity: ['U'] });
  });
});
