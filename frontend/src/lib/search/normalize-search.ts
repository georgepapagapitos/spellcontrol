/**
 * Re-export shim — the name-fold now lives in the isomorphic
 * `@spellcontrol/binder-routing` package (single source of truth, shared with
 * the binder rule engine's `nameContains` matching and the backend's
 * shared-binder projections). Import paths stay stable.
 *
 * `normalizeScryfallQuery` below stays client-side: it's a search-input repair
 * for the Scryfall query language, not part of the routing engine's contract.
 */
export { normalizeForSearch, matchesSearch } from '@spellcontrol/binder-routing';

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
 * empty type filter plus a name word. This collapses ALL whitespace around a
 * known operator's separator — `:` and the comparison forms (`>=`, `<=`,
 * `!=`, `>`, `<`, `=`), so `mv >= 3` becomes `mv>=3` — when a term follows.
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
      if (SCRYFALL_OPERATORS.has(word.toLowerCase())) {
        // The separator may itself be preceded by keyboard spaces ("mv >= 3").
        let opStart = j;
        while (opStart < q.length && /\s/.test(q[opStart])) opStart++;
        let op = '';
        if (q[opStart] === ':') op = ':';
        else if (/^(>=|<=|!=)/.test(q.slice(opStart, opStart + 2)))
          op = q.slice(opStart, opStart + 2);
        else if (/[<>=]/.test(q[opStart] ?? '')) op = q[opStart];
        if (op) {
          let k = opStart + op.length;
          while (k < q.length && /\s/.test(q[k])) k++;
          // Collapse only when whitespace was present AND a term follows —
          // a trailing "t: " (nothing after) is left alone.
          if (k > j + op.length && k < q.length) {
            out += `${word}${op}`;
            i = k;
            continue;
          }
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
