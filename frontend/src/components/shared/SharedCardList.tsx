import type { PublicCard } from '../../lib/shared-types';
import { formatMoney } from '../../lib/format-money';

export interface SharedCardListItem {
  /** Stable React key (printing+finish, or section-local index). */
  key: string;
  card: PublicCard;
  quantity: number;
}

interface Props {
  items: SharedCardListItem[];
  /** Row clicked — receives the row's index within `items` (the caller maps it
   *  to a global index into the flat carousel list). */
  onPreview: (index: number) => void;
  /** Deck cards carry no real price (placeholder 0), so the column is hidden there. */
  showPrice?: boolean;
}

/**
 * Read-only "list" rendering of grouped cards for the shared views — the lean
 * counterpart to the SharedCardTile grid. Reuses the existing `.shared-list-table`
 * styling (already used by the shared binder/list views) so collection, binder,
 * and deck all share one table look. Each row opens the card preview modal.
 */
export function SharedCardList({ items, onPreview, showPrice = true }: Props) {
  return (
    <div className="shared-table-scroll">
      <table className="shared-list-table shared-list-table--clickable">
        <thead>
          <tr>
            <th>Qty</th>
            <th>Name</th>
            <th>Set</th>
            <th>Finish</th>
            {showPrice && <th>Price</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr
              key={it.key}
              onClick={() => onPreview(i)}
              tabIndex={0}
              role="button"
              aria-label={`Preview ${it.card.name}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPreview(i);
                }
              }}
            >
              <td data-label="Qty">{it.quantity}</td>
              <td data-label="Name">{it.card.name}</td>
              <td data-label="Set">
                {it.card.setCode.toUpperCase()} {it.card.collectorNumber}
              </td>
              <td data-label="Finish">{it.card.finish}</td>
              {showPrice && <td data-label="Price">{formatMoney(it.card.purchasePrice)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
