/**
 * Pure placement math for the deck list's desktop hover-peek: given the hovered
 * row's viewport rect and the peek card's size, decide where to pin the floating
 * card image. Kept DOM-free so it's exhaustively unit-testable; the React glue
 * (capability gate, event delegation) lives in `components/deck/DeckHoverPeek`.
 *
 * Policy: prefer the empty gutter to the RIGHT of the row (that's the whole
 * point — reuse desktop horizontal width without covering the list); fall back
 * to the left if the card would overflow the right edge; clamp into the viewport
 * on both axes so it never spills off-screen on a narrow desktop window.
 */

export interface PeekRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PeekViewport {
  width: number;
  height: number;
}

export interface PeekPlacement {
  left: number;
  top: number;
}

/**
 * Viewport-responsive peek width. Small laptops get a compact card that fits the
 * gutter; large / 4K monitors get a bigger one that actually uses the room. Pure
 * so the hook (which drives the inline width) and the CSS fallback stay in sync
 * through one tested formula.
 */
export function peekWidth(viewportWidth: number, min = 200, max = 300, vwFraction = 0.18): number {
  return Math.round(Math.min(max, Math.max(min, viewportWidth * vwFraction)));
}

/**
 * Cursor-anchored placement: float the peek just beside the pointer, on the side
 * with room, clamped into the viewport. Unlike `computePeekPlacement` (which pins
 * to a row's gutter) this needs no empty gutter, so it works inside a centered
 * max-width panel and at any viewport width — the right fit for the Improve lane.
 */
export function computePointerPlacement(
  pointerX: number,
  pointerY: number,
  viewport: PeekViewport,
  cardW: number,
  cardH: number,
  gap = 16,
  margin = 8
): PeekPlacement {
  // Prefer the right of the cursor; flip left if it would overflow.
  let left = pointerX + gap;
  if (left + cardW + margin > viewport.width) left = pointerX - gap - cardW;
  left = Math.max(margin, Math.min(left, viewport.width - cardW - margin));

  // Vertically center on the cursor, clamped on-screen.
  let top = pointerY - cardH / 2;
  top = Math.max(margin, Math.min(top, viewport.height - cardH - margin));

  return { left, top };
}

export function computePeekPlacement(
  row: PeekRect,
  viewport: PeekViewport,
  cardW: number,
  cardH: number,
  gap = 12,
  margin = 8
): PeekPlacement {
  // Prefer right of the row; fall back to the left gutter if it would overflow.
  let left = row.right + gap;
  if (left + cardW + margin > viewport.width) {
    left = row.left - gap - cardW;
  }
  // Clamp horizontally for the narrow-desktop-window case (neither side fits
  // cleanly) so the card is always fully on-screen.
  left = Math.max(margin, Math.min(left, viewport.width - cardW - margin));

  // Vertically center on the row, then clamp top/bottom into the viewport.
  const rowCenter = (row.top + row.bottom) / 2;
  let top = rowCenter - cardH / 2;
  top = Math.max(margin, Math.min(top, viewport.height - cardH - margin));

  return { left, top };
}

/**
 * Does a peek card actually fit in a gutter beside the row without overlapping
 * it? True when there's room to the right OR left of the row for the full card.
 * The `'row'` gutter anchor is only worth using when this holds; on a narrow
 * window (full-width rows, no spare gutter) `computePeekPlacement` would clamp
 * the card into overlap, so callers should fall back to the cursor placement.
 */
export function rowGutterFits(
  row: PeekRect,
  viewport: PeekViewport,
  cardW: number,
  gap = 12,
  margin = 8
): boolean {
  const fitsRight = row.right + gap + cardW + margin <= viewport.width;
  const fitsLeft = row.left - gap - cardW >= margin;
  return fitsRight || fitsLeft;
}
