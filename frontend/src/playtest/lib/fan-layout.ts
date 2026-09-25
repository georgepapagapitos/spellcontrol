/**
 * Hand-fan geometry for the ≥1024px table (see `components/Hand.tsx`). Pure
 * arithmetic, kept out of the component so it can be tested directly and so
 * the component file stays components-only.
 */

/** Ceiling however wide the container gets: a fan past this stops reading as a
 *  hand and starts reading as a second battlefield row. */
const MAX_FAN_VW = 0.52;

/** Each tile is a card plus its 6px padding and hairline; the Hand button
 *  (`--pt-hand-btn-w`, 5.5rem) and four tiles, four gaps, and the row's right
 *  inset. Mirrors `.playtest-piles` in playtest.css. */
const PILE_CHROME = 13;
const HAND_BUTTON = 88;
const PILES_GAP = 8;
const PILES_INSET = 12;

/** How wide the zone-pile row is at a given card width. The fan is centred in
 *  what the row leaves free (`.playtest-hand--fan` reads the same number off
 *  `--pt-card-w`), and the two must agree or the fan drifts under the piles. */
export function pilesWidth(cardW: number): number {
  return HAND_BUTTON + 4 * (cardW + PILE_CHROME) + 4 * PILES_GAP + PILES_INSET;
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

/** The width the fan may spread across: what the pile row leaves, capped.
 *  `piles` is the row's width when the stylesheet states it
 *  (`--pt-pile-span`, below 1024px, where the row is two or four tiles at
 *  the table's card size, not the hand's); otherwise the desk row's sum. */
function fanRoom(cardW: number, containerW: number, piles = pilesWidth(cardW)): number {
  const band = containerW - piles - 2 * PILES_INSET;
  return Math.min(containerW * MAX_FAN_VW, Math.max(cardW, band));
}

/**
 * How much of a card the next one covers, as a fraction of the card's width.
 * Spread to fill the width the table actually has left of the pile row, so a
 * normal hand sits nearly side by side where there is room and a big one
 * tucks tighter instead of running under the piles. `cardW` is the table's
 * card size (the piles are drawn at it); `handW` is the hand's, which
 * `fanCardWidth` shrinks for a big hand.
 */
export function fanOverlap(
  count: number,
  cardW: number,
  containerW: number,
  handW = cardW,
  piles?: number
): number {
  if (count < 2 || handW <= 0) return MIN_FAN_OVERLAP;
  const room = fanRoom(cardW, containerW, piles);
  return clamp(1 - (room - handW) / (handW * (count - 1)), MIN_FAN_OVERLAP, MAX_FAN_OVERLAP);
}

/** The smallest a big hand's cards get, as a share of the table's card size. */
const MIN_HAND_CARD_SCALE = 0.5;

/**
 * The hand's card width. The table's size until the fan, at its tightest
 * overlap, no longer fits the room it has; past that the cards shrink so it
 * does, as EDHPlay draws a big hand smaller rather than letting it run off
 * the screen (a 22-card hand ran 56px off the left edge at full size).
 */
export function fanCardWidth(
  count: number,
  cardW: number,
  containerW: number,
  piles = pilesWidth(cardW)
): number {
  // No band left of the pile row means there is no room figure to shrink
  // to, and a normal hand must not shrink to nothing.
  const band = containerW - piles - 2 * PILES_INSET;
  if (count < 2 || band <= cardW) return cardW;
  const fits = fanRoom(cardW, containerW, piles) / (1 + (count - 1) * (1 - MAX_FAN_OVERLAP));
  return Math.max(cardW * MIN_HAND_CARD_SCALE, Math.min(cardW, fits));
}

/** Rotation per card away from the centre, and the drop per squared step that
 *  arcs the fan. What a normal hand gets. */
const FAN_STEP_DEG = 2;
const FAN_ARC_PX = 1.2;
/** The most the OUTERMOST card may turn and drop. A fixed per-card step turned
 *  the end cards of a 22-card hand 21° and dropped them 130px, off the table
 *  edge. Capping the edge flattens a big hand the way EDHPlay's does; up to
 *  seven cards the caps never bind, so a normal hand keeps its curve. */
const MAX_EDGE_DEG = 6;
const MAX_EDGE_DROP_PX = 12;

/** Card `i` of `n`: how far it turns (degrees) and how far it drops (px). */
export function fanTilt(i: number, n: number): { deg: number; drop: number } {
  const off = i - (n - 1) / 2;
  const edge = Math.max((n - 1) / 2, 1);
  const step = Math.min(FAN_STEP_DEG, MAX_EDGE_DEG / edge);
  const arc = Math.min(FAN_ARC_PX, MAX_EDGE_DROP_PX / (edge * edge));
  return { deg: off * step, drop: off * off * arc };
}
