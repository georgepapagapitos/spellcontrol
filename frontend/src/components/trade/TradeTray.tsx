import './TradeReview.css';
import type { PublicCard } from '@/lib/social/shared-types';
import { useTradeReview } from '@/lib/trade/use-trade-review';
import { ReviewThumb } from './ReviewThumb';

export interface TradeTrayProps {
  friendId: string;
  friendName: string;
  theirCards: readonly PublicCard[] | null;
  onReview: () => void;
  className?: string;
}

/**
 * The always-visible summary above the mobile tab bar: stacked art, who, the
 * counts and the net, and Review. One button, so the whole bar is the target.
 * Renders nothing while the draft is empty; it appears with the first card.
 */
export function TradeTray({
  friendId,
  friendName,
  theirCards,
  onReview,
  className,
}: TradeTrayProps) {
  const m = useTradeReview({ friendId, friendName, theirCards });
  if (m.getLineCount + m.giveLineCount === 0) return null;

  const names = [...m.getLines.map((l) => l.name), ...m.giveLines.map((l) => l.name)].slice(0, 4);
  const summary = `Get ${m.getCount} · Give ${m.giveCount}`;
  return (
    <div className={className ? `trade-tray ${className}` : 'trade-tray'}>
      <button
        type="button"
        className="trade-tray-main"
        onClick={onReview}
        aria-label={`Review trade with ${friendName}. ${summary}${m.netShort ? `. ${m.netShort}` : ''}`}
      >
        <span className="trade-tray-stack" aria-hidden>
          {names.map((name, i) => (
            <ReviewThumb key={`${i}-${name}`} name={name} />
          ))}
        </span>
        <span className="trade-tray-text" aria-hidden>
          <span className="trade-tray-title">Trade with {friendName}</span>
          <span className="trade-tray-sub">
            {summary}
            {m.netShort && (
              <>
                {' · '}
                <b>{m.netShort}</b>
              </>
            )}
          </span>
        </span>
        <span className="trade-tray-cta" aria-hidden>
          Review
        </span>
      </button>
    </div>
  );
}
