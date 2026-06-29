import { Modal } from '../Modal';
import { ManaCost } from '../ManaCost';
import type { PublicCard } from '../../lib/shared-types';
import { formatMoney } from '../../lib/format-money';

interface Props {
  card: PublicCard;
  onClose: () => void;
}

/**
 * Lightweight read-only card preview for shared views. Clicking a tile opens
 * this; clicking the backdrop or pressing Escape closes it. No mutations,
 * no edit affordances, no carousel — just the card's image + key facts.
 *
 * Uses the shared <Modal> primitive so the chrome (backdrop, scroll lock,
 * Escape handling) matches every other dialog in the app.
 */
export function SharedCardModal({ card, onClose }: Props) {
  return (
    <Modal onClose={onClose} label={card.name} className="choice-dialog shared-card-modal">
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
            <dd>
              <ManaCost cost={card.manaCost} />
            </dd>
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
            <dd>{formatMoney(card.purchasePrice)}</dd>
          </>
        )}
      </dl>
      <div className="choice-dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
