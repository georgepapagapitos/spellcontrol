import './TradeAddButton.css';
import { Check, Plus } from 'lucide-react';

interface Props {
  /** The card's name, for the accessible label. */
  name: string;
  /** Copies already in the trade. */
  count: number;
  /** "Ask for" on their cards, "Offer" on yours. */
  verb: 'Ask for' | 'Offer';
  onAdd: () => void;
  onRemove: () => void;
}

/**
 * The trade control on a card tile: a plus until the card is in the trade,
 * then a check that takes one copy back out. The count lives on the tile's art
 * (the ring and badge) and in this label, never in this 30px circle.
 *
 * The hit area is a ghost that grows to 44px on touch (overlay-containment's
 * coarse floor): the tile packs the control into its caption corner, between
 * the art above and the neighbor beside it, so a real 44px box would swell
 * the caption.
 */
export function TradeAddButton({ name, count, verb, onAdd, onRemove }: Props) {
  const picked = count > 0;
  return (
    <button
      type="button"
      className={picked ? 'trade-add is-picked' : 'trade-add'}
      aria-label={
        picked ? `Take one ${name} out of the trade. ${count} in the trade.` : `${verb} ${name}`
      }
      onClick={picked ? onRemove : onAdd}
    >
      {picked ? (
        <Check width={16} height={16} strokeWidth={2} aria-hidden="true" />
      ) : (
        <Plus width={16} height={16} strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  );
}
