import { useMemo } from 'react';
import type { PublicCard } from '../../lib/shared-types';
import { publicCardToEnriched } from '../../lib/shared-filter';
import { BinderBadge, type BinderInfo } from '../BinderBadge';
import { CardGridCell, gridSetLabel, useGridCaptionPrefs } from '../shared/CardGridCell';
import { formatMoney } from '../../lib/format-money';

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
  /**
   * Suppress everything stating a VALUE or a COUNT: the price caption, the
   * ×qty chip, and the "quantity N" in the accessible name. For a friend's
   * collection, whose endpoint withholds both by contract ("contents yes,
   * value no") — its projection carries `purchasePrice: 0`, which would
   * otherwise caption as `$0.00`. Sibling of `CardPreview`'s `hidePrice`.
   */
  hideValue?: boolean;
}

/** Folds the ownership fact into the tile's accessible name (rather than a
 *  second separately-focusable element per card), e.g. "Sol Ring · owned,
 *  in Sacrifice binder". Shared with SharedCardList's row label. */
export function ownedAriaSuffix(ownership?: CardOwnership): string {
  if (!ownership?.owned) return '';
  const names = [...new Set(ownership.binders.map((b) => b.name))];
  if (names.length === 0) return ' · owned';
  if (names.length === 1) return ` · owned, in ${names[0]} binder`;
  return ` · owned, in ${names.length} binders`;
}

/**
 * Card tile for the shared and friend views — a thin adapter over
 * `CardGridCell`, the app's single grid tile.
 *
 * It used to be its own `.shared-tile` markup, which is precisely why someone
 * else's collection didn't look like yours: one concept, two renderers,
 * drifting apart for a year. The owner's tile grew foil treatment, a rarity
 * badge, the set caption and the price caption; this one stayed an image with
 * a corner count. `CardGridCell`'s own doc already claimed to be "the single
 * card tile used by every grid surface" — the shared views just never adopted
 * it.
 *
 * Converting HERE rather than at the call sites converts all four surfaces at
 * once — shared collection, shared binder, deck feedback, friend hub — because
 * every one of them calls this component with the same card/quantity/onClick
 * shape. That is the whole reason this is a small diff.
 *
 * The adapter owns three things: the `PublicCard` → `EnrichedCard` projection,
 * the caption prefs (shared device-wide with the owner's collection, so the
 * "Details" toggles apply here too), and the ownership badges, which move into
 * `CardGridCell`'s `badges` slot. The old sibling-wrapper hack goes with them:
 * it existed because `.shared-tile` was a real `<button>` and `BinderBadge` is
 * itself a button, so nesting would have been invalid HTML. `CardGridCell`'s
 * root is a `role="button"` div — exactly how the owner's collection already
 * nests that same badge — so the wrapper has no job left.
 */
export function SharedCardTile({ card, quantity, onClick, ownership, hideValue }: Props) {
  const [captionPrefs] = useGridCaptionPrefs();
  const enriched = useMemo(() => publicCardToEnriched(card), [card]);

  // A shared projection can carry no printing identity at all — the friend
  // endpoint is oracle-level, with no set code and no collector number — and
  // `gridSetLabel` would caption that as an empty line. Ask for the line only
  // when there is something to put on it.
  const setLabel = enriched.setCode ? gridSetLabel(enriched, captionPrefs) : null;
  // Shared projections are server-stamped USD — pin the symbol, as the rest of
  // the shared views do.
  const caption =
    hideValue || !captionPrefs.sortValue
      ? null
      : formatMoney(enriched.purchasePrice, { currency: 'USD' });

  return (
    <CardGridCell
      card={enriched}
      qty={quantity ?? 1}
      hideQty={hideValue}
      size="1x"
      onActivate={() => onClick?.()}
      caption={caption}
      setLabel={setLabel}
      ariaExtra={ownedAriaSuffix(ownership)}
      badges={
        ownership?.owned ? (
          <>
            <span className="shared-tile-owned-dot" aria-hidden="true" />
            {ownership.binders.length > 0 && <BinderBadge binders={ownership.binders} />}
          </>
        ) : undefined
      }
    />
  );
}
