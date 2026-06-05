/**
 * Shared name-normalizer for every client-side card search surface.
 *
 * Card names are full of punctuation and accents that users don't type:
 * "Mr. House, President and CEO", "Urza's Saga", "Jötun Grunt", "Ratonhnhaké:ton".
 * Searching "mr house" should match "Mr. House"; "urzas saga" should match
 * "Urza's Saga"; "jotun" should match "Jötun". We fold both the query and the
 * candidate name into a comparable form so those punctuation/diacritic/spacing
 * differences stop causing misses.
 *
 * Folding rules:
 *  - NFD decompose + strip combining marks, so "ö" -> "o", "é" -> "e".
 *  - lowercase.
 *  - drop apostrophes outright so possessives collapse ("Urza's" -> "urzas",
 *    matching a typed "urzas").
 *  - turn every other run of non-alphanumeric characters (periods, commas,
 *    dashes, colons, the "//" DFC separator, whitespace) into a single space.
 *  - trim.
 *
 * Fold-only: it never mutates stored names, it's purely for comparison. Keep it
 * cheap — it runs per-card per-keystroke on collections of thousands of cards.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks (ö -> o)
    .toLowerCase()
    .replace(/['’]/g, '') // drop straight + curly apostrophes ("Urza's" -> "urzas")
    .replace(/[^a-z0-9]+/g, ' ') // any other punctuation / whitespace -> one space
    .trim();
}

/**
 * Punctuation-agnostic substring match of a search query against a card name.
 * An empty (or whitespace/punctuation-only) query matches everything, mirroring
 * the "no filter" behavior the call sites already guard for.
 *
 * For hot loops, prefer pre-normalizing the query once and comparing against
 * `normalizeForSearch(name)` directly rather than calling this per row.
 */
export function matchesSearch(name: string, query: string): boolean {
  return normalizeForSearch(name).includes(normalizeForSearch(query));
}
