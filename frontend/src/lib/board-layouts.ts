import type { GameLayout } from './game-state';

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

const LAYOUTS: Record<number, BoardLayout[]> = {
  // ── 2 players ──────────────────────────────────────────────────────────
  // 2p uniquely supports both row-seam (stacked) and col-seam
  // (side-by-side) arrangements — the device sits flat between two
  // players who face each other across either axis.
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
      // Wide top + 2 normal bottom. Lone player faces the pair.
      id: '3p-wide-top',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180, { c: 2 }), s(1, 2, 0), s(2, 2, 0)],
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
      // 1 top-right + 2 bottom, top-left empty corner.
      id: '3p-tr-bb',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(2, 1, 180), s(1, 2, 0), s(2, 2, 0)],
      empty: [e(1, 1)],
    },
    {
      // 1 top-left + 2 bottom, top-right empty corner.
      id: '3p-tl-bb',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180), s(1, 2, 0), s(2, 2, 0)],
      empty: [e(2, 1)],
    },
  ],

  // ── 4 players ──────────────────────────────────────────────────────────
  // Classic 2×2 pod is the default. Wide-top + 2 + Wide-bottom is the
  // "1 vs 1 vs 2 in the middle" arrangement.
  4: [
    {
      // Classic Commander pod — 2 on each side of the device.
      id: '4p-pod',
      cols: 2,
      rows: 2,
      seam: { row: 1 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 0), s(2, 2, 0)],
    },
    {
      // Wide top + 2 middle + Wide bottom. The two outer players each
      // sit alone on a long edge; the middle pair sits across from each
      // other at the seam.
      id: '4p-wide-middle',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180, { c: 2 }), s(1, 2, 180), s(2, 2, 180), s(1, 3, 0, { c: 2 })],
    },
  ],

  // ── 5 players ──────────────────────────────────────────────────────────
  // 3 rows × 2 cols with one Wide row absorbing the odd seat.
  5: [
    {
      // Wide top + 2 middle + 2 bottom (3 across the far side, 2 near).
      id: '5p-wide-top',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180, { c: 2 }), s(1, 2, 180), s(2, 2, 180), s(1, 3, 0), s(2, 3, 0)],
    },
    {
      // 2 top + 2 middle + Wide bottom (inverse).
      id: '5p-wide-bottom',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 180), s(2, 2, 180), s(1, 3, 0, { c: 2 })],
    },
    {
      // 2 top + Wide middle + 2 bottom (2 vs 1 vs 2).
      id: '5p-wide-middle',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 180, { c: 2 }), s(1, 3, 0), s(2, 3, 0)],
    },
  ],

  // ── 6 players ──────────────────────────────────────────────────────────
  // 3 rows × 2 cols, fully populated.
  6: [
    {
      // 4 across the far side (top + middle rows rotated) and 2 near.
      id: '6p-4v2',
      cols: 2,
      rows: 3,
      seam: { row: 2 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 180), s(2, 2, 180), s(1, 3, 0), s(2, 3, 0)],
    },
    {
      // 2 far + 4 near.
      id: '6p-2v4',
      cols: 2,
      rows: 3,
      seam: { row: 1 },
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 0), s(2, 2, 0), s(1, 3, 0), s(2, 3, 0)],
    },
  ],
};

/** All layouts available at the given player count (default first). */
export function layoutsForCount(count: number): BoardLayout[] {
  const c = Math.max(2, Math.min(count, 6));
  return LAYOUTS[c] ?? LAYOUTS[2];
}

/**
 * Resolve a (count, layoutId) pair to its concrete BoardLayout, falling
 * back to the count's default if the id is unknown. Legacy persisted ids
 * (`'pod'`, `'pod-alt'`, `'same'`, `'line'`) miss the registry and get
 * the new default automatically.
 */
export function resolveLayout(
  count: number,
  id: GameLayout | string | undefined | null
): BoardLayout {
  const available = layoutsForCount(count);
  const match = available.find((l) => l.id === id);
  return match ?? available[0];
}
