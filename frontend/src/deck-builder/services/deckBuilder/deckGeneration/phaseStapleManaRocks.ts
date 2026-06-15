import { logger } from '@/lib/logger';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import {
  constrainsToCollection,
  notInCollection,
  isOwnedBudgetExempt,
  exceedsMaxPrice,
  isOwnedRarityExempt,
  exceedsMaxRarity,
  notOnArena,
} from '../deckFilters';
import { categorizeCards, stampRoleSubtypes } from '../categorize';
import { type GenerationState, markUsed } from './state';

// Auto-include staple mana rocks (Sol Ring / Arcane Signet) — Commander only.
// Verbatim extraction from generateDeck: closed-over free vars rewritten to
// state.X (cfg fields, context, usedNames/bannedCards/categories/
// currentCurveCounts/currentRoleCounts); the markUsed closure call becomes
// the free function markUsed(state, name). Mutates state; no return value.
export async function stapleManaRocksPhase(state: GenerationState): Promise<void> {
  // Sol Ring goes in every Commander deck. Arcane Signet goes in every 2+ color deck.
  // These are so universally played that a deck with Charcoal Diamond but no Arcane Signet is wrong.
  const stapleRocks: { name: string; minColors: number }[] = [
    { name: 'Sol Ring', minColors: 0 },
    { name: 'Arcane Signet', minColors: 1 },
  ];
  if (state.cfg.format === 99) {
    for (const staple of stapleRocks) {
      if (state.context.colorIdentity.length < staple.minColors) continue;
      if (state.usedNames.has(staple.name) || state.bannedCards.has(staple.name)) continue;
      // Respect collection-only mode
      if (
        constrainsToCollection(state.cfg.collectionStrategy) &&
        notInCollection(staple.name, state.context.collectionNames)
      )
        continue;
      try {
        const card = await getCardByName(staple.name, true);
        // Respect budget, rarity, arena-only constraints
        if (
          !isOwnedBudgetExempt(
            staple.name,
            state.context.collectionNames,
            state.cfg.ignoreOwnedBudget
          ) &&
          exceedsMaxPrice(card, state.cfg.maxCardPrice, state.cfg.currency)
        )
          continue;
        if (
          !isOwnedRarityExempt(
            staple.name,
            state.context.collectionNames,
            state.cfg.ignoreOwnedRarity
          ) &&
          exceedsMaxRarity(card, state.cfg.maxRarity)
        )
          continue;
        if (notOnArena(card, state.cfg.arenaOnly)) continue;
        markUsed(state, card.name);
        categorizeCards([card], state.categories);
        const cmc = Math.min(Math.floor(card.cmc), 7);
        state.currentCurveCounts[cmc] = (state.currentCurveCounts[cmc] ?? 0) + 1;
        // Stamp role if available (use tagger directly since cardRoleMap is EDHREC-path only)
        const role = getCardRole(card.name);
        if (role) {
          state.currentRoleCounts[role]++;
          card.deckRole = role;
          stampRoleSubtypes(card);
        }
        logger.debug(`[DeckGen] Auto-included staple: ${staple.name}`);
      } catch {
        // Ignore if not found
      }
    }
  }
}
