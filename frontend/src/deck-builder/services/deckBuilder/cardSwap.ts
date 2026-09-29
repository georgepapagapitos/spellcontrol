import type { ScryfallCard, GeneratedDeck, DeckCategory } from '@/deck-builder/types';
import { calculateStats } from './deckGenerator';
import {
  getCardRole,
  getRampSubtype,
  getRemovalSubtype,
  getBoardwipeSubtype,
  getCardDrawSubtype,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { estimateBracket } from './bracketEstimator';
import { computeRoleCounts } from './commanderDeckAnalysis';
import { frontFaceName } from '@/lib/card-text';

const ROLE_TO_CATEGORY: Record<RoleKey, DeckCategory> = {
  ramp: 'ramp',
  removal: 'singleRemoval',
  boardwipe: 'boardWipes',
  cardDraw: 'cardDraw',
};

/** Find which DeckCategory a card is stored in. */
function findCardCategory(
  card: ScryfallCard,
  categories: GeneratedDeck['categories']
): DeckCategory | null {
  for (const [category, cards] of Object.entries(categories)) {
    if (cards.some((c) => c.name === card.name)) {
      return category as DeckCategory;
    }
  }
  return null;
}

/** Determine the appropriate DeckCategory for a card being swapped in. */
export function getCategoryForCard(card: ScryfallCard): DeckCategory {
  const typeLine = getFrontFaceTypeLine(card).toLowerCase();
  if (typeLine.includes('land')) return 'lands';

  const role = getCardRole(card.name);
  if (role) return ROLE_TO_CATEGORY[role];

  if (typeLine.includes('creature')) return 'creatures';
  if (typeLine.includes('planeswalker')) return 'utility';
  return 'synergy';
}

export interface SwapResult {
  deck: GeneratedDeck;
  success: boolean;
  error?: string;
}

/**
 * Swap a card in the generated deck with a candidate.
 * Returns a NEW GeneratedDeck object (immutable update).
 */
export function swapCard(
  deck: GeneratedDeck,
  oldCard: ScryfallCard,
  newCard: ScryfallCard
): SwapResult {
  const oldCategory = findCardCategory(oldCard, deck.categories);
  if (!oldCategory) {
    return { deck, success: false, error: `Card "${oldCard.name}" not found in deck` };
  }

  const newCategory = getCategoryForCard(newCard);

  // Build new categories (immutable)
  const newCategories = { ...deck.categories };

  // Remove first instance of old card
  const oldArr = [...newCategories[oldCategory]];
  const idx = oldArr.findIndex((c) => c.name === oldCard.name);
  if (idx !== -1) oldArr.splice(idx, 1);
  newCategories[oldCategory] = oldArr;

  // Stamp role and subtype on new card
  const newRole = getCardRole(newCard.name);
  if (newRole) {
    newCard.deckRole = newRole;
    if (newRole === 'ramp') newCard.rampSubtype = getRampSubtype(newCard.name) ?? undefined;
    else if (newRole === 'removal')
      newCard.removalSubtype = getRemovalSubtype(newCard.name) ?? undefined;
    else if (newRole === 'boardwipe')
      newCard.boardwipeSubtype = getBoardwipeSubtype(newCard.name) ?? undefined;
    else if (newRole === 'cardDraw')
      newCard.cardDrawSubtype = getCardDrawSubtype(newCard.name) ?? undefined;
  }

  // Add new card
  newCategories[newCategory] = [...newCategories[newCategory], newCard];

  // Recalculate stats
  const newStats = calculateStats(newCategories);

  // Update swap candidates: remove new card from the pool (don't add old card back —
  // the user explicitly replaced it, so it shouldn't resurface as a suggestion for other cards)
  let newSwapCandidates = deck.swapCandidates;
  if (deck.swapCandidates) {
    newSwapCandidates = { ...deck.swapCandidates };
    for (const key of Object.keys(newSwapCandidates)) {
      const pool = newSwapCandidates[key];
      if (pool.some((c) => c.name === newCard.name)) {
        newSwapCandidates[key] = pool.filter((c) => c.name !== newCard.name);
      }
    }
  }

  // Recount roles and subtypes the way generation stores them and the deck
  // page recounts them (computeRoleCounts over the nonland buckets, E166 and
  // E528). This used to tally the pick-time deckRole / *Subtype stamps across
  // every category, lands included, and stampRoleSubtypes stamps every
  // subtype on every pick, so one swap put the stored numbers back out of
  // step with the page's live count.
  let newRoleCounts = deck.roleCounts;
  let newRampSubtypeCounts = deck.rampSubtypeCounts;
  let newRemovalSubtypeCounts = deck.removalSubtypeCounts;
  let newBoardwipeSubtypeCounts = deck.boardwipeSubtypeCounts;
  let newCardDrawSubtypeCounts = deck.cardDrawSubtypeCounts;
  if (deck.roleCounts && deck.roleTargets) {
    const recount = computeRoleCounts(
      (Object.entries(newCategories) as [DeckCategory, ScryfallCard[]][])
        .filter(([category]) => category !== 'lands')
        .flatMap(([, cards]) => cards)
    );
    newRoleCounts = recount.roleCounts;
    newRampSubtypeCounts = recount.rampSubtypeCounts;
    newRemovalSubtypeCounts = recount.removalSubtypeCounts;
    newBoardwipeSubtypeCounts = recount.boardwipeSubtypeCounts;
    newCardDrawSubtypeCounts = recount.cardDrawSubtypeCounts;
  }

  // Recalculate combo completeness based on updated deck card names
  let newDetectedCombos = deck.detectedCombos;
  if (deck.detectedCombos && deck.detectedCombos.length > 0) {
    const allDeckNames = new Set<string>();
    if (deck.commander) {
      allDeckNames.add(deck.commander.name);
      if (deck.commander.name.includes(' // '))
        allDeckNames.add(frontFaceName(deck.commander.name));
    }
    if (deck.partnerCommander) {
      allDeckNames.add(deck.partnerCommander.name);
      if (deck.partnerCommander.name.includes(' // '))
        allDeckNames.add(frontFaceName(deck.partnerCommander.name));
    }
    for (const c of Object.values(newCategories).flat()) {
      allDeckNames.add(c.name);
      if (c.name.includes(' // ')) allDeckNames.add(frontFaceName(c.name));
    }

    newDetectedCombos = deck.detectedCombos
      .map((combo) => {
        const missingCards = combo.cards.filter((name) => !allDeckNames.has(name));
        return { ...combo, isComplete: missingCards.length === 0, missingCards };
      })
      .filter((dc) => dc.isComplete || dc.missingCards.length <= 2)
      .sort((a, b) => {
        if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
        return a.missingCards.length - b.missingCards.length;
      });

    if (newDetectedCombos.length === 0) newDetectedCombos = undefined;
  }

  // Update inclusion map and deck score
  let newCardInclusionMap = deck.cardInclusionMap;
  let newDeckScore = deck.deckScore;
  if (deck.cardInclusionMap) {
    newCardInclusionMap = { ...deck.cardInclusionMap };
    const oldName = oldCard.name;
    const oldNorm = frontFaceName(oldName);
    const oldIncl = newCardInclusionMap[oldName] ?? newCardInclusionMap[oldNorm] ?? 0;
    delete newCardInclusionMap[oldName];
    delete newCardInclusionMap[oldNorm];

    // Look up new card's inclusion from gap analysis
    const newName = newCard.name;
    const newNorm = frontFaceName(newName);
    const gapEntry = deck.gapAnalysis?.find((g) => g.name === newName || g.name === newNorm);
    const newIncl = gapEntry ? gapEntry.inclusion : 0;
    newCardInclusionMap[newName] = newIncl;

    if (newDeckScore !== undefined) {
      newDeckScore = Math.round(newDeckScore - oldIncl + newIncl);
    }
  }

  // Update relevancy map
  let newCardRelevancyMap = deck.cardRelevancyMap;
  if (deck.cardRelevancyMap) {
    newCardRelevancyMap = { ...deck.cardRelevancyMap };
    const oldName = oldCard.name;
    const oldNorm = frontFaceName(oldName);
    delete newCardRelevancyMap[oldName];
    delete newCardRelevancyMap[oldNorm];
    // New card should already be pre-indexed (from swap candidates/gap analysis)
  }

  // Re-estimate bracket with updated deck state
  let newBracketEstimation = deck.bracketEstimation;
  if (deck.gameChangerNames) {
    const gcSet = new Set(deck.gameChangerNames);
    const allNames = Object.values(newCategories)
      .flat()
      .map((c) => c.name);
    if (deck.commander) allNames.push(deck.commander.name);
    if (deck.partnerCommander) allNames.push(deck.partnerCommander.name);
    newBracketEstimation = estimateBracket(
      allNames,
      newDetectedCombos ?? undefined,
      newStats.averageCmc,
      newDeckScore,
      newRoleCounts ?? undefined,
      gcSet,
      [deck.commander?.name, deck.partnerCommander?.name].filter((n): n is string => !!n)
    );
  }

  return {
    deck: {
      ...deck,
      categories: newCategories,
      stats: newStats,
      swapCandidates: newSwapCandidates,
      roleCounts: newRoleCounts,
      rampSubtypeCounts: newRampSubtypeCounts,
      removalSubtypeCounts: newRemovalSubtypeCounts,
      boardwipeSubtypeCounts: newBoardwipeSubtypeCounts,
      cardDrawSubtypeCounts: newCardDrawSubtypeCounts,
      detectedCombos: newDetectedCombos,
      cardInclusionMap: newCardInclusionMap,
      cardRelevancyMap: newCardRelevancyMap,
      deckScore: newDeckScore,
      bracketEstimation: newBracketEstimation,
    },
    success: true,
  };
}

/** Map a card to its type-based swap bucket key. */
function getPrimaryTypeKey(card: ScryfallCard): string | null {
  const t = getFrontFaceTypeLine(card).toLowerCase();
  if (t.includes('land')) return null;
  if (t.includes('creature')) return 'type:creature';
  if (t.includes('instant')) return 'type:instant';
  if (t.includes('sorcery')) return 'type:sorcery';
  if (t.includes('artifact')) return 'type:artifact';
  if (t.includes('enchantment')) return 'type:enchantment';
  if (t.includes('planeswalker')) return 'type:planeswalker';
  return null;
}

/**
 * Get swap candidates for a card based on its deckRole and/or card type.
 * Tries role bucket first, then type bucket, then merges both if primary is thin.
 * Returns empty array if deck has no candidates.
 */
export function getSwapCandidatesForCard(deck: GeneratedDeck, card: ScryfallCard): ScryfallCard[] {
  if (!deck.swapCandidates) return [];

  // Build a set of name variants to exclude (handles DFC "Front // Back" vs "Front")
  const excludeNames = new Set<string>([card.name]);
  if (card.name.includes(' // ')) excludeNames.add(frontFaceName(card.name));
  // Never suggest commander(s) as swap candidates
  for (const cmdr of [deck.commander, deck.partnerCommander]) {
    if (cmdr) {
      excludeNames.add(cmdr.name);
      if (cmdr.name.includes(' // ')) excludeNames.add(frontFaceName(cmdr.name));
    }
  }

  const isExcluded = (c: ScryfallCard) => excludeNames.has(c.name);
  const roleCandidates = card.deckRole
    ? (deck.swapCandidates[card.deckRole] ?? []).filter((c) => !isExcluded(c))
    : [];
  const typeKey = getPrimaryTypeKey(card);
  const typeCandidates = typeKey
    ? (deck.swapCandidates[typeKey] ?? []).filter((c) => !isExcluded(c))
    : [];

  // If role bucket has enough candidates, use it
  if (roleCandidates.length >= 3) return roleCandidates;

  // If role bucket is thin/empty, merge with type bucket (role first, then type, deduped)
  if (roleCandidates.length > 0 || typeCandidates.length > 0) {
    const seen = new Set(roleCandidates.map((c) => c.name));
    const merged = [...roleCandidates];
    for (const c of typeCandidates) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        merged.push(c);
      }
    }
    return merged;
  }

  return [];
}
