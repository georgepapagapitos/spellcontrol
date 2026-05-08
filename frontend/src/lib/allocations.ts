import { useMemo } from 'react';
import { useDecksStore, type Deck } from '../store/decks';
import { useCollectionStore } from '../store/collection';
import type { EnrichedCard } from '../types';

/**
 * Per-allocation info: which deck claims this physical Scryfall printing,
 * and which logical card slot in that deck.
 */
export interface AllocationInfo {
  deckId: string;
  deckName: string;
  cardName: string;
}

/**
 * Map<scryfallId → AllocationInfo>. Read by `CardSlot` and the binder UI
 * to grey out copies that are "checked out" to a saved deck. The map only
 * contains entries with a non-null `allocatedScryfallId`; cards in decks
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
    if (deck.commander && deck.commanderAllocatedScryfallId) {
      m.set(deck.commanderAllocatedScryfallId, {
        deckId: deck.id,
        deckName: deck.name,
        cardName: deck.commander.name,
      });
    }
    if (deck.partnerCommander && deck.partnerCommanderAllocatedScryfallId) {
      m.set(deck.partnerCommanderAllocatedScryfallId, {
        deckId: deck.id,
        deckName: deck.name,
        cardName: deck.partnerCommander.name,
      });
    }
    for (const c of deck.cards) {
      if (c.allocatedScryfallId) {
        m.set(c.allocatedScryfallId, {
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
  allocated: Map<string, AllocationInfo>
): EnrichedCard | null {
  const candidates = collection.filter((c) => c.name === cardName && !allocated.has(c.scryfallId));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.foil !== b.foil) return a.foil ? 1 : -1;
    return (a.purchasePrice ?? 0) - (b.purchasePrice ?? 0);
  });
  return candidates[0];
}

/**
 * Lookup of `EnrichedCard` by `scryfallId` for the current collection.
 * Used by the editor to render allocation badges with set/finish info.
 */
export function useCollectionByScryfallId(): Map<string, EnrichedCard> {
  const cards = useCollectionStore((s) => s.cards);
  return useMemo(() => {
    const m = new Map<string, EnrichedCard>();
    for (const c of cards) m.set(c.scryfallId, c);
    return m;
  }, [cards]);
}

/**
 * Status of a deck slot, computed against the live collection. We do not
 * persist this — it is always derivable.
 */
export type AllocationStatus = 'allocated' | 'unowned' | 'orphan';

export function classifyAllocation(
  allocatedScryfallId: string | null,
  collectionById: Map<string, EnrichedCard>
): AllocationStatus {
  if (!allocatedScryfallId) return 'unowned';
  return collectionById.has(allocatedScryfallId) ? 'allocated' : 'orphan';
}
