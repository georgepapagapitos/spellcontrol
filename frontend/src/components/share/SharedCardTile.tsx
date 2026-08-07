import { useState } from 'react';
import type { PublicCard } from '../../lib/shared-types';
import { BinderBadge, type BinderInfo } from '../BinderBadge';

export interface CardOwnership {
  owned: boolean;
  binders: BinderInfo[];
}

interface Props {
  card: PublicCard;
  quantity?: number;
  onClick?: () => void;
  /** Viewer's ownership of this card (w1-ownership-lens) — absent when the
   *  page has no ownership lens (guest, or a view that doesn't compute one).
   *  Not owned -> no badge at all; absence is the signal. */
  ownership?: CardOwnership;
}

/** Folds the ownership fact into the tile's accessible name (rather than a
 *  second separately-focusable element per card) — e.g. "Sol Ring — owned,
 *  in Sacrifice binder". Shared with SharedCardList's row label. */
export function ownedAriaSuffix(ownership?: CardOwnership): string {
  if (!ownership?.owned) return '';
  const names = [...new Set(ownership.binders.map((b) => b.name))];
  if (names.length === 0) return ' — owned';
  if (names.length === 1) return ` — owned, in ${names[0]} binder`;
  return ` — owned, in ${names.length} binders`;
}

/**
 * Pure-presentational card tile for shared views. Renders the card's image
 * with a quantity badge overlay, plus (when `ownership` is supplied) an
 * owned check-dot and binder badge. No store reads beyond the passed props —
 * strictly read-only and self-contained.
 */
export function SharedCardTile({ card, quantity, onClick, ownership }: Props) {
  const [imgError, setImgError] = useState(false);
  const Tag = onClick ? 'button' : 'div';

  const tile = (
    <Tag
      className={`shared-tile${card.finish !== 'nonfoil' ? ' is-foil' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={`${card.name}${ownedAriaSuffix(ownership)}`}
    >
      {card.imageNormal && !imgError ? (
        <img
          src={card.imageNormal}
          alt={card.name}
          loading="lazy"
          className="shared-tile-img"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="shared-tile-placeholder">{card.name}</div>
      )}
      {quantity != null && quantity > 1 && (
        <span className="shared-tile-qty" aria-label={`Quantity ${quantity}`}>
          <span className="shared-tile-qty-x" aria-hidden>
            ×
          </span>
          {quantity}
        </span>
      )}
    </Tag>
  );

  if (!ownership?.owned) return tile;

  // The corner badges render as SIBLINGS of `Tag`, never nested inside it —
  // Tag is a <button> here (onClick is always passed by every ownership-aware
  // caller) and BinderBadge's single-binder case is itself a real <button>;
  // nesting would be invalid HTML (and a second interactive descendant a
  // screen reader's virtual cursor would trip over). The wrapper below is a
  // plain, unstyled positioning box the same size as `.shared-tile` (a block
  // child sizes its block parent), so the corner badges anchor to the exact
  // same visual box `.shared-tile`'s own aspect-ratio establishes.
  return (
    <div className="shared-tile-ownership-wrap">
      {tile}
      <span className="shared-tile-badges">
        <span className="shared-tile-owned-dot" aria-hidden="true" />
        {ownership.binders.length > 0 && <BinderBadge binders={ownership.binders} />}
      </span>
    </div>
  );
}
