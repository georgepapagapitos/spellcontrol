// Scryfall-search fallback fill: used when EDHREC pools can't satisfy a slot
// target. Extracted verbatim from deckGenerator.ts.
import { logger } from '@/lib/logger';
import type { ScryfallCard, MaxRarity, CollectionStrategy } from '@/deck-builder/types';
import { searchCards } from '@/deck-builder/services/scryfall/client';
import { BudgetTracker } from './budgetTracker';
import {
  exceedsMaxPrice,
  exceedsMaxRarity,
  notInCollection,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  notOnArena,
  exceedsCmcCap,
} from './deckFilters';

// Fill remaining slots with Scryfall search (fallback)
export async function fillWithScryfall(
  query: string,
  colorIdentity: string[],
  count: number,
  usedNames: Set<string>,
  bannedCards: Set<string> = new Set(),
  maxCardPrice: number | null = null,
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  currency: 'USD' | 'EUR' = 'USD',
  arenaOnly: boolean = false,
  scryfallQuery: string = '',
  collectionStrategy: CollectionStrategy = 'full',
  ignoreOwnedBudget: boolean = false,
  ignoreOwnedRarity: boolean = false
): Promise<ScryfallCard[]> {
  if (count <= 0) return [];

  // Add rarity filter to Scryfall query if set (skip when owned cards can bypass rarity)
  let fullQuery = query;
  if (maxRarity && !ignoreOwnedRarity) {
    fullQuery += ` r<=${maxRarity}`;
  }
  // Add CMC cap to Scryfall query (Tiny Leaders)
  if (maxCmc !== null) {
    fullQuery += ` cmc<=${maxCmc}`;
  }
  // Restrict to Arena-available cards
  if (arenaOnly) {
    fullQuery += ` game:arena`;
  }
  // Append user's additional Scryfall filters
  if (scryfallQuery.trim()) {
    fullQuery += ` ${scryfallQuery.trim()}`;
  }

  try {
    const response = await searchCards(fullQuery, colorIdentity, { order: 'edhrec' });
    const result: ScryfallCard[] = [];

    for (const card of response.data) {
      if (result.length >= count) break;
      if (usedNames.has(card.name)) continue; // Commander format is always singleton
      if (bannedCards.has(card.name)) continue; // Skip banned cards
      if (collectionStrategy === 'full' && notInCollection(card.name, collectionNames)) continue;
      const ownedExempt = isOwnedBudgetExempt(card.name, collectionNames, ignoreOwnedBudget);
      if (!ownedExempt) {
        const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
        if (exceedsMaxPrice(card, effectiveCap, currency)) continue;
      }
      if (!isOwnedRarityExempt(card.name, collectionNames, ignoreOwnedRarity)) {
        if (exceedsMaxRarity(card, maxRarity)) continue;
      }
      if (exceedsCmcCap(card, maxCmc)) continue;
      if (notOnArena(card, arenaOnly)) continue;

      result.push(card);
      usedNames.add(card.name);
      // Also mark front-face name for DFCs so EDHREC-sourced checks match
      if (card.name.includes(' // ')) usedNames.add(card.name.split(' // ')[0]);
      if (!ownedExempt) budgetTracker?.deductCard(card);
    }

    return result;
  } catch (error) {
    logger.error(`Scryfall fallback failed for query "${query}":`, error);
    return [];
  }
}
