import { useCollectionStore } from '@/store/collection';
import type { EnrichedCard, Finish } from '@/types';
import { type ThumbVersion, useCardThumb } from './card-thumbs';

/**
 * Which printing stands for a card NAME when the player owns it: the one rule
 * the suggestion carousel and the row thumbnails both follow, so the art a row
 * shows is the art its preview opens on. Before this, the carousel opened on the
 * owned printing (a Secret Lair copy, say) while the row resolved the name to
 * Scryfall's default printing, and the two disagreed for every owned card.
 */

const FINISH_RANK: Record<Finish, number> = { foil: 3, etched: 2, nonfoil: 1 };

/** The best owned physical copy for a card name, preferring foil > etched >
 *  nonfoil. Undefined when the card isn't in the collection, so suggestions and
 *  unowned cards fall back to name resolution. */
export function bestOwnedCopyByName(
  name: string,
  owned: readonly EnrichedCard[] = useCollectionStore.getState().cards
): EnrichedCard | undefined {
  const lower = name.toLowerCase();
  let best: EnrichedCard | undefined;
  let bestRank = 0;
  for (const c of owned) {
    if (c.name.toLowerCase() !== lower || !c.scryfallId) continue;
    const r = FINISH_RANK[c.finish] ?? 1;
    if (r > bestRank) {
      best = c;
      bestRank = r;
      if (r === 3) break; // foil is best possible — stop early
    }
  }
  return best;
}

/** An owned copy's CDN image at `version`. Reads the stored image when there is
 *  one, else builds the CDN path from the printing id (Scryfall's image paths
 *  are keyed by it), so a copy imported without image fields still matches. */
export function ownedCopyImage(copy: EnrichedCard, version: ThumbVersion): string {
  const stored = copy.imageNormal ?? copy.imageSmall ?? copy.imageLarge;
  if (stored) return stored.replace(/\/(small|normal|large|art_crop)\//, `/${version}/`);
  const id = copy.scryfallId;
  return `https://cards.scryfall.io/${version}/front/${id[0]}/${id[1]}/${id}.jpg`;
}

/** The owned printing's image for `name`, or undefined when it isn't owned.
 *  Subscribes to the collection, so a row repaints when the copy arrives. */
export function useOwnedPrintingImage(
  name: string | undefined,
  version: ThumbVersion
): string | undefined {
  return useCollectionStore((s) => {
    if (!name) return undefined;
    const copy = bestOwnedCopyByName(name, s.cards);
    return copy ? ownedCopyImage(copy, version) : undefined;
  });
}

/** {@link useCardThumb} for a surface whose tap opens the suggestion carousel:
 *  the owned printing when there is one, else the default printing by name. */
export function useOwnedCardThumb(
  name: string | undefined,
  version: ThumbVersion = 'normal'
): string | undefined {
  const owned = useOwnedPrintingImage(name, version);
  const byName = useCardThumb(owned ? undefined : name, version);
  return owned ?? byName;
}
