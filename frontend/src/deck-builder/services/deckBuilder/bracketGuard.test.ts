import { describe, it, expect } from 'vitest';
import { bracketCeilings, ceilingsAreOpen, BracketGuard } from './bracketGuard';

describe('bracketCeilings', () => {
  it('is open (all Infinity) when no bracket is targeted', () => {
    expect(ceilingsAreOpen(bracketCeilings(undefined))).toBe(true);
    expect(ceilingsAreOpen(bracketCeilings('all'))).toBe(true);
  });

  it('caps each floor signal tighter as the target bracket lowers', () => {
    // 1 GC / 1 MLD / 3 extra-turns / 3 stax all trip a higher floor, so a
    // bracket-2 deck must stay strictly under each of those.
    expect(bracketCeilings(2)).toEqual({
      gameChangers: 0,
      massLandDenial: 0,
      extraTurns: 2,
      stax: 2,
    });
    expect(bracketCeilings(3)).toEqual({
      gameChangers: 3,
      massLandDenial: 0,
      extraTurns: Infinity,
      stax: 4,
    });
    // Bracket 1 behaves like the lowest band.
    expect(bracketCeilings(1)).toEqual(bracketCeilings(2));
  });

  it('does not bind at brackets 4 and 5 (high-power bands)', () => {
    expect(ceilingsAreOpen(bracketCeilings(4))).toBe(true);
    expect(ceilingsAreOpen(bracketCeilings(5))).toBe(true);
  });
});

describe('BracketGuard', () => {
  it('blocks a game changer only once the bracket-3 ceiling (3) is reached', () => {
    const guard = new BracketGuard(bracketCeilings(3), new Set(['A', 'B', 'C', 'D']));
    expect(guard.exceedsCeiling('A')).toBe(false); // 0 < 3
    guard.record('A');
    guard.record('B');
    guard.record('C'); // count now 3
    expect(guard.exceedsCeiling('D')).toBe(true); // 3 >= 3
  });

  it('blocks every game changer at bracket 2 (ceiling 0)', () => {
    const guard = new BracketGuard(bracketCeilings(2), new Set(['Mana Crypt']));
    expect(guard.exceedsCeiling('Mana Crypt')).toBe(true); // 0 >= 0, nothing recorded
  });

  it('counts stax pieces via the hardcoded set, no tagger data needed', () => {
    const guard = new BracketGuard(bracketCeilings(2), new Set()); // stax ceiling 2
    expect(guard.exceedsCeiling('Winter Orb')).toBe(false);
    guard.record('Winter Orb');
    guard.record('Static Orb'); // both real STAX_PIECES → count now 2
    expect(guard.exceedsCeiling('Stasis')).toBe(true); // 2 >= 2
  });

  it('never blocks an unremarkable card', () => {
    const guard = new BracketGuard(bracketCeilings(2), new Set());
    expect(guard.exceedsCeiling('Llanowar Elves')).toBe(false);
    guard.record('Llanowar Elves');
    expect(guard.exceedsCeiling('Llanowar Elves')).toBe(false);
  });
});
