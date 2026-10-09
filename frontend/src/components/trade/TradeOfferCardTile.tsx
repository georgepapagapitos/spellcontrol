import { usePrintingThumb } from '@/lib/cards/card-thumbs';
import type { TradeCard } from '@/lib/trade/trades-client';

const FINISH_LABEL: Record<string, string> = { foil: 'Foil', etched: 'Etched' };

/**
 * One line of an offer, drawn as the card it is.
 *
 * The art is the PINNED printing when the line names one (`copies[0]`), by
 * Scryfall id, so a foil Sol Ring from Commander Legends shows that Sol Ring
 * and not whatever Scryfall calls the default. A line with no copies is an
 * oracle-level "any printing" ask (offers sent before asks were per printing):
 * the art is only an example, and the tile says so rather than let the picture
 * read as a promise.
 *
 * `compact` is the finished-trade ledger: smaller art with the name beside it.
 */
export function TradeOfferCardTile({
  card,
  compact,
  onInspect,
}: {
  card: TradeCard;
  compact: boolean;
  onInspect: (card: TradeCard) => void;
}) {
  const pin = card.copies[0];
  // Small art is plenty for a ledger tile; an open offer's tile is large enough
  // that the 146px `small` image would look soft.
  const { src, id } = usePrintingThumb(pin?.scryfallId, card.name, compact ? 'small' : 'normal');
  const caption = pin ? FINISH_LABEL[pin.finish] : 'Any printing';

  const label = [
    `Preview ${card.name}`,
    card.quantity > 1 ? `${card.quantity} copies` : null,
    caption ? caption.toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      className="trade-offer-chip"
      onClick={() => onInspect(card)}
      aria-label={label}
    >
      <span className="trade-offer-art">
        {src ? (
          <img
            className="trade-offer-chip-thumb"
            src={src}
            alt=""
            aria-hidden
            loading="lazy"
            draggable={false}
            data-scryfall-id={id}
          />
        ) : (
          <span className="trade-offer-chip-thumb is-placeholder" aria-hidden>
            {!compact && card.name}
          </span>
        )}
        {card.quantity > 1 && (
          <span className="trade-offer-chip-qty" aria-hidden>
            ×{card.quantity}
          </span>
        )}
      </span>
      <span className="trade-offer-chip-text">
        <span className="trade-offer-chip-name" title={card.name}>
          {card.name}
        </span>
        {caption && (
          <span className="trade-offer-chip-caption" aria-hidden>
            {caption}
          </span>
        )}
      </span>
    </button>
  );
}
