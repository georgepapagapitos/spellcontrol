import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import {
  isProtectionPiece,
  isFreeInteraction,
  validateCardRole,
} from '@/deck-builder/services/tagger/client';
import type { GenerationState } from './state';
import { countAllCards } from './state';
import {
  MUST_INCLUDE_BOOST,
  LAND_PROTECTION_BOOST,
  COMBO_TRIM_BOOST,
  ROLE_DEFICIT_TRIM_BOOST,
  ROLE_SURPLUS_TRIM_PENALTY,
  STAPLE_PROTECTION_BOOST,
  PROTECTION_PIECE_BOOST,
  FREE_INTERACTION_BOOST,
} from './trimResistanceConstants';

// ── Smart Trim: priority-aware, role-aware, combo-aware ──
// Verbatim extraction from generateDeckInner. Resistance formula lives in
// computeTrimResistance below (module-scope, unit-tested independently of
// this orchestration — moved here since this pass is its only caller;
// re-exported from deckGenerator.ts so deckGenerator.notes.test.ts keeps
// importing from the stable public API).

/**
 * Per-card trim resistance for the Smart Trim pass: higher survives, lower
 * gets cut first. Position in its category is the base signal (cards are
 * already priority-ordered, so a higher index = lower priority = lower
 * resistance); must-includes, staple rocks, lands (up to the land target),
 * combo pieces, and role-deficit cards all add protection, while role
 * surplus (>= target+3) subtracts it.
 */
export function computeTrimResistance(
  card: ScryfallCard,
  positionIndex: number,
  categoryLength: number,
  category: DeckCategory,
  comboCardNames: ReadonlySet<string>,
  roleTargets: Record<RoleKey, number> | null,
  currentRoleCounts: Record<RoleKey, number>
): number {
  let resistance = categoryLength - positionIndex;

  if (card.isMustInclude) {
    resistance += MUST_INCLUDE_BOOST;
  }
  if (card.isStapleRock) {
    resistance += STAPLE_PROTECTION_BOOST;
  }
  if (isProtectionPiece(card)) {
    resistance += PROTECTION_PIECE_BOOST;
  }
  if (isFreeInteraction(card)) {
    resistance += FREE_INTERACTION_BOOST;
  }
  if (category === 'lands' && !card.isMustInclude) {
    resistance += LAND_PROTECTION_BOOST;
  }
  if (comboCardNames.has(card.name)) {
    resistance += COMBO_TRIM_BOOST;
  }
  if (roleTargets) {
    const role = validateCardRole(card);
    if (role) {
      const target = roleTargets[role] ?? 0;
      const current = currentRoleCounts[role] ?? 0;
      if (current <= target) {
        resistance += ROLE_DEFICIT_TRIM_BOOST;
      } else if (current >= target + 3) {
        resistance += ROLE_SURPLUS_TRIM_PENALTY;
      }
    }
  }

  return resistance;
}

export interface SmartTrimContext {
  /** Deck's final card-count target (commander-count-adjusted format size). */
  targetDeckSize: number;
  /** Planned land count (targets.lands) — the trim never cuts below it. */
  landTarget: number;
  /** Balanced-roles targets; null when the toggle is off (deficit/surplus
   *  boosts are skipped in computeTrimResistance in that case). */
  roleTargets: Record<RoleKey, number> | null;
}

/**
 * Trims the deck down to targetDeckSize when generation overshot, in
 * ascending trim-resistance order (weakest first), respecting a land-trim
 * budget so the mana base never gets cut below its target. No-op when the
 * deck isn't over size.
 */
export function smartTrimPhase(state: GenerationState, ctx: SmartTrimContext): void {
  const { targetDeckSize, landTarget, roleTargets } = ctx;
  const { categories, comboCardNames, currentRoleCounts } = state;

  const currentCount = countAllCards(state);
  if (currentCount > targetDeckSize) {
    const trimCandidates: { card: ScryfallCard; category: DeckCategory; trimResistance: number }[] =
      [];

    // Protect lands: calculate how many non-must-include lands we can afford to trim
    const currentLandCount = categories.lands.length;
    const landTrimBudget = Math.max(0, currentLandCount - landTarget);

    for (const cat of Object.keys(categories) as DeckCategory[]) {
      const cards = categories[cat];
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const resistance = computeTrimResistance(
          card,
          i,
          cards.length,
          cat,
          comboCardNames,
          roleTargets,
          currentRoleCounts
        );
        trimCandidates.push({ card, category: cat, trimResistance: resistance });
      }
    }

    // Sort ascending: lowest resistance = first to trim
    trimCandidates.sort((a, b) => a.trimResistance - b.trimResistance);

    const excess = currentCount - targetDeckSize;
    // Respect the land trim budget: don't trim more lands than we can afford
    const toRemove: typeof trimCandidates = [];
    let landsTrimmed = 0;
    for (const candidate of trimCandidates) {
      if (toRemove.length >= excess) break;
      if (candidate.category === 'lands' && !candidate.card.isMustInclude) {
        if (landsTrimmed >= landTrimBudget) continue; // skip — would go below land target
        landsTrimmed++;
      }
      toRemove.push(candidate);
    }

    // Build removal sets per category for efficient filtering
    const removeByCategory = new Map<DeckCategory, Set<ScryfallCard>>();
    for (const { card, category } of toRemove) {
      if (!removeByCategory.has(category)) removeByCategory.set(category, new Set());
      removeByCategory.get(category)!.add(card);
    }

    // Apply removals
    for (const [cat, removeSet] of removeByCategory) {
      categories[cat] = categories[cat].filter((c) => !removeSet.has(c));
    }

    // Update role counts for trimmed role cards
    if (roleTargets) {
      for (const { card } of toRemove) {
        const role = validateCardRole(card);
        if (role && currentRoleCounts[role] > 0) {
          currentRoleCounts[role]--;
        }
      }
    }
  }
}
