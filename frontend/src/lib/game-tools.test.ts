import { describe, it, expect } from 'vitest';
import {
  randInt,
  flipCoin,
  rollDice,
  pickFirstPlayer,
  describeRoll,
  highRoll,
  type RandomFn,
} from './game-tools';

/** rand() value that makes randInt(1, 20, ...) return exactly `v`. */
const d20 = (v: number) => (v - 1 + 0.5) / 20;

/** Deterministic sequence-backed RandomFn for testing. */
function seq(values: number[]): RandomFn {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('randInt', () => {
  it('is inclusive of both bounds', () => {
    expect(randInt(1, 6, () => 0)).toBe(1);
    expect(randInt(1, 6, () => 0.9999)).toBe(6);
  });

  it('stays within range across many draws', () => {
    for (let i = 0; i < 500; i++) {
      const n = randInt(1, 20);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(20);
    }
  });
});

describe('flipCoin', () => {
  it('maps the random source to a side', () => {
    expect(flipCoin(() => 0.1)).toBe('Heads');
    expect(flipCoin(() => 0.9)).toBe('Tails');
  });
});

describe('rollDice', () => {
  it('rolls the requested count and totals correctly', () => {
    const r = rollDice(6, 3, seq([0, 0.5, 0.9999]));
    expect(r.sides).toBe(6);
    expect(r.count).toBe(3);
    expect(r.rolls).toEqual([1, 4, 6]);
    expect(r.total).toBe(11);
  });

  it('clamps absurd inputs', () => {
    const r = rollDice(1, 999);
    expect(r.sides).toBeGreaterThanOrEqual(2);
    expect(r.count).toBeLessThanOrEqual(20);
  });
});

describe('pickFirstPlayer', () => {
  it('skips eliminated seats', () => {
    const pick = pickFirstPlayer(
      [
        { seat: 0, name: 'A', eliminated: true },
        { seat: 1, name: 'B', eliminated: false },
        { seat: 2, name: 'C', eliminated: false },
      ],
      () => 0
    );
    expect(pick).toEqual({ seat: 1, name: 'B' });
  });

  it('falls back to full roster when all eliminated', () => {
    const pick = pickFirstPlayer(
      [
        { seat: 0, name: 'A', eliminated: true },
        { seat: 1, name: 'B', eliminated: true },
      ],
      () => 0.9999
    );
    expect(pick?.seat).toBe(1);
  });

  it('returns null for an empty roster', () => {
    expect(pickFirstPlayer([])).toBeNull();
  });
});

describe('highRoll', () => {
  it('the highest single roll wins outright', () => {
    const result = highRoll(
      [
        { seat: 0, eliminated: false },
        { seat: 1, eliminated: false },
        { seat: 2, eliminated: false },
      ],
      seq([d20(11), d20(20), d20(5)])
    );
    expect(result).toEqual({ rolls: { 0: 11, 1: 20, 2: 5 }, winnerSeat: 1 });
  });

  it('re-rolls only the tied seats, overwriting their earlier roll', () => {
    const result = highRoll(
      [
        { seat: 0, eliminated: false },
        { seat: 1, eliminated: false },
        { seat: 2, eliminated: false },
      ],
      // Round 1: seat 0 and 1 tie at 20, seat 2 rolls 5 (out).
      // Round 2 (seats 0 and 1 only): seat 0 rolls 10, seat 1 rolls 15.
      seq([d20(20), d20(20), d20(5), d20(10), d20(15)])
    );
    expect(result).toEqual({ rolls: { 0: 10, 1: 15, 2: 5 }, winnerSeat: 1 });
  });

  it('skips eliminated seats, same fallback as pickFirstPlayer', () => {
    const result = highRoll(
      [
        { seat: 0, eliminated: true },
        { seat: 1, eliminated: false },
      ],
      seq([d20(3)])
    );
    expect(result).toEqual({ rolls: { 1: 3 }, winnerSeat: 1 });
  });

  it('falls back to the full roster when every seat is eliminated', () => {
    const result = highRoll(
      [
        { seat: 0, eliminated: true },
        { seat: 1, eliminated: true },
      ],
      seq([d20(9), d20(14)])
    );
    expect(result).toEqual({ rolls: { 0: 9, 1: 14 }, winnerSeat: 1 });
  });

  it('a single living seat wins with no roll needed to break a tie', () => {
    const result = highRoll([{ seat: 4, eliminated: false }], seq([d20(1)]));
    expect(result).toEqual({ rolls: { 4: 1 }, winnerSeat: 4 });
  });

  it('returns null for an empty roster', () => {
    expect(highRoll([])).toBeNull();
  });
});

describe('describeRoll', () => {
  it('compacts a single die', () => {
    expect(describeRoll({ sides: 20, count: 1, rolls: [17], total: 17 })).toBe('🎲 1d20 → 17');
  });

  it('expands a multi-die roll', () => {
    expect(describeRoll({ sides: 6, count: 2, rolls: [3, 5], total: 8 })).toBe(
      '🎲 2d6 → [3, 5] = 8'
    );
  });
});
