/**
 * The front-face name of a card. Double-faced, split, adventure, and modal cards
 * carry both face names joined by ` // ` (e.g. "Fire // Ice"); EDHREC, Scryfall
 * name lookups, and our own indices key off the front face only.
 *
 * Splitting a single-faced name yields a one-element array, so this is a no-op
 * for normal cards — the old `name.includes(' // ') ? name.split(' // ')[0] : name`
 * guard was redundant.
 */
export function frontFaceName(name: string): string {
  return name.split(' // ')[0];
}
