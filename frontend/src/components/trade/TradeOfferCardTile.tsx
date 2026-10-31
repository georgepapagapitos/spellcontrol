import { usePrintingThumb } from '@/lib/cards/card-thumbs';
import type { TradeCard } from '@/lib/trade/trades-client';

const FINISH_LABEL: Record<string, string> = { foil: 'Foil', etched: 'Etched' };

/**
 * One line of an offer: the card's art beside its name and printing, a row of
 * the trade's ledger rather than a tile in a gallery (the price sits beside it,
 * in the row the parent draws).
 *
 * The art is the PINNED printing when the line names one (`copies[0]`), by
 * Scryfall id, so a foil Sol Ring from Commander Legends shows that Sol Ring
 * and not whatever Scryfall calls the default, and the row names its set and
 * collector number once that printing resolves. A line with no copies is an
 * oracle-level "any printing" ask (offers sent before asks were per printing):
 * the art is only an example, and the row says so rather than let the picture
 * read as a promise.
 *
 * `compact` is the finished-trade ledger: smaller art, no set and number.
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
  // The art is at most 56px wide; tapping the row opens the full card.
  const { src, id, printing } = usePrintingThumb(pin?.scryfallId, card.name, 'small');
  // A line can hand over copies of different printings (two Signets from two
  // sets). Then the art is only the first of them, so the row must not name
  // one set and number as if it were the whole line.
  const uniform = card.copies.every(
    (c) => c.scryfallId === pin?.scryfallId && c.finish === pin?.finish
  );
  const caption = !pin ? 'Any printing' : uniform ? FINISH_LABEL[pin.finish] : 'Mixed printings';
  const where =
    !compact && uniform && printing
      ? [printing.set?.toUpperCase(), printing.collector_number && `#${printing.collector_number}`]
          .filter(Boolean)
          .join(' ')
      : null;
  const meta = [where, caption].filter(Boolean).join(' · ');

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
          <span className="trade-offer-chip-thumb is-placeholder" aria-hidden />
        )}
      </span>
      <span className="trade-offer-chip-text">
        <span className="trade-offer-chip-name" title={card.name}>
          {card.quantity > 1 && (
            <span className="trade-offer-chip-qty" aria-hidden>
              {card.quantity}×{' '}
            </span>
          )}
          {card.name}
        </span>
        {meta && (
          <span className="trade-offer-chip-caption" aria-hidden>
            {meta}
          </span>
        )}
      </span>
    </button>
  );
}
