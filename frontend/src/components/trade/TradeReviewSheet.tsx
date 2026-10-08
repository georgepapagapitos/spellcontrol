import './TradeReview.css';
import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/overlays/Modal';
import { IconButton } from '@/components/shared/Button';
import { TradeReview, type TradeReviewProps } from './TradeReview';

export interface TradeReviewSheetProps extends Omit<TradeReviewProps, 'className'> {
  onClose: () => void;
}

/**
 * The sheet chrome shared by every trade review: a full-height bottom sheet
 * below 1024px, the same panel centred above it. `TradeReviewSheet` (composing
 * an offer) and `TradeIncomingReview` (answering one) both sit in it, so they
 * cannot drift apart. The children own the header-below layout: a flex column
 * with one scroll region and a pinned footer.
 */
export function TradeSheetShell({
  title,
  onClose,
  dismissable = true,
  children,
}: {
  title: string;
  onClose: () => void;
  dismissable?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      dismissable={dismissable}
      className="modal trade-review-sheet"
      backdropClassName="modal-backdrop--sheet trade-review-backdrop"
    >
      <header className="trade-review-head">
        <h2 id={titleId} className="trade-review-title">
          {title}
        </h2>
        <IconButton
          variant="quiet"
          label="Close"
          icon={<X width={18} height={18} strokeWidth={2} />}
          disabled={!dismissable}
          onClick={onClose}
        />
      </header>
      {children}
    </Modal>
  );
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
  return (
    <TradeSheetShell title={`Trade with ${review.friendName}`} onClose={onClose}>
      <TradeReview {...review} />
    </TradeSheetShell>
  );
}
