import './TrendingRail.css';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../../lib/api-base';
import { useCardThumb } from '../../lib/card-thumbs';

import { userMessage } from '@/lib/user-error';
import { Button } from '@/components/shared/Button';
interface RisingCommander {
  commanderKey: string;
  commanderName: string;
  partnerName: string | null;
  deckCount: number;
  newLast7d: number;
}

/** A deck other players liked, saved or copied this week (backend
 *  aggregates/trending-decks.ts). `players` is how many distinct accounts. */
export interface TrendingDeck {
  slug: string;
  deckName: string;
  commanderName: string | null;
  players: number;
}

interface TrendingData {
  risingCommanders: RisingCommander[];
  /** Absent from an API older than this client; read it as empty. */
  trendingDecks?: TrendingDeck[];
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

/** Real `<Link to="/d/:slug">` to an existing published deck. Its accessible
 *  name is its own text: deck name, how many players, commander. The chip
 *  mirrors the commander tile's bare-number chip beside it, with the full
 *  phrase for screen readers and on hover. */
function TrendingDeckTile({ deck }: { deck: TrendingDeck }) {
  const art = useCardThumb(deck.commanderName ?? undefined, 'small');
  const playersLabel = `${deck.players} players this week`;
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
          <span className="trending-deck-count" title={playersLabel}>
            <span aria-hidden>{deck.players}</span>
            <span className="sr-only">{playersLabel}</span>
          </span>
        </span>
        {deck.commanderName && <span className="commander-result-type">{deck.commanderName}</span>}
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
 * Trending rail (social program W4) -- mounted into Discover above the
 * browse grid. Two independently-gating sub-sections read off one
 * `GET /api/aggregates/trending` fetch: "Rising commanders" (commanders
 * several different authors built this week) and "Popular this week" (decks
 * several different players liked, saved or copied). Both lists stay empty
 * until more than one person is behind them, and an empty rail renders
 * nothing: the browse grid below is the page's content, and a "nothing
 * trending" card above it would only push that down.
 *
 * `enabled` is a real prop (parity with the established `useGameNights(enabled)`
 * pattern) -- the real call site below passes `enabled={true}` unconditionally;
 * nothing here blocks initial paint on it.
 */
export function TrendingRail({ enabled }: { enabled: boolean }) {
  const { data, loading, error, refresh } = useTrendingRail(enabled);
  const [reserve] = useState(readTrendingShape);
  useEffect(() => {
    if (!data) return;
    rememberTrendingShape(
      Math.min(
        TRENDING_SECTION_MAX,
        Math.max(data.risingCommanders.length, data.trendingDecks?.length ?? 0)
      )
    );
  }, [data]);

  if (loading) {
    // A remembered empty rail reserves nothing: an empty rail renders nothing.
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
  const popular = (data.trendingDecks ?? []).slice(0, TRENDING_SECTION_MAX);

  if (rising.length === 0 && popular.length === 0) return null;

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
        {popular.length > 0 && (
          <div className="trending-rail-section">
            <h3
              id="trending-popular-heading"
              className="deck-combos-title trending-rail-section-title"
            >
              Popular this week
            </h3>
            <ul className="commander-result-grid" aria-labelledby="trending-popular-heading">
              {popular.map((deck) => (
                <li key={deck.slug}>
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
