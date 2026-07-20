import crypto from 'crypto';

const MAX_BASE_LENGTH = 60;

/**
 * Base slug from a deck name: NFD-decompose + strip diacritics (mirrors
 * frontend/src/lib/normalize-search.ts's fold, e.g. "Jötun" -> "jotun"), drop
 * apostrophes so possessives read cleanly ("Urza's Saga" -> "urzas-saga"),
 * collapse every other run of non-alphanumerics to a single hyphen, then cap
 * length. Falls back to 'deck' when nothing alphanumeric survives (an
 * all-emoji/symbol name).
 */
function slugifyBase(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, ''); // a length-cap cut can land mid hyphen-run
  return base || 'deck';
}

/**
 * Public deck slug: `<kebab-name>-<8 lowercase hex>`. The random suffix (32
 * bits of entropy via crypto.randomBytes) is what makes the slug
 * collision-safe without a global uniqueness constraint on deck names, and is
 * what makes it safe to freeze forever once assigned (see
 * `deck_publications_slug_idx` / the frozen-slug decision in PLAN.md §A1).
 * Non-deterministic by design — two calls with the same name never match.
 */
export function generateDeckSlug(name: string): string {
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${slugifyBase(name)}-${suffix}`;
}
