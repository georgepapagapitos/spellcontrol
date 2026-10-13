import type { ReactNode } from 'react';
import type { SetMap } from '@/lib/api';
import type { CopyBreakdown } from '@/lib/collection/copy-locations';
import type { CardLocation } from '@/lib/binder/card-locations';
import { setSymbolTitle } from '@/lib/cards/set-symbols';
import type { CubeListing } from '@/lib/cube/cube-listings';
import { CopyPlaces } from '@/components/shared/CopyPlaces';
import { ArtBadge } from '@/components/shared/ArtBadge';
import {
  CardGridCell,
  gridSetLabel,
  type GridCaptionPrefs,
} from '@/components/shared/CardGridCell';
import type { Row } from './card-list-table-config';

interface Props {
  row: Row;
  size: '1x' | '2x' | '3x';
  /** Sort-value caption, or null when the caption pref is off. */
  caption: string | null;
  captionPrefs: GridCaptionPrefs;
  selectMode: boolean;
  selected: boolean;
  /** Card names shown as more than one printing, which grow a set-code chip. */
  duplicateNames: Set<string>;
  setMap?: SetMap;
  surplusOnly: boolean;
  surplusByName: Map<string, number>;
  /** Where this tile's copies are (breakdownCopies over row.copyIds). */
  places: CopyBreakdown;
  cubeListings: CubeListing[];
  /** Pages and pockets by copyId, for the where-your-copies list. */
  locations: ReadonlyMap<string, CardLocation>;
  onActivate: () => void;
  menu: ReactNode;
}

/** One collection grid tile: the shared `CardGridCell` plus the two
 *  collection-only corner chips and the marks for where its copies are. Split out of
 *  CardListTable's grid render (T176); it holds no state of its own. */
export function CardListGridCell({
  row: r,
  size,
  caption,
  captionPrefs,
  selectMode,
  selected,
  duplicateNames,
  setMap,
  surplusOnly,
  surplusByName,
  places,
  cubeListings,
  locations,
  onActivate,
  menu,
}: Props) {
  const setLabel = gridSetLabel(r.card, captionPrefs);
  // Two collection-only corner chips beside the ×qty badge: a
  // set code when the same name appears as several printings
  // (redundant while the set caption is on), and the surplus
  // count while the "Tradeable surplus" filter is active.
  const dupChip =
    setLabel === null && duplicateNames.has(r.card.name) ? (
      <ArtBadge
        className="collection-grid-set"
        title={setSymbolTitle({
          setCode: r.card.setCode,
          setName: r.card.setName || setMap?.[r.card.setCode.toUpperCase()]?.name,
          collectorNumber: r.card.collectorNumber,
          rarity: r.card.rarity,
        })}
      >
        {r.card.setCode.toUpperCase()}
      </ArtBadge>
    ) : null;
  const surplus = surplusOnly ? surplusByName.get(r.card.name) : undefined;
  const surplusChip = surplus ? (
    <ArtBadge
      className="collection-grid-surplus"
      title={`${surplus} unallocated ${surplus === 1 ? 'copy' : 'copies'} beyond your kept copy`}
    >
      {surplus} free
    </ArtBadge>
  ) : null;
  return (
    <CardGridCell
      card={r.card}
      qty={r.qty}
      size={size}
      caption={caption}
      setLabel={setLabel}
      selectMode={selectMode}
      selected={selected}
      onActivate={onActivate}
      menu={menu}
      cornerExtras={
        dupChip || surplusChip ? (
          <>
            {dupChip}
            {surplusChip}
          </>
        ) : null
      }
      badges={
        places.places.length > 0 || cubeListings.length > 0 ? (
          <CopyPlaces
            card={r.card}
            breakdown={places}
            listedIn={cubeListings}
            locations={locations}
            placement="art"
            interactive={!selectMode}
          />
        ) : null
      }
    />
  );
}
