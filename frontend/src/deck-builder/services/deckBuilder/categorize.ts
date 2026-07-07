// Card classification & role bucketing: type matching, tagger-role
// categorization, swap-candidate collection, and balanced-roles boosts.
// Extracted verbatim from deckGenerator.ts.
import type {
  ScryfallCard,
  EDHRECCard,
  DeckCategory,
  MaxRarity,
  CollectionStrategy,
} from '@/deck-builder/types';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import {
  validateCardRole,
  hasMultipleRoles,
  getRampSubtype,
  getRemovalSubtype,
  getBoardwipeSubtype,
  getCardDrawSubtype,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import {
  fitsColorIdentity,
  exceedsMaxPrice,
  exceedsMaxRarity,
  constrainsToCollection,
  notInCollection,
  isOwnedRarityExempt,
  notOnArena,
  exceedsCmcCap,
} from './deckFilters';

// Check if a card's type_line matches the expected type
export function matchesExpectedType(typeLine: string, expectedType: string): boolean {
  const normalizedType = expectedType.toLowerCase();
  const normalizedTypeLine = typeLine.toLowerCase();

  // Handle the main card types
  if (normalizedType === 'creature') return normalizedTypeLine.includes('creature');
  if (normalizedType === 'instant') return normalizedTypeLine.includes('instant');
  if (normalizedType === 'sorcery') return normalizedTypeLine.includes('sorcery');
  if (normalizedType === 'artifact')
    return (
      normalizedTypeLine.includes('artifact') &&
      !normalizedTypeLine.includes('creature') &&
      !normalizedTypeLine.includes('land')
    );
  if (normalizedType === 'enchantment')
    return (
      normalizedTypeLine.includes('enchantment') &&
      !normalizedTypeLine.includes('creature') &&
      !normalizedTypeLine.includes('land')
    );
  if (normalizedType === 'planeswalker') return normalizedTypeLine.includes('planeswalker');
  if (normalizedType === 'battle') return normalizedTypeLine.includes('battle');
  if (normalizedType === 'land') return normalizedTypeLine.includes('land');

  return false;
}

const ROLE_TO_CATEGORY: Record<RoleKey, DeckCategory> = {
  ramp: 'ramp',
  removal: 'singleRemoval',
  boardwipe: 'boardWipes',
  cardDraw: 'cardDraw',
};

// Categorize cards by functional role using Scryfall tagger data.
// Cards without a tagger role go to the given fallback category (typically 'synergy').
// Lands always route to 'lands' regardless of role/synergy score — a land can carry
// a tagger role (e.g. a utility land tagged 'ramp') but must still count toward the
// manabase, not a spell bucket.
export function categorizeCards(
  cards: ScryfallCard[],
  categories: Record<DeckCategory, ScryfallCard[]>,
  fallback: DeckCategory = 'synergy'
): void {
  for (const card of cards) {
    if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) {
      categories.lands.push(card);
      continue;
    }
    const role = validateCardRole(card);
    categories[role ? ROLE_TO_CATEGORY[role] : fallback].push(card);
  }
}

/**
 * Route a single card into its target category by type first (land, then
 * creature), then tagger role, falling back to 'synergy'. Extracted because
 * this exact type-then-role chain is duplicated ad hoc — and missing the land
 * branch — in the `addCard`/`auditAdd`/`fixupAddCard` helpers inside
 * deckGenerator.ts, phaseBracketConverge.ts, and phaseCoherenceRepair.ts
 * (each pushes straight to `categories.synergy` in its final `else`, which
 * mis-bucketed a land like Eldrazi Temple into synergy and undercounted
 * `manabase.totalLands`). Those call sites should switch to this helper
 * instead of re-inlining the chain.
 */
export function routeCardByType(
  card: ScryfallCard,
  categories: Record<DeckCategory, ScryfallCard[]>
): void {
  const typeLine = getFrontFaceTypeLine(card).toLowerCase();
  if (typeLine.includes('land')) {
    categories.lands.push(card);
    return;
  }
  if (typeLine.includes('creature')) {
    categories.creatures.push(card);
    return;
  }
  const role = validateCardRole(card);
  categories[role && ROLE_TO_CATEGORY[role] ? ROLE_TO_CATEGORY[role] : 'synergy'].push(card);
}

// Stamp all role subtypes on a card based on its deckRole
export function stampRoleSubtypes(card: ScryfallCard): void {
  card.multiRole = hasMultipleRoles(card.name);
  // Stamp all subtypes so secondary-role contexts (e.g. a ramp card in the card draw panel) show the right badge
  card.rampSubtype = getRampSubtype(card.name) ?? undefined;
  card.removalSubtype = getRemovalSubtype(card.name) ?? undefined;
  card.boardwipeSubtype = getBoardwipeSubtype(card.name) ?? undefined;
  card.cardDrawSubtype = getCardDrawSubtype(card.name) ?? undefined;
}

/** Map a ScryfallCard to a type-based swap bucket key, or null for lands. */
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

// Collect swap candidates from pools — eligible cards that weren't selected, grouped by role or card type
export function collectSwapCandidates(
  pools: EDHRECCard[][],
  cardMap: Map<string, ScryfallCard>,
  usedNames: Set<string>,
  colorIdentity: string[],
  bannedCards: Set<string>,
  maxCardPrice: number | null,
  maxRarity: MaxRarity,
  maxCmc: number | null,
  collectionNames: Set<string> | undefined,
  currency: 'USD' | 'EUR',
  arenaOnly: boolean,
  collectionStrategy: CollectionStrategy = 'full',
  limitPerBucket: number = 15,
  ignoreOwnedRarity: boolean = false
): Record<string, ScryfallCard[]> {
  const result: Record<string, ScryfallCard[]> = {
    ramp: [],
    removal: [],
    boardwipe: [],
    cardDraw: [],
    'type:creature': [],
    'type:instant': [],
    'type:sorcery': [],
    'type:artifact': [],
    'type:enchantment': [],
    'type:planeswalker': [],
  };
  const seen = new Set<string>();

  for (const pool of pools) {
    for (const edhrecCard of pool) {
      if (usedNames.has(edhrecCard.name) || bannedCards.has(edhrecCard.name)) continue;
      if (seen.has(edhrecCard.name)) continue;
      if (
        constrainsToCollection(collectionStrategy) &&
        notInCollection(edhrecCard.name, collectionNames)
      )
        continue;

      const scryfallCard = cardMap.get(edhrecCard.name);
      if (!scryfallCard) continue;

      // Determine bucket: role-based if tagged, otherwise type-based
      const role = validateCardRole(scryfallCard);
      const bucket = role ?? getPrimaryTypeKey(scryfallCard);
      if (!bucket) continue;
      if ((result[bucket]?.length ?? 0) >= limitPerBucket) continue;

      if (!fitsColorIdentity(scryfallCard, colorIdentity)) continue;
      if (exceedsMaxPrice(scryfallCard, maxCardPrice, currency)) continue;
      if (!isOwnedRarityExempt(edhrecCard.name, collectionNames, ignoreOwnedRarity)) {
        if (exceedsMaxRarity(scryfallCard, maxRarity)) continue;
      }
      if (exceedsCmcCap(scryfallCard, maxCmc)) continue;
      if (notOnArena(scryfallCard, arenaOnly)) continue;

      if (role) {
        scryfallCard.deckRole = role;
        stampRoleSubtypes(scryfallCard);
      }
      result[bucket].push(scryfallCard);
      seen.add(edhrecCard.name);
    }
  }

  // Sort each bucket by edhrec_rank (lower = more popular = better swap suggestion)
  for (const key of Object.keys(result)) {
    result[key].sort((a, b) => (a.edhrec_rank ?? Infinity) - (b.edhrec_rank ?? Infinity));
  }

  return result;
}

// Role targets by deck size — used by balanced roles mode
// getRoleTargets moved to ./roleTargets.ts as getBaseRoleTargets / getDynamicRoleTargets

// Compute role-deficit boost map for balanced roles mode
// Subtypes per role for diversity calculations
const ROLE_SUBTYPES: Record<string, string[]> = {
  ramp: ['mana-producer', 'mana-rock', 'cost-reducer', 'ramp'],
  removal: ['counterspell', 'bounce', 'spot-removal', 'removal'],
  boardwipe: ['bounce-wipe', 'boardwipe'],
  cardDraw: ['tutor', 'wheel', 'cantrip', 'card-draw', 'card-advantage'],
};

/**
 * Tolerance band above a role target before it's treated as "over cap" — the
 * shared shape (max 2 cards, else 20% of target) used both by the soft
 * over-target boost penalty below and the hard pick-loop cap gate
 * (cardPicking.ts's role-cap gate). One constant, so a role that's "at cap"
 * means the same thing to both surfaces.
 *
 * E113: board wipes get a tighter band (1, not the generic 2/20%) — every
 * caller of this function (the pick-loop gate, the Scryfall-fallback gate,
 * budget/bracket convergence, flagship seating, and the post-fill role-
 * surplus rebalance's own cap) shares this one constant, so tightening it
 * here alone closes the observed panel-wide overshoot (target+2 delivered
 * against a target+2 cap) everywhere at once, without touching any of those
 * call sites' own logic. A surplus wipe is worse than a surplus draw/ramp/
 * removal slot — it actively hurts the deck rather than just being a
 * slightly-weaker filler pick — so it doesn't get the same slack. `role` is
 * optional (defaults to the generic band) so every pre-E113 caller that
 * doesn't pass it keeps its exact prior behavior.
 */
export function roleCapTolerance(target: number, role?: RoleKey): number {
  if (role === 'boardwipe') return 1;
  return Math.max(2, Math.round(target * 0.2));
}

/**
 * Ceiling on how many over-cap candidates the role-cap escape hatch (see
 * roleCapTolerance above) admits in a single pass, at each of its 4 call
 * sites (cardPicking.ts, scryfallFill.ts, deckGenerator.ts x2). The hatch
 * exists so a pass never ships short over a soft target, but uncapped it
 * could stuff a role arbitrarily far over target (observed: 50 admissions
 * across a 15-deck baseline panel, max 11 in one deck). Median observed
 * admissions per affected deck was ~3 — this ceiling trims the outlier tail
 * without changing the typical deck. A pass that hits the ceiling finishes
 * short; the role-cap-gated downstream fills close the remaining gap from
 * under-target roles instead of over-stuffing this one further.
 */
export const ROLE_CAP_HATCH_MAX_PER_PASS = 3;

export function computeRoleBoosts(
  cardRoleMap: Map<string, RoleKey>,
  roleTargets: Record<RoleKey, number>,
  currentRoleCounts: Record<RoleKey, number>,
  baseBoosts?: Map<string, number>,
  cardCmcMap?: Map<string, number>,
  cardSubtypeMap?: Map<string, string>,
  currentSubtypeCounts?: Record<string, number>,
  strictRoles: boolean = false
): Map<string, number> {
  const boosts = new Map<string, number>(baseBoosts ?? []);

  // Pre-compute peer average counts per role for subtype diversity
  const peerAverages: Record<string, number> = {};
  if (cardSubtypeMap && currentSubtypeCounts) {
    for (const [role, subtypes] of Object.entries(ROLE_SUBTYPES)) {
      const total = subtypes.reduce((sum, st) => sum + (currentSubtypeCounts[st] ?? 0), 0);
      peerAverages[role] = subtypes.length > 0 ? total / subtypes.length : 0;
    }
  }

  for (const [name, role] of cardRoleMap) {
    const target = roleTargets[role];
    const current = currentRoleCounts[role] ?? 0;

    // When user explicitly set role targets, penalize roles that are at or over target
    if (strictRoles) {
      if (target <= 0) {
        // Target is 0 — strongly penalize cards with this role
        boosts.set(name, (boosts.get(name) ?? 0) - 100);
        continue;
      }
      if (current >= target) {
        // Already met target — penalize further cards with this role
        const surplus = current - target;
        boosts.set(name, (boosts.get(name) ?? 0) - 50 - surplus * 15);
        continue;
      }
    } else {
      if (target <= 0) continue;
      if (current >= target) {
        // Soft over-target penalty on the default (non-strict) path too — otherwise a role
        // that hits target keeps absorbing cards on pure priority with no cap (iter-3 cluster 1).
        const tolerance = roleCapTolerance(target, role);
        if (current - target >= tolerance) {
          boosts.set(name, (boosts.get(name) ?? 0) - 20 - (current - target - tolerance) * 10);
        }
        continue;
      }
    }

    const deficit = Math.max(0, target - current);
    if (deficit > 0) {
      // Stronger boost when user explicitly set targets (up to 120 vs 75)
      const maxBoost = strictRoles ? 120 : 75;
      const roleBoost = (deficit / target) * maxBoost;
      // Early ramp bonus: prefer low-CMC mana producers for reliable early acceleration
      let earlyRampMultiplier = 1.0;
      if (role === 'ramp' && cardCmcMap) {
        const cmc = cardCmcMap.get(name);
        if (cmc !== undefined) {
          if (cmc <= 1)
            earlyRampMultiplier = 2.0; // Sol Ring, Birds of Paradise, Llanowar Elves
          else if (cmc <= 2)
            earlyRampMultiplier = 1.5; // Arcane Signet, Fellwar Stone
          else if (cmc <= 3) earlyRampMultiplier = 1.2; // Cultivate, Kodama's Reach
        }
      }
      // Subtype diversity: penalize over-represented subtypes, bonus for unrepresented ones
      let diversityMultiplier = 1.0;
      if (cardSubtypeMap && currentSubtypeCounts) {
        const subtype = cardSubtypeMap.get(name);
        if (subtype) {
          const subtypeCount = currentSubtypeCounts[subtype] ?? 0;
          const avg = peerAverages[role] ?? 0;
          const excess = subtypeCount - avg;
          if (excess > 1) {
            // Gradually reduce boost: 0.9x at +2, 0.8x at +3, floor at 0.4x
            diversityMultiplier = Math.max(0.4, 1.0 - (excess - 1) * 0.1);
          } else if (subtypeCount === 0) {
            // Encourage picking the first of each subtype
            diversityMultiplier = 1.25;
          }
        }
      }
      boosts.set(
        name,
        (boosts.get(name) ?? 0) + roleBoost * earlyRampMultiplier * diversityMultiplier
      );
    }
  }
  return boosts;
}
