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
  onPreview: (card: PublicCard) => void;
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
          {items.map((it) => (
            <tr
              key={it.key}
              onClick={() => onPreview(it.card)}
              tabIndex={0}
              role="button"
              aria-label={`Preview ${it.card.name}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPreview(it.card);
                }
              }}
            >
              <td>{it.quantity}</td>
              <td>{it.card.name}</td>
              <td>
                {it.card.setCode.toUpperCase()} {it.card.collectorNumber}
              </td>
              <td>{it.card.finish}</td>
              {showPrice && <td>{formatMoney(it.card.purchasePrice)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
