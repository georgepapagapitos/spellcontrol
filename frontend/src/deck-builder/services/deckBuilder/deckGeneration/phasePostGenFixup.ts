import { logger } from '@/lib/logger';
import type { ScryfallCard, DeckCategory } from '@/deck-builder/types';
import { getCardRole, type RoleKey } from '@/deck-builder/services/tagger/client';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import type { GenerationState } from './state';
import { stampRoleSubtypes, routeCardByType } from '../categorize';
import { constrainsToCollection, notInCollection } from '../deckFilters';
import { calculateCardPriority } from '../cardPicking';

export interface PostGenFixupContext {
  /** Balanced-roles targets; role-deficit swaps (5a) are skipped when null. */
  roleTargets: Record<RoleKey, number> | null;
  /** Type-bucket swap-candidate lists (for the "similar cards" carousel) —
   *  mutated in place: a fixup swap's evicted card is appended under its
   *  type-bucket key. Undefined when swap-candidate collection is disabled. */
  swapCandidates: Record<string, ScryfallCard[]> | undefined;
  scryfallCardMap: Map<string, ScryfallCard>;
}

export interface PostGenFixupResult {
  fixupSwaps: number;
}

/**
 * ── Post-Generation Fixup Pass (light touch) ──
 * Verbatim extraction from generateDeckInner. Only fixes critical gaps: roles
 * <=50% of target, dead CMC 1/2 slots. No-op unless EDHREC data is present
 * and balanced-roles is on.
 */
export function postGenFixupPhase(
  state: GenerationState,
  ctx: PostGenFixupContext
): PostGenFixupResult {
  const { roleTargets, swapCandidates, scryfallCardMap } = ctx;
  let fixupSwaps = 0;

  const { customization, collectionNames } = state.context;
  if (!(state.edhrecData && customization.balancedRoles)) {
    return { fixupSwaps };
  }

  const { categories, usedNames, bannedCards, currentRoleCounts, comboCardNames } = state;
  const { collectionStrategy } = state.cfg;

  const MAX_FIXUP_SWAPS = 5;

  const fixupMustIncludeSet = new Set([
    ...customization.mustIncludeCards.map((n) => n.toLowerCase()),
    ...customization.tempMustIncludeCards.map((n) => n.toLowerCase()),
  ]);

  // Helper: find the lowest-priority non-protected card matching a filter
  // Never evict lands — they have their own target and shouldn't be swapped for spells
  function findWeakestCard(
    filter?: (card: ScryfallCard, cat: DeckCategory) => boolean
  ): { card: ScryfallCard; category: DeckCategory } | null {
    let weakest: { card: ScryfallCard; category: DeckCategory; priority: number } | null = null;
    for (const cat of Object.keys(categories) as DeckCategory[]) {
      if (cat === 'lands') continue;
      const cards = categories[cat];
      for (let i = cards.length - 1; i >= 0; i--) {
        const card = cards[i];
        if (fixupMustIncludeSet.has(card.name.toLowerCase())) continue;
        if (comboCardNames.has(card.name)) continue;
        if (filter && !filter(card, cat)) continue;
        const priority = cards.length - i;
        if (!weakest || priority < weakest.priority) {
          weakest = { card, category: cat, priority };
        }
      }
    }
    return weakest ? { card: weakest.card, category: weakest.category } : null;
  }

  // Helper: remove a card from its category and update tracking
  function fixupRemoveCard(card: ScryfallCard, category: DeckCategory) {
    categories[category] = categories[category].filter((c) => c !== card);
    usedNames.delete(card.name);
    const role = getCardRole(card.name);
    if (role && currentRoleCounts[role] > 0) currentRoleCounts[role]--;
  }

  // Helper: add a card to the appropriate category
  function fixupAddCard(card: ScryfallCard) {
    stampRoleSubtypes(card);
    const role = getCardRole(card.name);
    routeCardByType(card, categories);
    usedNames.add(card.name);
    if (role) currentRoleCounts[role] = (currentRoleCounts[role] || 0) + 1;
  }

  // In owned-only modes, fixup swaps must never inject an unowned card —
  // restrict replacement candidates to cards the user owns.
  const ownedOnly = constrainsToCollection(collectionStrategy);
  const isOwnedCandidate = (name: string) => !ownedOnly || !notInCollection(name, collectionNames);

  // Helper: find best EDHREC candidate for a role that's already fetched
  function findRoleCandidate(role: RoleKey): ScryfallCard | null {
    const candidates = state
      .edhrecData!.cardlists.allNonLand.filter(
        (c) =>
          !usedNames.has(c.name) &&
          !bannedCards.has(c.name) &&
          getCardRole(c.name) === role &&
          scryfallCardMap.has(c.name) &&
          isOwnedCandidate(c.name)
      )
      .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
    return candidates.length > 0 ? scryfallCardMap.get(candidates[0].name)! : null;
  }

  // 5a: Critical Role Deficits (<=50% of target)
  if (roleTargets) {
    const roleKeys: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];
    for (const role of roleKeys) {
      if (fixupSwaps >= MAX_FIXUP_SWAPS) break;
      const target = roleTargets[role] ?? 0;
      const current = currentRoleCounts[role] ?? 0;
      if (target > 0 && current <= target * 0.5) {
        const swapsForRole = Math.min(2, MAX_FIXUP_SWAPS - fixupSwaps);
        for (let i = 0; i < swapsForRole; i++) {
          const weak = findWeakestCard((card) => getCardRole(card.name) !== role);
          if (!weak) break;
          const replacement = findRoleCandidate(role);
          if (!replacement) break;
          fixupRemoveCard(weak.card, weak.category);
          fixupAddCard(replacement);
          if (swapCandidates) {
            const key = `type:${(getFrontFaceTypeLine(weak.card) || 'unknown').split(' ')[0].toLowerCase()}`;
            if (!swapCandidates[key]) swapCandidates[key] = [];
            swapCandidates[key].push(weak.card);
          }
          fixupSwaps++;
        }
      }
    }
  }

  // 5b: Dead CMC Slots (zero cards at CMC 1 or 2)
  if (!customization.tinyLeaders && !customization.advancedTargets?.curvePercentages) {
    for (const targetCmc of [1, 2]) {
      if (fixupSwaps >= MAX_FIXUP_SWAPS) break;
      const cardsAtCmc = Object.values(categories)
        .flat()
        .filter((c) => (c.cmc ?? 0) === targetCmc).length;
      if (cardsAtCmc === 0) {
        const cmcCounts: Record<number, number> = {};
        for (const cards of Object.values(categories)) {
          for (const card of cards) {
            cmcCounts[card.cmc ?? 0] = (cmcCounts[card.cmc ?? 0] || 0) + 1;
          }
        }
        const overfullEntry = Object.entries(cmcCounts)
          .filter(([cmc]) => Number(cmc) !== targetCmc)
          .sort(([, a], [, b]) => b - a)[0];
        if (overfullEntry) {
          const weak = findWeakestCard((card) => (card.cmc ?? 0) === Number(overfullEntry[0]));
          if (weak) {
            const candidates = state
              .edhrecData!.cardlists.allNonLand.filter(
                (c) =>
                  !usedNames.has(c.name) &&
                  !bannedCards.has(c.name) &&
                  scryfallCardMap.has(c.name) &&
                  isOwnedCandidate(c.name) &&
                  (scryfallCardMap.get(c.name)!.cmc ?? 0) === targetCmc
              )
              .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));
            if (candidates.length > 0) {
              const replacement = scryfallCardMap.get(candidates[0].name)!;
              fixupRemoveCard(weak.card, weak.category);
              fixupAddCard(replacement);
              if (swapCandidates) {
                const key = `type:${(getFrontFaceTypeLine(weak.card) || 'unknown').split(' ')[0].toLowerCase()}`;
                if (!swapCandidates[key]) swapCandidates[key] = [];
                swapCandidates[key].push(weak.card);
              }
              fixupSwaps++;
            }
          }
        }
      }
    }
  }

  if (fixupSwaps > 0) {
    logger.debug(`[DeckGen] Fixup pass: ${fixupSwaps} swap(s) applied`);
  }

  return { fixupSwaps };
}
