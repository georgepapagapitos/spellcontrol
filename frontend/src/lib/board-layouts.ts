import type { GameLayout } from './game-state';

/**
 * A board layout is a uniform CSS Grid + a placement for each seat. Seats
 * may span columns or rows; unused cells may be declared as `empty` so the
 * grid stays uniform (e.g. 5-player layouts are a 3×2 grid with one
 * intentionally-empty cell, matching the reference apps).
 *
 * Rotations are always 0° or 180°. Never 90°. Empty cells render as
 * subtle placeholders — they also act as natural anchors for board chrome
 * like the global menu button, which slots into the empty cell when one
 * is present.
 */

export interface SeatSlot {
  /** 1-based grid column start. */
  col: number;
  /** 1-based grid row start. */
  row: number;
  colSpan?: number;
  rowSpan?: number;
  rot: 0 | 180;
}

export interface EmptyCell {
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
}

export interface BoardLayout {
  id: GameLayout;
  /** Short, user-facing label for the picker. */
  label: string;
  /** One-liner displayed below the picker when this layout is active. */
  hint: string;
  cols: number;
  rows: number;
  /** Seat positions, in seat-index order. Length must equal player count. */
  seats: SeatSlot[];
  /** Cells with no player — render as faded placeholders. */
  empty?: EmptyCell[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function s(
  col: number,
  row: number,
  rot: 0 | 180 = 0,
  span?: { c?: number; r?: number }
): SeatSlot {
  return { col, row, rot, colSpan: span?.c, rowSpan: span?.r };
}

function e(col: number, row: number, span?: { c?: number; r?: number }): EmptyCell {
  return { col, row, colSpan: span?.c, rowSpan: span?.r };
}

// ── Layout tables ──────────────────────────────────────────────────────────
//
// Indexed by player count. Each count exposes one or more layouts; the first
// entry is the default for new games at that count.

const LAYOUTS: Record<number, BoardLayout[]> = {
  2: [
    {
      id: 'pod',
      label: 'Facing',
      hint: 'Phone between two players, each panel reads from their side.',
      cols: 1,
      rows: 2,
      seats: [s(1, 1, 180), s(1, 2, 0)],
    },
    {
      id: 'same',
      label: 'Same side',
      hint: 'Both players look at the device from the same side.',
      cols: 1,
      rows: 2,
      seats: [s(1, 1, 0), s(1, 2, 0)],
    },
  ],

  3: [
    {
      // 1 across (spans both columns), 2 on the near side.
      id: 'pod',
      label: '1 vs 2',
      hint: 'One player across the table, two on the near side.',
      cols: 2,
      rows: 2,
      seats: [s(1, 1, 180, { c: 2 }), s(1, 2, 0), s(2, 2, 0)],
    },
    {
      // Inverse — 2 across, 1 near (the lone seat spans).
      id: 'pod-alt',
      label: '2 vs 1',
      hint: 'Two players across the table, one on the near side.',
      cols: 2,
      rows: 2,
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 0, { c: 2 })],
    },
    {
      id: 'same',
      label: 'Same side',
      hint: 'All three players look at the device from the same side.',
      cols: 2,
      rows: 2,
      seats: [s(1, 1, 0), s(2, 1, 0), s(1, 2, 0, { c: 2 })],
    },
  ],

  4: [
    {
      id: 'pod',
      label: 'Pod',
      hint: 'Classic Commander pod — two players on each side of the device.',
      cols: 2,
      rows: 2,
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 0), s(2, 2, 0)],
    },
    {
      id: 'same',
      label: 'Same side',
      hint: 'All four players look at the device from the same side.',
      cols: 2,
      rows: 2,
      seats: [s(1, 1, 0), s(2, 1, 0), s(1, 2, 0), s(2, 2, 0)],
    },
    {
      id: 'line',
      label: 'Line',
      hint: 'Single row — best for a landscape tablet between four players.',
      cols: 4,
      rows: 1,
      seats: [s(1, 1, 0), s(2, 1, 0), s(3, 1, 0), s(4, 1, 0)],
    },
  ],

  // 5p uses a uniform 3×2 grid with one cell intentionally empty. The empty
  // cell anchors the global menu button so it never overlaps a panel.
  5: [
    {
      id: 'pod',
      label: '3 vs 2',
      hint: 'Three players across the table, two on the near side.',
      cols: 3,
      rows: 2,
      seats: [s(1, 1, 180), s(2, 1, 180), s(3, 1, 180), s(1, 2, 0), s(2, 2, 0)],
      empty: [e(3, 2)],
    },
    {
      id: 'pod-alt',
      label: '2 vs 3',
      hint: 'Two players across the table, three on the near side.',
      cols: 3,
      rows: 2,
      seats: [s(1, 1, 180), s(2, 1, 180), s(1, 2, 0), s(2, 2, 0), s(3, 2, 0)],
      empty: [e(3, 1)],
    },
    {
      id: 'same',
      label: 'Same side',
      hint: 'All five players look at the device from the same side.',
      cols: 3,
      rows: 2,
      seats: [s(1, 1, 0), s(2, 1, 0), s(3, 1, 0), s(1, 2, 0), s(2, 2, 0)],
      empty: [e(3, 2)],
    },
  ],

  6: [
    {
      id: 'pod',
      label: '3 vs 3',
      hint: 'Three players on each side of the device.',
      cols: 3,
      rows: 2,
      seats: [s(1, 1, 180), s(2, 1, 180), s(3, 1, 180), s(1, 2, 0), s(2, 2, 0), s(3, 2, 0)],
    },
    {
      id: 'same',
      label: 'Same side',
      hint: 'All six players look at the device from the same side.',
      cols: 3,
      rows: 2,
      seats: [s(1, 1, 0), s(2, 1, 0), s(3, 1, 0), s(1, 2, 0), s(2, 2, 0), s(3, 2, 0)],
    },
  ],
};

/** All layout ids available at the given player count (default first). */
export function layoutsForCount(count: number): BoardLayout[] {
  const c = Math.max(2, Math.min(count, 6));
  return LAYOUTS[c] ?? LAYOUTS[2];
}

/**
 * Resolve a (count, layoutId) pair to its concrete BoardLayout, falling
 * back to the default for the count if the id isn't available. Legacy
 * persisted ids (`'default'`, `'row'`) miss the registry and use the
 * count's default.
 */
export function resolveLayout(
  count: number,
  id: GameLayout | string | undefined | null
): BoardLayout {
  const available = layoutsForCount(count);
  const match = available.find((l) => l.id === id);
  return match ?? available[0];
}
