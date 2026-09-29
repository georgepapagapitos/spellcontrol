import './RadarCardTile.css';
import { useCardThumb } from '@/lib/cards/card-thumbs';
import { formatMoney } from '@/lib/collection/format-money';
import type { TradeRadarMatch } from '@/lib/trade/trade-radar';

/** One want-list card the friend owns: thumbnail (CDN via useCardThumb, never
 *  the throttled Scryfall API), name, and which list wants it + target price.
 *  Rendered by the friend hub's radar and by TonightTrades. It is a list
 *  item (`<li>`), so callers wrap it in their own `<ul className="friend-hub-radar-strip">`. */
export function RadarCardTile({ match }: { match: TradeRadarMatch }) {
  const thumb = useCardThumb(match.name, 'small');
  const subParts = [
    match.listNames.length > 1
      ? `${match.listNames[0]} +${match.listNames.length - 1}`
      : match.listNames[0],
  ];
  // Target prices render in the currency they were ENTERED in (never converted
  // or relabeled to the viewer's display currency) — see ListEntry.currency.
  if (match.targetPrice !== undefined)
    subParts.push(
      `${formatMoney(match.targetPrice, { currency: match.currency ?? 'USD' })} target`
    );
  const sub = subParts.join(' · ');
  return (
    <li className="friend-hub-radar-card">
      {thumb ? (
        <img
          className="friend-hub-radar-thumb"
          src={thumb}
          alt=""
          aria-hidden
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span className="friend-hub-radar-thumb is-placeholder" aria-hidden />
      )}
      <span className="friend-hub-radar-name" title={match.name}>
        {match.name}
        {match.quantity > 1 && <span className="friend-hub-radar-qty"> ×{match.quantity}</span>}
      </span>
      <span className="friend-hub-radar-sub" title={sub}>
        {sub}
      </span>
    </li>
  );
}
