import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { CardGridCell } from '@/components/shared/CardGridCell';
import { ArtBadge } from '@/components/shared/ArtBadge';
import { scryfallToEnrichedCard } from '@/lib/cards/scryfall-to-enriched';
import type { BrowseItem, BrowseListId } from '@/lib/discover/browse-lists';
import type { EnrichedCard } from '@/types';
import { browseStat } from './browse-labels';

/** A name-only card for a list that names cards without a printing (EDHREC's):
 *  the tile resolves its art by name. */
function nameOnlyCard(name: string): EnrichedCard {
  return {
    copyId: `browse:${name}`,
    name,
    setCode: '',
    setName: '',
    collectorNumber: '',
    rarity: '',
    scryfallId: '',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: '',
    finish: 'nonfoil',
    foil: false,
  };
}

/**
 * A browse list's card tile: the app's grid tile (`CardGridCell`), standing
 * for the card rather than a printing, with the list's stat as its caption and
 * a check on the art when the viewer owns a copy.
 */
export function BrowseTile({
  list,
  item,
  owned,
  onOpen,
}: {
  list: BrowseListId;
  item: BrowseItem;
  owned: boolean;
  onOpen: () => void;
}) {
  const card = useMemo(
    () => (item.card ? scryfallToEnrichedCard(item.card) : nameOnlyCard(item.name)),
    [item]
  );
  return (
    <CardGridCell
      card={card}
      qty={1}
      hideQty
      printing={false}
      size="1x"
      onActivate={onOpen}
      caption={browseStat(list, item)}
      ariaExtra={owned ? ', in your collection' : undefined}
      badges={
        owned ? (
          <ArtBadge
            // The plate, its size and the success tone are ArtBadge's own.
            className="browse-tile-owned"
            tone="success"
            title="In your collection"
            label="In your collection"
            icon={<Check width={12} height={12} strokeWidth={2} />}
          />
        ) : undefined
      }
    />
  );
}

/** A tile's loading stand-in: the same card box and caption line, so the
 *  real tiles land without moving anything. The box is the card grids' shared
 *  placeholder (`.list-entries-grid-cell--skeleton`, styles/collection.css). */
export function BrowseTileSkeleton({ caption }: { caption: boolean }) {
  return (
    <div className="collection-grid-cell" aria-hidden="true">
      <div className="collection-grid-item list-entries-grid-cell--skeleton" />
      {caption && (
        <div className="collection-grid-captions">
          <div className="collection-grid-caption" />
        </div>
      )}
    </div>
  );
}
