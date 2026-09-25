import type { GameLayout, GameState, TurnOrder } from './game-state';
export type { TurnOrder };

/**
 * Layout model
 * ─────────────
 * Every layout is a **2-column** CSS Grid. The number of rows is the
 * smallest count that fits the chosen arrangement (typically
 * `ceil(playerCount / 2)`, sometimes larger when a Wide row is part of
 * the layout). Each seat occupies a single cell that may span:
 *
 *   • Normal  — colSpan 1, rowSpan 1
 *   • Wide    — colSpan 2, rowSpan 1  (fills a whole row)
 *   • Tall    — colSpan 1, rowSpan 2  (fills both cells of a column)
 *
 * Cells with no seat render as faded placeholders. Players can span into
 * what would otherwise be an empty cell. Rotation is 0° or 180° per seat
 * — "top side" seats are 180° and "bottom side" seats are 0°, so each
 * player reads their own panel right-side-up from their seat at the
 * table.
 *
 * `seamAfterRow` tells the renderer where the central game-menu hub
 * sits — between row `seamAfterRow` and row `seamAfterRow + 1`. The hub
 * always lands at the visual boundary between rotated and upright seats.
 */

export interface SeatSlot {
  /** 1-based grid column start (1 or 2). */
  col: 1 | 2;
  /** 1-based grid row start. */
  row: number;
  /** colspan — 1 normal, 2 wide. */
  colSpan?: 1 | 2;
  /** rowspan — 1 normal, 2 tall. */
  rowSpan?: 1 | 2;
  /**
   * Panel rotation in degrees. 0 = upright, 180 = facing across a row
   * seam, 90 / 270 = facing across a column seam (e.g. side-by-side 2p
   * where each player reads from their own long edge of the device).
   */
  rot: 0 | 90 | 180 | 270;
}

export interface EmptyCell {
  col: 1 | 2;
  row: number;
  colSpan?: 1 | 2;
  rowSpan?: 1 | 2;
}

export interface BoardLayout {
  id: GameLayout;
  /** Always 2 in this model — preserved on the type for renderer ergonomics. */
  cols: 2;
  rows: number;
  /**
   * Position of the central hub button.
   * - `{ row: N }`: hub sits on the horizontal seam between row N and
   *   row N+1 (typical for top-vs-bottom layouts where seats are
   *   rotated 0° / 180°).
   * - `{ col: N }`: hub sits on the vertical seam between col N and
   *   col N+1 (used for side-by-side 2p where seats are rotated
   *   90° / 270° and face across a column seam).
   */
  seam: { row: number } | { col: number };
  /** Seat positions in seat-index order. Length must equal player count. */
  seats: SeatSlot[];
  /** Cells with no player — render as faded placeholders. */
  empty?: EmptyCell[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function s(
  col: 1 | 2,
  row: number,
  rot: 0 | 90 | 180 | 270,
  span?: { c?: 1 | 2; r?: 1 | 2 }
): SeatSlot {
  return { col, row, rot, colSpan: span?.c, rowSpan: span?.r };
}

function e(col: 1 | 2, row: number, span?: { c?: 1 | 2; r?: 1 | 2 }): EmptyCell {
  return { col, row, colSpan: span?.c, rowSpan: span?.r };
}

// ── Layout tables ──────────────────────────────────────────────────────────
//
// Indexed by player count. The first entry is the default for new games at
// that count. Within a count, layouts are ordered roughly by how common
// they are at a real table.
//
// Seat order (all counts): index 0 is the topmost-leftmost seat, and the
// rest follow CLOCKWISE around the table as seen from above — far row
// left→right, down the right side, near row right→left, up the left side —
// because turn order (seat index + 1) is clockwise from above in real MTG
// play. A Wide seat's clockwise position is taken from its right-hand cell.
// `board-layouts.test.ts` pins this with an angle-around-center assertion.

const LAYOUTS: Record<number, BoardLayout[]> = {
  // ── 2 players ──────────────────────────────────────────────────────────
  // 2p uniquely supports both row-seam (stacked) and col-seam
  // (side-by-side) arrangements — the device sits flat between two
  // players who face each other across either axis. Only 2 seats, so
  // clockwise vs counterclockwise is the same alternation either way.
  2: [
    {
      // Stacked Wide rows — facing across the short edge of the device.
      id: '2p-stacked',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180, { c: 2 }), s(1, 2, 0, { c: 2 })],
    },
    {
      // Side-by-side — facing across the long edge. The left seat
      // rotates 90° CW and the right seat 270° CW (= 90° CCW) so each
      // player reads their life number from their seat. The hub sits
      // on the vertical seam between the two cells.
      id: '2p-side',
      cols: 2,
      rows: 1,
      seam: { col: 1 },
      seats: [s(1, 1, 90), s(2, 1, 270)],
    },
  ],

  // ── 3 players ──────────────────────────────────────────────────────────
  // All in a 2×2 grid. The lone seat can sit on top or bottom, on either
  // column, or span the row as a Wide cell.
  3: [
    {
      // Wide top + two sideways seats — how three people sit around a phone
      // lying flat: one across the short edge, one on each long edge. The
      // bottom pair face each other across the column split, so each reads
      // along their cell's long axis and gets a far bigger numeral than an
      // upright half-width cell allows. The hub stays on the row seam.
      // Clockwise: top, then right, then left.
      id: '3p-wide-top-sides',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180, { c: 2 }), s(2, 2, 270), s(1, 2, 90)],
    },
    {
      // Wide top + 2 normal bottom. Lone player faces the pair.
      // Clockwise: top, bottom-right, bottom-left.
      id: '3p-wide-top',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180, { c: 2 }), s(2, 2, 0), s(1, 2, 0)],
    },
    {
      // 2 normal top + Wide bottom — inverse pairing.
      id: '3p-wide-bottom',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 0, { c: 2 })],
    },
    {
      // 2 top + 1 bottom-left, top-right empty corner.
      id: '3p-tt-bl',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 0)],
      empty: [e(2, 2)],
    },
    {
      // 2 top + 1 bottom-right, bottom-left empty corner.
      id: '3p-tt-br',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(2, 2, 0)],
      empty: [e(1, 2)],
    },
    {
      // 1 top-right + 2 bottom, top-left empty corner. Clockwise: top,
      // bottom-right, bottom-left.
      id: '3p-tr-bb',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(2, 1, 180), s(2, 2, 0), s(1, 2, 0)],
      empty: [e(1, 1)],
    },
    {
      // 1 top-left + 2 bottom, top-right empty corner. Clockwise: top,
      // bottom-right, bottom-left.
      id: '3p-tl-bb',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180), s(2, 2, 0), s(1, 2, 0)],
      empty: [e(2, 1)],
    },
  ],

  // ── 4 players ──────────────────────────────────────────────────────────
  // Classic 2×2 pod is the default. Wide-top + 2 + Wide-bottom is the
  // "1 vs 1 vs 2 in the middle" arrangement.
  4: [
    {
      // Two players per long edge of the device — the most common phone-
      // on-the-table 4-player seating. Both seats in the LEFT column read
      // rotated 90°, both in the RIGHT column 270° (mirror), so each
      // *column* faces one way and the hub sits on the vertical seam
      // between the columns. Clockwise: TL, TR, BR, BL.
      id: '4p-sides',
      cols: 2,
      rows: 2,
      seam: { col: 1 },
      seats: [s(1, 1, 90), s(2, 1, 270), s(2, 2, 270), s(1, 2, 90)],
    },
    {
      // Classic Commander pod — 2 on the far side of the device (rotated
      // 180°) facing 2 on the near side (upright). Clockwise: TL, TR, BR, BL.
      id: '4p-pod',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(2, 2, 0), s(1, 2, 0)],
    },
    {
      // Wide top + 2 middle + Wide bottom. The two outer players each
      // sit alone on a long edge; the middle pair sits across from each
      // other at the seam. Clockwise: top, right-middle, bottom, left-middle.
      id: '4p-wide-middle',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180, { c: 2 }), s(2, 2, 180), s(1, 3, 0, { c: 2 }), s(1, 2, 180)],
    },
  ],

  // ── 5 players ──────────────────────────────────────────────────────────
  // 3 rows × 2 cols with one Wide row absorbing the odd seat.
  5: [
    {
      // Wide top + 2 middle + 2 bottom (3 across the far side, 2 near).
      // Clockwise: top, mid-right, bottom-right, bottom-left, mid-left.
      id: '5p-wide-top',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180, { c: 2 }), s(2, 2, 180), s(2, 3, 0), s(1, 3, 0), s(1, 2, 180)],
    },
    {
      // 2 top + 2 middle + Wide bottom (inverse). Clockwise: TL, TR,
      // mid-right, bottom, mid-left.
      id: '5p-wide-bottom',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(2, 2, 180), s(1, 3, 0, { c: 2 }), s(1, 2, 180)],
    },
    {
      // 2 top + Wide middle + 2 bottom (2 vs 1 vs 2). Clockwise: TL, TR,
      // middle, bottom-right, bottom-left.
      id: '5p-wide-middle',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 180, { c: 2 }), s(2, 3, 0), s(1, 3, 0)],
    },
  ],

  // ── 6 players ──────────────────────────────────────────────────────────
  // 3 rows × 2 cols, fully populated.
  6: [
    {
      // 4 across the far side (top + middle rows rotated) and 2 near.
      // Clockwise: TL, TR, mid-right, bottom-right, bottom-left, mid-left.
      id: '6p-4v2',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(2, 2, 180), s(2, 3, 0), s(1, 3, 0), s(1, 2, 180)],
    },
    {
      // 2 far + 4 near. Clockwise: TL, TR, mid-right, bottom-right,
      // bottom-left, mid-left.
      id: '6p-2v4',
      cols: 2,
      rows: 3,
      seam: { row: 1 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(2, 2, 0), s(2, 3, 0), s(1, 3, 0), s(1, 2, 0)],
    },
  ],

  // ── 7 players ──────────────────────────────────────────────────────────
  // 4 rows × 2 cols; the odd seat is a Wide row (top or bottom) rather than
  // an empty cell, matching how 3p/5p absorb their odd seat.
  //
  // 7p-sides and 9p-sides are now the DEFAULT for their counts (Lotus's own
  // 7-10p arrangement: everyone along the two long edges of the device,
  // like 4p-sides scaled up). The odd seat takes a Wide top end — the same
  // move 3p-wide-top-sides makes for 3 — leaving the rest split evenly
  // between the two columns (3+3 for 7, 4+4 for 9).
  7: [
    {
      // Wide top (1) + 3 right + 3 left, every side seat rotated to face
      // its own long edge. Clockwise: top, right top→bottom, left
      // bottom→top. COL-seam, not row-seam like 3p-wide-top-sides: a row
      // seam's undo satellite offsets ±3.4rem horizontally from centre, a
      // margin measured against upright/180° panels, and it lands square on
      // a sideways row's step buttons once the board is short enough (4+
      // rows) to put those buttons close to the seam in absolute px —
      // measured 90-100px² of undo/step overlap at 320px with a row seam
      // here, on BOTH the row above and below it. A col seam sidesteps this
      // entirely: `seamSatellite`'s col-seam quarter-point rule (E299/E310)
      // already keeps the hub/undo off every panel's furniture regardless
      // of row count, and it places the hub dead-centre (left/top 50%),
      // which reads fine even though the row-1 seat above it is Wide.
      id: '7p-sides',
      cols: 2,
      rows: 4,
      seam: { col: 1 },
      seats: [
        s(1, 1, 180, { c: 2 }),
        s(2, 2, 270),
        s(2, 3, 270),
        s(2, 4, 270),
        s(1, 4, 90),
        s(1, 3, 90),
        s(1, 2, 90),
      ],
    },
    {
      // Wide top (1) + Wide bottom (1) + 3 right + 2 left — Lotus's other
      // 7p arrangement, a seat at each short end plus the rest along the
      // sides. 7 doesn't split the 5 remaining seats evenly between the
      // columns, so the right column takes 3 and the left 2 (row4/col1
      // empty) rather than leaving a gap at an end. Clockwise: top,
      // right top→bottom, bottom, left bottom→top.
      id: '7p-ends',
      cols: 2,
      rows: 5,
      seam: { col: 1 },
      seats: [
        s(1, 1, 180, { c: 2 }),
        s(2, 2, 270),
        s(2, 3, 270),
        s(2, 4, 270),
        s(1, 5, 0, { c: 2 }),
        s(1, 3, 90),
        s(1, 2, 90),
      ],
      empty: [e(1, 4)],
    },
    {
      // Wide top (1) + 2 far + 4 near. Clockwise: top, row2-right,
      // row3-right, row4-right, row4-left, row3-left, row2-left.
      id: '7p-wide-top',
      cols: 2,
      rows: 4,
      seam: { row: 2 },
      seats: [
        s(1, 1, 180, { c: 2 }),
        s(2, 2, 180),
        s(2, 3, 0),
        s(2, 4, 0),
        s(1, 4, 0),
        s(1, 3, 0),
        s(1, 2, 180),
      ],
    },
    {
      // 4 far + 2 near + Wide bottom (1). Clockwise: TL, TR, row2-right,
      // row3-right, bottom, row3-left, row2-left.
      id: '7p-wide-bottom',
      cols: 2,
      rows: 4,
      seam: { row: 2 },
      seats: [
        s(1, 1, 180),
        s(2, 1, 180),
        s(2, 2, 180),
        s(2, 3, 0),
        s(1, 4, 0, { c: 2 }),
        s(1, 3, 0),
        s(1, 2, 180),
      ],
    },
  ],

  // ── 8 players ────────────────────────────────────────────────────────────
  // 4 rows × 2 cols, fully populated. 8p-sides is now the DEFAULT — every
  // seat along a long edge, 4+4, the even-count sibling of 4p-sides.
  8: [
    {
      // 4 left + 4 right, col-seam — the same seat walk as 8p-4v4 (far
      // column top→bottom, near column bottom→top) but rotated 90°/270°
      // by COLUMN instead of 180°/0° by row-half, since every seat faces
      // a long edge rather than a short one.
      id: '8p-sides',
      cols: 2,
      rows: 4,
      seam: { col: 1 },
      seats: [
        s(1, 1, 90),
        s(2, 1, 270),
        s(2, 2, 270),
        s(2, 3, 270),
        s(2, 4, 270),
        s(1, 4, 90),
        s(1, 3, 90),
        s(1, 2, 90),
      ],
    },
    {
      // Wide top (1) + Wide bottom (1) + 3 right + 3 left — a seat at
      // each short end, the rest along the sides.
      id: '8p-ends',
      cols: 2,
      rows: 5,
      seam: { col: 1 },
      seats: [
        s(1, 1, 180, { c: 2 }),
        s(2, 2, 270),
        s(2, 3, 270),
        s(2, 4, 270),
        s(1, 5, 0, { c: 2 }),
        s(1, 4, 90),
        s(1, 3, 90),
        s(1, 2, 90),
      ],
    },
    {
      // 4 far + 4 near. Clockwise: TL, TR, row2-right, row3-right,
      // bottom-right, bottom-left, row3-left, row2-left.
      id: '8p-4v4',
      cols: 2,
      rows: 4,
      seam: { row: 2 },
      seats: [
        s(1, 1, 180),
        s(2, 1, 180),
        s(2, 2, 180),
        s(2, 3, 0),
        s(2, 4, 0),
        s(1, 4, 0),
        s(1, 3, 0),
        s(1, 2, 180),
      ],
    },
    {
      // 2 far + 6 near.
      id: '8p-2v6',
      cols: 2,
      rows: 4,
      seam: { row: 1 },
      seats: [
        s(1, 1, 180),
        s(2, 1, 180),
        s(2, 2, 0),
        s(2, 3, 0),
        s(2, 4, 0),
        s(1, 4, 0),
        s(1, 3, 0),
        s(1, 2, 0),
      ],
    },
  ],

  // ── 9 players ────────────────────────────────────────────────────────────
  // 5 rows × 2 cols; the odd seat is a Wide row (top or bottom). 9p-sides
  // is now the DEFAULT — see the 7p comment above for the shared reasoning.
  9: [
    {
      // Wide top (1) + 4 right + 4 left. Col-seam, same fix as 7p-sides
      // above — see that comment.
      id: '9p-sides',
      cols: 2,
      rows: 5,
      seam: { col: 1 },
      seats: [
        s(1, 1, 180, { c: 2 }),
        s(2, 2, 270),
        s(2, 3, 270),
        s(2, 4, 270),
        s(2, 5, 270),
        s(1, 5, 90),
        s(1, 4, 90),
        s(1, 3, 90),
        s(1, 2, 90),
      ],
    },
    {
      // Wide top (1) + Wide bottom (1) + 4 right + 3 left — 9 minus the two
      // wide ends leaves 7, split 4/3 between the columns for the same
      // reason 7p-ends splits 3/2 (an odd remainder can't split evenly).
      id: '9p-ends',
      cols: 2,
      rows: 6,
      seam: { col: 1 },
      seats: [
        s(1, 1, 180, { c: 2 }),
        s(2, 2, 270),
        s(2, 3, 270),
        s(2, 4, 270),
        s(2, 5, 270),
        s(1, 6, 0, { c: 2 }),
        s(1, 4, 90),
        s(1, 3, 90),
        s(1, 2, 90),
      ],
      empty: [e(1, 5)],
    },
    {
      // Wide top (1) + 4 far + 4 near.
      id: '9p-wide-top',
      cols: 2,
      rows: 5,
      seam: { row: 3 },
      seats: [
        s(1, 1, 180, { c: 2 }),
        s(2, 2, 180),
        s(2, 3, 180),
        s(2, 4, 0),
        s(2, 5, 0),
        s(1, 5, 0),
        s(1, 4, 0),
        s(1, 3, 180),
        s(1, 2, 180),
      ],
    },
    {
      // 4 far + 4 near + Wide bottom (1).
      id: '9p-wide-bottom',
      cols: 2,
      rows: 5,
      seam: { row: 2 },
      seats: [
        s(1, 1, 180),
        s(2, 1, 180),
        s(2, 2, 180),
        s(2, 3, 0),
        s(2, 4, 0),
        s(1, 5, 0, { c: 2 }),
        s(1, 4, 0),
        s(1, 3, 0),
        s(1, 2, 180),
      ],
    },
  ],

  // ── 10 players ───────────────────────────────────────────────────────────
  // 5 rows × 2 cols, fully populated — the ceiling Lotus supports. 10p-sides
  // is now the DEFAULT — every seat along a long edge, 5+5.
  10: [
    {
      // 5 left + 5 right, col-seam — same construction as 8p-sides.
      id: '10p-sides',
      cols: 2,
      rows: 5,
      seam: { col: 1 },
      seats: [
        s(1, 1, 90),
        s(2, 1, 270),
        s(2, 2, 270),
        s(2, 3, 270),
        s(2, 4, 270),
        s(2, 5, 270),
        s(1, 5, 90),
        s(1, 4, 90),
        s(1, 3, 90),
        s(1, 2, 90),
      ],
    },
    {
      // Wide top (1) + Wide bottom (1) + 4 right + 4 left.
      id: '10p-ends',
      cols: 2,
      rows: 6,
      seam: { col: 1 },
      seats: [
        s(1, 1, 180, { c: 2 }),
        s(2, 2, 270),
        s(2, 3, 270),
        s(2, 4, 270),
        s(2, 5, 270),
        s(1, 6, 0, { c: 2 }),
        s(1, 5, 90),
        s(1, 4, 90),
        s(1, 3, 90),
        s(1, 2, 90),
      ],
    },
    {
      // 6 far + 4 near.
      id: '10p-6v4',
      cols: 2,
      rows: 5,
      seam: { row: 3 },
      seats: [
        s(1, 1, 180),
        s(2, 1, 180),
        s(2, 2, 180),
        s(2, 3, 180),
        s(2, 4, 0),
        s(2, 5, 0),
        s(1, 5, 0),
        s(1, 4, 0),
        s(1, 3, 180),
        s(1, 2, 180),
      ],
    },
    {
      // 4 far + 6 near.
      id: '10p-4v6',
      cols: 2,
      rows: 5,
      seam: { row: 2 },
      seats: [
        s(1, 1, 180),
        s(2, 1, 180),
        s(2, 2, 180),
        s(2, 3, 0),
        s(2, 4, 0),
        s(2, 5, 0),
        s(1, 5, 0),
        s(1, 4, 0),
        s(1, 3, 0),
        s(1, 2, 180),
      ],
    },
  ],
};

/** `game.turnOrder`, resolved for a legacy state that never set it. */
export function turnOrderOf(game: Pick<GameState, 'turnOrder'>): TurnOrder {
  return game.turnOrder === 'counterclockwise' ? 'counterclockwise' : 'clockwise';
}

/**
 * Reorder a clockwise preset's seats to run counterclockwise instead, without
 * moving any seat's cell/rotation: seat 0 (the anchor, topmost-leftmost)
 * keeps its position, and the rest of the walk runs backward —
 * `[s0, s(n-1), …, s1]`. Turn order itself (seat index + 1, in game-core)
 * never changes; reversing which seat sits in which cell is what makes that
 * same advance read as going the other way around the table.
 */
function reverseSeatsCounterclockwise(seats: SeatSlot[]): SeatSlot[] {
  if (seats.length <= 1) return seats;
  return [seats[0], ...seats.slice(1).reverse()];
}

function applyTurnOrder(layout: BoardLayout, turnOrder: TurnOrder): BoardLayout {
  if (turnOrder === 'clockwise') return layout;
  return { ...layout, seats: reverseSeatsCounterclockwise(layout.seats) };
}

/** All layouts available at the given player count (default first). Presets
 *  come out clockwise; pass `'counterclockwise'` to reverse seating for
 *  every preset (a custom, user-arranged layout isn't in this list at all,
 *  so it never goes through this — see `resolveLayout`). */
export function layoutsForCount(count: number, turnOrder: TurnOrder = 'clockwise'): BoardLayout[] {
  const c = Math.max(2, Math.min(count, 10));
  const presets = LAYOUTS[c] ?? LAYOUTS[2];
  return turnOrder === 'clockwise' ? presets : presets.map((l) => applyTurnOrder(l, turnOrder));
}

/**
 * Index in `seats` of the slot the viewer should occupy on their own device
 * in an online game — their panel sits nearest them, like a seat at a real
 * table. Prefers upright (rot 0) slots, then the bottom-most row, then the
 * left column; for all-rotated layouts (e.g. side-by-side) the same row/col
 * tie-break still yields the bottom-left slot.
 */
export function homeSlotIndex(layout: BoardLayout): number {
  // Packed score: upright ≫ row (decode caps rows at 8) ≫ left column.
  const score = (s: SeatSlot) => (s.rot === 0 ? 1000 : 0) + s.row * 10 + (s.col === 1 ? 1 : 0);
  let best = layout.seats.length - 1;
  layout.seats.forEach((s, i) => {
    if (score(s) > score(layout.seats[best])) best = i;
  });
  return best;
}

/**
 * Compute the CSS translation offsets and icon rotation for the floating undo
 * button relative to the seam hub.
 *
 * Row-seam (hub on a horizontal boundary, e.g. 2p-stacked, 4p-pod):
 *   • Hub is centred left-right → undo button offsets to the LEFT (−X).
 *   • Icon at 0° (default Undo2 arrow pointing left) is readable for both
 *     the near-side (upright) and far-side (180°) players.
 *
 * Col-seam (hub on a vertical boundary, e.g. 2p-side, 4p-sides):
 *   • Hub is centred top-bottom → undo button offsets ABOVE the hub (−Y).
 *   • Seats rotate 90°/270° so the icon needs 90° rotation so the curved
 *     arrow reads naturally when the device is placed in landscape.
 *
 * @param seam  The layout seam from {@link BoardLayout}.
 * @param offset  Distance from the hub centre to the undo button centre.
 *                Defaults to "3.4rem" (mobile). Pass "4rem" for the ≥600px size.
 */
export function seamOffset(
  seam: BoardLayout['seam'],
  offset: string,
  side: -1 | 1
): {
  /** Full CSS translate() X argument. */
  tx: string;
  /** Full CSS translate() Y argument. */
  ty: string;
} {
  const sign = side < 0 ? '-' : '+';
  // The seam runs along one axis, so a satellite always moves along the other:
  // a col-seam is vertical, so its satellites sit above/below; a row-seam is
  // horizontal, so its satellites sit left/right.
  if ('col' in seam) return { tx: '-50%', ty: `calc(-50% ${sign} ${offset})` };
  return { tx: `calc(-50% ${sign} ${offset})`, ty: '-50%' };
}

/**
 * How far from the seam a wide satellite's near edge starts: the hub button's
 * radius (it is 2.75rem across at the coarse-pointer size) plus a small gap.
 */
const HUB_CLEARANCE = '2rem';

/**
 * Where a seam satellite (undo, clock) actually sits — the placement rule, as
 * opposed to `seamOffset`'s raw direction.
 *
 * On a ROW seam, the seam is a horizontal gutter with a panel above and below;
 * a satellite offset left or right of the hub sits over that gutter and clears
 * everything. That is the original behaviour and is unchanged.
 *
 * On a COLUMN seam it is different, and this is the part that kept producing
 * collisions (E299/E310): a col-seam board is a grid, so the hub sits where
 * FOUR panel corners meet — and every panel puts its name button in a corner.
 * Anything hung a few rem from the hub therefore lands on somebody's name; the
 * measured worst case was the clock covering 766px² of a seat's name button on
 * `4p-sides`, and it collides in BOTH directions because the corners are
 * symmetric about the crossing. Shuffling the offset only moves which name it
 * lands on, and the corner cluster cannot yield either — the satellite stack is
 * ~180px long, so the name would have to move further than the panel is deep.
 *
 * So a col-seam satellite stops being hub-relative and takes the **midpoint of
 * an adjacent panel's inner edge** instead: a quarter of the way down the
 * seam for the "before" satellite, three quarters for the "after" one.
 * Panels put their furniture at corners and their ± zones at the middle of
 * the panel, so the middle of an edge is clear *by construction* rather than
 * by a magic number tuned to one viewport — which is what makes this hold at
 * every board size instead of only the one it was measured at, PROVIDED
 * every row is a plain left/right pair (see the exception below for the one
 * shape where it isn't).
 *
 * All three stay on the seam line, so they still read as the boundary's
 * furniture rather than as any seat's.
 *
 * **Exception: a Wide seat in row 1 (2026-09-25).** The flat quarter above
 * holds only because a plain left/right row repeats identically at every
 * position, so *which* row 25% happens to land in never matters. `7p-ends`,
 * `8p-ends`, `9p-sides`, `9p-ends` and `10p-ends` all seat a Wide seat (no
 * left/right split at all) in row 1, which pushes seat 1 — the seat a table
 * actually marks "up next" most of the time — into row 2 instead of row 1.
 * On a 5-6 row board that puts row 2 somewhere a flat quarter doesn't land
 * cleanly on its boundary (`0.25 * rows` isn't a whole number), so the point
 * ends up *inside* that cell rather than near its edge, close enough to seat
 * 1's own "up next" chip corner that undo growing 42 → 44px (#2279) tipped
 * it into a measured 10px² overlap. `wideFirstRow` (derived by the caller
 * from `seats[0].colSpan === 2`, never a preset id) opts a board into a
 * shifted 32% "before" point *only* when both hold: a Wide first row AND
 * `0.25 * rows` isn't already a whole number. `7p-sides` has the Wide-row-1
 * shape too but only 4 rows (`0.25 * 4 === 1`, exactly a boundary) so it's
 * excluded by the second half of the check, same as `8p-sides`/`10p-sides`
 * are by the first (no Wide seat at all) — none of the three ever needed
 * the shift, and none of them get it. Every OTHER col-seam board keeps the
 * exact original 25%/75% this rule has always used. 32% (not a formula tied
 * to `rows`) is itself measured, not derived: it clears both the 5-row and
 * 6-row cases in one value (`LAYOUTS=ALL`, all three viewports,
 * `.claude/tools/life-board-probe.mjs`). The "after" (75%) side keeps its
 * literal value unconditionally — nothing today renders a col-seam "after"
 * satellite, and a symmetric Wide-last-row exception would be guessing
 * ahead of a collision nobody has measured.
 */
export function seamSatellite(
  seam: BoardLayout['seam'],
  rows: number,
  side: -1 | 1,
  offset: string,
  wideFirstRow = false
): { topPct: string; tx: string; ty: string } {
  if ('col' in seam) {
    if (side < 0 && wideFirstRow && (0.25 * rows) % 1 !== 0) {
      return { topPct: '32%', tx: '-50%', ty: '-50%' };
    }
    return { topPct: side < 0 ? '25%' : '75%', tx: '-50%', ty: '-50%' };
  }
  const topPct = `${(seam.row / rows) * 100}%`;
  if (side > 0) {
    // The "after" satellite on a row seam is the clock, a WIDE pill, and the
    // offset is applied to its centre — so half its width (66px at phone size)
    // swallowed the hub button, which is only 22px in radius. Measured at
    // 1357px² of the hub covered, with the clock painting last at the same
    // z-index: the ⋯ glyph was simply invisible on every row-seam board,
    // including the default `4p-pod` and `2p-stacked`.
    //
    // So this one is anchored by its NEAR EDGE instead of its centre — no
    // `-50%` — which makes the gap independent of how wide the pill gets when
    // a long player name lands in it.
    return { topPct, tx: HUB_CLEARANCE, ty: '-50%' };
  }
  return { topPct, ...seamOffset(seam, offset, side) };
}

export function undoButtonParams(
  seam: BoardLayout['seam'],
  offset = '3.4rem'
): {
  /** Full CSS translate() X argument. */
  tx: string;
  /** Full CSS translate() Y argument. */
  ty: string;
  /** Icon rotation in degrees (0 for row-seam, 90 for col-seam). */
  iconRot: 0 | 90;
} {
  // Undo is the "before" satellite: left of a row seam, above a col seam.
  return { ...seamOffset(seam, offset, -1), iconRot: 'col' in seam ? 90 : 0 };
}

// ── Custom layouts ─────────────────────────────────────────────────────────
//
// A user-arranged layout is serialized into the opaque `GameLayout` id
// string so it persists and syncs online with zero server changes — the
// server treats the id as opaque and `resolveLayout` falls back to a
// preset for anything it can't parse. Format (v1):
//
//   custom:v1~{rows}~{seam}~{seat};{seat};…
//     rows  = grid row count (cols are fixed at 2 in v1)
//     seam  = `r{n}` (row seam after row n) or `c{n}` (col seam after col n)
//     seat  = `col.row.colSpan.rowSpan.rot`  (seat-index order)

const CUSTOM_PREFIX = 'custom:v1~';
const VALID_ROT = new Set([0, 90, 180, 270]);

export function isCustomLayout(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(CUSTOM_PREFIX);
}

export function encodeCustomLayout(layout: {
  rows: number;
  seam: { row: number } | { col: number };
  seats: SeatSlot[];
}): string {
  const seam = 'row' in layout.seam ? `r${layout.seam.row}` : `c${layout.seam.col}`;
  const seats = layout.seats
    .map((st) => `${st.col}.${st.row}.${st.colSpan ?? 1}.${st.rowSpan ?? 1}.${st.rot}`)
    .join(';');
  return `${CUSTOM_PREFIX}${layout.rows}~${seam}~${seats}`;
}

function computeEmpty(rows: number, seats: SeatSlot[]): EmptyCell[] {
  const occ = new Set<string>();
  for (const st of seats) {
    const cs = st.colSpan ?? 1;
    const rs = st.rowSpan ?? 1;
    for (let c = st.col; c < st.col + cs; c++) {
      for (let r = st.row; r < st.row + rs; r++) occ.add(`${c},${r}`);
    }
  }
  const empties: EmptyCell[] = [];
  for (let r = 1; r <= rows; r++) {
    for (const c of [1, 2] as const) {
      if (!occ.has(`${c},${r}`)) empties.push({ col: c, row: r });
    }
  }
  return empties;
}

/**
 * Parse a serialized custom layout. Returns null (so the caller falls back
 * to a preset) if the string is malformed, the seat count doesn't match
 * `count`, or any seat would overlap / spill off the 2-column grid. Being
 * strict here means a stale or corrupt id can never render a broken board.
 */
export function decodeCustomLayout(
  id: string | null | undefined,
  count: number
): BoardLayout | null {
  if (!isCustomLayout(id)) return null;
  try {
    const [rowsStr, seamStr, seatsStr] = (id as string).slice(CUSTOM_PREFIX.length).split('~');
    const rows = Number(rowsStr);
    if (!Number.isInteger(rows) || rows < 1 || rows > 8) return null;

    let seam: { row: number } | { col: number };
    if (seamStr?.[0] === 'r') {
      const n = Number(seamStr.slice(1));
      if (!Number.isInteger(n) || n < 0 || n > rows) return null;
      seam = { row: n };
    } else if (seamStr?.[0] === 'c') {
      const n = Number(seamStr.slice(1));
      if (!Number.isInteger(n) || n < 0 || n > 2) return null;
      seam = { col: n };
    } else {
      return null;
    }

    const parts = (seatsStr ?? '').split(';').filter(Boolean);
    if (parts.length !== count) return null;

    const seats: SeatSlot[] = [];
    const occ = new Set<string>();
    for (const p of parts) {
      const [c, r, cs, rs, rot] = p.split('.').map(Number);
      if (c !== 1 && c !== 2) return null;
      if (!Number.isInteger(r) || r < 1 || r > rows) return null;
      if ((cs !== 1 && cs !== 2) || (rs !== 1 && rs !== 2)) return null;
      if (!VALID_ROT.has(rot)) return null;
      if (c + cs - 1 > 2) return null; // can't span past column 2
      if (r + rs - 1 > rows) return null; // can't span past the last row
      for (let cc = c; cc < c + cs; cc++) {
        for (let rr = r; rr < r + rs; rr++) {
          const k = `${cc},${rr}`;
          if (occ.has(k)) return null; // overlap
          occ.add(k);
        }
      }
      seats.push({
        col: c as 1 | 2,
        row: r,
        colSpan: cs as 1 | 2,
        rowSpan: rs as 1 | 2,
        rot: rot as 0 | 90 | 180 | 270,
      });
    }

    return { id: id as string, cols: 2, rows, seam, seats, empty: computeEmpty(rows, seats) };
  } catch {
    return null;
  }
}

/**
 * Resolve a (count, layoutId) pair to its concrete BoardLayout, falling
 * back to the count's default if the id is unknown. Legacy persisted ids
 * (`'pod'`, `'pod-alt'`, `'same'`, `'line'`) miss the registry and get
 * the new default automatically.
 */
export function resolveLayout(
  count: number,
  id: GameLayout | string | undefined | null,
  turnOrder: TurnOrder = 'clockwise'
): BoardLayout {
  const c = Math.max(2, Math.min(count, 10));
  // A custom (user-arranged) layout keeps the order the user set — turnOrder
  // only reverses the built-in presets.
  const custom = decodeCustomLayout(id, c);
  if (custom) return custom;
  const available = layoutsForCount(count, turnOrder);
  const match = available.find((l) => l.id === id);
  return match ?? available[0];
}
