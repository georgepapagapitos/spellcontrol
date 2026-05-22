/**
 * Pure fan geometry for the native navigation FAB (see components/NavFab.tsx).
 *
 * The FAB is locked to the bottom-right corner; tapping it fans the
 * destinations out along the 90° quadrant that opens up-and-left into the
 * screen. Keeping the math here — free of React and the DOM — makes it
 * unit-testable and keeps the component focused on rendering.
 */

/** Distance (px) from the FAB centre to each fanned-out item's centre. */
export const FAN_RADIUS_PX = 92;

export interface FanOffset {
  /** px offset from the FAB centre; +x is right, +y is down (CSS axes). */
  x: number;
  y: number;
}

/**
 * Offset for fan item `index` of `count`.
 *
 * Items spread evenly across the 90° quadrant opening away from the two
 * screen edges the bottom-right corner touches: item 0 sits straight up
 * (away from the bottom edge) and the last item straight left (away from
 * the right edge), so the fan always opens up into the screen.
 */
export function fanItemOffset(
  index: number,
  count: number,
  radius: number = FAN_RADIUS_PX
): FanOffset {
  const t = count <= 1 ? 0.5 : index / (count - 1);
  const angle = t * (Math.PI / 2);
  // Bottom-right corner: fan up (−y) and left (−x).
  return {
    x: -Math.sin(angle) * radius,
    y: -Math.cos(angle) * radius,
  };
}
