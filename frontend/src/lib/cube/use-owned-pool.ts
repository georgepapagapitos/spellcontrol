// The owned-cube-pool recipe (available names -> pool filters -> oracle
// lookup -> CubeCard[]), shared by every surface that needs the pool a cube
// draws from: the build page's own generate(), and the cube edit page's
// swap candidates / "add from collection" / "Rebuild the rest". Extracted
// from CubeBuildPage so the recipe lives in one place.

import { useCallback, useMemo, useState } from 'react';
import { useCollectionStore } from '@/store/collection';
import { useDecksStore } from '@/store/decks';
import { useCubeStore } from '@/store/cube';
import { buildAvailableCollection } from '@/lib/collection-availability';
import { filterPool, type PoolFilters } from './pool-filters';
import { fetchCubeOracle } from './oracle';
import { namesToCubePool } from './pool';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { loadCubeSignal } from './signal';
import { ensureCardTags, getCardTags, useCardTagsReady } from '@/lib/card-tags';
import { userMessage } from '@/lib/user-error';
import type { CardFetchProgress } from '@/deck-builder/services/scryfall/card-repository';
import type { CubeCard } from './core';

const NO_TAGS = (): readonly string[] => [];

/**
 * Owned-pool names for `filters` (cheap, no network) plus a lazy `load()` that
 * fetches oracle facts and builds the full `CubeCard[]` ranking pool. `load()`
 * is not called until a surface actually needs the ranked pool — viewing a
 * cube's page never pays the oracle-lookup cost; only opening Swap, "Add from
 * collection" or "Rebuild the rest" does. Cached per `filters` value for the
 * life of the component.
 */
export function useOwnedCubePool(filters: PoolFilters) {
  const collectionCards = useCollectionStore((s) => s.cards);
  const decks = useDecksStore((s) => s.decks);
  const savedCubes = useCubeStore((s) => s.saved);
  const tagsReady = useCardTagsReady();
  const tagsOf = tagsReady ? getCardTags : NO_TAGS;

  const availableNames = useMemo(
    () => buildAvailableCollection(collectionCards, decks, savedCubes).names,
    [collectionCards, decks, savedCubes]
  );
  const { names: uniqueNames, hidden } = useMemo(
    () => filterPool(collectionCards, availableNames, filters, tagsOf),
    [collectionCards, availableNames, filters, tagsOf]
  );

  const [pool, setPool] = useState<CubeCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = JSON.stringify(filters);

  const load = useCallback(
    async (onFetchProgress?: CardFetchProgress): Promise<CubeCard[] | null> => {
      if (pool && loadedKey === key) return pool;
      setLoading(true);
      setError('');
      try {
        await Promise.all([loadTaggerData(), loadCubeSignal(), ensureCardTags()]);
        // Recomputed fresh (not the outer memo): ensureCardTags() may have just
        // resolved, and the memo above won't reflect that until the next render.
        const { names } = filterPool(collectionCards, availableNames, filters);
        const enriched = await fetchCubeOracle(names, collectionCards, onFetchProgress);
        const built = namesToCubePool(names, collectionCards, enriched);
        setPool(built);
        setLoadedKey(key);
        return built;
      } catch (e) {
        setError(userMessage(e, "Couldn't load your collection's cards. Try again."));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [pool, loadedKey, key, collectionCards, availableNames, filters]
  );

  return { pool, uniqueNames, hidden, loading, error, load };
}
