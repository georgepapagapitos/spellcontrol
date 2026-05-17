import { describe, it, expect } from 'vitest';
import {
  randInt,
  flipCoin,
  rollDice,
  pickFirstPlayer,
  describeRoll,
  type RandomFn,
} from './game-tools';

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
