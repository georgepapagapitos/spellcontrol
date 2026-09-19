/**
 * Hand-fan geometry for the ≥1024px table (see `components/Hand.tsx`). Pure
 * arithmetic, kept out of the component so it can be tested directly and so
 * the component file stays components-only.
 */

/**
 * The band down each side of the fan's CONTAINER (the battlefield wrap, which
 * is the whole table below 1440px and one quadrant of the seat grid above it)
 * that the fan must not reach into: the log
 * dock's footprint on the left (24rem plus its gutters, reserved whether or
 * not the dock is open, so opening it never re-lays the hand) and the zone
 * pile row on the right. The fan is centred, so the usable half-width is
 * whichever side is tighter.
 */
const DOCK_RESERVE = 24 * 16 + 2 * 12;
const PILES_RESERVE = 26 * 16 + 12;

/** Ceiling however wide the container gets: a fan past this stops reading as a
 *  hand and starts reading as a second battlefield row. */
const MAX_FAN_VW = 0.52;

/**
 * Overlap bounds. The floor is "effectively side by side"; the ceiling is the
 * density this board shipped with, which is known to fit at the tightest table
 * width, so a very large hand degrades to what it always did rather than
 * stacking into an unreadable pile.
 */
export const MIN_FAN_OVERLAP = 0.12;
export const MAX_FAN_OVERLAP = 0.45;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * How much of a card the next one covers, as a fraction of the card's width.
 * Spread to fill the width the table actually has, so seven cards sit nearly
 * side by side and fifteen still fit, instead of one fixed fraction that is
 * wrong at both ends (0.45 bunched a normal hand into an unreadable stack on
 * a 1920px table).
 */
export function fanOverlap(count: number, cardW: number, containerW: number): number {
  if (count < 2 || cardW <= 0) return MIN_FAN_OVERLAP;
  const half = Math.min(containerW / 2 - DOCK_RESERVE, containerW - PILES_RESERVE - containerW / 2);
  const maxFanWidth = Math.min(containerW * MAX_FAN_VW, Math.max(cardW, half * 2));
  return clamp(1 - (maxFanWidth - cardW) / (cardW * (count - 1)), MIN_FAN_OVERLAP, MAX_FAN_OVERLAP);
}
