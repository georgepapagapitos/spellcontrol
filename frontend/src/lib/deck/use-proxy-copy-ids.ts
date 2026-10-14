import { useMemo } from 'react';
import { useCollectionStore } from '@/store/collection';
import { proxyCopyIdsOf } from './deck-value';

/** The collection's proxy copies by copy id, for `ownDeckValue`. */
export function useProxyCopyIds(): ReadonlySet<string> {
  const cards = useCollectionStore((s) => s.cards);
  return useMemo(() => proxyCopyIdsOf(cards), [cards]);
}
