import { useMemo } from 'react';
import { useCollectionStore } from '@/store/collection';
import { ownedNameSet } from './browse-lists';

/** Lower-cased names of every card in the viewer's collection, full name and
 *  front face (see `ownedNameSet`), for marking what they own in a list. */
export function useOwnedNames(): Set<string> {
  const cards = useCollectionStore((s) => s.cards);
  return useMemo(() => ownedNameSet(cards), [cards]);
}
