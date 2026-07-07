// Scryfall-search fallback fill: used when EDHREC pools can't satisfy a slot
// target. Extracted verbatim from deckGenerator.ts.
import { logger } from '@/lib/logger';
import type { ScryfallCard, MaxRarity, CollectionStrategy } from '@/deck-builder/types';
import { searchCards, commanderSearchIdentity } from '@/deck-builder/services/scryfall/client';
import { BudgetTracker } from './budgetTracker';
import {
  exceedsMaxPrice,
  exceedsMaxRarity,
  constrainsToCollection,
  notInCollection,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  notOnArena,
  exceedsCmcCap,
} from './deckFilters';
import { frontFaceName } from '@/lib/card-text';
import { buildSynergyFingerprint, synergyScore } from './synergyFingerprint';
import type { BracketGuard } from './bracketGuard';
import { validateCardRole, type RoleKey } from '@/deck-builder/services/tagger/client';
import { roleCapTolerance, ROLE_CAP_HATCH_MAX_PER_PASS } from './categorize';
import { qualifiedPayoffMismatch } from './nonbo';

/**
 * Same hard role-cap gate as the primary pick loop (cardPicking.ts's
 * RoleCapConfig), for the Scryfall-search fallback fill. No pre-built
 * cardRoleMap here — these are live Scryfall search results, not an EDHREC
 * pool with pre-known names — so role is derived per-candidate via
 * `validateCardRole`. `currentRoleCounts` is shared/mutated live like the
 * rest of FillHardGates' running counts.
 */
export interface RoleCapGate {
  roleTargets: Record<RoleKey, number>;
  currentRoleCounts: Record<RoleKey, number>;
  /** Shared across every gated path in the generation — incremented whenever
   *  the escape hatch admits an over-cap card, so the build report can
   *  disclose it in one aggregate note (never silent). */
  overflowCounts?: Partial<Record<RoleKey, number>>;
}

// Hard gates the EDHREC-pool picker (cardPicking.ts) enforces but a raw
// Scryfall search can't express in its query string. Threaded here so the
// fallback fill can never admit a card the primary path would have rejected
// (E71 controls audit): salt tolerance, the game-changer cap, and the
// target-bracket ceilings. All shared refs — counts accumulate across every
// fill in the same generation, exactly like the picking phases.
export interface FillHardGates {
  isSaltBlocked?: (name: string) => boolean;
  bracketGuard?: BracketGuard;
  gameChangerNames?: Set<string>;
  gameChangerCount?: { value: number };
  maxGameChangers?: number;
  /** Set per-call (not on the shared base gates object) where the brief
   *  actually wants role-awareness — see deckGenerator.ts call sites. */
  roleCap?: RoleCapGate;
  /** Live snapshot of every card seated so far this generation (all
   *  categories, all fill/pick paths) — needed to evaluate whether a
   *  color/type-qualified ETB/death payoff (E111, e.g. Ayara, First of
   *  Locthwain) the deck can't feed is being seated in place of an
   *  unqualified equivalent. Undefined disables the gate (tests that don't
   *  care about it never need to thread it through). */
  deckCardsSoFar?: () => ScryfallCard[];
  /** Shared across every gated path, like `overflowCounts` — incremented
   *  whenever the escape hatch admits a qualified-mismatched card rather
   *  than shipping the deck short (E111), so the build report can disclose
   *  it once, never silently. */
  qualifiedGateOverflowCount?: { value: number };
}

// Fill remaining slots with Scryfall search (fallback)
export async function fillWithScryfall(
  query: string,
  colorIdentity: string[],
  count: number,
  usedNames: Set<string>,
  bannedCards: Set<string> = new Set(),
  maxCardPrice: number | null = null,
  maxRarity: MaxRarity = null,
  maxCmc: number | null = null,
  budgetTracker: BudgetTracker | null = null,
  collectionNames?: Set<string>,
  currency: 'USD' | 'EUR' = 'USD',
  arenaOnly: boolean = false,
  scryfallQuery: string = '',
  collectionStrategy: CollectionStrategy = 'full',
  ignoreOwnedBudget: boolean = false,
  ignoreOwnedRarity: boolean = false,
  cardAllowed?: (card: ScryfallCard) => boolean,
  // EDHREC lift clusterScore lookup (E71 slice 2), lowercase name -> score,
  // 0 for cards with no lift connectivity. Primary re-rank key below — with
  // no lift data every score is 0, so the sort falls through to today's
  // fingerprint order unchanged.
  liftScoreOf?: (name: string) => number,
  gates?: FillHardGates
): Promise<ScryfallCard[]> {
  if (count <= 0) return [];

  // Add rarity filter to Scryfall query if set (skip when owned cards can bypass rarity)
  let fullQuery = query;
  if (maxRarity && !ignoreOwnedRarity) {
    fullQuery += ` r<=${maxRarity}`;
  }
  // Add CMC cap to Scryfall query (Tiny Leaders)
  if (maxCmc !== null) {
    fullQuery += ` cmc<=${maxCmc}`;
  }
  // Restrict to Arena-available cards
  if (arenaOnly) {
    fullQuery += ` game:arena`;
  }
  // Append user's additional Scryfall filters
  if (scryfallQuery.trim()) {
    fullQuery += ` ${scryfallQuery.trim()}`;
  }

  try {
    const response = await searchCards(fullQuery, commanderSearchIdentity(colorIdentity), {
      order: 'edhrec',
    });

    // Pass 1: cards clearing the static gates, in Scryfall's global edhrec order.
    // Budget is applied in pass 2 since its cap moves as we deduct.
    const passing: ScryfallCard[] = [];
    for (const card of response.data) {
      if (usedNames.has(card.name)) continue; // Commander format is always singleton
      if (bannedCards.has(card.name)) continue; // Skip banned cards
      if (cardAllowed && !cardAllowed(card)) continue;
      if (constrainsToCollection(collectionStrategy) && notInCollection(card.name, collectionNames))
        continue;
      if (!isOwnedRarityExempt(card.name, collectionNames, ignoreOwnedRarity)) {
        if (exceedsMaxRarity(card, maxRarity)) continue;
      }
      if (exceedsCmcCap(card, maxCmc)) continue;
      if (notOnArena(card, arenaOnly)) continue;
      if (gates?.isSaltBlocked?.(card.name)) continue;
      passing.push(card);
    }

    // In owned-only modes the candidates are all cards the user happens to own of
    // this type — Scryfall's global edhrec_rank says nothing about their fit with
    // this commander. Re-rank by how well each card's tagger tags match the deck
    // built so far (usedNames), so slots fill with the most on-theme owned card
    // rather than just the globally-best legal one. Stable sort → cards with no
    // shared tags keep their edhrec order. Other modes are left untouched.
    if (constrainsToCollection(collectionStrategy)) {
      const fingerprint = buildSynergyFingerprint(usedNames);
      if (fingerprint.size > 0) {
        const scored = passing.map((card, i) => ({
          card,
          i,
          l: liftScoreOf?.(card.name) ?? 0,
          s: synergyScore(card.name, fingerprint),
        }));
        scored.sort((a, b) => b.l - a.l || b.s - a.s || a.i - b.i);
        passing.length = 0;
        for (const { card } of scored) passing.push(card);
      }
    }

    // Pass 2: take up to `count`, applying the dynamic budget/price gate in order.
    const result: ScryfallCard[] = [];
    // Candidates skipped ONLY for being over their role's cap — replayed as an
    // escape hatch (least-over-target first) if the fill would otherwise ship
    // short, same shape as the primary pick loop's role-cap gate.
    const capSkipped: ScryfallCard[] = [];
    // Candidates skipped for being a qualified ETB/death payoff (E111) the
    // deck can't feed while an unqualified equivalent is available — same
    // escape-hatch shape as capSkipped, kept separate so a qualified-gate
    // admission never gets misattributed to the role-cap disclosure.
    const qualifiedGateSkipped: ScryfallCard[] = [];
    const tryAcceptCard = (
      card: ScryfallCard,
      allowCapOverflow: boolean,
      allowQualifiedOverflow = false
    ): boolean => {
      const ownedExempt = isOwnedBudgetExempt(card.name, collectionNames, ignoreOwnedBudget);
      if (!ownedExempt) {
        const effectiveCap = budgetTracker?.getEffectiveCap(maxCardPrice) ?? maxCardPrice;
        if (exceedsMaxPrice(card, effectiveCap, currency)) return false;
      }
      if (
        !allowQualifiedOverflow &&
        gates?.deckCardsSoFar &&
        qualifiedPayoffMismatch(card, gates.deckCardsSoFar(), passing)
      ) {
        qualifiedGateSkipped.push(card);
        return false;
      }
      // Running-count gates (checked at accept time, like cardPicking's tryPick,
      // so counts shared with the picking phases stay accurate).
      if (gates?.bracketGuard?.exceedsCeiling(card.name)) return false;
      const isGC = gates?.gameChangerNames?.has(card.name) ?? false;
      if (
        isGC &&
        gates?.gameChangerCount &&
        gates.maxGameChangers !== undefined &&
        gates.gameChangerCount.value >= gates.maxGameChangers
      )
        return false;
      if (!allowCapOverflow && gates?.roleCap) {
        const role = validateCardRole(card);
        if (role) {
          const target = gates.roleCap.roleTargets[role] ?? 0;
          if (
            target > 0 &&
            (gates.roleCap.currentRoleCounts[role] ?? 0) >= target + roleCapTolerance(target, role)
          ) {
            capSkipped.push(card);
            return false;
          }
        }
      }
      if (isGC && gates?.gameChangerCount) {
        card.isGameChanger = true;
        gates.gameChangerCount.value++;
      }
      if (allowQualifiedOverflow && gates?.qualifiedGateOverflowCount) {
        gates.qualifiedGateOverflowCount.value++;
      }
      gates?.bracketGuard?.record(card.name);
      result.push(card);
      usedNames.add(card.name);
      // Also mark front-face name for DFCs so EDHREC-sourced checks match
      if (card.name.includes(' // ')) usedNames.add(frontFaceName(card.name));
      if (!ownedExempt) budgetTracker?.deductCard(card);
      if (gates?.roleCap) {
        const role = validateCardRole(card);
        if (role) {
          gates.roleCap.currentRoleCounts[role] = (gates.roleCap.currentRoleCounts[role] ?? 0) + 1;
          if (allowCapOverflow && gates.roleCap.overflowCounts) {
            gates.roleCap.overflowCounts[role] = (gates.roleCap.overflowCounts[role] ?? 0) + 1;
          }
        }
      }
      return true;
    };

    for (const card of passing) {
      if (result.length >= count) break;
      tryAcceptCard(card, false);
    }

    if (gates?.roleCap && result.length < count && capSkipped.length > 0) {
      const roleCap = gates.roleCap;
      capSkipped.sort((a, b) => {
        const roleA = validateCardRole(a);
        const roleB = validateCardRole(b);
        const overA = roleA
          ? (roleCap.currentRoleCounts[roleA] ?? 0) - (roleCap.roleTargets[roleA] ?? 0)
          : 0;
        const overB = roleB
          ? (roleCap.currentRoleCounts[roleB] ?? 0) - (roleCap.roleTargets[roleB] ?? 0)
          : 0;
        return overA - overB;
      });
      let admitted = 0;
      for (const card of capSkipped) {
        if (result.length >= count) break;
        if (admitted >= ROLE_CAP_HATCH_MAX_PER_PASS) break;
        if (tryAcceptCard(card, true)) admitted++;
      }
    }

    // Qualified-payoff escape hatch (E111) — mirrors the role-cap hatch above:
    // seating a dead-text qualified payoff still beats shipping the deck
    // short, so replay the skipped candidates once nothing else is left.
    if (result.length < count && qualifiedGateSkipped.length > 0) {
      let admitted = 0;
      for (const card of qualifiedGateSkipped) {
        if (result.length >= count) break;
        if (admitted >= ROLE_CAP_HATCH_MAX_PER_PASS) break;
        if (tryAcceptCard(card, false, true)) admitted++;
      }
    }

    return result;
  } catch (error) {
    logger.error(`Scryfall fallback failed for query "${query}":`, error);
    return [];
  }
}
