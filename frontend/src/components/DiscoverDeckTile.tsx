import './DiscoverDeckTile.css';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { ColorPip } from './shared/ManaSymbol';
import { MeterBar } from './shared/MeterBar';
import { UserAvatar } from './UserAvatar';
import { useCardThumb } from '../lib/card-thumbs';
import { formatMoney } from '../lib/format-money';
import { formatSocialCount } from '../lib/social-proof';
import { formatRelativeTime } from '../lib/format-time';
import { formatIdentity } from '../lib/display-name';
import { DECK_FORMAT_CONFIGS } from '../deck-builder/lib/constants/archetypes';
import { bracketLabel } from '../deck-builder/services/deckBuilder/bracketEstimator';
import { LikeButton } from './LikeButton';
import { BookmarkButton } from './BookmarkButton';
import type { DeckFormat } from '../deck-builder/types';
import type { DiscoverDeck } from '../lib/discover-client';

export type DiscoverTileView = 'grid' | 'list';

function formatLabel(format: string): string {
  return DECK_FORMAT_CONFIGS[format as DeckFormat]?.label ?? format;
}

/** List view's in-body stats line — unchanged from the pre-art-banner tile
 *  (list keeps its current compact-row design; only grid became an art-
 *  banner tile). Price/views/copies/likes, each individually thresholded. */
function socialLine(deck: DiscoverDeck): string | null {
  const views = formatSocialCount(deck.viewCount);
  const copies = formatSocialCount(deck.copyCount);
  const likes = formatSocialCount(deck.likeCount);
  const parts = [
    views && `${views} views`,
    copies && `${copies} copies`,
    likes && `${likes} likes`,
  ].filter((s): s is string => s != null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Grid banner's on-art overlay line — views/copies (thresholded exactly like
 * `socialLine`) plus recency, which has no floor (a publish date is never
 * "noise", unlike a single-digit view count). Likes are dropped here:
 * LikeButton already carries that state via its own aria-pressed heart, so
 * the banner spends its one line on recency instead of repeating a count
 * that's shown nowhere else as a number anyway (LikeButton itself never
 * renders one). Never empty — `formatRelativeTime` always returns something.
 */
function bannerStatsLine(deck: DiscoverDeck): string {
  const views = formatSocialCount(deck.viewCount);
  const copies = formatSocialCount(deck.copyCount);
  const parts = [views && `${views} views`, copies && `${copies} copies`].filter(
    (s): s is string => s != null
  );
  parts.push(formatRelativeTime(deck.publishedAt));
  return parts.join(' · ');
}

function tileAriaLabel(
  deck: DiscoverDeck,
  social: string | null,
  buildablePercent: number | null
): string {
  const parts = [deck.name, formatLabel(deck.format)];
  if (deck.bracket != null) parts.push(bracketLabel(deck.bracket));
  if (deck.colorIdentity.length > 0) parts.push(deck.colorIdentity.join(''));
  parts.push(formatMoney(deck.estimatedValueUsd, { currency: 'USD' }));
  if (social) parts.push(social);
  if (buildablePercent != null) parts.push(`${buildablePercent}% buildable from your collection`);
  return parts.join(', ');
}

interface Props {
  deck: DiscoverDeck;
  view: DiscoverTileView;
  /** Percent of the deck's distinct cards the viewer already owns — null
   *  when the viewer is a guest or has an empty collection (no meter). */
  buildablePercent?: number | null;
  /** Fired after a confirmed unbookmark (w2-likes-bookmarks). SavedDecksPage
   *  passes this to splice the tile out of its list immediately; Discover
   *  leaves it undefined — a like/bookmark there never removes the tile. */
  onUnsaved?: (slug: string) => void;
}

/**
 * One public-deck tile — the real `DecksIndexPage`/`PublicProfilePage`
 * card precedent (`.decks-index-card` family), not the invented
 * stretched-link mechanic: `position: relative` on the `<li>`, an in-flow
 * `<Link>` wrapping the tile's real visible content (art/name/badges/
 * pips/stats), and the owner attribution as a genuinely separate sibling
 * `<Link>` — never nested inside the first (nesting `<a>` inside `<a>` is
 * invalid HTML and would double-fire navigation). The Like/Bookmark corner
 * actions (w2-likes-bookmarks) are a third sibling for the same reason, and
 * the buildable/value footer (tile system v2) a fourth, so the visual stack
 * (banner → colorbar → name/chips → owner → footer) can render bottom-to-top
 * in DOM order with zero JS reordering.
 *
 * `view` drives the parent `<ul>`'s `is-grid`/`is-list` class. List stays the
 * original compact-row design (thumbnail + text) unchanged; grid is the art-
 * banner tile (tile system v2, pass 2a of the visual-richness program) — art
 * banner with on-art overlay stats, a segmented color-identity bar, an
 * avatar-attributed owner line, and a buildable-or-value footer. Hover quick-
 * actions (Open + relocated Like/Bookmark) are grid + hover-capable only.
 */
export function DiscoverDeckTile({ deck, view, buildablePercent = null, onUnsaved }: Props) {
  const thumb = useCardThumb(deck.commanderName ?? undefined, 'normal');
  const social = socialLine(deck);
  const isGrid = view === 'grid';
  const ownerName = formatIdentity({
    username: deck.ownerUsername,
    displayName: deck.ownerDisplayName,
  }).primary;

  return (
    <li className="decks-index-card discover-tile">
      <Link
        to={`/d/${deck.slug}`}
        className="decks-index-card-link discover-tile-link"
        aria-label={tileAriaLabel(deck, social, buildablePercent)}
      >
        {isGrid ? (
          <span className="discover-tile-banner">
            {thumb ? (
              <img
                className="decks-index-card-art"
                src={thumb}
                alt=""
                aria-hidden="true"
                loading="lazy"
              />
            ) : (
              <span className="decks-index-card-banner" aria-hidden="true">
                {deck.colorIdentity.length > 0 && (
                  <span className="decks-index-card-banner-pips">
                    {deck.colorIdentity.map((c) => (
                      <ColorPip key={c} color={c} pip="lg" />
                    ))}
                  </span>
                )}
              </span>
            )}
            <span className="discover-tile-banner-stats" aria-hidden="true">
              {bannerStatsLine(deck)}
            </span>
          </span>
        ) : (
          thumb && (
            <img
              className="decks-index-card-art"
              src={thumb}
              alt=""
              aria-hidden="true"
              loading="lazy"
            />
          )
        )}
        {isGrid && (
          <span className="discover-tile-colorbar" aria-hidden="true">
            {(deck.colorIdentity.length > 0 ? deck.colorIdentity : ['C']).map((c, i) => (
              <span
                key={`${c}-${i}`}
                className={`discover-tile-colorbar-seg discover-tile-colorbar-seg--${c.toLowerCase()}`}
              />
            ))}
          </span>
        )}
        <div className="decks-index-card-body">
          <div className="decks-index-card-name">
            <span>{deck.name}</span>
          </div>
          <div className="decks-index-card-meta">
            {deck.colorIdentity.length > 0 && (
              <span className="decks-index-card-pips">
                {deck.colorIdentity.map((c) => (
                  <ColorPip key={c} color={c} />
                ))}
              </span>
            )}
            <span className="deck-format-badge">{formatLabel(deck.format)}</span>
            {deck.bracket != null && (
              <span className="deck-format-badge">{bracketLabel(deck.bracket)}</span>
            )}
          </div>
          {!isGrid && (
            <div className="discover-tile-stats">
              <span className="discover-tile-value">
                {formatMoney(deck.estimatedValueUsd, { currency: 'USD' })}
              </span>
              {social && <span className="discover-tile-social">{social}</span>}
            </div>
          )}
          {!isGrid && buildablePercent != null && (
            <div className="discover-tile-buildable">
              <MeterBar value={buildablePercent} className="discover-tile-buildable-bar" />
              <span className="discover-tile-buildable-label">{buildablePercent}% buildable</span>
            </div>
          )}
        </div>
      </Link>
      {isGrid ? (
        <Link
          to={`/u/${deck.ownerUsername}`}
          className="discover-tile-owner"
          aria-label={`By ${ownerName}`}
        >
          <UserAvatar imageUrl={deck.ownerAvatarUrl} name={ownerName} size={20} />
          <span>{ownerName}</span>
        </Link>
      ) : (
        <Link to={`/u/${deck.ownerUsername}`} className="discover-tile-owner">
          by {deck.ownerUsername}
        </Link>
      )}
      {isGrid &&
        (buildablePercent != null ? (
          <div className="discover-tile-footer discover-tile-buildable">
            <MeterBar value={buildablePercent} className="discover-tile-buildable-bar" />
            <span className="discover-tile-buildable-label">{buildablePercent}% buildable</span>
          </div>
        ) : deck.estimatedValueUsd != null ? (
          <div className="discover-tile-footer discover-tile-value-footer">
            {formatMoney(deck.estimatedValueUsd, { currency: 'USD' })}
          </div>
        ) : null)}
      <div className="tile-actions">
        {isGrid && (
          <Link
            to={`/d/${deck.slug}`}
            className="discover-tile-open-pill"
            aria-hidden="true"
            tabIndex={-1}
          >
            <ArrowUpRight width={12} height={12} strokeWidth={2.5} aria-hidden />
            Open
          </Link>
        )}
        <LikeButton
          slug={deck.slug}
          initialLiked={deck.likedByViewer}
          initialCount={deck.likeCount}
        />
        <BookmarkButton
          slug={deck.slug}
          initialBookmarked={deck.bookmarkedByViewer}
          onChange={onUnsaved ? (bookmarked) => !bookmarked && onUnsaved(deck.slug) : undefined}
        />
      </div>
    </li>
  );
}

/** 8-12 skeleton tiles reads as a real grid row or two, not a guess at the
 *  page's eventual length. */
export const DISCOVER_SKELETON_COUNT = 10;

/** Skeleton tile matching the real tile's box dimensions (art band + name/
 *  meta/stats lines), so the loading grid doesn't jump when real tiles
 *  swap in. Shares the app's one `skeleton-shimmer` keyframe. `view` picks
 *  the grid-banner vs list-thumbnail art shape, mirroring the real tile —
 *  the grid art shape is the same `aspect-ratio: 16/9` box the real banner
 *  reserves, so there's no swap-in size jump either. */
export function DiscoverTileSkeleton({ view }: { view: DiscoverTileView }) {
  return (
    <li
      className={`decks-index-card discover-tile-skeleton${view === 'list' ? ' discover-tile-skeleton--list' : ''}`}
      aria-hidden="true"
    >
      <span className="discover-tile-skeleton-art" />
      <div className="discover-tile-skeleton-body">
        <span className="discover-tile-skeleton-bar discover-tile-skeleton-bar--name" />
        <span className="discover-tile-skeleton-bar discover-tile-skeleton-bar--meta" />
        <span className="discover-tile-skeleton-bar discover-tile-skeleton-bar--stats" />
      </div>
    </li>
  );
}
