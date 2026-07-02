// Card-eligibility predicates used during deck generation.
// Pure functions — no shared state, no side effects. Extracted verbatim from
// deckGenerator.ts so they can be unit-tested in isolation.
import type { ScryfallCard, MaxRarity, CollectionStrategy } from '@/deck-builder/types';
import { getCardPrice, getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';

// Check if a card's color identity fits within the commander's color identity
export function fitsColorIdentity(card: ScryfallCard, commanderColors: string[]): boolean {
  const cardColors = card.color_identity || [];
  // Every color in the card's identity must be in the commander's identity
  return cardColors.every((color) => commanderColors.includes(color));
}

// Check if a card exceeds the max price limit
// Cards with no price are treated as exceeding the limit when a budget is active
export function exceedsMaxPrice(
  card: ScryfallCard,
  maxPrice: number | null,
  currency: 'USD' | 'EUR' = 'USD'
): boolean {
  if (maxPrice === null) return false;
  const priceStr = getCardPrice(card, currency);
  if (!priceStr) return true; // No price data — skip when budget is set
  const price = parseFloat(priceStr);
  return isNaN(price) || price > maxPrice;
}

// Check if a card exceeds the max rarity limit
const RARITY_ORDER: Record<string, number> = { common: 0, uncommon: 1, rare: 2, mythic: 3 };

export function exceedsMaxRarity(card: ScryfallCard, maxRarity: MaxRarity): boolean {
  if (maxRarity === null) return false;
  return (RARITY_ORDER[card.rarity] ?? 3) > RARITY_ORDER[maxRarity];
}

// Check if a card is NOT in the user's collection (for collection mode)
export function notInCollection(
  cardName: string,
  collectionNames: Set<string> | undefined
): boolean {
  if (!collectionNames) return false;
  return !collectionNames.has(cardName);
}

// Strategies that promise the generated deck is constrained to the provided
// collectionNames set. For "available", callers pass only names with free
// unclaimed copies, so it must be just as strict as "full".
export function constrainsToCollection(strategy: CollectionStrategy): boolean {
  return strategy === 'full' || strategy === 'available';
}

// Check if an owned card is exempt from budget constraints
export function isOwnedBudgetExempt(
  cardName: string,
  collectionNames: Set<string> | undefined,
  ignoreOwnedBudget: boolean
): boolean {
  return ignoreOwnedBudget && !!collectionNames && collectionNames.has(cardName);
}

// Check if an owned card is exempt from rarity constraints
export function isOwnedRarityExempt(
  cardName: string,
  collectionNames: Set<string> | undefined,
  ignoreOwnedRarity: boolean
): boolean {
  return ignoreOwnedRarity && !!collectionNames && collectionNames.has(cardName);
}

// Check if a card is not available on MTG Arena (for Arena-only mode)
export function notOnArena(card: ScryfallCard, arenaOnly: boolean): boolean {
  if (!arenaOnly) return false;
  return !card.games?.includes('arena');
}

// Check if a non-land card exceeds the CMC cap (for Tiny Leaders)
export function exceedsCmcCap(card: ScryfallCard, maxCmc: number | null): boolean {
  if (maxCmc === null) return false;
  // Lands are never filtered by CMC (use front face for MDFCs)
  if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) return false;
  return card.cmc > maxCmc;
}

// Check if a card is banned/not legal in Commander. EDHREC/lift-derived pools
// aren't pre-scoped to legality (unlike the Scryfall-search fallback, which
// queries within `f:commander` implicitly via its color-identity search), so
// candidates sourced from a card page need an explicit gate.
export function notCommanderLegal(card: ScryfallCard): boolean {
  return card.legalities.commander !== 'legal';
}
