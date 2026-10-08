import { useMemo, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import type { PublicCard } from '@/lib/social/shared-types';
import { publicCardToEnriched } from '@/lib/social/shared-filter';
import { ArtBadge } from '../shared/ArtBadge';
import { BinderBadge, type BinderInfo } from '../BinderBadge';
import { DeckBadge } from '../DeckBadge';
import type { AllocationInfo } from '@/lib/collection/allocations-core';
import {
  CardGridCell,
  gridSetLabel,
  useGridCaptionPrefs,
  type GridCaptionPrefs,
} from '../shared/CardGridCell';
import { formatMoney } from '@/lib/collection/format-money';

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
  /** The OWNER's decks this card is in (friend hub): only ones the viewer can
   *  open, each carrying its own `href`. */
  allocations?: AllocationInfo[];
  /** The owner has a copy to spare (friend hub). A yes/no, never a count. */
  spare?: boolean;
  /** The caption prefs, when the surface owns them (the collection browser's
   *  Details control). Absent: this tile reads the stored device-wide prefs. */
  captionPrefs?: GridCaptionPrefs;
  /** Replaces the default note line (otherwise "Spare copy" for a spare). */
  note?: string;
  /** A short plate on the art ("You want"). */
  flag?: string;
  /** Copies of this card in a trade being built; above 0 the tile shows it. */
  pickedCount?: number;
  /** A control in the caption (the trade "+"). */
  action?: ReactNode;
  /** The card is this device's own: price it in the display currency. */
  localValues?: boolean;
}

/** The visible words for a spare copy. "Spare" alone was explained only by a
 *  tooltip, which a phone can't show. It means the owner has a copy past the
 *  one they keep that no deck or cube claims, so it says "copy". */
export const SPARE_LABEL = 'Spare copy';

/** Tooltip for the list row's chip, same meaning as SPARE_LABEL. */
export const SPARE_TITLE = 'A copy to spare: not in any of their decks, past the one they keep';

function capitalize(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1) : w;
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
export function SharedCardTile({
  card,
  quantity,
  onClick,
  ownership,
  hideValue,
  allocations,
  spare,
  captionPrefs: captionPrefsProp,
  note: noteProp,
  flag,
  pickedCount,
  action,
  localValues,
}: Props) {
  const [storedPrefs] = useGridCaptionPrefs();
  const captionPrefs = captionPrefsProp ?? storedPrefs;
  const enriched = useMemo(() => publicCardToEnriched(card), [card]);

  // A shared projection can carry no printing identity at all — the friend
  // endpoint is oracle-level, with no set code and no collector number — and
  // `gridSetLabel` would caption that as an empty line. Ask for the line only
  // when there is something to put on it.
  // With no printing, rarity still has a place: the caption line, spelled out.
  // The old corner chip sat on the art's printed mana cost.
  const setLabel = enriched.setCode
    ? gridSetLabel(enriched, captionPrefs)
    : captionPrefs.set && enriched.rarity
      ? capitalize(enriched.rarity)
      : null;
  // Shared projections are server-stamped USD — pin the symbol, as the rest of
  // the shared views do.
  const caption =
    hideValue || !captionPrefs.sortValue
      ? null
      : formatMoney(enriched.purchasePrice, localValues ? undefined : { currency: 'USD' });
  const note = noteProp ?? (spare ? SPARE_LABEL : null);

  return (
    <CardGridCell
      card={enriched}
      qty={quantity ?? 1}
      hideQty={hideValue}
      size="1x"
      onActivate={() => onClick?.()}
      caption={caption}
      setLabel={setLabel}
      ariaExtra={`${ownedAriaSuffix(ownership)}${flag ? ` · ${flag.toLowerCase()}` : ''}${
        note ? ` · ${note.toLowerCase()}` : ''
      }${pickedCount ? ` · ${pickedCount} in your trade` : ''}`}
      rarityOnArt={false}
      note={note}
      cornerExtras={
        flag ? (
          <ArtBadge
            className="shared-tile-flag"
            tone="warn"
            icon={<Star width={11} height={11} strokeWidth={2} />}
          >
            {flag}
          </ArtBadge>
        ) : undefined
      }
      pickedCount={pickedCount}
      action={action}
      badges={
        ownership?.owned || allocations?.length ? (
          <>
            {allocations && <DeckBadge allocations={allocations} placement="art" />}
            {ownership?.owned && <span className="shared-tile-owned-dot" aria-hidden="true" />}
            {ownership?.owned && ownership.binders.length > 0 && (
              <BinderBadge binders={ownership.binders} placement="art" />
            )}
          </>
        ) : undefined
      }
    />
  );
}
