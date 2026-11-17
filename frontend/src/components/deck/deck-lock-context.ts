import { createContext, useContext } from 'react';

export const NO_LOCKS: ReadonlySet<string> = new Set();

/** Names of the deck's locked cards (lib/deck/deck-locks), for the row and
 *  tile marks. Empty outside a deck that can be regenerated. */
export const DeckLockContext = createContext<ReadonlySet<string>>(NO_LOCKS);

export const useIsLocked = (name: string): boolean => useContext(DeckLockContext).has(name);
