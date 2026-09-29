import { DiscoverDeckRail } from '../DiscoverDeckRail';

/** Below this many fresh decks, the rail renders nothing rather than a
 *  near-empty grid on the marketing page a cold visitor and search crawlers
 *  land on — same ghost-town-proofing instinct as PublicProfilePage's
 *  GHOST_TOWN_THRESHOLD, applied to a rail's visibility instead of a stat
 *  line's. */
const MIN_DECKS_TO_SHOW = 3;

/** Stable, so the rail doesn't see a new query each render. */
const NEWEST = { sort: 'newest' } as const;

/**
 * "Fresh public decks" — the welcome storefront's first live rail (pass 2c):
 * the newest community decks. Renders nothing until at least
 * `MIN_DECKS_TO_SHOW` have loaded.
 *
 * `onVisibilityChange` reports whether the rail decided to show anything
 * (called once real data has resolved), so a caller can decide whether a
 * sibling rail is also worth mounting rather than stacking two half-empty
 * marketing sections (B1-06 — see WelcomePage's use of it with TrendingRail).
 */
export function FreshDecksRail({
  onVisibilityChange,
}: {
  onVisibilityChange?: (visible: boolean) => void;
} = {}) {
  return (
    <DiscoverDeckRail
      query={NEWEST}
      heading="Fresh public decks"
      viewAllTo="/decks/discover"
      listLabel="Recently published public decks"
      loadingLabel="Loading public decks…"
      minToShow={MIN_DECKS_TO_SHOW}
      onVisibilityChange={onVisibilityChange}
    />
  );
}
