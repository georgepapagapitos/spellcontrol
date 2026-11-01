import { describe, it, expect } from 'vitest';
import { compileManaSymbols, manaCostMatches } from './mana-cost.js';

describe('manaCostMatches', () => {
  const c = compileManaSymbols({ counts: { B: 2 }, mode: 'atLeast' })!;

  it('counts real symbols', () => {
    expect(manaCostMatches('{3}{B}{B}', c)).toBe(true);
    expect(manaCostMatches('{3}{B}', c)).toBe(false);
  });

  it('still reads a symbol that follows stray open braces', () => {
    expect(manaCostMatches('{{{B}{B}', c)).toBe(true);
  });

  // CodeQL #187: /\{([^}]+)\}/g rescans to the end from every '{' (quadratic).
  it('scans a long run of unclosed braces in linear time', () => {
    const hostile = '{'.repeat(50_000);
    const t0 = performance.now();
    expect(manaCostMatches(hostile, c)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
