import { describe, expect, it } from 'vitest';
import {
  cardsSeenOnThePlay,
  chanceOfAtLeastOne,
  formatChance,
  roleOdds,
  ROLE_ODDS_TURN,
} from './role-odds';

describe('cardsSeenOnThePlay', () => {
  it('is the opening seven plus a draw from turn 2', () => {
    expect(cardsSeenOnThePlay(1)).toBe(7);
    expect(cardsSeenOnThePlay(2)).toBe(8);
    expect(cardsSeenOnThePlay(6)).toBe(12);
  });
});

describe('chanceOfAtLeastOne', () => {
  it('matches the hypergeometric closed form', () => {
    // 1 - C(89,8)/C(99,8) for 10 copies in a 99-card library, 8 cards seen.
    expect(chanceOfAtLeastOne(99, 10, 8)).toBeCloseTo(0.6, 1);
    // One copy in a 99-card library: seen / N exactly.
    expect(chanceOfAtLeastOne(99, 1, 12)).toBeCloseTo(12 / 99, 10);
  });
  it('is 0 without copies and 1 when a miss is impossible', () => {
    expect(chanceOfAtLeastOne(99, 0, 12)).toBe(0);
    expect(chanceOfAtLeastOne(10, 4, 8)).toBe(1);
    expect(chanceOfAtLeastOne(0, 4, 8)).toBe(0);
  });
  it('grows with copies and with turns', () => {
    expect(chanceOfAtLeastOne(99, 8, 10)).toBeGreaterThan(chanceOfAtLeastOne(99, 4, 10));
    expect(chanceOfAtLeastOne(99, 8, 12)).toBeGreaterThan(chanceOfAtLeastOne(99, 8, 10));
  });
});

describe('roleOdds', () => {
  it("uses each role's turn", () => {
    expect(roleOdds('ramp', 10, 99)?.turn).toBe(ROLE_ODDS_TURN.ramp);
    expect(roleOdds('removal', 10, 99)?.turn).toBe(4);
    expect(roleOdds('cardDraw', 10, 99)?.turn).toBe(4);
    expect(roleOdds('boardwipe', 3, 99)?.turn).toBe(6);
  });
  it('is null with no cards or no library to draw from', () => {
    expect(roleOdds('ramp', 0, 99)).toBeNull();
    expect(roleOdds('ramp', 5, undefined)).toBeNull();
    expect(roleOdds('ramp', 5, 0)).toBeNull();
  });
});

describe('formatChance', () => {
  it('rounds to a whole percent', () => {
    expect(formatChance(0.624)).toBe('62%');
  });
  it('never calls a near miss certain or impossible', () => {
    expect(formatChance(0.9996)).toBe('>99%');
    expect(formatChance(0.001)).toBe('<1%');
    expect(formatChance(1)).toBe('100%');
    expect(formatChance(0)).toBe('0%');
  });
});
