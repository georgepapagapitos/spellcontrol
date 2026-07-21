/**
 * Pure helpers for the /home hero band (social program pass 2b — "your
 * collection is the hero"). Store-free like `home-signals.ts`, so both stay
 * cheap to unit-test: the component reads the stores and passes plain data
 * in.
 */
import { dayKey } from './value-history';

/** A pool this small is plenty of rotation without the hero going stale on
 *  a collection with hundreds of priced cards — mirrors the FAN_LIMIT/
 *  DISPLAY_LIMIT caps other home cards already use. */
const POOL_LIMIT = 5;

export interface HeroCollectionCard {
  name: string;
  purchasePrice: number;
  /** Epoch ms this copy was acquired — import time, or last-edited as a
   *  fallback. Mirrors home-signals.ts's own (private) acquiredAt derivation. */
  acquiredAt: number;
  /** Art-crop URL of the OWNED printing (derived from the row's stored
   *  imageNormal via scryfallArtCrop, the binder-cover idiom). Absent when
   *  the row has no stored image — the component then falls back to
   *  name-resolution, which returns Scryfall's default printing. */
  art?: string;
}

export interface HeroDeck {
  commanderName: string | null;
  updatedAt: number;
  /** Art-crop URL of the deck's actual commander printing, when in hand. */
  art?: string;
}

/** Which tier won the pick — the caption states this so the choice reads as
 *  curated, not random ("why THIS card?" was a real user reaction). */
export type HeroPickReason = 'top' | 'recent' | 'commander';

/** A resolved hero pick: the card's name (caption + name-resolution
 *  fallback), the owned printing's art URL when the caller had it, and the
 *  reason its tier won. */
export interface HeroPick {
  name: string;
  art?: string;
  reason: HeroPickReason;
}

/** Epoch-day number for a `YYYY-MM-DD` key — increments once per calendar
 *  day, so indexing a pool by it rotates the pick daily with no hash needed.
 *  Exported for `welcome-hero.ts`'s own day-key rotation, which reuses this
 *  exact idiom over a hardcoded pool instead of a collection-derived one. */
export function epochDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function pickFrom(pool: readonly HeroPick[], day: string): HeroPick | null {
  return pool.length > 0 ? pool[epochDay(day) % pool.length] : null;
}

/**
 * The hero background's card. Preference order: the collection's
 * highest-value owned cards, else its most recently acquired, else the most
 * recently updated deck's commander — each tier a small pool rotated by day
 * key so the same card doesn't hold forever. The pick carries the owned
 * printing's art URL when the caller supplied one (YOUR copy, not a
 * name-resolved default printing); `useCardThumb` is only the fallback for
 * rows with no stored image. `null` means show the brand fallback (a
 * brand-new collection with no cards and no decks).
 *
 * No `Date.now()` default here (unlike `home-signals.ts`'s
 * `upcomingGameNights`) — the day key is cheap for a caller to compute once
 * and callers that need determinism in a render already have it in hand.
 */
export function pickHeroCard(
  cards: readonly HeroCollectionCard[],
  decks: readonly HeroDeck[],
  day: string = dayKey(Date.now())
): HeroPick | null {
  const priced = [...cards]
    .filter((c) => c.purchasePrice > 0)
    .sort((a, b) => b.purchasePrice - a.purchasePrice)
    .slice(0, POOL_LIMIT)
    .map((c) => ({ name: c.name, art: c.art, reason: 'top' as const }));
  if (priced.length > 0) return pickFrom(priced, day);

  const recent = [...cards]
    .sort((a, b) => b.acquiredAt - a.acquiredAt)
    .slice(0, POOL_LIMIT)
    .map((c) => ({ name: c.name, art: c.art, reason: 'recent' as const }));
  if (recent.length > 0) return pickFrom(recent, day);

  const commanders = decks
    .filter((d): d is HeroDeck & { commanderName: string } => d.commanderName != null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, POOL_LIMIT)
    .map((d) => ({ name: d.commanderName, art: d.art, reason: 'commander' as const }));
  return pickFrom(commanders, day);
}

/** Time-of-day greeting. Takes the hour so the render body never calls
 *  `Date.now()`/`new Date()` directly (react-hooks/purity) — mirrors
 *  `home-signals.ts`'s `upcomingGameNights(nights, now = Date.now())`. */
export function heroGreeting(hour: number = new Date().getHours()): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}
