// What DeckDisplay derives from every zone's visible sections at once: the
// carousel / inspector index and the "Not in the deck" piles.
import { useMemo } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { useRarityCorrections } from '@/lib/deck/use-rarity-corrections';
import type { DeckZone } from '../../store/decks';
import { buildFlatIndex } from './deck-display-derive';
import type { Row, TypedGroup } from './deck-display-rows';
import type { DeckDisplayCard } from './deck-display-types';

/**
 * The flat carousel / inspector index over every zone's visible rows, with
 * rarity re-resolved for cards whose stored snapshot defaulted to 'common'
 * (decks generated against the pre-#329 offline oracle; see the hook doc).
 * Every zone feeds the corrections, not just the mainboard: feeding only the
 * mainboard left a card that lives only in another pile stuck on its stale
 * 'common' snapshot forever. The hook dedupes by oracle id, so the tag lens's
 * repeated rows cost nothing.
 */
export function useDeckFlatIndex(
  visibleGroups: TypedGroup[],
  visibleSideboardGroups: TypedGroup[],
  visibleConsideringGroups: TypedGroup[],
  visibleExtrasGroups: TypedGroup[]
) {
  const previewCards = useMemo<ScryfallCard[]>(
    () =>
      [
        ...visibleGroups,
        ...visibleSideboardGroups,
        ...visibleConsideringGroups,
        ...visibleExtrasGroups,
      ].flatMap((g) => g.rows.map((r) => r.card)),
    [visibleGroups, visibleSideboardGroups, visibleConsideringGroups, visibleExtrasGroups]
  );
  const rarityCorrections = useRarityCorrections(previewCards);
  return useMemo(
    () =>
      buildFlatIndex(
        visibleGroups,
        visibleSideboardGroups,
        visibleConsideringGroups,
        visibleExtrasGroups,
        rarityCorrections
      ),
    [
      visibleGroups,
      visibleSideboardGroups,
      visibleConsideringGroups,
      visibleExtrasGroups,
      rarityCorrections,
    ]
  );
}

/**
 * "Not in the deck": the piles at the foot of the deck body, in order (the
 * sideboard when the format has one, Considering, then In the box), and which
 * pile a row belongs to. A tile's menu needs its pile, but the grid reports
 * only the row, and a name can sit in more than one pile, so the row's own
 * slot ids decide.
 */
export function useDeckOutzone({
  hasSideboard,
  sideboard,
  extras,
  visibleSideboardGroups,
  visibleConsideringGroups,
  visibleExtrasGroups,
}: {
  hasSideboard: boolean;
  sideboard: DeckDisplayCard[];
  extras: DeckDisplayCard[];
  visibleSideboardGroups: TypedGroup[];
  visibleConsideringGroups: TypedGroup[];
  visibleExtrasGroups: TypedGroup[];
}) {
  const outzoneGroups = useMemo(
    () => [
      ...(hasSideboard ? visibleSideboardGroups : []),
      ...visibleConsideringGroups,
      ...visibleExtrasGroups,
    ],
    [hasSideboard, visibleSideboardGroups, visibleConsideringGroups, visibleExtrasGroups]
  );
  const sideboardSlotIds = useMemo(() => new Set(sideboard.map((c) => c.slotId)), [sideboard]);
  const extrasSlotIds = useMemo(() => new Set(extras.map((c) => c.slotId)), [extras]);
  const outzoneOf = (row: Row): DeckZone =>
    row.slotIds.some((id) => sideboardSlotIds.has(id))
      ? 'sideboard'
      : row.slotIds.some((id) => extrasSlotIds.has(id))
        ? 'extras'
        : 'considering';
  return { outzoneGroups, outzoneOf };
}
