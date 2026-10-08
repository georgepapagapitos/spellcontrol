import './TradeReview.css';
import { useId } from 'react';
import { TradeReview, type TradeReviewProps } from './TradeReview';

/**
 * The review docked beside the browser, for a workspace wide enough to hold
 * both. The host decides when (an `@container` threshold on the workspace,
 * mirrored in JS with `useElementWidth`); this is only the panel: sticky,
 * header fixed, one scroll region, Send pinned at its bottom.
 */
export function TradeDock(props: TradeReviewProps) {
  const titleId = useId();
  return (
    <aside
      className={props.className ? `trade-dock ${props.className}` : 'trade-dock'}
      aria-labelledby={titleId}
    >
      <header className="trade-review-head">
        <h2 id={titleId} className="trade-review-title">
          Trade with {props.friendName}
        </h2>
      </header>
      <TradeReview {...props} className={undefined} />
    </aside>
  );
}
