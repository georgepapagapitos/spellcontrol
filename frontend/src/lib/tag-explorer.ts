/**
 * Pure helpers behind the tag explorer (`/tags`) — searching the oracle-tag
 * corpus and turning a tag selection into a Scryfall query.
 *
 * Kept separate from `card-tags.ts` (which owns loading the snapshot) so this
 * logic is testable against a fixture: the real corpus lives in
 * `public/otag-index.json`, a regenerated asset no test may read.
 */
import type { TagCount } from './card-tags';

/** How the query matched a tag, best tier first. Drives result ordering. */
const MatchTier = {
  Exact: 0,
  Prefix: 1,
  WordStart: 2,
  Substring: 3,
  None: 4,
} as const;
type MatchTier = (typeof MatchTier)[keyof typeof MatchTier];

/** Users type "mana rock"; corpus slugs are kebab. Normalize both sides. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-');
}

function tierFor(slug: string, needle: string): MatchTier {
  if (slug === needle) return MatchTier.Exact;
  if (slug.startsWith(needle)) return MatchTier.Prefix;
  // A hyphen is this vocabulary's word break — `-rock` matches "mana-rock"
  // mid-slug without also matching an arbitrary infix.
  if (slug.includes(`-${needle}`)) return MatchTier.WordStart;
  if (slug.includes(needle)) return MatchTier.Substring;
  return MatchTier.None;
}

/**
 * Tags matching `query`, best match first and most-used first within a tier.
 * An empty query returns the corpus as given (already count-ordered).
 *
 * `tags` is assumed pre-sorted by count desc — the sort below is stable, so
 * that ordering survives as the within-tier tiebreak.
 */
export function searchTags(tags: TagCount[], query: string, limit: number): TagCount[] {
  const needle = normalize(query);
  if (!needle) return tags.slice(0, limit);
  const scored: { tag: TagCount; tier: MatchTier }[] = [];
  for (const tag of tags) {
    const tier = tierFor(tag.slug, needle);
    if (tier !== MatchTier.None) scored.push({ tag, tier });
  }
  return scored
    .sort((a, b) => a.tier - b.tier)
    .slice(0, limit)
    .map((s) => s.tag);
}

/**
 * Scryfall query for a tag selection — an intersection, so adding a tag always
 * narrows. Empty selection yields '' (callers skip the search entirely).
 */
export function tagsToQuery(slugs: string[]): string {
  return slugs.map((slug) => `otag:${slug}`).join(' ');
}

/** Parse the `?t=` param — comma-separated slugs, deduped, junk dropped. */
export function parseTagParam(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const slug = normalize(part);
    if (/^[a-z0-9-]+$/.test(slug)) seen.add(slug);
  }
  return [...seen];
}
