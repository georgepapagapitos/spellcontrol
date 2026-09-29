import './BrewerCard.css';
import { Link } from 'react-router-dom';
import { ColorIdentityBar } from '../shared/ColorIdentityBar';
import { Surface } from '../shared/Surface';
import { UserAvatar } from '../UserAvatar';
import { formatIdentity } from '@/lib/display-name';
import { brewerStatsLine } from '@/lib/brewer-stats';
import type { BrewerCard as BrewerCardData } from '@/lib/brewers-client';

/**
 * `card`: art-banner tile for rails and grids. `row`: compact one-line row for
 * search results and lists. `featured`: the larger spotlight layout.
 */
export type BrewerCardVariant = 'card' | 'row' | 'featured';

export interface BrewerCardProps {
  brewer: BrewerCardData;
  /** Defaults to `card`. */
  variant?: BrewerCardVariant;
  /** `li` inside a list (default), `div` standing alone (the spotlight). */
  as?: 'li' | 'div';
}

const AVATAR_SIZE: Record<BrewerCardVariant, number> = { card: 56, row: 44, featured: 72 };

/**
 * One brewer, as a single link to their profile. The whole card is the link
 * (no nested controls: Follow lives on the profile), named by their identity
 * plus the stats line. The banner is the art crop of their pinned or most
 * liked deck at a fixed 16:9, with the avatar overlapping its lower edge; a
 * brewer with no art gets the same flat fallback the deck tiles use.
 */
export function BrewerCard({ brewer, variant = 'card', as = 'li' }: BrewerCardProps) {
  const { primary, secondary } = formatIdentity(brewer);
  const stats = brewerStatsLine(brewer);
  const label = [primary, secondary, stats, brewer.topCommander].filter(Boolean).join(', ');
  const avatar = (
    <span className="brewer-card-avatar">
      <UserAvatar imageUrl={brewer.avatarImageUrl} name={primary} size={AVATAR_SIZE[variant]} />
    </span>
  );

  return (
    <Surface as={as} variant="sleeve" className={`brewer-card brewer-card--${variant}`}>
      <Link to={`/u/${brewer.username}`} className="brewer-card-link" aria-label={label}>
        {variant === 'row' ? (
          avatar
        ) : (
          <span className="brewer-card-media">
            <span className="brewer-card-banner" aria-hidden="true">
              {brewer.bannerImage ? (
                <img className="brewer-card-art" src={brewer.bannerImage} alt="" loading="lazy" />
              ) : (
                <span className="brewer-card-fallback" />
              )}
            </span>
            {avatar}
          </span>
        )}
        <span className="brewer-card-body">
          <span className="brewer-card-name">{primary}</span>
          {secondary && <span className="brewer-card-handle">{secondary}</span>}
          <span className="brewer-card-stats">{stats}</span>
          {brewer.topCommander && (
            <span className="brewer-card-commander">Brews {brewer.topCommander}</span>
          )}
        </span>
        {variant !== 'row' && <ColorIdentityBar colors={brewer.topColors} />}
      </Link>
    </Surface>
  );
}

/** Fixed-geometry loading placeholder, the same box as {@link BrewerCard}. */
export function BrewerCardSkeleton({ variant = 'card' }: { variant?: BrewerCardVariant }) {
  return (
    <Surface
      as="li"
      variant="sleeve"
      className={`brewer-card brewer-card--${variant} brewer-card--skeleton`}
      aria-hidden="true"
    >
      {variant !== 'row' && (
        <span className="brewer-card-media">
          <span className="brewer-card-banner brewer-card-shimmer" />
        </span>
      )}
      <span className="brewer-card-body">
        <span className="brewer-card-bar brewer-card-shimmer" />
        <span className="brewer-card-bar brewer-card-bar--short brewer-card-shimmer" />
      </span>
    </Surface>
  );
}
