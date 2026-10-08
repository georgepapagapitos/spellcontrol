import './TradePreviewPanel.css';
import { Minus, Plus } from 'lucide-react';
import { IconButton } from '@/components/shared/Button';

interface Props {
  /** What the card is to the other side of the trade: "Morgan has 3 · spare". */
  status: string;
  /** Copies in the trade now. 0 hides the stepper. */
  count: number;
  /** The most that can go in. */
  max: number;
  /** "that's all Morgan has" / "that's all you have", shown at the ceiling. */
  ceilingNote: string;
  onMore: () => void;
  onFewer: () => void;
}

/**
 * The trade row a card preview carries (the carousel's `renderPanelExtra`): the
 * card's standing on the other side, and once it is in the trade a stepper with
 * the reason it stops. The ask itself is the carousel's own action button, so
 * this is the second half of "Ask for this".
 *
 * The stepper is its own row in a roomy panel, so its buttons take the 44px
 * floor on their real boxes (no ghost to police).
 */
export function TradePreviewPanel({ status, count, max, ceilingNote, onMore, onFewer }: Props) {
  const atCeiling = count >= max;
  return (
    <div className="trade-preview-panel">
      <p className="trade-preview-status">{status}</p>
      {count > 0 && (
        <div className="trade-preview-row">
          <div className="trade-preview-stepper" role="group" aria-label="Copies in your trade">
            <IconButton
              label="One fewer in the trade"
              icon={<Minus width={16} height={16} strokeWidth={2} />}
              onClick={onFewer}
            />
            <output aria-live="polite">{count}</output>
            <IconButton
              label="One more in the trade"
              icon={<Plus width={16} height={16} strokeWidth={2} />}
              onClick={onMore}
              disabled={atCeiling}
            />
          </div>
          <p className="trade-preview-note">
            {atCeiling ? `In your trade · ${ceilingNote}` : 'In your trade'}
          </p>
        </div>
      )}
    </div>
  );
}
