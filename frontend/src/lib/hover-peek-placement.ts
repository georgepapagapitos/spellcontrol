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
