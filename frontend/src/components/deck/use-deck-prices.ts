import { useEffect, useSyncExternalStore } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getPricesVersion, subscribePrices } from '@/lib/collection/card-prices';
import { resolveDeckPrices } from '@/lib/deck/deck-price-resolve';

/**
 * Keeps the displayed decks' prices current. Re-resolves printings the device
 * price cache doesn't have (once per TTL, batched, see deck-price-resolve) and
 * returns the price-cache version: put it in the deps of anything derived from
 * `priceOf` / `deckValue` so it recomputes when prices land.
 */
export function useDeckPrices(cards: readonly (ScryfallCard | null | undefined)[]): number {
  const version = useSyncExternalStore(subscribePrices, getPricesVersion, getPricesVersion);
  const key = cards
    .map((c) => c?.id)
    .filter(Boolean)
    .join(',');
  useEffect(() => {
    if (key) void resolveDeckPrices(key.split(','));
  }, [key]);
  return version;
}
