import { describe, it, expect } from 'vitest';
import {
  decodeCustomLayout,
  encodeCustomLayout,
  homeSlotIndex,
  isCustomLayout,
  resolveLayout,
  seamSatellite,
  undoButtonParams,
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

describe('undoButtonParams', () => {
  it('row-seam: offsets left (−X), icon at 0°', () => {
    const p = undoButtonParams({ row: 1 });
    expect(p.tx).toBe('calc(-50% - 3.4rem)');
    expect(p.ty).toBe('-50%');
    expect(p.iconRot).toBe(0);
  });

  it('col-seam: offsets above (−Y), icon at 90°', () => {
    const p = undoButtonParams({ col: 1 });
    expect(p.tx).toBe('-50%');
    expect(p.ty).toBe('calc(-50% - 3.4rem)');
    expect(p.iconRot).toBe(90);
  });

  it('row-seam with custom offset', () => {
    const p = undoButtonParams({ row: 1 }, '4rem');
    expect(p.tx).toBe('calc(-50% - 4rem)');
    expect(p.ty).toBe('-50%');
    expect(p.iconRot).toBe(0);
  });

  it('col-seam with custom offset', () => {
    const p = undoButtonParams({ col: 1 }, '4rem');
    expect(p.tx).toBe('-50%');
    expect(p.ty).toBe('calc(-50% - 4rem)');
    expect(p.iconRot).toBe(90);
  });

  it('all preset col-seam layouts produce the col-seam params', () => {
    // 2p-side (col seam) and 4p-sides (col seam) must produce col-seam params.
    const colSeamSeams: Array<{ col: number }> = [{ col: 1 }];
    for (const seam of colSeamSeams) {
      const p = undoButtonParams(seam);
      expect(p.iconRot).toBe(90);
      expect(p.ty).toContain('calc');
      expect(p.tx).toBe('-50%');
    }
  });

  it('all preset row-seam layouts produce the row-seam params', () => {
    // Various row seam positions — they all share the same offset direction.
    const rowSeams: Array<{ row: number }> = [{ row: 1 }, { row: 2 }];
    for (const seam of rowSeams) {
      const p = undoButtonParams(seam);
      expect(p.iconRot).toBe(0);
      expect(p.tx).toContain('calc');
      expect(p.ty).toBe('-50%');
    }
  });
});

describe('seamSatellite', () => {
  it('row seam: satellites flank the hub over the gutter', () => {
    const before = seamSatellite({ row: 1 }, 2, -1, '3.4rem');
    expect(before.tx).toBe('calc(-50% - 3.4rem)');
    expect(before.ty).toBe('-50%');
    // The "after" side is the wide clock and anchors by its edge instead —
    // pinned in its own case below.
    // The seam's own row still drives how far down the board they sit.
    expect(before.topPct).toBe('50%');
    expect(seamSatellite({ row: 1 }, 4, -1, '3.4rem').topPct).toBe('25%');
  });

  it('column seam: satellites take the quarter points instead of hugging the hub', () => {
    // The hub is a four-corner crossing on a column seam, so anything offset a
    // few rem from it lands on a name — measured at 766px² on 4p-sides before
    // this rule. A quarter of the way along the seam is the middle of an
    // adjacent panel's edge, which is clear by construction.
    const before = seamSatellite({ col: 1 }, 2, -1, '3.4rem');
    const after = seamSatellite({ col: 1 }, 2, 1, '3.4rem');
    expect(before.topPct).toBe('25%');
    expect(after.topPct).toBe('75%');
    // Centred on that point — no hub-relative offset left to apply.
    for (const p of [before, after]) {
      expect(p.tx).toBe('-50%');
      expect(p.ty).toBe('-50%');
    }
  });

  it('row seam: the wide satellite is anchored by its edge, not its centre', () => {
    // Centring a 133px pill 3.4rem from a 44px hub put 1357px² of the hub
    // underneath it — the ⋯ glyph was invisible on every row-seam board. An
    // edge anchor keeps the gap fixed however wide the pill gets.
    const clock = seamSatellite({ row: 1 }, 2, 1, '3.4rem');
    expect(clock.tx).not.toContain('-50%');
    expect(clock.tx).toBe('2rem');
    // The small icon satellite still centres — it is narrower than the gap.
    expect(seamSatellite({ row: 1 }, 2, -1, '3.4rem').tx).toContain('-50%');
  });

  it('row-seam edge anchor does not grow with the offset step', () => {
    // Both size steps must clear the same hub, which is one size.
    expect(seamSatellite({ row: 1 }, 2, 1, '3.4rem').tx).toBe(
      seamSatellite({ row: 1 }, 2, 1, '4rem').tx
    );
  });

  it('column-seam placement ignores the offset it is handed', () => {
    // Both size steps (3.4rem / 4rem) must resolve to the same quarter points,
    // or the ≥600px media query would shift the satellites off them.
    expect(seamSatellite({ col: 1 }, 2, 1, '3.4rem')).toEqual(
      seamSatellite({ col: 1 }, 2, 1, '4rem')
    );
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

describe('homeSlotIndex', () => {
  it('picks the bottom-most upright seat, left column on ties', () => {
    expect(homeSlotIndex(resolveLayout(2, '2p-stacked'))).toBe(1);
    expect(homeSlotIndex(resolveLayout(4, '4p-pod'))).toBe(2); // bottom-left
    expect(homeSlotIndex(resolveLayout(5, '5p-wide-bottom'))).toBe(4); // wide bottom
  });

  it('picks the bottom-left slot when no seat is upright (side-by-side layouts)', () => {
    expect(homeSlotIndex(resolveLayout(2, '2p-side'))).toBe(0);
    expect(homeSlotIndex(resolveLayout(4, '4p-sides'))).toBe(2);
  });

  it('works on decoded custom layouts', () => {
    const decoded = decodeCustomLayout(encodeCustomLayout(pod4), 4);
    expect(homeSlotIndex(decoded!)).toBe(2);
  });
});
