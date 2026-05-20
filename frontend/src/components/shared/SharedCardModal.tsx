import { useEffect } from 'react';
import type { PublicCard } from '../../lib/shared-types';

interface Props {
  card: PublicCard;
  onClose: () => void;
}

/**
 * Lightweight read-only card preview for shared views. Clicking a tile opens
 * this; clicking the backdrop or pressing Escape closes it. No mutations,
 * no edit affordances, no carousel — just the card's image + key facts.
 */
export function SharedCardModal({ card, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="shared-card-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="shared-card-modal"
        role="dialog"
        aria-modal="true"
        aria-label={card.name}
        onClick={(e) => e.stopPropagation()}
      >
        {card.imageNormal ? (
          <img src={card.imageNormal} alt={card.name} className="shared-card-modal-img" />
        ) : (
          <div className="shared-card-modal-placeholder">{card.name}</div>
        )}
        <dl className="shared-card-modal-meta">
          <dt>Set</dt>
          <dd>
            {card.setName} ({card.setCode.toUpperCase()} {card.collectorNumber})
          </dd>
          <dt>Rarity</dt>
          <dd>{card.rarity}</dd>
          {card.typeLine && (
            <>
              <dt>Type</dt>
              <dd>{card.typeLine}</dd>
            </>
          )}
          {card.manaCost && (
            <>
              <dt>Cost</dt>
              <dd>{card.manaCost}</dd>
            </>
          )}
          {card.finish !== 'nonfoil' && (
            <>
              <dt>Finish</dt>
              <dd>{card.finish}</dd>
            </>
          )}
          {card.purchasePrice > 0 && (
            <>
              <dt>Price</dt>
              <dd>${card.purchasePrice.toFixed(2)}</dd>
            </>
          )}
        </dl>
        <button
          type="button"
          className="shared-card-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          Close
        </button>
      </div>
    </div>
  );
}
