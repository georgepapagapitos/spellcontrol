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

/**
 * Scryfall operator words eligible for the "space after colon" fix below.
 * Only a word from this list, sitting at a term boundary, gets collapsed —
 * so a bare colon inside a card name ("Circle of Protection: Red") is never
 * touched ("Protection" isn't an operator).
 */
const SCRYFALL_OPERATORS = new Set([
  't',
  'type',
  'o',
  'oracle',
  'c',
  'color',
  'colors',
  'id',
  'identity',
  'cmc',
  'mv',
  'manavalue',
  'f',
  'format',
  'kw',
  'keyword',
  'otag',
  'function',
  'art',
  'arttag',
  'atag',
  'is',
  'not',
  'e',
  'set',
  'edition',
  'r',
  'rarity',
  'pow',
  'power',
  'tou',
  'toughness',
  'name',
  'banned',
  'restricted',
  'year',
  'm',
  'mana',
]);

/**
 * Fix the mobile-keyboard space that breaks Scryfall operators: phone
 * keyboards insert a space after autocompleting/swiping a word, so a user
 * typing `t:vampire` ends up with `t: vampire` — which Scryfall reads as an
 * empty type filter plus a name word. This collapses ALL whitespace directly
 * after a known operator's colon down to none, when a term follows.
 *
 * Applied at query-consumption time (the Scryfall client / offline parser),
 * never while typing, so it doesn't fight the user's input field.
 *
 * Quote-aware by construction: text inside double quotes is copied verbatim
 * (`o:"draw a card"`, `name:"t: weird"` stay untouched), which is why this is
 * a character scanner rather than a regex over the whole string.
 */
export function normalizeScryfallQuery(q: string): string {
  let out = '';
  let i = 0;
  let inQuotes = false;
  while (i < q.length) {
    const ch = q[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      out += ch;
      i++;
      continue;
    }
    if (inQuotes) {
      out += ch;
      i++;
      continue;
    }
    // Operator words only count at a term boundary: start of string, or after
    // whitespace / an opening paren / the `-` negation prefix.
    const prev = out[out.length - 1];
    const atBoundary = out.length === 0 || /[\s(-]/.test(prev);
    if (atBoundary && /[a-zA-Z]/.test(ch)) {
      let j = i;
      while (j < q.length && /[a-zA-Z]/.test(q[j])) j++;
      const word = q.slice(i, j);
      if (q[j] === ':' && SCRYFALL_OPERATORS.has(word.toLowerCase())) {
        let k = j + 1;
        while (k < q.length && /\s/.test(q[k])) k++;
        // Collapse only when whitespace was present AND a term follows —
        // a trailing "t: " (nothing after) is left alone.
        if (k > j + 1 && k < q.length) {
          out += `${word}:`;
          i = k;
          continue;
        }
      }
      out += word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
