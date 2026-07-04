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
import type { BudgetTracker } from '../budgetTracker';

// Auto-include staple mana rocks (Sol Ring / Arcane Signet) — Commander only.
// Verbatim extraction from generateDeck: closed-over free vars rewritten to
// state.X (cfg fields, context, usedNames/bannedCards/categories/
// currentCurveCounts/currentRoleCounts); the markUsed closure call becomes
// the free function markUsed(state, name). Mutates state; no return value.
//
// `budgetTracker` is threaded in (rather than living on state) because these
// staples are added AFTER the tracker is built from must-includes — like every
// other budget-gated pick, they gate on the LIVE effective cap (not just the
// static max) and must deduct their own cost, or a budget deck can silently
// overspend by exactly Sol Ring + Arcane Signet before any convergence pass
// ever sees the spend (E79).
export async function stapleManaRocksPhase(
  state: GenerationState,
  budgetTracker: BudgetTracker | null
): Promise<void> {
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
        // One retry: a transient fetch failure here silently costs the deck a
        // staple (observed live: Sol Ring absent from one panel deck), and
        // nothing downstream re-adds it.
        const card = await getCardByName(staple.name, true).catch(() =>
          getCardByName(staple.name, true)
        );
        const ownedExempt = isOwnedBudgetExempt(
          staple.name,
          state.context.collectionNames,
          state.cfg.ignoreOwnedBudget
        );
        // Respect budget, rarity, arena-only constraints — the dynamic
        // per-card cap (not just the static max), matching every other
        // budget-gated pick path.
        const cap =
          budgetTracker?.getEffectiveCap(state.cfg.maxCardPrice) ?? state.cfg.maxCardPrice;
        if (!ownedExempt && exceedsMaxPrice(card, cap, state.cfg.currency)) continue;
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
        // Force-included AFTER scored categorization, so it lands at the TAIL
        // of categories.ramp — Smart Trim's position-based resistance treats
        // tail = first cut. Flag it so trim can protect it without conflating
        // it with a user-locked must-include (see isStapleRock's doc).
        card.isStapleRock = true;
        markUsed(state, card.name);
        categorizeCards([card], state.categories);
        if (!ownedExempt) budgetTracker?.deductCard(card);
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
      } catch (err) {
        // A missing staple is a real deck-quality loss — leave a trace.
        logger.warn(`[DeckGen] Staple ${staple.name} could not be fetched, skipping`, err);
      }
    }
  }
}
