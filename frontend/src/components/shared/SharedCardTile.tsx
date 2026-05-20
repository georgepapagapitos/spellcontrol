import { useState } from 'react';
import type { PublicCard } from '../../lib/shared-types';

interface Props {
  card: PublicCard;
  quantity?: number;
  onClick?: () => void;
}

/**
 * Pure-presentational card tile for shared views. Renders the card's image
 * with a quantity badge overlay. No store reads, no hover tooltip, no
 * allocations — strictly read-only and self-contained.
 */
export function SharedCardTile({ card, quantity, onClick }: Props) {
  const [imgError, setImgError] = useState(false);
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`shared-tile${card.finish !== 'nonfoil' ? ' is-foil' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={card.name}
    >
      {card.imageNormal && !imgError ? (
        <img
          src={card.imageNormal}
          alt={card.name}
          loading="lazy"
          className="shared-tile-img"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="shared-tile-placeholder">{card.name}</div>
      )}
      {quantity != null && quantity > 1 && (
        <span className="shared-tile-qty" aria-label={`Quantity ${quantity}`}>
          <span className="shared-tile-qty-x" aria-hidden>
            ×
          </span>
          {quantity}
        </span>
      )}
    </Tag>
  );
}
