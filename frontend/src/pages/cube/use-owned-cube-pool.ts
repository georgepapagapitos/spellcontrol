import { useCallback, useMemo } from 'react';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCubeStore } from '../../store/cube';
import { buildAvailableCollection } from '../../lib/collection-availability';
import { filterPool, DEFAULT_POOL_FILTERS } from '../../lib/cube/pool-filters';
import { fetchCubeOracle } from '../../lib/cube/oracle';
import type { CardFetchProgress } from '@/deck-builder/services/scryfall/card-repository';
import { loadTaggerData } from '../../deck-builder/services/tagger/client';
import { loadCubeSignal } from '../../lib/cube/signal';
import { ensureCardTags } from '../../lib/card-tags';
import { namesToCubePool } from '../../lib/cube/pool';
import type { CubeCard } from '../../lib/cube/core';

/**
 * Loads the caller's OWNED cube pool — the same fetch-then-rank pipeline
 * `CubeBuildPage` runs (available collection → oracle lookup → `CubeCard[]`),
 * pulled into its own module so a second build surface (Import → Build my
 * version) doesn't grow a copy. No "Draw from" filter UI here: an
 * import-driven build draws from every available card at the page's
 * defaults, same as the build page opens on.
 */
export function useOwnedCubePool() {
  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);

  const availableNames = useMemo(
    () => buildAvailableCollection(collectionCards, decks, savedCubes).names,
    [collectionCards, decks, savedCubes]
  );

  const load = useCallback(
    async (onProgress?: CardFetchProgress): Promise<CubeCard[]> => {
      await Promise.all([loadTaggerData(), loadCubeSignal(), ensureCardTags()]);
      const { names } = filterPool(collectionCards, availableNames, DEFAULT_POOL_FILTERS);
      const enriched = await fetchCubeOracle(names, collectionCards, onProgress);
      return namesToCubePool(names, collectionCards, enriched);
    },
    [collectionCards, availableNames]
  );

  return { load, hasCollection: collectionCards.length > 0 };
}
