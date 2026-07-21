/**
 * Pure helper for WelcomePage's hero art (welcome storefront, pass 2c).
 * Guests have no collection to draw hero art from (unlike `home-hero.ts`'s
 * collection-backed `pickHeroCardName`), so this rotates a small hardcoded
 * pool of iconic, broadly-known Commander staples instead — same day-key
 * rotation idiom, reusing `home-hero.ts`'s own `epochDay` rather than
 * re-deriving it.
 */
import { dayKey } from './value-history';
import { epochDay } from './home-hero';

/** Iconic, evergreen EDH staples with striking, recognizable art — chosen so
 *  a guest with zero collection data still gets a hero that looks like the
 *  game, not a placeholder. Exact Scryfall spellings; the first three are
 *  cross-checked against this repo's own fixtures (TrendingRail.test.tsx,
 *  DiscoverDeckTile.test.tsx) since a typo here would silently fail to
 *  resolve art via useCardThumb. */
export const EVERGREEN_COMMANDERS = [
  "Atraxa, Praetors' Voice",
  'Krenko, Mob Boss',
  'Meren of Clan Nel Toth',
  'The Ur-Dragon',
  'Edgar Markov',
  'Muldrotha, the Gravetide',
  'Miirym, Sentinel Wyrm',
] as const;

/**
 * Today's hero card name — deterministic per day, rotating across the pool
 * so the same card doesn't hold forever. `day` defaults to today's key; a
 * render-body caller should let the default do the `Date.now()` read rather
 * than compute it separately (mirrors `heroGreeting()`'s own no-arg call in
 * HomeHero.tsx).
 */
export function pickWelcomeHeroCard(day: string = dayKey(Date.now())): string {
  return EVERGREEN_COMMANDERS[epochDay(day) % EVERGREEN_COMMANDERS.length];
}
