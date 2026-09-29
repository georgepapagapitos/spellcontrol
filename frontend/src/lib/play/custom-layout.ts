/**
 * Pure helpers behind the custom table-layout editor. Kept out of the
 * component so the placement/overlap maths is unit-testable in isolation
 * (the editor itself is just React state + DnD plumbing on top of these).
 *
 * Model: a fixed 2-column grid, `rows` tall. Each seat occupies one cell
 * and may span 1–2 columns / 1–2 rows. A `null` slot = an unplaced seat
 * (sitting in the tray).
 */

export interface Placement {
  col: 1 | 2;
  row: number;
  colSpan: 1 | 2;
  rowSpan: 1 | 2;
  rot: 0 | 90 | 180 | 270;
}

/** Map every covered grid cell ("col,row") -> the seat index covering it. */
export function occupancyOf(placements: (Placement | null)[]): Map<string, number> {
  const occ = new Map<string, number>();
  placements.forEach((p, i) => {
    if (!p) return;
    for (let c = p.col; c < p.col + p.colSpan; c++) {
      for (let r = p.row; r < p.row + p.rowSpan; r++) occ.set(`${c},${r}`, i);
    }
  });
  return occ;
}

/**
 * Move `seat` to (col,row), resetting it to 1×1 so the grid can never
 * overlap. If the target cell already belongs to another seat, the two
 * swap positions (the displaced seat also resets to 1×1); if the mover
 * came from the tray the displaced seat is bumped back to the tray.
 * Returns a new array — never mutates the input.
 */
export function applyPlacement(
  placements: (Placement | null)[],
  seat: number,
  col: 1 | 2,
  row: number
): (Placement | null)[] {
  const next = placements.slice();
  const occ = occupancyOf(next);
  const targetOwner = occ.get(`${col},${row}`);
  const moving = next[seat];
  const from = moving ? { col: moving.col, row: moving.row } : null;
  next[seat] = { col, row, colSpan: 1, rowSpan: 1, rot: moving?.rot ?? 0 };
  if (targetOwner != null && targetOwner !== seat) {
    const other = next[targetOwner]!;
    next[targetOwner] = from
      ? { col: from.col, row: from.row, colSpan: 1, rowSpan: 1, rot: other.rot }
      : null;
  }
  return next;
}

/** True if every cell in `col` over `rowSpan` rows from `fromRow` is free. */
export function rangeFree(
  occ: Map<string, number>,
  col: number,
  fromRow: number,
  rowSpan: number,
  ignore: number
): boolean {
  for (let r = fromRow; r < fromRow + rowSpan; r++) {
    const o = occ.get(`${col},${r}`);
    if (o != null && o !== ignore) return false;
  }
  return true;
}

/** True if `row` is free across the seat's `colSpan` columns from `col`. */
export function rangeFreeRows(
  occ: Map<string, number>,
  col: number,
  colSpan: number,
  row: number,
  ignore: number
): boolean {
  for (let c = col; c < col + colSpan; c++) {
    const o = occ.get(`${c},${row}`);
    if (o != null && o !== ignore) return false;
  }
  return true;
}

/**
 * Pick a sensible hub-seam position from the arrangement. Purely cosmetic
 * (where the centre menu button sits): a single row of sideways seats
 * gets a vertical seam; otherwise the seam sits below the lowest
 * 180°-rotated ("far side") row, falling back to the middle.
 */
export function deriveSeam(
  rows: number,
  placements: Placement[]
): { row: number } | { col: number } {
  if (rows === 1 && placements.some((p) => p.rot === 90 || p.rot === 270)) {
    return { col: 1 };
  }
  let lastFlipped = 0;
  for (const p of placements) if (p.rot === 180) lastFlipped = Math.max(lastFlipped, p.row);
  return { row: lastFlipped || Math.floor(rows / 2) };
}
