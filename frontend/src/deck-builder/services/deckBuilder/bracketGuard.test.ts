import { describe, it, expect, vi } from 'vitest';

// bracketEstimator.ts pulls these from the tagger — mock so the reconciliation
// tests below only exercise Game Changer classification, not tagger data.
vi.mock('@/deck-builder/services/tagger/client', () => ({
  hasTag: vi.fn().mockReturnValue(false),
  isMassLandDenial: vi.fn().mockReturnValue(false),
  isExtraTurn: vi.fn().mockReturnValue(false),
  getCardRole: vi.fn().mockReturnValue(null),
}));

import { bracketCeilings, ceilingsAreOpen, BracketGuard } from './bracketGuard';
import { estimateBracket, isGameChangerCard } from './bracketEstimator';

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

  it('clone() copies counts so far without linking to the original', () => {
    const guard = new BracketGuard(bracketCeilings(3), new Set(['A', 'B', 'C', 'D']));
    guard.record('A');
    guard.record('B');
    const clone = guard.clone();
    expect(clone.exceedsCeiling('C')).toBe(false); // 2 < 3, matches the original so far

    clone.record('C'); // clone now at 3 — the original must be untouched
    expect(clone.exceedsCeiling('D')).toBe(true);
    expect(guard.exceedsCeiling('D')).toBe(false);
  });
});

describe('GC-list reconciliation (E104)', () => {
  // BracketGuard.category() and estimateBracket's own counting loop both key
  // off isGameChangerCard() now (a thin shared wrapper, not two separately
  // inlined `.has()` checks) — pin that they agree given the SAME Set,
  // whether the name is in it or not.
  it('BracketGuard and estimateBracket agree a real Game Changer counts', () => {
    const gcNames = new Set(['The One Ring']);
    expect(isGameChangerCard('The One Ring', gcNames)).toBe(true);

    const guard = new BracketGuard(bracketCeilings(2), gcNames);
    expect(guard.exceedsCeiling('The One Ring')).toBe(true); // ceiling 0 at bracket <= 2

    const estimation = estimateBracket(
      ['The One Ring'],
      undefined,
      3,
      undefined,
      undefined,
      gcNames
    );
    expect(estimation.breakdown.gameChangerCount).toBe(1);
    expect(estimation.breakdown.gameChangerNames).toEqual(['The One Ring']);
  });

  it('BracketGuard and estimateBracket agree a non-member never counts', () => {
    const gcNames = new Set(['The One Ring']);
    expect(isGameChangerCard('Llanowar Elves', gcNames)).toBe(false);

    const guard = new BracketGuard(bracketCeilings(2), gcNames);
    expect(guard.exceedsCeiling('Llanowar Elves')).toBe(false);

    const estimation = estimateBracket(
      ['Llanowar Elves'],
      undefined,
      3,
      undefined,
      undefined,
      gcNames
    );
    expect(estimation.breakdown.gameChangerCount).toBe(0);
  });
});
