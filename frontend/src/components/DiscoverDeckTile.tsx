import './DiscoverDeckTile.css';
import { Link } from 'react-router-dom';
import { ColorPip } from './shared/ManaSymbol';
import { useCardThumb } from '../lib/card-thumbs';
import { formatMoney } from '../lib/format-money';
import { formatSocialCount } from '../lib/social-proof';
import { DECK_FORMAT_CONFIGS } from '../deck-builder/lib/constants/archetypes';
import { bracketLabel } from '../deck-builder/services/deckBuilder/bracketEstimator';
import { LikeButton } from './LikeButton';
import { BookmarkButton } from './BookmarkButton';
import type { DeckFormat } from '../deck-builder/types';
import type { DiscoverDeck } from '../lib/discover-client';

function formatLabel(format: string): string {
  return DECK_FORMAT_CONFIGS[format as DeckFormat]?.label ?? format;
}

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

function tileAriaLabel(deck: DiscoverDeck, social: string | null): string {
  const parts = [deck.name, formatLabel(deck.format)];
  if (deck.bracket != null) parts.push(bracketLabel(deck.bracket));
  if (deck.colorIdentity.length > 0) parts.push(deck.colorIdentity.join(''));
  parts.push(formatMoney(deck.estimatedValueUsd, { currency: 'USD' }));
  if (social) parts.push(social);
  return parts.join(', ');
}

interface DiscoverDeckTileProps {
  deck: DiscoverDeck;
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
 * actions (w2-likes-bookmarks) are a third sibling for the same reason.
 */
export function DiscoverDeckTile({ deck, onUnsaved }: DiscoverDeckTileProps) {
  const thumb = useCardThumb(deck.commanderName ?? undefined, 'normal');
  const social = socialLine(deck);

  return (
    <li className="decks-index-card discover-tile">
      <Link
        to={`/d/${deck.slug}`}
        className="decks-index-card-link discover-tile-link"
        aria-label={tileAriaLabel(deck, social)}
      >
        {thumb ? (
          <img className="decks-index-card-art" src={thumb} alt="" aria-hidden="true" />
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
          <div className="discover-tile-stats">
            <span className="discover-tile-value">
              {formatMoney(deck.estimatedValueUsd, { currency: 'USD' })}
            </span>
            {social && <span className="discover-tile-social">{social}</span>}
          </div>
        </div>
      </Link>
      <Link to={`/u/${deck.ownerUsername}`} className="discover-tile-owner">
        by {deck.ownerUsername}
      </Link>
      <div className="tile-actions">
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
 *  swap in. Shares the app's one `skeleton-shimmer` keyframe. */
export function DiscoverTileSkeleton() {
  return (
    <li className="decks-index-card discover-tile-skeleton" aria-hidden="true">
      <span className="discover-tile-skeleton-art" />
      <div className="discover-tile-skeleton-body">
        <span className="discover-tile-skeleton-bar discover-tile-skeleton-bar--name" />
        <span className="discover-tile-skeleton-bar discover-tile-skeleton-bar--meta" />
        <span className="discover-tile-skeleton-bar discover-tile-skeleton-bar--stats" />
      </div>
    </li>
  );
}
