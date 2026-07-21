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
}

export interface HeroDeck {
  commanderName: string | null;
  updatedAt: number;
}

/** Epoch-day number for a `YYYY-MM-DD` key — increments once per calendar
 *  day, so indexing a pool by it rotates the pick daily with no hash needed. */
function epochDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function pickFrom(pool: readonly string[], day: string): string | null {
  return pool.length > 0 ? pool[epochDay(day) % pool.length] : null;
}

/**
 * The hero background's card, by name (art itself resolves via
 * `useCardThumb`). Preference order: the collection's highest-value owned
 * cards, else its most recently acquired, else the most recently updated
 * deck's commander — each tier a small pool rotated by day key so the same
 * card doesn't hold forever. `null` means show the brand fallback (a
 * brand-new collection with no cards and no decks).
 *
 * No `Date.now()` default here (unlike `home-signals.ts`'s
 * `upcomingGameNights`) — the day key is cheap for a caller to compute once
 * and callers that need determinism in a render already have it in hand.
 */
export function pickHeroCardName(
  cards: readonly HeroCollectionCard[],
  decks: readonly HeroDeck[],
  day: string = dayKey(Date.now())
): string | null {
  const priced = [...cards]
    .filter((c) => c.purchasePrice > 0)
    .sort((a, b) => b.purchasePrice - a.purchasePrice)
    .slice(0, POOL_LIMIT)
    .map((c) => c.name);
  if (priced.length > 0) return pickFrom(priced, day);

  const recent = [...cards]
    .sort((a, b) => b.acquiredAt - a.acquiredAt)
    .slice(0, POOL_LIMIT)
    .map((c) => c.name);
  if (recent.length > 0) return pickFrom(recent, day);

  const commanders = decks
    .filter((d): d is HeroDeck & { commanderName: string } => d.commanderName != null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, POOL_LIMIT)
    .map((d) => d.commanderName);
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
