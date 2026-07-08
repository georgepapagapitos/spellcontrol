/**
 * Per-card functional tags (BlueprintMTG-style): a fixed 8-tag palette applied
 * from a radial quick-pick in the deck editor, so a deck's role balance can be
 * eyeballed (and filtered) without a full analysis pass.
 *
 * The palette is fixed at 8 so every tag maps 1:1 to a radial-menu sector —
 * order here IS the sector order, starting at 12 o'clock and going clockwise.
 */
export const DECK_CARD_TAGS = [
  'Ramp',
  'Draw',
  'Interaction',
  'Removal',
  'Wincon',
  'Synergy',
  'Setup',
  'Payoff',
] as const;

export type DeckCardTag = (typeof DECK_CARD_TAGS)[number];

/** Max tags per card slot — the store ignores toggles beyond this. */
export const MAX_CARD_TAGS = 4;

/**
 * Tag → number of slots carrying it, across a deck's card list. Counts any
 * string it finds (not just the palette) so a future palette change or a
 * synced deck from a newer build still tallies instead of silently dropping.
 */
export function tagCounts(cards: Array<{ tags?: string[] }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of cards) {
    for (const tag of c.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Radial-menu hit test: which sector does the point at offset (dx, dy) from
 * the menu center fall in? Pure so the gesture math is unit-testable apart
 * from pointer events.
 *
 * - Returns `null` strictly inside the dead zone (distance < deadZoneRadius),
 *   the "release here to keep the menu open" center.
 * - Sector 0 is centered at 12 o'clock; indices advance clockwise. Screen
 *   coordinates (+y is down), so straight up is (0, -1).
 * - A point exactly on the boundary between two sectors resolves to the
 *   higher (clockwise) index.
 */
export function sectorForPoint(
  dx: number,
  dy: number,
  sectorCount: number,
  deadZoneRadius: number
): number | null {
  if (sectorCount <= 0) return null;
  if (Math.hypot(dx, dy) < deadZoneRadius) return null;
  // atan2(dx, -dy) is 0 pointing up and grows clockwise — exactly the sector
  // layout. Range (-π, π]; shift by half a sector so sector 0 straddles 12
  // o'clock, then normalize to [0, 2π) before bucketing.
  const angle = Math.atan2(dx, -dy);
  const sectorSize = (2 * Math.PI) / sectorCount;
  const normalized = (((angle + sectorSize / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Guard the top edge: floating-point can land exactly on 2π/sectorSize.
  return Math.min(sectorCount - 1, Math.floor(normalized / sectorSize));
}
