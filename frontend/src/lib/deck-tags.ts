// User-defined card tags (E171) — pure helpers shared by the deck list, the
// card-preview tag editor, and the tag manager. Multi-tag, free-text,
// per-deck-scoped; see the `tags` doc on `DeckCard` (store/decks.ts) for the
// sticky-override contract this all builds on.
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';
import { classifyCardCategory } from '@/deck-builder/services/deckBuilder/categorize';
import { ROLE_TITLES } from './role-badges';
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

// Only the generator's functional-role buckets make a useful suggested tag —
// 'lands'/'creatures' are already obvious from the type line, and
// 'synergy'/'utility' are catch-alls with nothing specific to suggest.
const SUGGESTABLE_LABELS: Partial<Record<DeckCategory, string>> = {
  ramp: ROLE_TITLES.ramp,
  cardDraw: ROLE_TITLES.cardDraw,
  singleRemoval: ROLE_TITLES.removal,
  boardWipes: ROLE_TITLES.boardwipe,
};

/**
 * A live, never-persisted tag suggestion for an untouched card — derived
 * from `classifyCardCategory` (display-only by design, see its own doc
 * comment; this reads it, never mutates it). Returns null once the slot has
 * ANY user tags (edited or not is the caller's job to check via
 * `isTagsEdited` — this function only answers "what would we suggest").
 */
export function suggestedTagForCard(card: ScryfallCard): string | null {
  return SUGGESTABLE_LABELS[classifyCardCategory(card)] ?? null;
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
