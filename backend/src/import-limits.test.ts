import { describe, it, expect } from 'vitest';
import {
  ImportTooLargeError,
  MAX_QTY_PER_ROW,
  MAX_TOTAL_CARDS,
  expandByQuantity,
} from './import-limits';
import type { ImportRow } from './parsers/types';

function row(name: string, quantity: number): ImportRow {
  return { name, quantity, sourceFormat: 'plain' };
}

describe('expandByQuantity', () => {
  it('expands each row into one entry per copy', () => {
    const out = expandByQuantity([row('Sol Ring', 1), row('Plains', 3)]);
    expect(out).toHaveLength(4);
    expect(out.filter((r) => r.name === 'Plains')).toHaveLength(3);
  });

  it('treats missing / zero / negative quantity as a single copy', () => {
    expect(expandByQuantity([row('A', 0), row('B', -2)])).toHaveLength(2);
  });

  it('clamps a single absurd quantity to MAX_QTY_PER_ROW', () => {
    const out = expandByQuantity([row('Sol Ring', 1_000_000)]);
    expect(out).toHaveLength(MAX_QTY_PER_ROW);
  });

  it('throws ImportTooLargeError when the total exceeds the cap', () => {
    // Two rows each clamped to MAX_QTY_PER_ROW can't exceed the total cap, so
    // drive the total directly with many small rows past MAX_TOTAL_CARDS.
    const rows = Array.from({ length: MAX_TOTAL_CARDS + 1 }, (_, i) => row(`c${i}`, 1));
    expect(() => expandByQuantity(rows)).toThrow(ImportTooLargeError);
  });
});
