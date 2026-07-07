import { logger } from '@/lib/logger';
import type {
  CoherenceRepair,
  DetectedCombo,
  ScryfallCard,
  DeckCategory,
  TargetBracket,
} from '@/deck-builder/types';
import type { GenerationState } from './state';
import { frontFaceName } from '@/lib/card-text';
import {
  constrainsToCollection,
  notInCollection,
  exceedsMaxPrice,
  isOwnedBudgetExempt,
  fitsColorIdentity,
} from '../deckFilters';
import { stampRoleSubtypes, routeCardByType } from '../categorize';
import type { BudgetTracker } from '../budgetTracker';

// ── Combo Floor ──
// If the generated deck contains zero complete 2-card combos AND the bracket
// permits combos (bracket ≥ 3 or unrestricted), try to seed exactly ONE
// 2-card combo from the commander's known combo list.
//
// Seeding criteria (in priority order):
//   1. Exactly 1 card is missing from the deck.
//   2. The missing card is not banned and satisfies collection/price constraints.
//   3. The missing card is available in scryfallCardMap.
//   4. Among qualifying combos, prefer highest `deckCount` (most popular).
//
// If seeding is possible, the missing piece is swapped in by evicting the
// lowest-priority non-essential non-land card.  Deck size/curve/legality
// are preserved (1-for-1 swap).  If no eligible combo can be seeded without
// violating constraints, the deck is left unchanged.
//
// This fires only when comboCountSetting is 0 (user didn't ask for combos).
// When the user explicitly requests combos, the upstream combo-boost +
// Combo Integrity Audit already handle seeding.

export interface ComboFloorContext {
  /** Result of detectCombosPhase — may be undefined if no combos were detected. */
  detectedCombos: DetectedCombo[] | undefined;
  /** Full Scryfall card map built during generation (name → card). */
  scryfallCardMap: Map<string, ScryfallCard>;
  /** Cards the user wants protected from eviction (lower-cased). */
  mustIncludeNames: Set<string>;
  /** Current target bracket (undefined / 'all' = unrestricted). */
  targetBracket: TargetBracket | undefined;
  /** Same budget gate cardPicking/scryfallFill/coherenceRepair enforce.
   *  All default to "no budget constraint" so existing callers/tests are unaffected. */
  budgetTracker?: BudgetTracker | null;
  maxCardPrice?: number | null;
  currency?: 'USD' | 'EUR';
  ignoreOwnedBudget?: boolean;
}

export interface ComboFloorResult {
  /** Updated detected-combos list (with the seeded combo marked complete). */
  detectedCombos: DetectedCombo[] | undefined;
  /** True if a combo was seeded. */
  seeded: boolean;
  /** Count of otherwise-eligible combo pieces skipped for exceeding budget. */
  budgetSkipped: number;
  /** The swap this phase applied, in the same {cut, added, reason} shape every
   *  sibling swap phase discloses (S2 — nothing moves silently). Null when no
   *  combo was seeded. */
  repair: CoherenceRepair | null;
}

/**
 * Returns true when the target bracket allows 2-card combos.
 *
 * Brackets 1 & 2 are intentionally combo-free in the RC framework.
 * Bracket 3+ explicitly permits infinite combos; undefined / 'all' means
 * no restriction was set by the user.
 */
export function bracketAllowsCombos(target: TargetBracket | undefined): boolean {
  if (target === undefined || target === 'all') return true;
  return (target as number) >= 3;
}

export function applyComboFloor(state: GenerationState, ctx: ComboFloorContext): ComboFloorResult {
  const {
    detectedCombos,
    scryfallCardMap,
    mustIncludeNames,
    targetBracket,
    budgetTracker = null,
    maxCardPrice = null,
    currency = 'USD',
    ignoreOwnedBudget = false,
  } = ctx;

  // Don't fire when the user has explicitly requested combos (the Combo
  // Integrity Audit already runs in that path).
  if (state.cfg.comboCountSetting > 0) {
    return { detectedCombos, seeded: false, budgetSkipped: 0, repair: null };
  }

  // Respect bracket guardrail — brackets 1 & 2 are combo-free.
  if (!bracketAllowsCombos(targetBracket)) {
    return { detectedCombos, seeded: false, budgetSkipped: 0, repair: null };
  }

  // Check whether the deck already has at least one complete 2-card combo.
  const hasComplete2Card = detectedCombos?.some((dc) => dc.isComplete && dc.cardCount <= 2);
  if (hasComplete2Card) {
    return { detectedCombos, seeded: false, budgetSkipped: 0, repair: null };
  }

  // No combos to search from — bail early.
  if (state.combos.length === 0) {
    return { detectedCombos, seeded: false, budgetSkipped: 0, repair: null };
  }

  // Build the current deck name set (commanders + category cards).
  const deckNames = new Set<string>();
  const { commander, partnerCommander } = state.context;
  if (commander) {
    deckNames.add(commander.name);
    if (commander.name.includes(' // ')) deckNames.add(frontFaceName(commander.name));
  }
  if (partnerCommander) {
    deckNames.add(partnerCommander.name);
    if (partnerCommander.name.includes(' // ')) deckNames.add(frontFaceName(partnerCommander.name));
  }
  for (const card of Object.values(state.categories).flat()) {
    deckNames.add(card.name);
    if (card.name.includes(' // ')) deckNames.add(frontFaceName(card.name));
  }

  const ownedOnly = constrainsToCollection(state.cfg.collectionStrategy);

  // Find the best 2-card combo where exactly 1 piece is missing and can be added.
  interface Candidate {
    combo: (typeof state.combos)[0];
    missingName: string;
    missingCard: ScryfallCard;
  }
  let best: Candidate | null = null;
  let budgetSkipped = 0;

  // Sort combos descending by deckCount so we pick the most popular first.
  const sorted = [...state.combos]
    .filter((c) => c.cardCount <= 2 && !c.cards.some((p) => state.bannedCards.has(p.name)))
    .sort((a, b) => b.deckCount - a.deckCount);

  for (const combo of sorted) {
    const missingPieces = combo.cards.map((p) => p.name).filter((name) => !deckNames.has(name));

    if (missingPieces.length !== 1) continue;

    const missingName = missingPieces[0];
    if (state.bannedCards.has(missingName)) continue;
    if (ownedOnly && notInCollection(missingName, state.context.collectionNames)) continue;

    const missingCard = scryfallCardMap.get(missingName);
    if (!missingCard) continue;
    // state.combos (fetched per-commander from EDHREC) should already be
    // identity-legal, but this is by-name resolution from the same
    // all-combos batch fetch the audit uses — never trust that without
    // checking (see the Combo Integrity Audit's identical gate).
    if (!fitsColorIdentity(missingCard, state.context.colorIdentity)) continue;

    // Same budget gate cardPicking/scryfallFill/coherenceRepair enforce —
    // owned copies are exempt, everything else checks the live effective cap.
    if (!isOwnedBudgetExempt(missingName, state.context.collectionNames, ignoreOwnedBudget)) {
      const cap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
      if (exceedsMaxPrice(missingCard, cap, currency)) {
        budgetSkipped++;
        continue; // next-best combo under budget
      }
    }

    best = { combo, missingName, missingCard };
    break; // highest deckCount wins; first match is best
  }

  if (!best) {
    logger.debug('[DeckGen] Combo floor: no eligible 2-card combo found to seed');
    return { detectedCombos, seeded: false, budgetSkipped, repair: null };
  }

  // Names that must never be evicted to make room for the seed: the pieces of
  // the very combo we're completing (evicting the partner would defeat the
  // seed), plus any cards already flagged as combo pieces upstream.
  const protectedNames = new Set<string>(best.combo.cards.map((p) => p.name));

  // Find the weakest evictable card. Categories are searched weakest-filler
  // first; within a category the LAST-appended card is the weakest (generation
  // appends best-fit first, filler last). Lands are never evicted (they hold the
  // mana base), nor are must-include cards, known combo pieces, or this combo's
  // own pieces.
  const EVICTION_ORDER: DeckCategory[] = [
    'synergy',
    'utility',
    'creatures',
    'cardDraw',
    'singleRemoval',
    'boardWipes',
    'ramp',
  ];
  function findWeakest(): { card: ScryfallCard; category: DeckCategory } | null {
    for (const cat of EVICTION_ORDER) {
      const cards = state.categories[cat];
      if (!cards) continue;
      for (let i = cards.length - 1; i >= 0; i--) {
        const card = cards[i];
        if (mustIncludeNames.has(card.name.toLowerCase())) continue;
        if (state.comboCardNames.has(card.name)) continue;
        if (protectedNames.has(card.name)) continue;
        return { card, category: cat };
      }
    }
    return null;
  }

  const evict = findWeakest();
  if (!evict) {
    logger.debug('[DeckGen] Combo floor: no evictable card found');
    return { detectedCombos, seeded: false, budgetSkipped, repair: null };
  }

  // Perform the swap.
  state.categories[evict.category] = state.categories[evict.category].filter(
    (c) => c !== evict.card
  );
  state.usedNames.delete(evict.card.name);

  // Add the missing combo piece to the appropriate category.
  stampRoleSubtypes(best.missingCard);
  routeCardByType(best.missingCard, state.categories);
  state.usedNames.add(best.missingName);
  if (best.missingCard.name.includes(' // ')) {
    state.usedNames.add(frontFaceName(best.missingCard.name));
  }
  if (!isOwnedBudgetExempt(best.missingName, state.context.collectionNames, ignoreOwnedBudget)) {
    budgetTracker?.deductCard(best.missingCard);
  }

  logger.debug(
    `[DeckGen] Combo floor: seeded combo ${best.combo.comboId} ` +
      `(${best.combo.cards.map((p) => p.name).join(' + ')}) ` +
      `→ added ${best.missingName}, evicted ${evict.card.name}`
  );

  // Rebuild detectedCombos to reflect the seeded combo.
  const newDeckNames = new Set<string>();
  if (commander) {
    newDeckNames.add(commander.name);
    if (commander.name.includes(' // ')) newDeckNames.add(frontFaceName(commander.name));
  }
  if (partnerCommander) {
    newDeckNames.add(partnerCommander.name);
    if (partnerCommander.name.includes(' // '))
      newDeckNames.add(frontFaceName(partnerCommander.name));
  }
  for (const card of Object.values(state.categories).flat()) {
    newDeckNames.add(card.name);
    if (card.name.includes(' // ')) newDeckNames.add(frontFaceName(card.name));
  }

  const seededDetected: DetectedCombo = {
    comboId: best.combo.comboId,
    cards: best.combo.cards.map((p) => p.name),
    results: best.combo.results,
    isComplete: true,
    missingCards: [],
    deckCount: best.combo.deckCount,
    bracket: best.combo.bracket,
    bracketTag: best.combo.bracketTag ?? null,
    cardCount: best.combo.cardCount,
  };

  const updated = (detectedCombos ?? [])
    .map((dc) => {
      const missing = dc.cards.filter((n) => !newDeckNames.has(n));
      return { ...dc, isComplete: missing.length === 0, missingCards: missing };
    })
    .filter((dc) => dc.isComplete || dc.missingCards.length <= 2);

  // Add the newly seeded combo if it's not already in the list.
  if (!updated.some((dc) => dc.comboId === seededDetected.comboId)) {
    updated.unshift(seededDetected);
  }

  const producesText = best.combo.results.length > 0 ? ` (${best.combo.results.join(', ')})` : '';
  return {
    detectedCombos: updated.length > 0 ? updated : undefined,
    seeded: true,
    budgetSkipped,
    repair: {
      cut: evict.card.name,
      added: best.missingCard.name,
      reason: `Completes the ${best.combo.cards.map((p) => p.name).join(' + ')} combo${producesText}`,
    },
  };
}
