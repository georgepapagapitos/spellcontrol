import { useMemo } from 'react';
import { useDecksStore, type Deck } from '../store/decks';
import { useCollectionStore } from '../store/collection';
import type { EnrichedCard } from '../types';

/**
 * Per-allocation info: which deck claims this physical card copy,
 * and which logical card slot in that deck.
 */
export interface AllocationInfo {
  deckId: string;
  deckName: string;
  cardName: string;
}

/**
 * Map<copyId → AllocationInfo>. Read by `CardSlot` and the binder UI
 * to grey out copies that are "checked out" to a saved deck. The map only
 * contains entries with a non-null `allocatedCopyId`; cards in decks
 * the user does not own (or that have been orphaned by a collection
 * delete) do not appear here.
 */
export function useAllocations(): Map<string, AllocationInfo> {
  const decks = useDecksStore((s) => s.decks);
  return useMemo(() => buildAllocationMap(decks), [decks]);
}

export function buildAllocationMap(decks: Deck[]): Map<string, AllocationInfo> {
  const m = new Map<string, AllocationInfo>();
  for (const deck of decks) {
    if (deck.commander && deck.commanderAllocatedCopyId) {
      m.set(deck.commanderAllocatedCopyId, {
        deckId: deck.id,
        deckName: deck.name,
        cardName: deck.commander.name,
      });
    }
    if (deck.partnerCommander && deck.partnerCommanderAllocatedCopyId) {
      m.set(deck.partnerCommanderAllocatedCopyId, {
        deckId: deck.id,
        deckName: deck.name,
        cardName: deck.partnerCommander.name,
      });
    }
    for (const c of deck.cards) {
      if (c.allocatedCopyId) {
        m.set(c.allocatedCopyId, {
          deckId: deck.id,
          deckName: deck.name,
          cardName: c.card.name,
        });
      }
    }
    for (const c of deck.sideboard ?? []) {
      if (c.allocatedCopyId) {
        m.set(c.allocatedCopyId, {
          deckId: deck.id,
          deckName: deck.name,
          cardName: c.card.name,
        });
      }
    }
  }
  return m;
}

/**
 * Pick the best collection copy of a named card to allocate to a deck.
 *
 * Preference order:
 *   1. Not already allocated to any deck (so we never double-claim).
 *   2. Non-foil over foil (foils are usually display copies).
 *   3. Cheapest purchasePrice (so the deck claims the budget copy first;
 *      premium copies stay free for the user).
 */
export function pickCollectionCopy(
  cardName: string,
  collection: EnrichedCard[],
  allocated: Map<string, AllocationInfo>,
  preferredScryfallId?: string
): EnrichedCard | null {
  const candidates = collection.filter((c) => c.name === cardName && !allocated.has(c.copyId));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (preferredScryfallId) {
      const aMatch = a.scryfallId === preferredScryfallId ? 0 : 1;
      const bMatch = b.scryfallId === preferredScryfallId ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    const finishRank = { nonfoil: 0, foil: 1, etched: 2 } as const;
    const aRank = finishRank[a.finish] ?? (a.foil ? 1 : 0);
    const bRank = finishRank[b.finish] ?? (b.foil ? 1 : 0);
    if (aRank !== bRank) return aRank - bRank;
    return (a.purchasePrice ?? 0) - (b.purchasePrice ?? 0);
  });
  return candidates[0];
}

/**
 * Lookup of `EnrichedCard` by `copyId` for the current collection.
 * Used by the editor to render allocation badges with set/finish info.
 *
 * Returns `undefined` while the collection store is still rehydrating
 * from localStorage so callers can avoid mis-classifying allocated slots
 * as orphans (which paints them red) on first render.
 */
export function useCollectionByCopyId(): Map<string, EnrichedCard> | undefined {
  const cards = useCollectionStore((s) => s.cards);
  const hydrating = useCollectionStore((s) => s.hydrating);
  return useMemo(() => {
    if (hydrating) return undefined;
    const m = new Map<string, EnrichedCard>();
    for (const c of cards) m.set(c.copyId, c);
    return m;
  }, [cards, hydrating]);
}

/**
 * Status of a deck slot, computed against the live collection. We do not
 * persist this — it is always derivable.
 */
export type AllocationStatus = 'allocated' | 'unowned' | 'orphan';

export function classifyAllocation(
  allocatedCopyId: string | null,
  collectionById: Map<string, EnrichedCard> | undefined
): AllocationStatus {
  if (!allocatedCopyId) return 'unowned';
  // Collection store hasn't rehydrated yet — defer the orphan check so we
  // don't paint every allocated row red for one frame on load.
  if (!collectionById) return 'allocated';
  return collectionById.has(allocatedCopyId) ? 'allocated' : 'orphan';
}
