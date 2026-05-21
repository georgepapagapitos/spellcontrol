// Multi-copy card pipeline ("A deck can have any number of cards named ...").
// Self-contained; extracted verbatim from deckGenerator.ts.
import { logger } from '@/lib/logger';
import type { ScryfallCard, MaxRarity } from '@/deck-builder/types';
import { fetchMultiCopyCardNames, getCardByName } from '@/deck-builder/services/scryfall/client';
import { fetchAverageDeckMultiCopies } from '@/deck-builder/services/edhrec/client';
import { exceedsMaxPrice, exceedsMaxRarity, isOwnedRarityExempt } from './deckFilters';

// ============================================================
// Multi-copy card support ("A deck can have any number of...")
// ============================================================
const DEFAULT_MULTI_COPY_COUNT = 15; // Fallback when EDHREC average deck is unavailable

export interface MultiCopyResult {
  card: ScryfallCard;
  copies: ScryfallCard[];
}

/**
 * Self-contained pipeline: detect "any number of copies" cards in the EDHREC cardlist,
 * fetch the recommended quantity from EDHREC's average deck, scale to deck size,
 * and return the copies to add. Returns empty array if no multi-copy cards found.
 *
 * Uses Scryfall oracle text search to dynamically detect multi-copy cards
 * rather than a hardcoded list, so new cards are automatically supported.
 */
export async function resolveMultiCopyCards(
  edhrecCardNames: string[],
  commanderName: string,
  themeSlug: string | undefined,
  usedNames: Set<string>,
  deckSize: number,
  bannedCards: Set<string>,
  maxCardPrice: number | null,
  maxRarity: MaxRarity,
  currency: 'USD' | 'EUR' = 'USD',
  collectionNames?: Set<string>,
  ignoreOwnedRarity: boolean = false
): Promise<MultiCopyResult[]> {
  // Step 1: Fetch the set of all multi-copy cards from Scryfall (cached after first call)
  const multiCopyCards = await fetchMultiCopyCardNames();
  if (multiCopyCards.size === 0) return [];

  // Step 2: Check if any EDHREC card is a multi-copy card
  const matches = edhrecCardNames.filter(
    (name) => multiCopyCards.has(name) && !bannedCards.has(name)
  );
  if (matches.length === 0) return [];

  logger.debug(`[DeckGen] Multi-copy cards detected in cardlist: ${matches.join(', ')}`);

  // Step 3: Fetch ALL quantities in one request (null = fetch failed entirely)
  const quantityMap = await fetchAverageDeckMultiCopies(commanderName, matches, themeSlug);
  const fetchFailed = quantityMap === null;

  const results: MultiCopyResult[] = [];

  for (const cardName of matches) {
    const maxCopies = multiCopyCards.get(cardName)!; // null = unlimited

    let quantity: number;
    if (fetchFailed) {
      // Endpoint unreachable — use a sensible fallback
      quantity = maxCopies ?? DEFAULT_MULTI_COPY_COUNT;
      logger.debug(
        `[DeckGen] Average deck unavailable, using fallback ${quantity} for "${cardName}"`
      );
    } else if (quantityMap.has(cardName)) {
      // Card found in average deck with >1 copies — use that count
      quantity = quantityMap.get(cardName)!;
    } else {
      // Fetch succeeded but card only has 1 copy in average deck — skip multi-copy
      logger.debug(`[DeckGen] "${cardName}" not multi-copy in average deck, skipping`);
      continue;
    }

    // Step 4: Scale to deck size (EDHREC data is based on 100-card decks)
    const scaledQuantity = Math.round(quantity * (deckSize / 100));
    let finalQuantity = Math.max(2, scaledQuantity); // Minimum 2 copies

    // Step 5: Respect maxCopies cap
    if (maxCopies !== null) {
      finalQuantity = Math.min(finalQuantity, maxCopies);
    }

    // Step 6: If already in deck as must-include, reduce count
    const existingCount = usedNames.has(cardName) ? 1 : 0;
    const copiesToAdd = finalQuantity - existingCount;
    if (copiesToAdd <= 0) {
      logger.debug(`[DeckGen] "${cardName}" already in deck, no extra copies needed`);
      continue;
    }

    // Step 7: Fetch the card from Scryfall
    try {
      const card = await getCardByName(cardName);
      if (!card) {
        logger.warn(`[DeckGen] Could not find "${cardName}" on Scryfall, skipping multi-copy`);
        continue;
      }

      // Verify price/rarity constraints on the card itself
      if (exceedsMaxPrice(card, maxCardPrice, currency)) {
        logger.debug(`[DeckGen] "${cardName}" exceeds max card price, skipping multi-copy`);
        continue;
      }
      if (!isOwnedRarityExempt(cardName, collectionNames, ignoreOwnedRarity)) {
        if (exceedsMaxRarity(card, maxRarity)) {
          logger.debug(`[DeckGen] "${cardName}" exceeds max rarity, skipping multi-copy`);
          continue;
        }
      }

      // Step 8: Create copies with unique IDs
      const copies: ScryfallCard[] = [];
      for (let i = 0; i < copiesToAdd; i++) {
        copies.push({ ...card, id: `${card.id}-multi-${i}` });
      }

      logger.debug(
        `[DeckGen] Adding ${copiesToAdd} copies of "${cardName}" (scaled from ${quantity} in 100-card to ${finalQuantity} in ${deckSize}-card deck)`
      );
      results.push({ card, copies });
    } catch (error) {
      logger.warn(`[DeckGen] Failed to fetch "${cardName}" for multi-copy:`, error);
    }
  }

  return results;
}
