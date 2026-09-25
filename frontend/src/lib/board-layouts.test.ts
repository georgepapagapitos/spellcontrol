import { describe, it, expect } from 'vitest';
import {
  decodeCustomLayout,
  encodeCustomLayout,
  homeSlotIndex,
  isCustomLayout,
  layoutsForCount,
  resolveLayout,
  seamSatellite,
  turnOrderOf,
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
    expect(homeSlotIndex(resolveLayout(4, '4p-pod'))).toBe(3); // bottom-left, now last (clockwise)
    expect(homeSlotIndex(resolveLayout(5, '5p-wide-bottom'))).toBe(3); // wide bottom
  });

  it('picks the bottom-left slot when no seat is upright (side-by-side layouts)', () => {
    expect(homeSlotIndex(resolveLayout(2, '2p-side'))).toBe(0);
    expect(homeSlotIndex(resolveLayout(4, '4p-sides'))).toBe(3); // bottom-left, now last (clockwise)
  });

  it('works on decoded custom layouts', () => {
    const decoded = decodeCustomLayout(encodeCustomLayout(pod4), 4);
    expect(homeSlotIndex(decoded!)).toBe(2);
  });
});

describe('7-10p Lotus sides/ends layouts', () => {
  // Lotus's own 7-10p arrangement seats everyone along the two long edges
  // (4p-sides scaled up) rather than stacking rows facing the short edges —
  // it is now the DEFAULT for these counts, with the existing wide-row
  // presets still available and a new "ends" variant (a seat at each short
  // end, the rest along the sides) alongside it.
  it('the new "sides" preset is the default (index 0) for 7-10 players', () => {
    for (const count of [7, 8, 9, 10]) {
      expect(layoutsForCount(count)[0].id).toBe(`${count}p-sides`);
    }
  });

  it('a matching "ends" preset exists for 7-10 players', () => {
    for (const count of [7, 8, 9, 10]) {
      const ids = layoutsForCount(count).map((l) => l.id);
      expect(ids).toContain(`${count}p-ends`);
    }
  });

  it('every existing preset is still in the picker alongside the new ones', () => {
    const preExisting: Record<number, string[]> = {
      7: ['7p-wide-top', '7p-wide-bottom'],
      8: ['8p-4v4', '8p-2v6'],
      9: ['9p-wide-top', '9p-wide-bottom'],
      10: ['10p-6v4', '10p-4v6'],
    };
    for (const [count, ids] of Object.entries(preExisting)) {
      const available = layoutsForCount(Number(count)).map((l) => l.id);
      for (const id of ids) expect(available).toContain(id);
    }
  });

  it('"sides" seats every seat along a long edge — even counts fully, odd counts via one Wide top end', () => {
    // 8/10 (even) split cleanly into two columns, so every seat faces a
    // long edge (rot 90/270). 7/9 (odd) can't split evenly, so — same move
    // 3p-wide-top-sides makes for 3 — the extra seat takes a Wide top end
    // (rot 180) and the rest (an even count) split between the columns.
    for (const count of [8, 10]) {
      const sides = layoutsForCount(count).find((l) => l.id === `${count}p-sides`)!;
      for (const seat of sides.seats) expect([90, 270]).toContain(seat.rot);
    }
    for (const count of [7, 9]) {
      const sides = layoutsForCount(count).find((l) => l.id === `${count}p-sides`)!;
      const wide = sides.seats.filter((seat) => seat.colSpan === 2);
      expect(wide).toHaveLength(1);
      expect(wide[0].rot).toBe(180);
      const rest = sides.seats.filter((seat) => seat.colSpan !== 2);
      for (const seat of rest) expect([90, 270]).toContain(seat.rot);
    }
  });

  it('"ends" seats a Wide seat at each short end (rot 180 top, rot 0 bottom) and the rest sideways', () => {
    for (const count of [7, 8, 9, 10]) {
      const ends = layoutsForCount(count).find((l) => l.id === `${count}p-ends`)!;
      const wide = ends.seats.filter((seat) => seat.colSpan === 2);
      expect(wide.map((seat) => seat.rot).sort()).toEqual([0, 180]);
      const sideways = ends.seats.filter((seat) => seat.colSpan !== 2);
      for (const seat of sideways) expect([90, 270]).toContain(seat.rot);
    }
  });

  it('an even count splits its sides evenly; an odd count splits as evenly as possible', () => {
    // 8/10 (even, after the wide ends on "ends") split N/2 either column;
    // 7/9 (odd) can't split evenly once two wide seats are subtracted, so
    // one column gets one more seat than the other and the shorter column
    // leaves its far cell empty rather than shrinking the grid.
    const countBySide = (l: ReturnType<typeof layoutsForCount>[number]) => {
      const left = l.seats.filter((seat) => seat.col === 1 && seat.colSpan !== 2).length;
      const right = l.seats.filter((seat) => seat.col === 2 && seat.colSpan !== 2).length;
      return { left, right };
    };
    expect(countBySide(layoutsForCount(8).find((l) => l.id === '8p-sides')!)).toEqual({
      left: 4,
      right: 4,
    });
    expect(countBySide(layoutsForCount(10).find((l) => l.id === '10p-sides')!)).toEqual({
      left: 5,
      right: 5,
    });
    expect(countBySide(layoutsForCount(8).find((l) => l.id === '8p-ends')!)).toEqual({
      left: 3,
      right: 3,
    });
    expect(countBySide(layoutsForCount(10).find((l) => l.id === '10p-ends')!)).toEqual({
      left: 4,
      right: 4,
    });
    const ends7 = countBySide(layoutsForCount(7).find((l) => l.id === '7p-ends')!);
    expect(ends7.left + ends7.right).toBe(5);
    expect(Math.abs(ends7.left - ends7.right)).toBe(1);
    const ends9 = countBySide(layoutsForCount(9).find((l) => l.id === '9p-ends')!);
    expect(ends9.left + ends9.right).toBe(7);
    expect(Math.abs(ends9.left - ends9.right)).toBe(1);
  });

  it('"ends" leaves exactly one empty cell for an odd count, none for an even one', () => {
    expect(layoutsForCount(7).find((l) => l.id === '7p-ends')!.empty).toHaveLength(1);
    expect(layoutsForCount(9).find((l) => l.id === '9p-ends')!.empty ?? []).toHaveLength(1);
    expect(layoutsForCount(8).find((l) => l.id === '8p-ends')!.empty ?? []).toHaveLength(0);
    expect(layoutsForCount(10).find((l) => l.id === '10p-ends')!.empty ?? []).toHaveLength(0);
  });

  it('seam satellites clear the hub for every new seam (row and col alike)', () => {
    for (const count of [7, 8, 9, 10]) {
      for (const id of [`${count}p-sides`, `${count}p-ends`]) {
        const layout = layoutsForCount(count).find((l) => l.id === id)!;
        const before = seamSatellite(layout.seam, layout.rows, -1, '3.4rem');
        const after = seamSatellite(layout.seam, layout.rows, 1, '3.4rem');
        // The seam row/col itself must sit strictly inside the grid (never
        // on row 0 or past the last row), or the satellites would land off
        // the board entirely.
        if ('row' in layout.seam) {
          expect(layout.seam.row).toBeGreaterThan(0);
          expect(layout.seam.row).toBeLessThan(layout.rows);
        } else {
          expect(layout.seam.col).toBe(1);
        }
        for (const p of [before, after]) {
          expect(p.topPct).toMatch(/^\d+(\.\d+)?%$/);
          const pct = parseFloat(p.topPct);
          expect(pct).toBeGreaterThanOrEqual(0);
          expect(pct).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('3p default', () => {
  // Three people round a phone lying flat sit one on the short edge and one on
  // each long edge. The upright half-width cells of 3p-wide-top capped the
  // bottom pair's numeral at a third of a phone's width; turning them to read
  // along their cell's long axis is what makes the number table-legible.
  it('seats the bottom pair sideways, facing each other across the column split', () => {
    const def = layoutsForCount(3)[0];
    expect(def.id).toBe('3p-wide-top-sides');
    expect(def.seam).toEqual({ row: 1 });
    // Clockwise: top, then right (270°), then left (90°).
    expect(def.seats.map((s) => s.rot)).toEqual([180, 270, 90]);
  });

  it('every preset fills its grid exactly, with no overlap and no stray cell', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const l of layoutsForCount(count)) {
        const encoded = encodeCustomLayout(l);
        expect(decodeCustomLayout(encoded, count), l.id).not.toBeNull();
      }
    }
  });

  it('every count has a default layout', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(layoutsForCount(count).length).toBeGreaterThan(0);
    }
  });
});

describe('clockwise seat order (T-tenplayers)', () => {
  // Turn order (seat index + 1, see packages/game-core) must read as
  // clockwise around the table as seen from above, top edge = far side:
  // far row left→right, down the right side, near row right→left, up the
  // left side. Verified geometrically: seat 0 is the anchor (relative angle
  // 0) and every other seat's angle, measured clockwise from seat 0 around
  // the grid's centre, must be non-decreasing. A Wide (colSpan-2) seat's
  // angle is taken from its right-hand cell — the corner that keeps its
  // clockwise position well-defined even when the seat sits exactly on the
  // grid's centre line (5p-wide-middle).
  function angleDeg(seat: SeatSlot, rows: number): number {
    const cx = seat.col + (seat.colSpan ?? 1) - 1;
    const cy = seat.row + (seat.rowSpan ?? 1) - 1;
    const dx = cx - 1.5; // cols is always 2, centre col = 1.5
    const dyNorth = (rows + 1) / 2 - cy;
    return (Math.atan2(dx, dyNorth) * (180 / Math.PI) + 360) % 360;
  }

  function assertClockwise(layout: ReturnType<typeof layoutsForCount>[number]) {
    const angles = layout.seats.map((seat) => angleDeg(seat, layout.rows));
    const relative = angles.map((a) => (a - angles[0] + 360) % 360);
    for (let i = 1; i < relative.length; i++) {
      expect(
        relative[i],
        `${layout.id}: seat ${i} not clockwise from seat ${i - 1}`
      ).toBeGreaterThanOrEqual(relative[i - 1]);
    }
  }

  it('every preset (2-10) seats clockwise from the top-left seat', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const l of layoutsForCount(count)) assertClockwise(l);
    }
  });

  // Counterclockwise reverses which SEAT sits in which cell (seat 0 stays
  // anchored; the rest run backward) without touching a cell's position or
  // rotation — so the geometric angle sequence must run the other way. The
  // seat0→seat1 step is excluded: it's the one edge that wraps back through
  // the anchor, so it isn't part of either monotonic run (the clockwise
  // test's own relative[0] = 0 baseline makes that edge trivially ≥ 0 there,
  // which is not evidence of direction the way every interior step is).
  function assertCounterclockwise(layout: ReturnType<typeof layoutsForCount>[number]) {
    const angles = layout.seats.map((seat) => angleDeg(seat, layout.rows));
    const relative = angles.map((a) => (a - angles[0] + 360) % 360);
    for (let i = 2; i < relative.length; i++) {
      expect(
        relative[i],
        `${layout.id}: seat ${i} not counterclockwise from seat ${i - 1}`
      ).toBeLessThanOrEqual(relative[i - 1]);
    }
  }

  it('every preset (2-10) seats counterclockwise when turnOrder is reversed', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const l of layoutsForCount(count, 'counterclockwise')) assertCounterclockwise(l);
    }
  });

  it('seat 0 stays in its cell either way; only the rest reverse', () => {
    for (const count of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const cw = layoutsForCount(count)[0];
      const ccw = layoutsForCount(count, 'counterclockwise')[0];
      expect(ccw.seats[0]).toEqual(cw.seats[0]);
      expect(ccw.seats.slice(1)).toEqual(cw.seats.slice(1).reverse());
    }
  });

  it("a custom layout keeps the user's own order regardless of turnOrder", () => {
    const id = encodeCustomLayout(pod4);
    const cw = resolveLayout(4, id, 'clockwise');
    const ccw = resolveLayout(4, id, 'counterclockwise');
    expect(ccw).toEqual(cw);
  });

  it('turnOrderOf reads a legacy state (no field) as clockwise', () => {
    expect(turnOrderOf({ turnOrder: undefined })).toBe('clockwise');
    expect(turnOrderOf({ turnOrder: 'clockwise' })).toBe('clockwise');
    expect(turnOrderOf({ turnOrder: 'counterclockwise' })).toBe('counterclockwise');
  });
});
