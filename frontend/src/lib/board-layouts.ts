import type { GameLayout } from './game-state';

/**
 * A board layout is just a CSS Grid + a rotation per seat. Each seat slot
 * declares its grid placement (1-based, with optional column/row spans) and
 * whether it reads upside-down. Player count determines which layouts are
 * available — the actual game logic never reads from here.
 *
 * Rotations are always 0° or 180°. Never 90°. The reference apps that ship
 * 90° rotations end up with sideways text under a flat phone; we explicitly
 * avoid that.
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

// ── Layout tables ──────────────────────────────────────────────────────────
//
// Indexed by player count. Each count exposes one or more layouts; the first
// entry is the default for new games at that count. Layouts not listed here
// are not available at that count.

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
      // 1 across, 2 near — the most common 3-player table arrangement.
      id: 'pod',
      label: '1 vs 2',
      hint: 'One player across the table, two on the near side.',
      cols: 2,
      rows: 2,
      seats: [s(1, 1, 180, { c: 2 }), s(1, 2, 0), s(2, 2, 0)],
    },
    {
      // 2 across, 1 near — the inverse.
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

  5: [
    {
      id: 'pod',
      label: '3 vs 2',
      hint: 'Three players across the table, two on the near side.',
      cols: 6,
      rows: 2,
      seats: [
        s(1, 1, 180, { c: 2 }),
        s(3, 1, 180, { c: 2 }),
        s(5, 1, 180, { c: 2 }),
        s(1, 2, 0, { c: 3 }),
        s(4, 2, 0, { c: 3 }),
      ],
    },
    {
      id: 'pod-alt',
      label: '2 vs 3',
      hint: 'Two players across the table, three on the near side.',
      cols: 6,
      rows: 2,
      seats: [
        s(1, 1, 180, { c: 3 }),
        s(4, 1, 180, { c: 3 }),
        s(1, 2, 0, { c: 2 }),
        s(3, 2, 0, { c: 2 }),
        s(5, 2, 0, { c: 2 }),
      ],
    },
    {
      id: 'same',
      label: 'Same side',
      hint: 'All five players look at the device from the same side.',
      cols: 2,
      rows: 3,
      seats: [s(1, 1, 0), s(2, 1, 0), s(1, 2, 0), s(2, 2, 0), s(1, 3, 0, { c: 2 })],
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
 * back to the default for the count if the id isn't available. This is
 * how legacy ids (`'default'`, `'row'`) end up rendering correctly — they
 * simply don't match any entry and we return the count's default.
 */
export function resolveLayout(
  count: number,
  id: GameLayout | string | undefined | null
): BoardLayout {
  const available = layoutsForCount(count);
  const match = available.find((l) => l.id === id);
  return match ?? available[0];
}
