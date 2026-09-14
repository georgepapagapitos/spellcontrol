/**
 * Server-side per-printing release-date lookup for shared-binder projections —
 * the mirror of the frontend's `lib/card-release-dates.ts`, exactly as
 * `card-sld-drops.ts` mirrors its Secret Lair drop decoration.
 *
 * A binder sorted by Release date dates each printing individually
 * (`EnrichedCard.releasedAt`, stamped on just before materializing — never
 * persisted). Without this, the shared view of that binder would date every
 * card from its SET while the owner's view dates it per printing, so the two
 * would show different orders — the same owner/viewer divergence the drop
 * decoration exists to prevent.
 *
 * No snapshot file needed, unlike the drop map: the date is already in the
 * SQLite card cache, which the nightly `default_cards` ingest restamps for
 * every printing. A printing the cache doesn't hold keeps today's set/drop
 * fallback rather than erroring, and `allowStale` is deliberate — a release
 * date is immutable, so the price TTL is meaningless for it.
 */
import type { EnrichedCard } from '@spellcontrol/binder-routing';
import { getScryfallCache } from '../scryfall-cache';

/** Cheap walk of raw binder JSONB: does any binder sort by release date? */
export function anyBinderUsesReleaseDateSort(bindersRaw: unknown): boolean {
  if (!Array.isArray(bindersRaw)) return false;
  return bindersRaw.some((b) => {
    const sorts = (b as { sorts?: unknown })?.sorts;
    return (
      Array.isArray(sorts) &&
      sorts.some((s) => (s as { field?: unknown })?.field === 'setReleaseDate')
    );
  });
}

/** Stamp `releasedAt` onto cards the cache has a date for (copies only those). */
export function decorateCardsWithReleaseDates(cards: EnrichedCard[]): EnrichedCard[] {
  const ids = [...new Set(cards.map((c) => c.scryfallId).filter((id): id is string => !!id))];
  if (ids.length === 0) return cards;
  let cached;
  try {
    cached = getScryfallCache().getMany(ids, true);
  } catch {
    // No cache DB (dev/test) — cards keep their set/drop date. Not an error.
    return cards;
  }
  return cards.map((c) => {
    const date = c.scryfallId ? cached.get(c.scryfallId)?.released_at : undefined;
    return date ? { ...c, releasedAt: date } : c;
  });
}
