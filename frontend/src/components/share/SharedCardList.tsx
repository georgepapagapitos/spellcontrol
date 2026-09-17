import { useMemo } from 'react';
import type { PublicCard } from '../../lib/shared-types';
import { publicCardToEnriched } from '../../lib/shared-filter';
import { BinderBadge } from '../BinderBadge';
import { CardRow } from '../shared/CardRow';
import { ownedAriaSuffix, type CardOwnership } from './SharedCardTile';

export interface SharedCardListItem {
  /** Stable React key (printing+finish, or section-local index). */
  key: string;
  card: PublicCard;
  quantity: number;
  /** Viewer's ownership of this card (w1-ownership-lens) — see SharedCardTile. */
  ownership?: CardOwnership;
}

interface Props {
  items: SharedCardListItem[];
  /** Row clicked — receives the row's index within `items` (the caller maps it
   *  to a global index into the flat carousel list). */
  onPreview: (index: number) => void;
  /** Deck cards carry no real price (placeholder 0), so the column is hidden there. */
  showPrice?: boolean;
  /**
   * A friend's collection is oracle-level and reports no counts by contract
   * ("contents yes, value no"). The count goes entirely rather than printing a
   * placeholder 1 on every row, which would read as a real quantity.
   */
  showQty?: boolean;
}

/**
 * List rendering of grouped cards for the shared and friend views — a thin
 * adapter over `CardRow`, the app's single card row.
 *
 * It used to be its own `<table class="shared-list-table">`, which is the last
 * place someone else's collection didn't look like yours. `SharedCardTile`
 * became `CardGridCell` in #1939, so the GRID matched everywhere while the list
 * view stayed a four-column table with none of the row's information hierarchy
 * — no foil treatment, no type glyph, no rarity chip, no mana cost, no proxy or
 * price-override badges. `CardRow`'s own doc had called itself "a candidate for
 * shared views" since it was written; this is that.
 *
 * Converting HERE rather than at the call sites converts all three at once
 * (shared collection, shared binder, friend hub), because each passes the same
 * `items`/`onPreview` shape.
 *
 * ⚠️ `.shared-list-table` does NOT go away with this — `SharedListView` (want
 * lists) still uses it, and those rows are unowned printing references with a
 * target-price editor, not collection cards. Deleting the class because this
 * component stopped using it would break that surface.
 */
export function SharedCardList({ items, onPreview, showPrice = true, showQty = true }: Props) {
  // One conversion per card, not per render — `CardRow` compares by identity.
  const rows = useMemo(
    () => items.map((it) => ({ ...it, enriched: publicCardToEnriched(it.card) })),
    [items]
  );

  return (
    <div className="collection-list">
      {rows.map((it, i) => (
        <CardRow
          key={it.key}
          card={it.enriched}
          qty={it.quantity}
          // Read-only surfaces: no deck allocations to show, and no per-row
          // action menu (nothing here is the viewer's to edit).
          allocations={[]}
          menu={null}
          onActivate={() => onPreview(i)}
          isLastRow={i === rows.length - 1}
          hidePrice={!showPrice}
          hideQty={!showQty}
          // Shared projections are server-stamped market values, not the
          // viewer's own cost basis — so the price cell says so on hover.
          priceTitle="Market price at the time this was shared"
          ownedBadge={
            it.ownership?.owned ? (
              <span className="shared-list-owned-badges">
                <span className="shared-tile-owned-dot" aria-hidden="true" />
                {/* The dot is decorative and `CardRow` has no aria-label (its
                    accessible name is its content), so without this the
                    ownership fact — which the old table spelled out in a
                    per-row label — would reach a screen reader only by
                    accident, via BinderBadge, and not at all for a card owned
                    in no binder. */}
                <span className="sr-only">{ownedAriaSuffix(it.ownership)}</span>
                {it.ownership.binders.length > 0 && <BinderBadge binders={it.ownership.binders} />}
              </span>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}
