/**
 * Pure geometry + persistence helpers for the native navigation FAB
 * (see components/NavFab.tsx).
 *
 * The FAB docks to one of the four screen corners and, when tapped, fans its
 * destinations out along the 90° quadrant that opens into the screen. Keeping
 * the math here — free of React and the DOM — makes it unit-testable and keeps
 * the component focused on gesture wiring.
 */

export type FabCorner = 'tl' | 'tr' | 'bl' | 'br';

export const FAB_CORNERS: readonly FabCorner[] = ['tl', 'tr', 'bl', 'br'];
export const DEFAULT_FAB_CORNER: FabCorner = 'br';

/** Distance (px) from the FAB centre to each fanned-out item's centre. */
export const FAN_RADIUS_PX = 92;

const STORAGE_KEY = 'sc:nav-fab-corner';

function isFabCorner(value: unknown): value is FabCorner {
  return typeof value === 'string' && (FAB_CORNERS as readonly string[]).includes(value);
}

/** Read the user's last docked corner; falls back to bottom-right. */
export function loadFabCorner(): FabCorner {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isFabCorner(raw)) return raw;
  } catch {
    // Private-mode / disabled storage — non-fatal, use the default.
  }
  return DEFAULT_FAB_CORNER;
}

/** Persist the docked corner so it survives reloads. */
export function saveFabCorner(corner: FabCorner): void {
  try {
    localStorage.setItem(STORAGE_KEY, corner);
  } catch {
    // Non-fatal — the FAB simply reverts to the default next launch.
  }
}

/**
 * Pick the corner closest to a point, given the container size. Used on
 * drag-release to snap the FAB home.
 */
export function nearestCorner(x: number, y: number, width: number, height: number): FabCorner {
  const left = x < width / 2;
  const top = y < height / 2;
  return `${top ? 't' : 'b'}${left ? 'l' : 'r'}` as FabCorner;
}

export interface FanOffset {
  /** px offset from the FAB centre; +x is right, +y is down (CSS axes). */
  x: number;
  y: number;
}

/**
 * Offset for fan item `index` of `count`, given the docked corner.
 *
 * Items spread evenly across the 90° quadrant that opens away from the two
 * screen edges the corner touches: item 0 sits straight along the vertical
 * edge (away from the horizontal edge) and the last item straight along the
 * horizontal edge, so the fan always opens *into* the screen regardless of
 * which corner the FAB was dragged to.
 */
export function fanItemOffset(
  corner: FabCorner,
  index: number,
  count: number,
  radius: number = FAN_RADIUS_PX
): FanOffset {
  const t = count <= 1 ? 0.5 : index / (count - 1);
  const angle = t * (Math.PI / 2);
  // Right-edge corners fan leftward; bottom-edge corners fan upward.
  const signX = corner === 'tr' || corner === 'br' ? -1 : 1;
  const signY = corner === 'bl' || corner === 'br' ? -1 : 1;
  return {
    x: signX * Math.sin(angle) * radius,
    y: signY * Math.cos(angle) * radius,
  };
}
