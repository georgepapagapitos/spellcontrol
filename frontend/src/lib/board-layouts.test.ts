import { describe, it, expect } from 'vitest';
import {
  decodeCustomLayout,
  encodeCustomLayout,
  isCustomLayout,
  resolveLayout,
  type SeatSlot,
} from './board-layouts';

const pod4: { rows: number; seam: { row: number }; seats: SeatSlot[] } = {
  rows: 2,
  seam: { row: 1 },
  seats: [
    { col: 1, row: 1, colSpan: 1, rowSpan: 1, rot: 180 },
    { col: 2, row: 1, colSpan: 1, rowSpan: 1, rot: 180 },
    { col: 1, row: 2, colSpan: 1, rowSpan: 1, rot: 0 },
    { col: 2, row: 2, colSpan: 1, rowSpan: 1, rot: 0 },
  ],
};

describe('custom layout encode/decode', () => {
  it('round-trips a 4-player pod', () => {
    const id = encodeCustomLayout(pod4);
    expect(isCustomLayout(id)).toBe(true);
    const decoded = decodeCustomLayout(id, 4);
    expect(decoded).not.toBeNull();
    expect(decoded!.rows).toBe(2);
    expect(decoded!.seam).toEqual({ row: 1 });
    expect(decoded!.seats).toHaveLength(4);
    expect(decoded!.seats[0]).toMatchObject({ col: 1, row: 1, rot: 180 });
    expect(decoded!.empty).toEqual([]);
  });

  it('derives empty cells for an under-filled grid', () => {
    const id = encodeCustomLayout({
      rows: 2,
      seam: { row: 1 },
      seats: [
        { col: 1, row: 1, colSpan: 1, rowSpan: 1, rot: 180 },
        { col: 1, row: 2, colSpan: 1, rowSpan: 1, rot: 0 },
      ],
    });
    const decoded = decodeCustomLayout(id, 2);
    expect(decoded!.empty).toEqual([
      { col: 2, row: 1 },
      { col: 2, row: 2 },
    ]);
  });

  it('rejects a seat-count mismatch', () => {
    const id = encodeCustomLayout(pod4);
    expect(decodeCustomLayout(id, 3)).toBeNull();
  });

  it('rejects overlapping seats', () => {
    const id = encodeCustomLayout({
      rows: 2,
      seam: { row: 1 },
      seats: [
        { col: 1, row: 1, colSpan: 2, rowSpan: 1, rot: 180 },
        { col: 2, row: 1, colSpan: 1, rowSpan: 1, rot: 0 },
      ],
    });
    expect(decodeCustomLayout(id, 2)).toBeNull();
  });

  it('rejects a span that spills off the grid', () => {
    const bad = `custom:v1~1~r1~1.1.1.2.0;2.1.1.1.0`; // rowSpan 2 but only 1 row
    expect(decodeCustomLayout(bad, 2)).toBeNull();
  });

  it('rejects an invalid rotation', () => {
    const bad = `custom:v1~2~r1~1.1.1.1.45;2.1.1.1.0`;
    expect(decodeCustomLayout(bad, 2)).toBeNull();
  });

  it('returns null for non-custom ids', () => {
    expect(decodeCustomLayout('4p-pod', 4)).toBeNull();
    expect(decodeCustomLayout(null, 4)).toBeNull();
    expect(isCustomLayout('4p-pod')).toBe(false);
  });
});

describe('resolveLayout with custom ids', () => {
  it('uses a valid custom layout', () => {
    const id = encodeCustomLayout(pod4);
    const r = resolveLayout(4, id);
    expect(r.id).toBe(id);
    expect(r.seats).toHaveLength(4);
  });

  it('falls back to a preset when the custom layout is stale for the count', () => {
    const id = encodeCustomLayout(pod4); // 4 seats
    const r = resolveLayout(3, id); // now a 3-player game
    expect(isCustomLayout(r.id)).toBe(false);
    expect(r.seats).toHaveLength(3);
  });

  it('falls back for a malformed custom id', () => {
    const r = resolveLayout(4, 'custom:v1~garbage');
    expect(isCustomLayout(r.id)).toBe(false);
  });
});
