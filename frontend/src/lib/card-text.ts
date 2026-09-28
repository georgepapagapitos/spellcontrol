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

/**
 * A card's entry in a name-keyed index, trying the full name first and then
 * the front face. A deck card carries Scryfall's full name ("Revitalizing
 * Repast // Old-Growth Grove") while EDHREC lists most double-faced cards
 * under the front face alone, so an exact-name lookup misses every one of
 * them (E490: the coherence audit read MDFCs as 0% inclusion and cut them).
 */
export function getByCardName<T>(index: ReadonlyMap<string, T>, name: string): T | undefined {
  const direct = index.get(name);
  if (direct !== undefined || !name.includes(' // ')) return direct;
  return index.get(frontFaceName(name));
}
