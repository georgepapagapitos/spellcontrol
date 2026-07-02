// EDHREC card-pool selection: priority scoring and the two prefetched-map
// pickers (flat + curve-aware). Extracted verbatim from deckGenerator.ts.
import { logger } from '@/lib/logger';
import type { ScryfallCard, EDHRECCard, MaxRarity, CollectionStrategy } from '@/deck-builder/types';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { hasCurveRoom } from './curveUtils';
import { BudgetTracker } from './budgetTracker';
import type { BracketGuard } from './bracketGuard';
import { matchesExpectedType } from './categorize';
import {
  fitsColorIdentity,
  exceedsMaxPrice,
  exceedsMaxRarity,
  constrainsToCollection,
  notInCollection,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  notOnArena,
  exceedsCmcCap,
} from './deckFilters';

// Pick cards from a pre-fetched card map (no API calls)
export function pickFromPrefetched(
  edhrecCards: EDHRECCard[],
  cardMap: Map<string, ScryfallCard>,
  count: number,
  usedNames: Set<string>,
  colorIdentity: string[],
  bannedCards: Set<string> = new Set(),
  maxCardPrice: number | null = null,
  maxGameChangers: number = Infinity,
  gameChangerCount: { value: number } = { value: 0 },
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  comboPriorityBoost?: Map<string, number>,
  currency: 'USD' | 'EUR' = 'USD',
  gameChangerNames: Set<string> = new Set(),
  arenaOnly: boolean = false,
  collectionStrategy: CollectionStrategy = 'full',
  collectionOwnedPercent: number = 100,
  ignoreOwnedBudget: boolean = false,
  ignoreOwnedRarity: boolean = false,
  cardAllowed?: (card: ScryfallCard) => boolean,
  liftTieBreak?: Map<string, number>
): ScryfallCard[] {
  const result: ScryfallCard[] = [];
  const preferOwned = collectionStrategy === 'prefer';

  // Filter and sort candidates (with combo boost + owned-first bias if enabled)
  const candidates = edhrecCards
    .filter((c) => !usedNames.has(c.name) && !bannedCards.has(c.name))
    .sort(
      (a, b) =>
        priorityWithBoosts(b, comboPriorityBoost, preferOwned, collectionNames) -
          priorityWithBoosts(a, comboPriorityBoost, preferOwned, collectionNames) ||
        liftTie(b.name, liftTieBreak) - liftTie(a.name, liftTieBreak)
    );

  // Shared validation for a single candidate
  const tryPick = (edhrecCard: EDHRECCard): boolean => {
    const isGC = gameChangerNames.has(edhrecCard.name);
    if (isGC && gameChangerCount.value >= maxGameChangers) return false;

    const scryfallCard = cardMap.get(edhrecCard.name);
    if (!scryfallCard) return false;
    if (cardAllowed && !cardAllowed(scryfallCard)) return false;
    if (!fitsColorIdentity(scryfallCard, colorIdentity)) return false;

    const ownedExempt = isOwnedBudgetExempt(edhrecCard.name, collectionNames, ignoreOwnedBudget);
    if (!ownedExempt) {
      const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
      if (exceedsMaxPrice(scryfallCard, effectiveCap, currency)) return false;
    }
    if (!isOwnedRarityExempt(edhrecCard.name, collectionNames, ignoreOwnedRarity)) {
      if (exceedsMaxRarity(scryfallCard, maxRarity)) return false;
    }
    if (exceedsCmcCap(scryfallCard, maxCmc)) return false;
    if (notOnArena(scryfallCard, arenaOnly)) return false;

    if (isGC) {
      scryfallCard.isGameChanger = true;
      gameChangerCount.value++;
    }
    if (edhrecCard.isThemeSynergyCard) scryfallCard.isThemeSynergyCard = true;
    result.push(scryfallCard);
    usedNames.add(edhrecCard.name);
    if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
    if (!ownedExempt) budgetTracker?.deductCard(scryfallCard);
    return true;
  };

  if (collectionNames && collectionStrategy === 'partial') {
    // Two-phase picking: respect owned percentage target
    const ownedTarget = Math.round((count * collectionOwnedPercent) / 100);
    const unownedTarget = count - ownedTarget;

    const ownedCandidates = candidates.filter((c) => collectionNames.has(c.name));
    const unownedCandidates = candidates.filter((c) => !collectionNames.has(c.name));

    // Phase 1: Pick from owned cards up to ownedTarget
    let ownedPicked = 0;
    for (const card of ownedCandidates) {
      if (ownedPicked >= ownedTarget || result.length >= count) break;
      if (tryPick(card)) ownedPicked++;
    }

    // Phase 2: Pick from unowned cards up to unownedTarget
    let unownedPicked = 0;
    for (const card of unownedCandidates) {
      if (unownedPicked >= unownedTarget || result.length >= count) break;
      if (tryPick(card)) unownedPicked++;
    }

    // Phase 3: If either phase fell short, fill from the other pool
    if (result.length < count) {
      for (const card of ownedCandidates) {
        if (result.length >= count) break;
        if (usedNames.has(card.name)) continue;
        tryPick(card);
      }
    }
    if (result.length < count) {
      for (const card of unownedCandidates) {
        if (result.length >= count) break;
        if (usedNames.has(card.name)) continue;
        tryPick(card);
      }
    }
  } else {
    // Full mode or no collection: simple linear pick
    for (const edhrecCard of candidates) {
      if (result.length >= count) break;
      if (
        constrainsToCollection(collectionStrategy) &&
        notInCollection(edhrecCard.name, collectionNames)
      )
        continue;
      tryPick(edhrecCard);
    }
  }

  return result;
}

// Check if a card is a high-priority theme synergy card
export function isHighSynergyCard(card: EDHRECCard): boolean {
  // Card is from highsynergycards, topcards, newcards, or gamechangers lists
  if (card.isThemeSynergyCard) return true;
  // Or has a high synergy score (> 0.3)
  if ((card.synergy ?? 0) > 0.3) return true;
  return false;
}

// Calculate a priority score for EDHREC cards
// High synergy cards (from theme) should be prioritized over generic high-inclusion cards
export function calculateCardPriority(card: EDHRECCard): number {
  const synergy = card.synergy ?? 0;
  const inclusion = card.inclusion;

  // Cards from theme synergy lists (highsynergycards, topcards, etc.) get top priority
  if (card.isThemeSynergyCard) {
    // Theme synergy cards get a big boost: 100 + synergy bonus + inclusion
    // This ensures they're prioritized over regular high-inclusion cards
    return 100 + synergy * 50 + inclusion;
  }

  // New cards get a small relevancy boost to compensate for having fewer total decks,
  // but not enough to override established staples with high inclusion/synergy
  const newCardBoost = card.isNewCard ? 25 : 0;

  // If synergy score is high (> 0.3), boost the card
  if (synergy > 0.3) {
    return synergy * 100 + inclusion + newCardBoost;
  }

  // For low/no synergy cards, just use inclusion
  return inclusion + newCardBoost;
}

// Owned-first ('prefer' strategy): a bounded boost so owned cards win ties and
// near-ties within the filler tier, without dredging a weak owned card over a
// premium staple. Theme/high-synergy cards already score >=100 and are
// partitioned first, so they're unaffected — the bias only operates among
// regular inclusion-ranked cards (where "use what I own" helps, not hurts).
// Applied in the sort comparator ONLY (not calculateCardPriority), so ownership
// changes pick *preference*, never a card's type classification or its right to
// break curve.
// ponytail: single tunable constant; raise if the owned bias feels too weak.
export const OWNED_PRIORITY_BOOST = 40;

function priorityWithBoosts(
  card: EDHRECCard,
  comboPriorityBoost: Map<string, number> | undefined,
  preferOwned: boolean,
  collectionNames: Set<string> | undefined
): number {
  return (
    calculateCardPriority(card) +
    (comboPriorityBoost?.get(card.name) ?? 0) +
    (preferOwned && collectionNames?.has(card.name) ? OWNED_PRIORITY_BOOST : 0)
  );
}

// EDHREC lift clusterScore (E71 slice 2), keyed lowercase. A SECONDARY sort
// key only — it breaks an EXACT priorityWithBoosts tie, never outranks a
// higher-priority card and never grants curve-breaking rights (the curve gate
// below runs on isHighSynergyCard/inclusion/combo boost, untouched by lift).
function liftTie(name: string, liftTieBreak: Map<string, number> | undefined): number {
  return liftTieBreak?.get(name.toLowerCase()) ?? 0;
}

// Pick cards with curve awareness from pre-fetched map (no API calls)
// Prioritizes high-synergy theme cards over generic high-inclusion cards
export function pickFromPrefetchedWithCurve(
  edhrecCards: EDHRECCard[],
  cardMap: Map<string, ScryfallCard>,
  count: number,
  usedNames: Set<string>,
  colorIdentity: string[],
  curveTargets: Record<number, number>,
  currentCurveCounts: Record<number, number>,
  bannedCards: Set<string> = new Set(),
  expectedType?: string,
  maxCardPrice: number | null = null,
  maxGameChangers: number = Infinity,
  gameChangerCount: { value: number } = { value: 0 },
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  comboPriorityBoost?: Map<string, number>,
  currency: 'USD' | 'EUR' = 'USD',
  gameChangerNames: Set<string> = new Set(),
  arenaOnly: boolean = false,
  strictCurve: boolean = false,
  collectionStrategy: CollectionStrategy = 'full',
  collectionOwnedPercent: number = 100,
  ignoreOwnedBudget: boolean = false,
  ignoreOwnedRarity: boolean = false,
  bracketGuard?: BracketGuard,
  cardAllowed?: (card: ScryfallCard) => boolean,
  liftTieBreak?: Map<string, number>
): ScryfallCard[] {
  const result: ScryfallCard[] = [];
  const preferOwned = collectionStrategy === 'prefer';

  // Filter and sort ALL candidates by priority (synergy + combo + owned-first bias)
  const allCandidates = edhrecCards
    .filter((c) => !usedNames.has(c.name) && !bannedCards.has(c.name))
    .sort(
      (a, b) =>
        priorityWithBoosts(b, comboPriorityBoost, preferOwned, collectionNames) -
          priorityWithBoosts(a, comboPriorityBoost, preferOwned, collectionNames) ||
        liftTie(b.name, liftTieBreak) - liftTie(a.name, liftTieBreak)
    );

  // Separate into high-synergy cards (any type) and regular cards
  const highSynergyCards = allCandidates.filter((c) => isHighSynergyCard(c));
  const regularTypedCards = allCandidates.filter(
    (c) => c.primary_type !== 'Unknown' && !isHighSynergyCard(c)
  );
  const regularUnknownCards = allCandidates.filter(
    (c) => c.primary_type === 'Unknown' && !isHighSynergyCard(c)
  );

  // Log high synergy card info for debugging
  if (highSynergyCards.length > 0 && expectedType) {
    logger.debug(
      `[DeckGen] ${expectedType}: Found ${highSynergyCards.length} high-synergy cards:`,
      highSynergyCards
        .slice(0, 5)
        .map((c) => `${c.name} (synergy=${c.synergy}, isTheme=${c.isThemeSynergyCard})`)
    );
  }

  // Partial mode: track ownership quotas across all phases
  const isPartialMode = collectionNames && collectionStrategy === 'partial';
  const ownedTarget = isPartialMode ? Math.round((count * collectionOwnedPercent) / 100) : count;
  const unownedTarget = isPartialMode ? count - ownedTarget : count;
  let ownedPicked = 0;
  let unownedPicked = 0;
  let enforceQuotas = true; // Relaxed in fill pass

  const processCards = (candidates: EDHRECCard[], requireTypeCheckForUnknown: boolean): void => {
    for (const edhrecCard of candidates) {
      if (result.length >= count) break;
      if (usedNames.has(edhrecCard.name)) continue;

      const isGC = gameChangerNames.has(edhrecCard.name);

      // Skip game changers that exceed the limit
      if (isGC && gameChangerCount.value >= maxGameChangers) continue;

      // Skip cards that would push a bracket floor signal past the target band
      if (bracketGuard?.exceedsCeiling(edhrecCard.name)) continue;

      // Collection filtering
      if (
        constrainsToCollection(collectionStrategy) &&
        notInCollection(edhrecCard.name, collectionNames)
      )
        continue;
      if (isPartialMode && enforceQuotas) {
        const isOwned = collectionNames!.has(edhrecCard.name);
        if (isOwned && ownedPicked >= ownedTarget) continue;
        if (!isOwned && unownedPicked >= unownedTarget) continue;
      }

      const scryfallCard = cardMap.get(edhrecCard.name);
      if (!scryfallCard) continue;
      if (cardAllowed && !cardAllowed(scryfallCard)) continue;

      // Type check for Unknown cards (need to verify they match expected type via Scryfall)
      // Cards already categorized by EDHREC (primary_type !== 'Unknown') skip this check
      if (requireTypeCheckForUnknown && edhrecCard.primary_type === 'Unknown' && expectedType) {
        if (!matchesExpectedType(getFrontFaceTypeLine(scryfallCard), expectedType)) {
          continue;
        }
      }

      // Verify color identity
      if (!fitsColorIdentity(scryfallCard, colorIdentity)) {
        continue;
      }

      // Price limit check (uses dynamic cap if budget tracker is active)
      const ownedExempt = isOwnedBudgetExempt(edhrecCard.name, collectionNames, ignoreOwnedBudget);
      if (!ownedExempt) {
        const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
        if (exceedsMaxPrice(scryfallCard, effectiveCap, currency)) {
          continue;
        }
      }

      // Rarity limit check
      if (!isOwnedRarityExempt(edhrecCard.name, collectionNames, ignoreOwnedRarity)) {
        if (exceedsMaxRarity(scryfallCard, maxRarity)) {
          continue;
        }
      }

      // CMC cap check (Tiny Leaders)
      if (exceedsCmcCap(scryfallCard, maxCmc)) {
        continue;
      }

      // Arena-only check
      if (notOnArena(scryfallCard, arenaOnly)) {
        continue;
      }

      // Curve enforcement - but high synergy cards get more leniency
      const cmc = Math.min(Math.floor(scryfallCard.cmc), 7);
      if (!hasCurveRoom(cmc, curveTargets, currentCurveCounts)) {
        if (strictCurve) {
          // User explicitly set curve targets — respect them strictly
          continue;
        }
        // High synergy, high inclusion (> 40%), or high combo boost can break curve
        const comboBoost = comboPriorityBoost?.get(edhrecCard.name) ?? 0;
        if (!isHighSynergyCard(edhrecCard) && edhrecCard.inclusion < 40 && comboBoost < 100) {
          continue;
        }
      }

      if (isGC) {
        scryfallCard.isGameChanger = true;
        gameChangerCount.value++;
      }
      bracketGuard?.record(edhrecCard.name);
      if (edhrecCard.isThemeSynergyCard) scryfallCard.isThemeSynergyCard = true;
      result.push(scryfallCard);
      usedNames.add(edhrecCard.name);
      if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
      currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      if (!ownedExempt) budgetTracker?.deductCard(scryfallCard);

      // Track ownership for quota enforcement
      if (isPartialMode) {
        if (collectionNames!.has(edhrecCard.name)) ownedPicked++;
        else unownedPicked++;
      }
    }
  };

  // Phase 1: Process HIGH SYNERGY cards first (these are the theme cards!)
  // Need type check since high-synergy Unknown cards should match expected type
  processCards(highSynergyCards, true);

  // Phase 2: Process regular typed cards (pre-categorized by EDHREC)
  if (result.length < count) {
    processCards(regularTypedCards, false);
  }

  // Phase 3: Process remaining Unknown cards if still needed
  if (result.length < count && regularUnknownCards.length > 0) {
    processCards(regularUnknownCards, true);
  }

  // Phase 4: If quotas left slots unfilled, relax and fill from any remaining candidates
  if (isPartialMode && result.length < count) {
    enforceQuotas = false;
    processCards(highSynergyCards, true);
    if (result.length < count) processCards(regularTypedCards, false);
    if (result.length < count) processCards(regularUnknownCards, true);
  }

  return result;
}

// Merge type-specific cards with allNonLand cards (which includes topcards, highsynergycards, etc.)
// This ensures cards from generic EDHREC lists get considered for each type slot
// IMPORTANT: Sort by priority so high-synergy cards come first, not last!
export function mergeWithAllNonLand(
  typeSpecificCards: EDHRECCard[],
  allNonLand: EDHRECCard[]
): EDHRECCard[] {
  const seenNames = new Set(typeSpecificCards.map((c) => c.name));
  const additionalCards = allNonLand.filter(
    (c) => c.primary_type === 'Unknown' && !seenNames.has(c.name)
  );
  // Merge and sort by priority - high synergy cards should come FIRST
  const merged = [...typeSpecificCards, ...additionalCards];
  return merged.sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
}
