/** The battlefield box a drop lands in, as `getBattlefieldGeometry` reads it. */
interface Geometry {
  width: number;
  height: number;
  cardW: number;
  cardH: number;
}

/**
 * Snap a battlefield position to a half-card grid ("Snap cards to grid").
 *
 * `x`/`y` are fractions of the (box − card) span, the same space the
 * renderer's `left: calc(x * (100% - cardW))` uses, so the snap happens in
 * pixels and converts back. Half a card is the pitch because it gives both
 * clean columns (every other line) and the tidy 50% shingle a row of lands
 * wants; a full-card pitch would forbid overlap altogether.
 */
export function snapToGrid(x: number, y: number, g: Geometry): { x: number; y: number } {
  const snap = (f: number, span: number, pitch: number) => {
    if (!(span > 0 && pitch > 0)) return f;
    const px = Math.round((f * span) / pitch) * pitch;
    return Math.min(1, Math.max(0, px / span));
  };
  return {
    x: snap(x, g.width - g.cardW, g.cardW / 2),
    y: snap(y, g.height - g.cardH, g.cardH / 2),
  };
}
