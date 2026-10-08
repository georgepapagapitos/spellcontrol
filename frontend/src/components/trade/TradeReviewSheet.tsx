import './TradeReview.css';
import { useId } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/overlays/Modal';
import { IconButton } from '@/components/shared/Button';
import { TradeReview, type TradeReviewProps } from './TradeReview';

export interface TradeReviewSheetProps extends Omit<TradeReviewProps, 'className'> {
  onClose: () => void;
}

/**
 * The review as a full-height sheet, for everything below the dock.
 *
 * Closing never discards: the draft lives in the trade-drafts store, so the
 * close button, the backdrop, Escape and Back all just hide this. The shared
 * `.modal-backdrop--sheet` only sheets up to 600px; `.trade-review-backdrop`
 * extends it to 1023px, the same two-class move `AddCardsSheet` makes.
 * Header and footer are chrome and the middle is the one scroll region.
 */
export function TradeReviewSheet({ onClose, ...review }: TradeReviewSheetProps) {
  const titleId = useId();
  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      className="modal trade-review-sheet"
      backdropClassName="modal-backdrop--sheet trade-review-backdrop"
    >
      <header className="trade-review-head">
        <h2 id={titleId} className="trade-review-title">
          Trade with {review.friendName}
        </h2>
        <IconButton
          variant="quiet"
          label="Close"
          icon={<X width={18} height={18} strokeWidth={2} />}
          onClick={onClose}
        />
      </header>
      <TradeReview {...review} />
    </Modal>
  );
}
