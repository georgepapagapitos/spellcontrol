/**
 * Name-normalizer for card search — zero-dependency copy for the binder-routing package.
 *
 * Mirrors frontend/src/lib/normalize-search.ts exactly so the engine's
 * nameContains matching uses the same folding rules as the collection predicate.
 * (Dedup into a single source is deferred to PR-2 when the import path is
 * stabilised.)
 *
 * Folding rules:
 *  - NFD decompose + strip combining diacritical marks (ö→o, é→e).
 *  - lowercase.
 *  - drop apostrophes (Urza's → urzas).
 *  - turn every other run of non-alphanumeric characters into a single space.
 *  - trim.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/['']/g, '') // drop straight + curly apostrophes
    .replace(/[^a-z0-9]+/g, ' ') // any other punctuation / whitespace -> one space
    .trim();
}
