import { describe, it, expect } from 'vitest';
import {
  describeClock,
  formatClock,
  gameElapsed,
  seatTurnTotals,
  turnElapsed,
  turnStartedAt,
} from './game-clock';
import type { GameEvent, GameState } from './game-state';

const S = 1000;
const M = 60 * S;

function ev(kind: GameEvent['kind'], ts: number, targetSeat: number | null = null): GameEvent {
  return { id: `e${ts}`, ts, kind, actorSeat: null, targetSeat };
}

/** Minimal state — only the fields the clock actually reads. */
function game(patch: Partial<GameState> = {}): GameState {
  return {
    startedAt: 0,
    endedAt: null,
    startingSeat: null,
    events: [],
    ...patch,
  } as GameState;
}

describe('formatClock', () => {
  it('renders m:ss below an hour', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9 * S)).toBe('0:09');
    expect(formatClock(12 * M + 4 * S)).toBe('12:04');
    expect(formatClock(59 * M + 59 * S)).toBe('59:59');
  });

  it('adds an hours field and zero-pads minutes past the hour', () => {
    expect(formatClock(60 * M)).toBe('1:00:00');
    expect(formatClock(2 * 60 * M + 5 * M + 7 * S)).toBe('2:05:07');
  });

  it('floors partial seconds instead of rounding up to a time that has not happened', () => {
    expect(formatClock(1999)).toBe('0:01');
  });

  it('floors to zero for negative and non-finite input (clock skew across devices)', () => {
    expect(formatClock(-5000)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('describeClock', () => {
  it('spells out the units for a screen reader', () => {
    expect(describeClock(12 * M + 4 * S)).toBe('12 minutes 4 seconds');
    expect(describeClock(60 * M)).toBe('1 hour');
    expect(describeClock(61 * M)).toBe('1 hour 1 minute');
  });

  it('keeps seconds when they are the only unit, including zero', () => {
    expect(describeClock(0)).toBe('0 seconds');
    expect(describeClock(1 * S)).toBe('1 second');
  });
});

describe('gameElapsed', () => {
  it('is null before the game starts', () => {
    expect(gameElapsed(game({ startedAt: null }), 5 * M)).toBeNull();
  });

  it('counts from startedAt while running', () => {
    expect(gameElapsed(game({ startedAt: 1 * M }), 6 * M)).toBe(5 * M);
  });

  it('freezes at the final duration once finished, ignoring now', () => {
    const g = game({ startedAt: 0, endedAt: 30 * M });
    expect(gameElapsed(g, 90 * M)).toBe(30 * M);
  });
});

describe('turnStartedAt / turnElapsed', () => {
  it('falls back to the game start for the first turn, before anyone passes', () => {
    const g = game({ startedAt: 2 * M, events: [ev('start', 2 * M), ev('life', 3 * M)] });
    expect(turnStartedAt(g)).toBe(2 * M);
    expect(turnElapsed(g, 5 * M)).toBe(3 * M);
  });

  it('uses the most recent turn event once turns are being passed', () => {
    const g = game({
      startedAt: 0,
      events: [ev('turn', 5 * M, 1), ev('life', 6 * M), ev('turn', 8 * M, 2)],
    });
    expect(turnStartedAt(g)).toBe(8 * M);
    expect(turnElapsed(g, 9 * M)).toBe(1 * M);
  });

  it('is null in a lobby that has not started', () => {
    const g = game({ startedAt: null, events: [ev('turn', 5 * M, 1)] });
    expect(turnStartedAt(g)).toBeNull();
    expect(turnElapsed(g, 9 * M)).toBeNull();
  });
});

describe('seatTurnTotals', () => {
  it('attributes each stretch to the seat named by the turn event that opened it', () => {
    const g = game({
      startedAt: 0,
      startingSeat: 0,
      events: [ev('turn', 2 * M, 1), ev('turn', 5 * M, 2), ev('turn', 6 * M, 0)],
    });
    expect(seatTurnTotals(g, 10 * M)).toEqual({
      0: 2 * M + 4 * M, // opening stretch, then its second turn through `now`
      1: 3 * M,
      2: 1 * M,
    });
  });

  it('drops the opening stretch when nobody recorded who went first', () => {
    const g = game({ startedAt: 0, startingSeat: null, events: [ev('turn', 2 * M, 1)] });
    expect(seatTurnTotals(g, 4 * M)).toEqual({ 1: 2 * M });
  });

  it('omits seats that never held a turn rather than reporting them as zero', () => {
    const g = game({ startedAt: 0, startingSeat: 0, events: [ev('turn', 2 * M, 1)] });
    const totals = seatTurnTotals(g, 4 * M);
    expect(Object.keys(totals).sort()).toEqual(['0', '1']);
    expect(totals[3]).toBeUndefined();
  });

  it('stops at the end of a finished game instead of running to now', () => {
    const g = game({
      startedAt: 0,
      endedAt: 10 * M,
      startingSeat: 0,
      events: [ev('turn', 4 * M, 1)],
    });
    expect(seatTurnTotals(g, 99 * M)).toEqual({ 0: 4 * M, 1: 6 * M });
  });

  it('is empty for a game that never started', () => {
    expect(seatTurnTotals(game({ startedAt: null }), 5 * M)).toEqual({});
  });
});
