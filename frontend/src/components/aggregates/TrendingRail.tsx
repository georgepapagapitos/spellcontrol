import './TrendingRail.css';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../../lib/api-base';
import { useCardThumb } from '../../lib/card-thumbs';
import { EmptyStateMark } from '../shared/EmptyStateMark';

import { userMessage } from '@/lib/user-error';
import { Button } from '@/components/shared/Button';
interface RisingCommander {
  commanderKey: string;
  commanderName: string;
  partnerName: string | null;
  deckCount: number;
  newLast7d: number;
}

export interface TopCopiedDeck {
  deckId: string;
  slug: string;
  deckName: string;
  commanderName: string | null;
  partnerName: string | null;
  score: number;
}

interface TrendingData {
  risingCommanders: RisingCommander[];
  topCopiedDecks?: TopCopiedDeck[];
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** Self-fetching hook for the trending rail, mirroring `useGameNights(enabled)`'s
 *  exact {data, loading, error, refresh} contract (GameNights.tsx:57-82) --
 *  deliberately its own inline fetch rather than a shared aggregates client
 *  (see TrendingRail's own file-disjointness note below). */
function useTrendingRail(enabled: boolean) {
  const [data, setData] = useState<TrendingData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    return fetch(apiUrl('/api/aggregates/trending'), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, "Couldn't load trending decks."));
        return (await res.json()) as TrendingData;
      })
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(userMessage(err, "Couldn't load trending decks."));
      })
      .finally(() => setLoading(false));
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

/** Borrows CommanderResultCard's exact CSS classes (visually identical) but
 *  is a real `<Link>` to `/decks/new`, never a `<button onClick>` -- a click
 *  handler here would give up cmd/ctrl-click, middle-click, and
 *  right-click-open-in-new-tab, none of which are worth threading an
 *  `href`/`as` prop through that shared, four-call-site component for one
 *  new consumer. `/decks/new` has no commander-prefill contract anywhere in
 *  the app today, so the copy never claims one -- it names the commander
 *  being displayed, and the aria-label states the real behavior. */
function TrendingCommanderTile({
  commanderName,
  deckCount,
}: {
  commanderName: string;
  deckCount: number;
}) {
  // The art box is 2.6rem wide (deck-builder-commander.css); Scryfall's
  // `small` (146px) covers it at 3x, where `normal` was ~100 KB per tile.
  const art = useCardThumb(commanderName, 'small');
  return (
    <Link
      to="/decks/new"
      className="commander-result-card"
      aria-label={`Build a deck with ${commanderName}`}
    >
      <span className="commander-result-art" aria-hidden>
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="commander-result-art-skeleton" />
        )}
      </span>
      <span className="commander-result-body">
        <span className="commander-result-headline">
          <span className="commander-result-name">Build with {commanderName}</span>
          <span className="trending-deck-count" aria-hidden>
            {deckCount}
          </span>
        </span>
      </span>
    </Link>
  );
}

/** Real `<Link to="/d/:slug">` to an existing published deck -- no raw
 *  `score` is ever rendered (it's an internal ranking key). Accessible name
 *  is left to the link's own visible text content (deck name + commander),
 *  which already conveys "view deck" via the `<Link>`'s default semantics. */
function TrendingDeckTile({ deck }: { deck: TopCopiedDeck }) {
  const art = useCardThumb(deck.commanderName ?? undefined, 'small');
  const commanderLine = deck.commanderName
    ? deck.partnerName
      ? `${deck.commanderName} + ${deck.partnerName}`
      : deck.commanderName
    : null;
  return (
    <Link to={`/d/${deck.slug}`} className="commander-result-card">
      <span className="commander-result-art" aria-hidden>
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="commander-result-art-skeleton" />
        )}
      </span>
      <span className="commander-result-body">
        <span className="commander-result-headline">
          <span className="commander-result-name">{deck.deckName}</span>
        </span>
        {commanderLine && <span className="commander-result-type">{commanderLine}</span>}
      </span>
    </Link>
  );
}

function TrendingTileSkeleton() {
  return (
    <li className="trending-tile-skeleton">
      <span className="commander-result-art-skeleton trending-tile-skeleton-art" />
      <span className="trending-tile-skeleton-body">
        <span className="deck-analysis-skeleton-bar is-headline" />
        <span className="deck-analysis-skeleton-bar is-body is-short" />
      </span>
    </li>
  );
}

/** A loaded section shows up to this many tiles. */
export const TRENDING_SECTION_MAX = 10;

/**
 * The skeleton reserves the height the rail had LAST time it loaded, so
 * the browse grid beneath does not move when data lands. A fixed four-tile
 * skeleton reserved less than half the loaded rail and the grid jumped
 * ~200px — a 0.07 layout shift measured on /decks/discover (2026-09-09);
 * a fixed ten-tile one would over-reserve wherever nothing is trending
 * yet and the grid would jump UP instead. The loaded shape is one number
 * (the longer section's tile count) kept per browser; a first visit
 * assumes a full section, the common shape in production.
 */
const SHAPE_KEY = 'sc-trending-shape';

export function readTrendingShape(): number {
  try {
    const raw = localStorage.getItem(SHAPE_KEY);
    if (raw === null) return TRENDING_SECTION_MAX;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? Math.min(n, TRENDING_SECTION_MAX) : TRENDING_SECTION_MAX;
  } catch {
    return TRENDING_SECTION_MAX;
  }
}

function rememberTrendingShape(tiles: number): void {
  try {
    localStorage.setItem(SHAPE_KEY, String(tiles));
  } catch {
    // Storage denied: the next visit reserves the default and that's fine.
  }
}

function TrendingSkeletonSection({ heading, tiles }: { heading: string; tiles: number }) {
  return (
    <div className="trending-rail-section">
      <h3 className="deck-combos-title trending-rail-section-title">{heading}</h3>
      <ul className="commander-result-grid">
        {Array.from({ length: tiles }, (_, i) => (
          <TrendingTileSkeleton key={i} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Trending rail (social program W4, w4-trending) -- mounted into Discover
 * above the browse grid. Two independently-gating sub-sections read off one
 * `GET /api/aggregates/trending` fetch: "Rising commanders"
 * (`risingCommanders`, from w4-aggregates-backend) and "Most copied decks"
 * (`topCopiedDecks`, this PR's own decayed snapshot ranking). Feature-detects
 * `topCopiedDecks` via `'topCopiedDecks' in data` rather than an empty array,
 * matching the backend's additive-field contract for that key.
 *
 * `enabled` is a real prop (parity with the established `useGameNights(enabled)`
 * pattern) -- the real call site below passes `enabled={true}` unconditionally;
 * nothing here blocks initial paint on it.
 */
export function TrendingRail({
  enabled,
  compactWhenEmpty = false,
}: {
  enabled: boolean;
  /** When the page's own primary content is also empty, a second full
   *  illustrated empty state here would stack two brand marks bracketing
   *  the toolbar. Pass true to fall back to a single muted line instead —
   *  the page-level empty state stays the one brand moment per screen. */
  compactWhenEmpty?: boolean;
}) {
  const { data, loading, error, refresh } = useTrendingRail(enabled);
  const [reserve] = useState(readTrendingShape);
  useEffect(() => {
    if (!data) return;
    rememberTrendingShape(
      Math.min(
        TRENDING_SECTION_MAX,
        Math.max(data.risingCommanders.length, data.topCopiedDecks?.length ?? 0)
      )
    );
  }, [data]);

  if (loading) {
    // A remembered empty rail reserves nothing: the loaded state is one
    // muted line or an empty-state card, neither of which a tile grid
    // would approximate.
    if (reserve === 0) return null;
    return (
      <section aria-labelledby="trending-rail-heading" className="trending-rail">
        <h2 id="trending-rail-heading" className="deck-combos-title">
          Trending
        </h2>
        <p role="status" aria-live="polite" className="sr-only">
          Loading trending decks
        </p>
        {/* One section, not two: the bento puts a second one beside the
            first on wide boards (same height) but BELOW it on phones, where
            a rail that usually loads one section would then shrink by a
            whole section's height. One section is the common loaded shape
            on every width. */}
        <div className="deck-bento trending-rail-grid" aria-hidden="true">
          <TrendingSkeletonSection heading="Rising commanders" tiles={reserve} />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section aria-labelledby="trending-rail-heading" className="trending-rail">
        <h2 id="trending-rail-heading" className="deck-combos-title">
          Trending
        </h2>
        <div className="empty-state">
          <p className="empty-state-tagline">Couldn't load trending decks right now.</p>
          <p className="empty-state-hint">Check your connection and try again.</p>
          <div className="empty-state-actions">
            <Button onClick={() => void refresh()} className="trending-rail-retry-btn">
              Retry
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // enabled=false -- never fetched, nothing to show yet.
  if (!data) return null;

  const rising = data.risingCommanders.slice(0, TRENDING_SECTION_MAX);
  const topCopied = ('topCopiedDecks' in data ? (data.topCopiedDecks ?? []) : []).slice(
    0,
    TRENDING_SECTION_MAX
  );
  const hasTopCopied = topCopied.length > 0;

  if (rising.length === 0 && !hasTopCopied) {
    if (compactWhenEmpty) {
      return <p className="trending-rail-compact-empty">Nothing trending yet.</p>;
    }
    return (
      <section aria-labelledby="trending-rail-heading" className="trending-rail">
        <h2 id="trending-rail-heading" className="deck-combos-title">
          Trending
        </h2>
        <div className="empty-state">
          <EmptyStateMark />
          <p className="empty-state-tagline">Nothing trending yet.</p>
          <p className="empty-state-hint">Publish a deck to be the first commander on the board.</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="trending-rail-heading" className="trending-rail">
      <h2 id="trending-rail-heading" className="deck-combos-title">
        Trending
      </h2>
      <div className="deck-bento trending-rail-grid">
        {rising.length > 0 && (
          <div className="trending-rail-section">
            <h3
              id="trending-rising-heading"
              className="deck-combos-title trending-rail-section-title"
            >
              Rising commanders
            </h3>
            <ul className="commander-result-grid" aria-labelledby="trending-rising-heading">
              {rising.map((c) => (
                <li key={c.commanderKey}>
                  <TrendingCommanderTile commanderName={c.commanderName} deckCount={c.deckCount} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {hasTopCopied && (
          <div className="trending-rail-section">
            <h3
              id="trending-copied-heading"
              className="deck-combos-title trending-rail-section-title"
            >
              Most copied decks
            </h3>
            <ul className="commander-result-grid" aria-labelledby="trending-copied-heading">
              {topCopied.map((deck) => (
                <li key={deck.deckId}>
                  <TrendingDeckTile deck={deck} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
