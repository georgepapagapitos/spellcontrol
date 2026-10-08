import { useQueryLookup } from './keyword-glossary';

/**
 * Glossary terms for card search. `public/rules-glossary.json` is derived
 * from the Comprehensive Rules by scripts/keyword-glossary.mjs: every glossary
 * term that is not a keyword ("Priority", "Stack", "Mana Value"), with its
 * definition and the rule it points to. About 20 KB gzipped, fetched only by
 * Search, so a lookup never needs the ~1 MB rules bundle.
 */
export interface GlossaryTerm {
  term: string;
  /** The first rule the definition points to; a few terms point nowhere. */
  rule?: string;
  text: string;
}

interface TermsFile {
  meta: { effective: string };
  terms: GlossaryTerm[];
}

export const RULES_GLOSSARY_URL = '/rules-glossary.json';

/** Lowercase, straight apostrophes, single spaces, and no leading "the" ("the stack" is Stack). */
const normTerm = (s: string) =>
  s.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim().replace(/^the /, '');

/** A query names a term only when it IS the term, as a keyword lookup does. */
export function buildTermLookup(terms: GlossaryTerm[]): (query: string) => GlossaryTerm | null {
  const byTerm = new Map(terms.map((t) => [normTerm(t.term), t]));
  return (query) => {
    const q = normTerm(query);
    return q.length < 3 ? null : (byTerm.get(q) ?? null);
  };
}

let cache: Promise<(query: string) => GlossaryTerm | null> | null = null;

/** Fetch the terms once and build their lookup. A failed load is retried on the next call. */
export function loadTermLookup(): Promise<(query: string) => GlossaryTerm | null> {
  if (!cache) {
    cache = fetch(RULES_GLOSSARY_URL)
      .then((r) => {
        if (!r.ok) throw new Error("Couldn't load the rules glossary.");
        return r.json() as Promise<TermsFile>;
      })
      .then((file) => buildTermLookup(file.terms));
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

/** The glossary term a search query names; `undefined` while loading. Pass '' to skip the lookup. */
export function useTermLookup(query: string): GlossaryTerm | null | undefined {
  return useQueryLookup(query, loadTermLookup);
}
