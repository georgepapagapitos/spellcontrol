import { logger } from '@/lib/logger';
import type { ScryfallCard, DeckCategory, CoherenceRepair } from '@/deck-builder/types';
import {
  getCardRole,
  isProtectionPiece,
  isFreeInteraction,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import type { GenerationState } from './state';
import { stampRoleSubtypes, routeCardByType } from '../categorize';
import { constrainsToCollection, notInCollection } from '../deckFilters';
import { calculateCardPriority } from '../cardPicking';
import { STAPLE_ROCK_NAMES } from './phaseStapleManaRocks';
import { ROLE_LABEL } from './phaseRoleSurplusRebalance';

export interface PostGenFixupContext {
  /** Balanced-roles targets; role-deficit swaps (5a) are skipped when null. */
  roleTargets: Record<RoleKey, number> | null;
  /** Type-bucket swap-candidate lists (for the "similar cards" carousel) —
   *  mutated in place: a fixup swap's evicted card is appended under its
   *  type-bucket key. Undefined when swap-candidate collection is disabled. */
  swapCandidates: Record<string, ScryfallCard[]> | undefined;
  scryfallCardMap: Map<string, ScryfallCard>;
  /** Names the Combo Integrity Audit and Combo Floor added earlier THIS
   *  generation (E167) — position-based weakness treats a fresh add as
   *  last-in-array, i.e. the top eviction candidate by construction, so
   *  those adds need their own protection here on top of comboCardNames. */
  repairAddedNames: ReadonlySet<string>;
}

export interface PostGenFixupResult {
  fixupSwaps: number;
  /** Every 5a/5b swap this pass applied, disclosed (T37 ethos: nothing moves
   *  silently) — was logger.debug-only before E167. */
  fixupRepairs: CoherenceRepair[];
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
  const { roleTargets, swapCandidates, scryfallCardMap, repairAddedNames } = ctx;
  let fixupSwaps = 0;
  const fixupRepairs: CoherenceRepair[] = [];

  const { customization, collectionNames } = state.context;
  if (!(state.edhrecData && customization.balancedRoles)) {
    return { fixupSwaps, fixupRepairs };
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
        // E167: the combo audit's/floor's OWN fresh adds this generation —
        // without this, a just-added combo piece is last-in-array (BY
        // CONSTRUCTION the top eviction candidate below) and gets cut the
        // same generation it was added.
        if (repairAddedNames.has(card.name)) continue;
        // Staples protected by NAME too (STAPLE_ROCK_NAMES), not just the
        // isStapleRock flag — that flag is only ever set on a copy THIS
        // generation's stapleManaRocksPhase itself adds; a staple picked
        // naturally from the EDHREC pool (the common case) arrives here
        // flagless (mirrors phaseRoleSurplusRebalance.ts's identical guard).
        if (card.isStapleRock || STAPLE_ROCK_NAMES.has(card.name)) continue;
        if (isProtectionPiece(card) || isFreeInteraction(card)) continue;
        if (filter && !filter(card, cat)) continue;
        // ponytail: position-based weakness is a pick-order proxy (iter-6
        // class); the protected set above neuters its worst failure — a
        // survival-blend rank is the upgrade path if fixup churn ever shows
        // up in a gate again.
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
        // Deficit-bound (E167): never queue more swaps than the deficit
        // itself needs — the old flat `Math.min(2, ...)` fired 2 swaps for a
        // 1-card deficit, and phaseRoleSurplusRebalance then had to trim the
        // resulting overage back down. Pure churn.
        const swapsForRole = Math.min(
          2,
          Math.max(0, target - current),
          MAX_FIXUP_SWAPS - fixupSwaps
        );
        const roleLabel = ROLE_LABEL[role];
        const capitalizedRoleLabel = roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1);
        for (let i = 0; i < swapsForRole; i++) {
          const weak = findWeakestCard((card) => getCardRole(card.name) !== role);
          if (!weak) break;
          const replacement = findRoleCandidate(role);
          if (!replacement) break;
          fixupRemoveCard(weak.card, weak.category);
          fixupAddCard(replacement);
          fixupRepairs.push({
            cut: weak.card.name,
            added: replacement.name,
            reason: `Critical role gap: ${capitalizedRoleLabel} was running ${current} vs its ${target}-card target after earlier swaps — swapped ${weak.card.name} for ${replacement.name}.`,
          });
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
  if (!customization.tinyLeaders) {
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
              fixupRepairs.push({
                cut: weak.card.name,
                added: replacement.name,
                reason: `Dead curve slot: no cards at ${targetCmc} mana — swapped ${weak.card.name} for ${replacement.name}.`,
              });
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

  return { fixupSwaps, fixupRepairs };
}
