/**
 * Hand-fan geometry for the ≥1024px table (see `components/Hand.tsx`). Pure
 * arithmetic, kept out of the component so it can be tested directly and so
 * the component file stays components-only.
 */

/** Ceiling however wide the container gets: a fan past this stops reading as a
 *  hand and starts reading as a second battlefield row. */
const MAX_FAN_VW = 0.52;

/** Each tile is a card plus its 6px padding and hairline; four of them, three
 *  gaps, and the row's right inset. Mirrors `.playtest-piles` in playtest.css. */
const PILE_CHROME = 13;
const PILES_GAP = 8;
const PILES_INSET = 12;

/** How wide the zone-pile row is at a given card width. The fan is centred in
 *  what the row leaves free (`.playtest-hand--fan` reads the same number off
 *  `--pt-card-w`), and the two must agree or the fan drifts under the piles. */
export function pilesWidth(cardW: number): number {
  return 4 * (cardW + PILE_CHROME) + 3 * PILES_GAP + PILES_INSET;
}

/**
 * Overlap bounds. The floor is "effectively side by side"; the ceiling is how
 * far a big hand may tuck before the cards stop being findable at all, even
 * with the hover lift and the full-size preview doing the reading.
 */
export const MIN_FAN_OVERLAP = 0.12;
export const MAX_FAN_OVERLAP = 0.6;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * How much of a card the next one covers, as a fraction of the card's width.
 * Spread to fill the width the table actually has left of the pile row, so a
 * normal hand sits nearly side by side where there is room and a big one
 * tucks tighter instead of running under the piles.
 */
export function fanOverlap(count: number, cardW: number, containerW: number): number {
  if (count < 2 || cardW <= 0) return MIN_FAN_OVERLAP;
  const band = containerW - pilesWidth(cardW) - 2 * PILES_INSET;
  const maxFanWidth = Math.min(containerW * MAX_FAN_VW, Math.max(cardW, band));
  return clamp(1 - (maxFanWidth - cardW) / (cardW * (count - 1)), MIN_FAN_OVERLAP, MAX_FAN_OVERLAP);
}
