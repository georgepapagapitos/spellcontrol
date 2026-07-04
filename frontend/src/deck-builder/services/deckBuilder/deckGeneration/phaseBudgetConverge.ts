import { logger } from '@/lib/logger';
import type {
  CoherenceRepair,
  DeckCategory,
  DetectedCombo,
  MaxRarity,
  ScryfallCard,
} from '@/deck-builder/types';
import type { GenerationState } from './state';
import { frontFaceName } from '@/lib/card-text';
import { getCardRole, type RoleKey } from '@/deck-builder/services/tagger/client';
import { roleCapTolerance, stampRoleSubtypes, routeCardByType } from '../categorize';
import {
  constrainsToCollection,
  notInCollection,
  exceedsMaxRarity,
  exceedsCmcCap,
  notOnArena,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  fitsColorIdentity,
} from '../deckFilters';
import { calculateCardPriority } from '../cardPicking';
import { parsePrice } from '../costAnalyzer';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { primaryTypeOf } from '@/lib/card-matching';
import type { BudgetTracker } from '../budgetTracker';
import type { BracketGuard } from '../bracketGuard';
import { analyzeDeckSynergy, isLoadBearing } from '@/deck-builder/services/synergy/deckSynergy';
import { isAltWinCard } from '@/deck-builder/services/winConditions/detect';

// ── Budget Convergence (E79) ──
// BudgetTracker's per-pick `getEffectiveCap` is a soft greedy heuristic — it
// spreads spend across remaining slots, but nothing ever re-checks the
// ACCUMULATED total against `deckBudget` once generation finishes. A $50 ask
// can ship at $71 with only a disclosure note. This pass closes the loop: after
// every other mutating phase (fixup, coherence repair, bracket convergence), if
// the live deck total exceeds `deckBudget`, iteratively swap the priciest
// swappable cards for a cheaper same-role (or same-function) replacement until
// the deck lands at or under budget, or no legal swap remains.
//
// Every replacement clears the SAME full pick-time gate set as the other
// generation-tail repair passes (phaseCoherenceRepair.ts's `findCandidate`):
// salt, color identity, game-changer cap, bracket ceiling, rarity, CMC, Arena,
// the synergy-dependency guard, collection mode, and the #1008 role cap (a
// same-role swap is net-neutral on role counts by construction; a role-null
// replacement still can't push a DIFFERENT role over its cap). Candidates are
// sourced from the same query-scoped EDHREC pool the other two repair phases
// use (`state.edhrecData.cardlists.allNonLand`), so — like them — no separate
// scryfallQuery re-check is needed; the pool was already built against it.
//
// Deliberately NOT gated: BudgetTracker.getEffectiveCap / remainingBudget.
// That heuristic exists to PACE spend across remaining picks during
// generation — it's meaningless once the deck is already over budget: a deck
// that's over $50 has `remainingBudget < 0`, and `getEffectiveCap` floors its
// dynamic cap at `Math.max(0, ...)`, i.e. exactly $0 whenever remainingBudget
// is negative. Gating replacements on that cap meant EVERY candidate flunked
// the moment the deck went over — a live eval reproduced this exactly: 0
// swaps applied to a $71 mono-red deck with a $50 budget, next to an honest
// "no cheaper legal alternatives" note that was actually false. The real
// budget improvement for a convergence swap is simply "strictly cheaper than
// the card it replaces" (enforced below) — every such swap monotonically
// lowers the total, which is the only ceiling this pass needs.
//
// ponytail: costAnalyzer.ts's `buildCostPlan`/`autoCheckToTarget` already solve
// "rank cheaper alternatives" for the Coach's UI-facing Trim Cost lane, but they
// batch-plan over a `RecommendedCard[]` pool with no notion of the LIVE,
// per-swap pick-time gates this pass must honor (GC cap, bracket ceiling, role
// cap — all counters that change after each swap). Force-fitting them here
// would mean re-deriving the same live-gate logic as a wrapper around them —
// more code, not less. We reuse `parsePrice` directly (the one pure primitive
// that fits) and mirror `autoCheckToTarget`'s "biggest savings first" greedy
// order, adapted to the live per-swap loop the other repair phases already use.
// The UI Trim Cost lane keeps its own engine untouched.
//
// Lands are never swapped here (no land-fixing-floor logic in this pass) — a
// residual dominated by land cost surfaces the same honest "no cheaper
// equivalent" disclosure as a must-include/combo-piece residual.

export const MAX_BUDGET_SWAPS = 20;
const MAX_BUDGET_ROUNDS = 5;

export interface BudgetConvergeContext {
  /** name → ScryfallCard map built during generation (for swap-in lookups). */
  scryfallCardMap: Map<string, ScryfallCard>;
  /** Complete/partial combos detected so far (combo pieces are protected). */
  detectedCombos: DetectedCombo[] | undefined;
  /** Cards the user pinned — never cut (lower-cased). */
  mustIncludeNames: Set<string>;
  /** Generation-wide synergy-dependency guard for replacements. */
  cardAllowed?: (card: ScryfallCard) => boolean;
  /** Lowercased name → lift co-play seeds (from the generation lift index). */
  liftedByOf: (lowerName: string) => string[] | undefined;
  isSaltBlocked?: (name: string) => boolean;
  bracketGuard?: BracketGuard;
  gameChangerCount: { value: number };
  maxGameChangers: number;
  /** Only used for bookkeeping (deduct on add / credit back on cut) — never
   *  for gating a replacement (see the header comment on why). */
  budgetTracker: BudgetTracker | null;
  maxRarity: MaxRarity;
  maxCmc: number | null;
  arenaOnly: boolean;
  currency: 'USD' | 'EUR';
  ignoreOwnedBudget: boolean;
  ignoreOwnedRarity: boolean;
  /** Live role targets, so a role-null replacement can't push a role over its
   *  cap (a same-role swap is net-neutral by construction either way). */
  roleTargets: Record<RoleKey, number> | null;
  /** The user's total-deck budget — always a number when this phase runs
   *  (the caller only invokes it when `cfg.deckBudget !== null`). */
  deckBudget: number;
}

export interface BudgetConvergeResult {
  /** Number of expensive→cheaper swaps applied. */
  applied: number;
  /** Deck total (all categories, including lands) after convergence. */
  finalTotal: number;
  /** CoherenceRepair-shaped rows for the build report (same shape as coherence
   *  repair's, rendered the same way, its own section). */
  repairs: CoherenceRepair[];
  /** Honest, human reason convergence stopped short — set only when the deck
   *  is STILL over budget once the loop gives up (protected cards / no legal
   *  cheaper alternative left). Undefined when the deck converged. */
  residualReason?: string;
}

const ROLE_LABEL: Record<RoleKey, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipe',
  cardDraw: 'card draw',
};

export function applyBudgetConvergence(
  state: GenerationState,
  ctx: BudgetConvergeContext
): BudgetConvergeResult {
  const repairs: CoherenceRepair[] = [];

  const nonLands = (): ScryfallCard[] =>
    (Object.entries(state.categories) as [DeckCategory, ScryfallCard[]][])
      .filter(([cat]) => cat !== 'lands')
      .flatMap(([, cards]) => cards);

  const totalNow = (): number => {
    let sum = 0;
    for (const card of Object.values(state.categories).flat()) {
      const p = getCardPrice(card, ctx.currency);
      if (p) sum += parseFloat(p) || 0;
    }
    return sum;
  };

  let total = totalNow();
  if (total <= ctx.deckBudget) return { applied: 0, finalTotal: total, repairs };

  const pool = state.edhrecData?.cardlists.allNonLand;
  if (!pool || pool.length === 0) {
    logger.debug('[DeckGen] Budget converge: no EDHREC pool — skipped (offline)');
    return {
      applied: 0,
      finalTotal: total,
      repairs,
      residualReason: 'no cheaper alternatives could be sourced offline',
    };
  }

  const { commander, partnerCommander } = state.context;
  const commanders = [commander, partnerCommander].filter((c): c is ScryfallCard => c != null);
  const commanderNames = commanders.map((c) => c.name);
  const ownedOnly = constrainsToCollection(state.cfg.collectionStrategy);
  const collectionNames = state.context.collectionNames;
  const colorIdentity = state.context.colorIdentity;

  const completeComboNames = new Set<string>();
  for (const combo of ctx.detectedCombos ?? []) {
    if (!combo.isComplete) continue;
    for (const n of combo.cards) completeComboNames.add(n);
  }

  // Computed once, up front — mirrors phaseCoherenceRepair's isLoadBearing
  // snapshot (a handful of mid-loop swaps don't meaningfully shift what counts
  // as the deck's synergy backbone).
  const deckSynergy = analyzeDeckSynergy([...commanders, ...nonLands()]);

  const isProtected = (card: ScryfallCard): boolean =>
    commanderNames.includes(card.name) ||
    !!card.isMustInclude ||
    ctx.mustIncludeNames.has(card.name.toLowerCase()) ||
    state.comboCardNames.has(card.name) ||
    completeComboNames.has(card.name) ||
    completeComboNames.has(frontFaceName(card.name)) ||
    (ctx.liftedByOf(card.name.toLowerCase())?.length ?? 0) >= 2 ||
    state.gameChangerNames.has(card.name) ||
    isAltWinCard(card) ||
    isLoadBearing(card, deckSynergy);

  const findInDeck = (name: string): { card: ScryfallCard; category: DeckCategory } | null => {
    for (const [cat, cards] of Object.entries(state.categories) as [
      DeckCategory,
      ScryfallCard[],
    ][]) {
      if (cat === 'lands') continue;
      const card = cards.find((c) => c.name === name);
      if (card) return { card, category: cat };
    }
    return null;
  };

  const removeCard = (card: ScryfallCard, category: DeckCategory) => {
    state.categories[category] = state.categories[category].filter((c) => c !== card);
    state.usedNames.delete(card.name);
    if (card.name.includes(' // ')) state.usedNames.delete(frontFaceName(card.name));
    const role = getCardRole(card.name);
    if (role && state.currentRoleCounts[role] > 0) state.currentRoleCounts[role]--;
    // Every cut here is immediately followed by a commitAdd (a lateral 1-for-1
    // swap, never a net removal) — credit the tracker back so it doesn't drift
    // ever-more-negative across many swaps: commitAdd's deductCard already
    // subtracts the replacement's price and decrements cardsRemaining, so this
    // is the other half of that same slot, not a new one.
    if (
      ctx.budgetTracker &&
      !isOwnedBudgetExempt(card.name, collectionNames, ctx.ignoreOwnedBudget)
    ) {
      const cutPrice = parsePrice(getCardPrice(card, ctx.currency));
      if (cutPrice != null) ctx.budgetTracker.remainingBudget += cutPrice;
      ctx.budgetTracker.cardsRemaining += 1;
    }
  };

  const isRoleCapBlocked = (name: string): boolean => {
    if (!ctx.roleTargets) return false;
    const role = getCardRole(name);
    if (!role) return false;
    const target = ctx.roleTargets[role] ?? 0;
    if (target <= 0) return false;
    return (state.currentRoleCounts[role] ?? 0) >= target + roleCapTolerance(target);
  };

  const commitAdd = (card: ScryfallCard) => {
    stampRoleSubtypes(card);
    routeCardByType(card, state.categories);
    state.usedNames.add(card.name);
    if (card.name.includes(' // ')) state.usedNames.add(frontFaceName(card.name));
    const role = getCardRole(card.name);
    if (role) state.currentRoleCounts[role] = (state.currentRoleCounts[role] ?? 0) + 1;
    if (state.gameChangerNames.has(card.name)) {
      card.isGameChanger = true;
      ctx.gameChangerCount.value++;
    }
    ctx.bracketGuard?.record(card.name);
    if (!isOwnedBudgetExempt(card.name, collectionNames, ctx.ignoreOwnedBudget)) {
      ctx.budgetTracker?.deductCard(card);
    }
  };

  // Best pool candidate strictly cheaper than `cutPrice`, clearing every
  // pick-time hard gate, preferring same role → same primary type → highest
  // calculateCardPriority (mirrors findCandidate in phaseCoherenceRepair.ts,
  // plus the strict-cheaper + role-cap checks this pass needs).
  const findReplacement = (cutCard: ScryfallCard, cutPrice: number): ScryfallCard | null => {
    const cutRole = getCardRole(cutCard.name);
    const cutType = primaryTypeOf(cutCard);

    const ranked = [...pool]
      .filter(
        (c) =>
          c.name !== cutCard.name &&
          !state.usedNames.has(c.name) &&
          !state.bannedCards.has(c.name) &&
          ctx.scryfallCardMap.has(c.name) &&
          !state.comboCardNames.has(c.name) &&
          !completeComboNames.has(c.name) &&
          !ctx.isSaltBlocked?.(c.name) &&
          (!ownedOnly || !notInCollection(c.name, collectionNames))
      )
      .sort((a, b) => calculateCardPriority(b) - calculateCardPriority(a));

    const gateOk = (card: ScryfallCard): boolean => {
      const price = parsePrice(getCardPrice(card, ctx.currency));
      if (price == null || price >= cutPrice) return false; // strictly cheaper, and must be priced
      if (ctx.cardAllowed && !ctx.cardAllowed(card)) return false;
      if (!fitsColorIdentity(card, colorIdentity)) return false;
      const isGC = state.gameChangerNames.has(card.name);
      if (isGC && ctx.gameChangerCount.value >= ctx.maxGameChangers) return false;
      if (ctx.bracketGuard?.exceedsCeiling(card.name)) return false;
      // No maxCardPrice/getEffectiveCap gate here — "strictly cheaper than
      // cutPrice" (checked above) IS the budget ceiling for a convergence
      // swap; see the header comment for why the dynamic cap can't be used.
      if (!isOwnedRarityExempt(card.name, collectionNames, ctx.ignoreOwnedRarity)) {
        if (exceedsMaxRarity(card, ctx.maxRarity)) return false;
      }
      if (exceedsCmcCap(card, ctx.maxCmc)) return false;
      if (notOnArena(card, ctx.arenaOnly)) return false;
      if (isRoleCapBlocked(card.name)) return false;
      return true;
    };

    const eligible = ranked
      .map((c) => ctx.scryfallCardMap.get(c.name))
      .filter((c): c is ScryfallCard => !!c && gateOk(c));
    if (eligible.length === 0) return null;

    if (cutRole) {
      const sameRole = eligible.find((c) => getCardRole(c.name) === cutRole);
      if (sameRole) return sameRole;
    }
    const sameType = eligible.find((c) => primaryTypeOf(c) === cutType);
    if (sameType) return sameType;
    return eligible[0];
  };

  const reasonFor = (cut: ScryfallCard, added: ScryfallCard, savings: number): string => {
    const sym = ctx.currency === 'EUR' ? '€' : '$';
    const cutRole = getCardRole(cut.name);
    const addedRole = getCardRole(added.name);
    const bucket =
      cutRole && cutRole === addedRole
        ? `same ${ROLE_LABEL[cutRole]} role`
        : primaryTypeOf(cut) === primaryTypeOf(added)
          ? 'similar card type'
          : 'cheaper alternative';
    return `Saves ${sym}${savings.toFixed(2)} — ${bucket}`;
  };

  let applied = 0;

  for (let round = 0; round < MAX_BUDGET_ROUNDS && total > ctx.deckBudget; round++) {
    // Priciest-first each round: the biggest single swap makes the fastest
    // progress toward budget, and a fresh sort picks up any composition change
    // (a previous round's swap, role/GC counters shifting what's now legal).
    const cuttable = nonLands()
      .filter((c) => !isProtected(c))
      .map((c) => ({ card: c, price: parsePrice(getCardPrice(c, ctx.currency)) }))
      .filter((c): c is { card: ScryfallCard; price: number } => c.price != null && c.price > 0)
      .sort((a, b) => b.price - a.price);

    let progressed = false;
    for (const { card, price } of cuttable) {
      if (total <= ctx.deckBudget || applied >= MAX_BUDGET_SWAPS) break;
      // The card may already have been swapped out earlier this round via a
      // different candidate's replacement path — re-verify it's still seated.
      if (!findInDeck(card.name)) continue;

      const replacement = findReplacement(card, price);
      if (!replacement) continue;

      const replPrice = parsePrice(getCardPrice(replacement, ctx.currency)) ?? 0;
      const savings = price - replPrice;
      const loc = findInDeck(card.name)!;
      removeCard(loc.card, loc.category);
      commitAdd(replacement);
      total -= savings;
      applied++;
      progressed = true;
      repairs.push({
        cut: card.name,
        added: replacement.name,
        reason: reasonFor(card, replacement, savings),
      });
      logger.debug(
        `[DeckGen] Budget converge: cut ${card.name} ($${price.toFixed(2)}) → added ${replacement.name} ($${replPrice.toFixed(2)})`
      );
    }

    if (!progressed) break; // every remaining offender is protected/unreplaceable
  }

  // Recompute fresh rather than trusting the incrementally-decremented `total`
  // — a long chain of `total -= savings` can drift a cent off a full re-sum
  // by float rounding, and this number is what a unit test (and, in spirit,
  // deckGenerator.ts's own independent final-total recompute) pins against.
  const finalTotal = totalNow();

  if (applied > 0) {
    logger.debug(
      `[DeckGen] Budget converge: ${applied} swap(s), total now $${finalTotal.toFixed(2)}`
    );
  }

  if (finalTotal <= ctx.deckBudget) {
    return { applied, finalTotal, repairs };
  }

  // Still over — say why, worded so it's equally honest whether 0 or N swaps
  // ran (never implies a partial job or an exhaustive search that didn't
  // happen). If every remaining priced card is protected, that's the reason;
  // otherwise some unprotected cards simply had no legal cheaper alternative
  // (a thin pool, or every candidate blocked by a hard gate) — including the
  // 0-swap case, since findReplacement really did search every cuttable card.
  const remainingUnprotectedPriced = nonLands().filter((c) => {
    if (isProtected(c)) return false;
    const p = parsePrice(getCardPrice(c, ctx.currency));
    return p != null && p > 0;
  });
  const residualReason =
    remainingUnprotectedPriced.length === 0
      ? 'every remaining card is a must-include, combo piece, or otherwise protected, with no cheaper equivalent'
      : 'no cheaper legal alternative could be found for the remaining cards';

  return { applied, finalTotal, repairs, residualReason };
}
