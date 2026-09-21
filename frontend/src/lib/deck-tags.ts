// User-defined card tags (E171) — pure helpers shared by the deck list, the
// card menu, the card-preview tag editor, and the tag manager. Multi-tag,
// free-text, per-deck-scoped; see the `tags` doc on `DeckCard`
// (store/decks.ts) for the sticky-override contract this all builds on.
//
// There used to be a `suggestedTagForCard` here, offering the four ROLE_TITLES
// words as a ghost chip on an untouched card. It was dropped 2026-09-21 (E371):
// those four words are exactly what the Roles lens already partitions by and
// the role filter chips already filter by, so accepting suggestions rebuilt,
// one card at a time, a grouping that was one click away. What user tags are
// FOR is the grouping the app cannot derive ("Blink", "Combo", "Cut"), and the
// suggestion pointed away from it.
import type { DeckCard } from '../store/decks';

/** A card's current tags — `undefined` (never edited) reads the same as
 *  "no tags" everywhere except the sticky-override check below. */
export function cardTagsOf(dc: Pick<DeckCard, 'tags'>): string[] {
  return dc.tags ?? [];
}

/** True once a user has touched this slot's tags (including clearing them
 *  all) — the point past which the classifier's suggestion never returns. */
export function isTagsEdited(dc: Pick<DeckCard, 'tags'>): boolean {
  return dc.tags !== undefined;
}

/** Trim + collapse whitespace; empty after trimming means "not a tag". */
export function normalizeTagText(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
  return cleaned.length > 0 ? cleaned : null;
}

/** Add `tag` to `existing`, case-insensitively deduped, keeping the first
 *  casing used. Pure — returns a new array, or `existing` unchanged if the
 *  tag didn't normalize to anything or is already present. */
export function withTagAdded(existing: string[] | undefined, raw: string): string[] {
  const tag = normalizeTagText(raw);
  const current = existing ?? [];
  if (!tag || current.some((t) => t.toLowerCase() === tag.toLowerCase())) return current;
  return [...current, tag];
}

/** Remove `tag` (case-insensitive) from `existing`. Pure. */
export function withTagRemoved(existing: string[] | undefined, tag: string): string[] {
  const current = existing ?? [];
  return current.filter((t) => t.toLowerCase() !== tag.toLowerCase());
}

/** Every distinct tag across a deck's three zones, with how many slots carry
 *  it — the tag manager's "see all tags" list. Sorted alphabetically. Loosely
 *  typed (just needs `.tags`) so it accepts both the persisted `DeckCard[]`
 *  and the display layer's slimmer `DeckDisplayCard[]`. */
export function collectDeckTags(zones: {
  cards: Array<Pick<DeckCard, 'tags'>>;
  sideboard?: Array<Pick<DeckCard, 'tags'>>;
  considering?: Array<Pick<DeckCard, 'tags'>>;
}): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of [...zones.cards, ...(zones.sideboard ?? []), ...(zones.considering ?? [])]) {
    for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
