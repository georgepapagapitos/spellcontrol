import { logger } from '@/lib/util/logger';
import { evictionKeeper } from './evictionKeeper';
import { budgetTrades, budgetTradeLoss, pickTrade, stapleTarget } from './budgetTradeLoss';
import type {
  CoherenceRepair,
  DeckCategory,
  DetectedCombo,
  EDHRECCard,
  MaxRarity,
  ScryfallCard,
} from '@/deck-builder/types';
import type { GenerationState } from './state';
import { frontFaceName } from '@/lib/cards/card-text';
import {
  getCardRole,
  isUtilityLand as isTaggedUtilityLand,
  readsAsProtection,
  isFreeInteraction,
  isOneSidedWipe,
  getWipeScope,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { wipeQualityPenalty } from '../wipeTieBreaks';
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
  exceedsBudget,
  budgetStep,
} from '../deckFilters';
import { calculateCardPriority } from '../cardPicking';
import { parsePrice } from '../costAnalyzer';
import { getCardPrice, getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { primaryTypeOf } from '@/lib/coach/card-matching';
import type { BudgetTracker } from '../budgetTracker';
import { STAPLE_ROCK_NAMES } from './phaseStapleManaRocks';
import { STAPLE_INCLUSION_BAR } from '../roleCapAllowance';
import type { BracketGuard } from '../bracketGuard';
import { analyzeDeckSynergy, isLoadBearing } from '@/deck-builder/services/synergy/deckSynergy';
import { isAltWinCard } from '@/deck-builder/services/winConditions/detect';
import { isBasicLandName } from '@/lib/collection/allocations';
import { producedManaColors } from '@/lib/deck-analysis/mana-sources';
import { isUtilityLand } from '../landUpgrades';
import { planJobServed, readDeckLandPlan } from '../landPlan';
import { countedRoleOf } from '../commanderDeckAnalysis';

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
// costAnalyzer.ts's `buildCostPlan`/`autoCheckToTarget` already solve
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
//
// ── Round 3 fixes (E79) ──
// 1. Role-cap timing bug: the role-cap gate (#1008) was applied to EVERY
//    candidate, including same-role ones — but a same-role swap (cut one
//    ramp card, add another ramp card) is net-ZERO on that role's count, so
//    it can never be what pushes a role over cap; only a role-CROSSING
//    replacement can. Gating same-role candidates on the CURRENT (pre-cut)
//    count wrongly rejected every same-role swap whenever that role was
//    already at/over cap — which is common, since the generator's own
//    role-cap escape hatch (`roleCapOverflowNote`) deliberately allows a
//    THIN role to finish over its target. A live eval reproduced this
//    exactly on Atraxa (ramp 15 vs target 12, removal 10 vs target 7 — both
//    already over-cap): 0 swaps applied even though 22 of the deck's 30
//    priciest cards were entirely unprotected, because every one of them
//    needed a same-role replacement and every same-role candidate was
//    wrongly blocked. Fixed: the role-cap gate now only applies when the
//    candidate's role DIFFERS from the cut card's role.
// 2. Savings-first, quality-bounded selection: previously "prefer same
//    role → same type → highest calculateCardPriority" picked the highest-
//    priority cheaper card, which is often barely cheaper (a live eval
//    showed $0.06–$0.36 "savings"). Now, within whichever tier wins (role >
//    type > any), candidates are shortlisted to those within
//    PRIORITY_BAND of that tier's best `calculateCardPriority`, and the
//    CHEAPEST of the shortlist is picked — real savings without settling for
//    a meaningfully worse card.
// 3. Minimum savings threshold: a swap below MIN_SAVINGS is churn, not a
//    real budget improvement (the round-3 eval's Big Score → Mind Stone
//    saved $0.06 while side-grading a spell for a rock) — it's declined
//    outright rather than applied. Same-role tier's threshold check never
//    falls through to type/any — the round-3 eval's Fyndhorn Elves (ramp) →
//    Reclamation Sage (removal creature) crossing happened only because the
//    role-cap bug above wrongly emptied the same-role tier first; with that
//    fixed, declining a too-small same-role swap outright (rather than
//    reaching for a role-degrading fallback) keeps the deck's role balance
//    the higher-priority invariant.
//
// ── Round 4 fixes (E79) ──
// A live eval on Atraxa (a dense superfriends/counters synergy deck) still
// produced 0 swaps and an "every remaining card is protected" note after
// round 3 — but a dump-based reconstruction of `isProtected` found 22 of the
// 30 priciest cards unprotected. The dump couldn't reproduce the LIVE
// `analyzeDeckSynergy`/lift index, so the live isLoadBearing/lift-protected
// sets were far broader than the reconstruction: for a deck this synergy-
// dense, a flat "never cut" union over load-bearing + lift + GC effectively
// protected the whole deck — a protection that protects everything protects
// nothing the user asked for (a budget deck the user explicitly wants
// trimmed). Two structural changes:
//
// 1. TIERED PROTECTIONS — hard vs soft. HARD (never cut, no matter what):
//    commander(s), must-includes, complete-combo pieces, and the alt-win
//    FLOOR (never cut the last remaining win condition — extra ones beyond
//    the first are soft). SOFT (cut only once every fully-unprotected
//    candidate is exhausted — a distinct second stage, priciest-soft-first,
//    each such swap discloses which protection it yielded in the reason
//    string): isLoadBearing, lift-protected (≥2 seeds), extra alt-win cards,
//    game changers (but ONLY when the user didn't set an explicit
//    targetBracket — with one set, GCs stay hard so a budget ask can't
//    silently change the bracket ask), and comboCardNames (the generation-
//    time combo-boost candidate set — a weaker "combo-flavored" signal than
//    an actually-complete combo, which stays hard via completeComboNames).
// 2. BUDGET-POOL CANDIDATE SOURCE: the standard EDHREC page (`pool`) is what
//    generation itself picked from, so by convergence time its cheapest,
//    most-popular cards are usually already IN the deck — the leftover tail
//    skews toward similarly-priced-or-pricier staples, so same-role tiers
//    can run dry even when real budget alternatives exist (Krenko stuck at
//    $68 with "no cheaper legal alternative"). `ctx.fetchBudgetPool` (soft-
//    fails to null — network/offline never breaks generation) lets the
//    caller merge the commander's EDHREC "budget" pool + resolved
//    ScryfallCards in, sourced the same way generation resolves its own pool
//    (mirrors phaseCoherenceRepair's `getBasicLand` DI pattern so this phase
//    stays pure/testable and agnostic to EDHREC/Scryfall mechanics). Same
//    full gate set applies regardless of a candidate's source. One nuance:
//    even with more candidates available, a role-BEARING cut card still only
//    ever considers same-role candidates (never same-type/any) — the
//    same-type fallback is for role-NULL cut cards only, so more candidates
//    existing can't reintroduce a function-degrading cross-role trade.

export const MAX_BUDGET_SWAPS = 20;
/** The value cut's own allowance on top (E1044): at $25 a card averages about
 *  33 cents, so closing a few dollars takes many small trades. */
export const MAX_VALUE_CUTS = 20;
/** At most this many nonbasics leave for basics (E1044): the last resort is
 *  a few lands, never the whole manabase. */
export const MAX_LAND_CUTS = 8;

const BASIC_BY_COLOR: Record<string, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
};
const MAX_BUDGET_ROUNDS = 5;
/** Round-3 tuning constants — see the header comment above for rationale. */
const PRIORITY_BAND = 0.8;
/** Stages 1-2 take the band's cheapest card, stage 3 the least play lost (E1046). */
type ReplaceMode = 'cheapest' | 'leastLoss' | 'value';

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
  /** E1044: run only the last-resort stages (value cut, then lands). The
   *  generator calls this once more after the whole-deck search, on a deck
   *  still over budget; the first call runs the same-role stages only. */
  lastResort?: boolean;
  /** Fetches the commander's EDHREC "budget" pool + resolves it to
   *  ScryfallCards the same way generation resolves its own pool — injected
   *  so this phase stays pure/testable and agnostic to EDHREC/Scryfall
   *  mechanics (mirrors phaseCoherenceRepair's `getBasicLand` DI). MUST
   *  soft-fail to `null` on any error/offline — never throw; a failure here
   *  just means the merge is skipped and convergence proceeds with the
   *  standard pool only. Omitted entirely (undefined) → merge never
   *  attempted (e.g. tests that don't care, or a null-deckBudget path where
   *  this phase never runs at all). */
  /** Resolves a basic land by name for the land stage (E1044); mirrors
   *  phaseCoherenceRepair's DI. Omitted, the land stage never runs. */
  getBasicLand?: (name: string) => Promise<ScryfallCard | null>;
  fetchBudgetPool?: () => Promise<{
    pool: EDHRECCard[];
    scryfallMap: Map<string, ScryfallCard>;
  } | null>;
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

/** A board wipe may be swapped for a worse one only for at least this saving. */
const WIPE_DOWNGRADE_MIN_SAVINGS = 5;

export async function applyBudgetConvergence(
  state: GenerationState,
  ctx: BudgetConvergeContext
): Promise<BudgetConvergeResult> {
  const repairs: CoherenceRepair[] = [];

  const nonLands = (): ScryfallCard[] =>
    (Object.entries(state.categories) as [DeckCategory, ScryfallCard[]][])
      .filter(([cat]) => cat !== 'lands')
      .flatMap(([, cards]) => cards);

  // E128: an owned card the user asked to ignore-for-budget must not count
  // toward the total at all — otherwise "ignoreOwnedBudget" is decorative:
  // the deck can still read as over budget purely from cards the user
  // already owns, and convergence below (see isHardProtected) would then
  // have a real incentive to evict them.
  const isBudgetExempt = (card: ScryfallCard): boolean =>
    isOwnedBudgetExempt(card.name, state.context.collectionNames, ctx.ignoreOwnedBudget);

  // Cards with no resolvable price that also aren't budget-exempt — the ONLY
  // way one of these can be seated is a must-include (the sole picker that
  // never gates on price). totalNow() below has to treat them as $0 for lack
  // of a real number, which is optimistic, not conservative, unlike pick-time
  // exceedsMaxPrice (which treats a missing price as OVER any cap). Tracked
  // so the residual note can say so rather than implying an exhaustive total.
  const unpricedNonExempt = (): ScryfallCard[] =>
    nonLands().filter((c) => !isBudgetExempt(c) && !getCardPrice(c, ctx.currency));

  const totalNow = (): number => {
    let sum = 0;
    for (const card of Object.values(state.categories).flat()) {
      if (isBudgetExempt(card)) continue;
      const p = getCardPrice(card, ctx.currency);
      if (p) sum += parseFloat(p) || 0;
    }
    return sum;
  };

  let total = totalNow();
  if (!exceedsBudget(total, ctx.deckBudget)) return { applied: 0, finalTotal: total, repairs };

  const standardPool = state.edhrecData?.cardlists.allNonLand;
  if (!standardPool || standardPool.length === 0) {
    logger.debug('[DeckGen] Budget converge: no EDHREC pool — skipped (offline)');
    return {
      applied: 0,
      finalTotal: total,
      repairs,
      residualReason: 'no cheaper alternatives could be sourced offline',
    };
  }

  // Merge in the commander's EDHREC "budget" pool (round 4) — the standard
  // pool's leftover tail skews expensive (generation already picked its
  // cheapest/best entries), so same-role tiers can run dry even when real
  // budget alternatives exist. Soft-fails to the standard pool alone on any
  // error (see the ctx.fetchBudgetPool doc comment) — this network call must
  // never be able to break generation.
  let pool = standardPool;
  let scryfallCardMap = ctx.scryfallCardMap;
  const budgetInclusion = new Map<string, number>();
  if (ctx.fetchBudgetPool) {
    try {
      const budgetResult = await ctx.fetchBudgetPool();
      if (budgetResult && budgetResult.pool.length > 0) {
        for (const c of budgetResult.pool) budgetInclusion.set(c.name, c.inclusion);
        const existingNames = new Set(pool.map((c) => c.name));
        const newCards = budgetResult.pool.filter((c) => !existingNames.has(c.name));
        if (newCards.length > 0) {
          pool = [...pool, ...newCards];
          scryfallCardMap = new Map(ctx.scryfallCardMap);
          for (const [name, card] of budgetResult.scryfallMap) {
            if (!scryfallCardMap.has(name)) scryfallCardMap.set(name, card);
          }
          logger.debug(
            `[DeckGen] Budget converge: merged ${newCards.length} budget-pool candidate(s)`
          );
        }
      }
    } catch (error) {
      logger.debug(
        '[DeckGen] Budget converge: budget-pool fetch failed, using standard pool',
        error
      );
    }
  }

  // A swap below this saves pennies, not budget — churn that side-grades a
  // card's function for nothing (E79 round 3: Big Score → Mind Stone saved
  // $0.06). Scales with the ask so a $500 budget doesn't get nickel-and-dimed
  // by $0.50 swaps either.
  const MIN_SAVINGS = budgetStep(ctx.deckBudget);
  // E1044: the value cut never takes a card for one played less often, so a
  // smaller saving is not the side-grade MIN_SAVINGS guards against: it trades
  // a 0%-play pick for a cheaper card the commander's decks play at least as
  // much. A fifth of the step: 10 cents at $25, $1 at $500.
  const VALUE_CUT_MIN_SAVINGS = MIN_SAVINGS / 5;

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

  // True only for the LAST alt-win card left in the deck — extra ones beyond
  // the first are a soft protection (see softProtectionLabel). Recomputed
  // live each call (cheap at deck scale) so it always reflects the current
  // count, including mid-round after an earlier swap.
  const isLastAltWinCard = (card: ScryfallCard): boolean =>
    isAltWinCard(card) && nonLands().filter((c) => isAltWinCard(c)).length <= 1;

  // HARD protections — never cut, no matter how far over budget the deck is.
  // E128: a card the user told us to ignore-for-budget is budget-invisible by
  // definition — cutting it "to fit the budget" contradicts the setting it
  // was seated under (isBudgetExempt, same predicate totalNow() excludes it
  // with, so a card can never be simultaneously invisible to the total and
  // an eviction candidate for that same total).
  const isHardProtected = (card: ScryfallCard): boolean =>
    commanderNames.includes(card.name) ||
    !!card.isMustInclude ||
    ctx.mustIncludeNames.has(card.name.toLowerCase()) ||
    completeComboNames.has(card.name) ||
    completeComboNames.has(frontFaceName(card.name)) ||
    isLastAltWinCard(card) ||
    // A staple rock costs a few dollars and is in nearly every deck; the cut
    // that fits the budget comes from the spells (E561, like E537's paths).
    STAPLE_ROCK_NAMES.has(card.name) ||
    isBudgetExempt(card);

  // SOFT protections — cut only once every fully-unprotected candidate is
  // exhausted (stage 2, below). Returns the human label to disclose in the
  // swap's reason string, or null when no soft protection applies. Checked
  // ONLY for cards that already cleared isHardProtected, so an alt-win card
  // reaching here is guaranteed not to be the last one.
  const keeps = evictionKeeper(state);
  const softProtectionLabel = (card: ScryfallCard): string | null => {
    if (isLoadBearing(card, deckSynergy)) return 'a synergy engine piece';
    if ((ctx.liftedByOf(card.name.toLowerCase())?.length ?? 0) >= 2)
      return 'a strongly-linked synergy pick';
    if (isAltWinCard(card)) return 'an extra win condition';
    if (state.cfg.targetBracket === undefined && state.gameChangerNames.has(card.name))
      return 'a game changer';
    if (state.comboCardNames.has(card.name)) return 'a combo-flavored pick';
    if (readsAsProtection(card)) return 'a protection/free-interaction piece';
    if (keeps(card)) return 'a staple, tutor, combo piece or last answer of its kind'; // E563
    // iter-10 Slice A: the protection label above already says
    // "protection/free-interaction piece", but its regex misses the
    // Commandeer-class cards this new classifier exists for (e.g. Fierce
    // Guardianship's "Counter target noncreature spell" still trips the
    // widened isProtectionPiece branch, but Commandeer itself never did) —
    // this branch is for exactly the ones that classifier's regex misses.
    if (isFreeInteraction(card)) return 'a free-interaction piece';
    return null;
  };

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

  // The standard page only: the merged budget page counts budget decks, so a
  // card's figure there is not comparable with another card's standard one
  // (Haunted Cloak read 20.6 against Reality Smasher's 18.7 in the first gate,
  // and is in 0% of Kozilek's decks).
  const poolInclusion = new Map(standardPool.map((c) => [c.name, c.inclusion]));
  const inclusionOf = (name: string): number => poolInclusion.get(name) ?? 0;
  // E1046: a card cut here never comes back as a replacement (Krenko $100 cut
  // Conspicuous Snoop, brought it back, then cut it again).
  const cutHere = new Set<string>();
  const { leastLossPick, playLost } = budgetTradeLoss(poolInclusion, budgetInclusion, (sc) =>
    parsePrice(getCardPrice(sc, ctx.currency))
  );

  // Counted from the deck as it stands, the way the report and the deck page
  // count (countedRoleOf): after the whole-deck search the running counters
  // no longer match the deck, and the tagger's role reads more cards as ramp
  // or removal than the report does. Either one let the value cut take
  // Krenko's ramp to 11 of 12 and Yuriko's removal to 6 of 8 in the gates.
  const liveRoleCount = (role: RoleKey): number =>
    nonLands().filter((c) => countedRoleOf(c) === role).length;

  /** The role sits under its target (a value cut may fill it). */
  const isRoleShort = (role: RoleKey): boolean =>
    !!ctx.roleTargets && liveRoleCount(role) < (ctx.roleTargets[role] ?? 0);

  /** The role holds more than its target, so one card of it can leave the role.
   *  With no targets nothing is known to be spare. */
  const isRoleSurplus = (role: RoleKey): boolean =>
    !!ctx.roleTargets && liveRoleCount(role) > (ctx.roleTargets[role] ?? 0);

  // Only meaningful for a role-CROSSING replacement (its role differs from
  // the card being cut) — see the callsite in gateOk for why a same-role
  // candidate is exempt.
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

  // Among gate-passing candidates in a tier, shortlist those within
  // PRIORITY_BAND of the tier's best `calculateCardPriority`, then pick the
  // CHEAPEST of that shortlist. Real savings without settling for a
  // meaningfully worse card just to save an extra dime.
  const pickBestSavings = (pairs: { ec: EDHRECCard; sc: ScryfallCard }[]): ScryfallCard => {
    const bestPriority = Math.max(
      ...pairs.map((p) => calculateCardPriority(p.ec, state.cfg.brewLevel))
    );
    const shortlist = pairs.filter(
      (p) => calculateCardPriority(p.ec, state.cfg.brewLevel) >= bestPriority * PRIORITY_BAND
    );
    shortlist.sort(
      (a, b) =>
        (parsePrice(getCardPrice(a.sc, ctx.currency)) ?? Infinity) -
        (parsePrice(getCardPrice(b.sc, ctx.currency)) ?? Infinity)
    );
    return shortlist[0].sc;
  };

  // Best pool candidate strictly cheaper than `cutPrice`, clearing every
  // pick-time hard gate, preferring same role → same primary type → any
  // (mirrors findCandidate in phaseCoherenceRepair.ts, plus the
  // strict-cheaper, role-cap, savings-band, and min-savings checks this pass
  // needs). Tier 1 (same role) never falls through to tier 2/3, even when its
  // own pick misses the savings bar — crossing roles for a smaller gain
  // elsewhere is exactly the degrading trade this pass must not make.
  const findReplacement = (
    cutCard: ScryfallCard,
    cutPrice: number,
    mode: ReplaceMode = 'cheapest'
  ): ScryfallCard | null => {
    const valueCut = mode === 'value';
    const cutRole = getCardRole(cutCard.name);
    const cutType = primaryTypeOf(cutCard);

    // The deck itself, not only usedNames: the whole-deck search doesn't keep
    // usedNames in step, and the last resort runs after it (E1044's third gate
    // seated a second Studious First-Year // Rampant Growth in Tatyova).
    const seated = new Set(
      Object.values(state.categories)
        .flat()
        .flatMap((c) => [c.name, frontFaceName(c.name)])
    );
    const ranked = [...pool]
      .filter(
        (c) =>
          c.name !== cutCard.name &&
          !cutHere.has(c.name) &&
          !state.usedNames.has(c.name) &&
          !seated.has(c.name) &&
          !seated.has(frontFaceName(c.name)) &&
          !state.bannedCards.has(c.name) &&
          scryfallCardMap.has(c.name) &&
          !state.comboCardNames.has(c.name) &&
          !completeComboNames.has(c.name) &&
          !ctx.isSaltBlocked?.(c.name) &&
          (!ownedOnly || !notInCollection(c.name, collectionNames))
      )
      .sort(
        (a, b) =>
          calculateCardPriority(b, state.cfg.brewLevel) -
          calculateCardPriority(a, state.cfg.brewLevel)
      );

    const isLand = (card: ScryfallCard) => getFrontFaceTypeLine(card).includes('Land');
    const gateOk = (card: ScryfallCard): boolean => {
      const price = parsePrice(getCardPrice(card, ctx.currency));
      if (price == null || price >= cutPrice) return false; // strictly cheaper, and must be priced
      // E485: allNonLand still carries utility lands, and the any-type tier
      // below can reach them. Lands swap only for lands, or the deck ships
      // off its tuned land count (the E282 rule in substituteFinder).
      if (isLand(card) !== isLand(cutCard)) return false;
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
      // Role cap only guards a role-CROSSING replacement — a same-role swap
      // can't push anything over cap that wasn't already there (see
      // isRoleCapBlocked's doc comment and the header comment above).
      if (getCardRole(card.name) !== cutRole && isRoleCapBlocked(card.name)) return false;
      // E561: a board wipe leaves for a wipe that is no worse, unless the swap saves
      // real money. Vandalblast (one-sided in a goblin deck) went to Chain Reaction
      // (symmetric) for $1.28, and the role-surplus pass then kept a creature as
      // the deck's only "wipe"; Cyclonic Rift's $26 is worth a symmetric wipe.
      if (
        cutRole === 'boardwipe' &&
        cutPrice - price < WIPE_DOWNGRADE_MIN_SAVINGS &&
        getCardRole(card.name) === 'boardwipe' &&
        wipeQualityPenalty(card, isOneSidedWipe, getWipeScope, undefined) >
          wipeQualityPenalty(cutCard, isOneSidedWipe, getWipeScope, undefined)
      ) {
        return false;
      }
      return true;
    };

    const eligiblePairs = ranked
      .map((ec) => {
        const sc = scryfallCardMap.get(ec.name);
        return sc && gateOk(sc) ? { ec, sc } : null;
      })
      .filter((p): p is { ec: EDHRECCard; sc: ScryfallCard } => p != null);
    if (eligiblePairs.length === 0) return null;

    const meetsMinSavings = (sc: ScryfallCard): boolean => {
      const replPrice = parsePrice(getCardPrice(sc, ctx.currency)) ?? 0;
      return cutPrice - replPrice >= (valueCut ? VALUE_CUT_MIN_SAVINGS : MIN_SAVINGS);
    };

    // A role-BEARING cut card is same-role-only, full stop — no same-type/any
    // fallback, even if the same-role tier is entirely empty (round 4: more
    // candidates from the merged budget pool must not reopen the door to a
    // function-degrading cross-role trade). Only a role-NULL cut card (no
    // tracked role to preserve) considers same-type, then any, as fallbacks.
    // E1044: the value cut leaves the role ladder. The cut card already showed
    // it has no cheaper same-role swap, so any role is open, but the incoming
    // card is played at least as often (the keeper's "leaves only for a card
    // played as often") and fills a role the deck is short of, or none.
    if (valueCut) {
      const floor = inclusionOf(cutCard.name);
      const leaving = countedRoleOf(cutCard);
      const fits = eligiblePairs.filter((p) => {
        if (inclusionOf(p.sc.name) < floor) return false;
        const role = countedRoleOf(p.sc);
        return !role || role === leaving || isRoleShort(role);
      });
      if (fits.length === 0) return null;
      const short = fits.filter((p) => {
        const role = countedRoleOf(p.sc);
        return role && role !== leaving && isRoleShort(role);
      });
      const pick = pickBestSavings(short.length > 0 ? short : fits);
      return meetsMinSavings(pick) ? pick : null;
    }
    // E1046: stage 3 cuts when the band's cheapest saves enough, as before, but
    // takes the saver losing the least play (not Theorix Charm for Mistblade Shinobi).
    const pickFrom = (pairs: { ec: EDHRECCard; sc: ScryfallCard }[]): ScryfallCard | null => {
      const pick = pickBestSavings(pairs);
      if (!meetsMinSavings(pick)) return null;
      const savers = pairs.filter((p) => meetsMinSavings(p.sc));
      return mode === 'leastLoss' ? leastLossPick(cutCard, cutPrice, savers).sc : pick;
    };
    if (cutRole) {
      const sameRole = eligiblePairs.filter((p) => getCardRole(p.sc.name) === cutRole);
      return sameRole.length === 0 ? null : pickFrom(sameRole);
    }
    const sameType = eligiblePairs.filter((p) => primaryTypeOf(p.sc) === cutType);
    if (sameType.length > 0) {
      const pick = pickFrom(sameType);
      if (pick) return pick;
    }
    return pickFrom(eligiblePairs);
  };

  // `softLabel` is non-null only for a stage-2 (soft-protected) cut — appends
  // a disclosure clause naming which protection yielded, e.g. "Saves $6.10 —
  // same ramp role; swapped a synergy engine piece to fit your budget".
  const reasonFor = (
    cut: ScryfallCard,
    added: ScryfallCard,
    savings: number,
    softLabel: string | null
  ): string => {
    const sym = ctx.currency === 'EUR' ? '€' : '$';
    const cutRole = getCardRole(cut.name);
    const addedRole = getCardRole(added.name);
    const bucket =
      cutRole && cutRole === addedRole
        ? `same ${ROLE_LABEL[cutRole]} role`
        : primaryTypeOf(cut) === primaryTypeOf(added)
          ? 'similar card type'
          : 'cheaper alternative';
    const base = `Saves ${sym}${savings.toFixed(2)}: ${bucket}`;
    return softLabel ? `${base}. Cut ${softLabel} to fit your budget.` : base;
  };

  let applied = 0;

  const swap = (card: ScryfallCard, price: number, replacement: ScryfallCard): void => {
    const replPrice = parsePrice(getCardPrice(replacement, ctx.currency)) ?? 0;
    const savings = price - replPrice;
    const loc = findInDeck(card.name)!;
    // Read at cut time, so the reason names the protection this card yielded.
    const softLabel = softProtectionLabel(card);
    removeCard(loc.card, loc.category);
    cutHere.add(card.name);
    commitAdd(replacement);
    total -= savings;
    applied++;
    repairs.push({
      cut: card.name,
      added: replacement.name,
      reason: reasonFor(card, replacement, savings, softLabel),
    });
    logger.debug(
      `[DeckGen] Budget converge: cut ${card.name} ($${price.toFixed(2)}) → added ${replacement.name} ($${replPrice.toFixed(2)})${softLabel ? ` [soft: ${softLabel}]` : ''}`
    );
  };

  // Runs bounded rounds of priciest-cuttable-first swaps against whichever
  // `isCuttable` predicate the stage below passes in, sharing `applied`/
  // `total`/MAX bounds across stages. `exceedsBudget(total, ctx.deckBudget)` already stops
  // a stage the moment the deck converges, so calling this twice (stage 1
  // fully-unprotected, stage 2 soft-eligible too) is just "try the cheaper,
  // safer pool first."
  const runRounds = (
    isCuttable: (card: ScryfallCard) => boolean,
    mode: ReplaceMode = 'cheapest',
    maxSwaps = MAX_BUDGET_SWAPS
  ): void => {
    const valueCut = mode === 'value';
    for (
      let round = 0;
      round < MAX_BUDGET_ROUNDS && exceedsBudget(total, ctx.deckBudget);
      round++
    ) {
      // Priciest-first each round: the biggest single swap makes the fastest
      // progress toward budget, and a fresh sort picks up any composition
      // change (a previous round's swap, role/GC counters shifting what's
      // now legal, or a soft protection's live re-evaluation).
      const cuttable = nonLands()
        .filter(isCuttable)
        .map((c) => ({ card: c, price: parsePrice(getCardPrice(c, ctx.currency)) }))
        .filter((c): c is { card: ScryfallCard; price: number } => c.price != null && c.price > 0)
        .sort((a, b) =>
          valueCut
            ? inclusionOf(a.card.name) / a.price - inclusionOf(b.card.name) / b.price ||
              b.price - a.price
            : b.price - a.price
        );

      let progressed = false;
      for (const { card, price } of cuttable) {
        if (!exceedsBudget(total, ctx.deckBudget) || applied >= maxSwaps) break;
        // The card may already have been swapped out earlier this round via a
        // different candidate's replacement path — re-verify it's still seated.
        if (!findInDeck(card.name)) continue;
        // A value cut earlier this round can take a role down to its target,
        // so the value cut reads its predicate again for each card. The
        // same-role stages keep their round-start snapshot.
        if (valueCut && !isCuttable(card)) continue;

        const replacement = findReplacement(card, price, mode);
        if (!replacement) continue;
        swap(card, price, replacement);
        progressed = true;
      }

      if (!progressed) break; // every remaining offender is protected/unreplaceable
    }
  };

  // E1046: stage 3 picks the trades that close the gap for the least play
  // (pickTrade), not the priciest card at a time; which cards may go is unchanged.
  const runLeastLoss = (isCuttable: (card: ScryfallCard) => boolean): void => {
    const priceOf = (c: ScryfallCard) => parsePrice(getCardPrice(c, ctx.currency));
    const tradesNow = () =>
      budgetTrades(nonLands().filter(isCuttable), priceOf, playLost, (card, price) =>
        findReplacement(card, price, 'leastLoss')
      );
    let trades = tradesNow();
    const target = stapleTarget(trades, total, ctx.deckBudget);
    if (target > ctx.deckBudget) state.budgetKeepsStaples = true;
    while (exceedsBudget(total, target) && applied < MAX_BUDGET_SWAPS) {
      const pick = pickTrade(trades, total - target);
      // Under budget, the step of headroom is taken only for free (Talrand $25 lost Archmage Emeritus).
      if (!pick || (!exceedsBudget(total, ctx.deckBudget) && pick.lost > 0)) return;
      swap(pick.card, pick.price, pick.replacement);
      trades = tradesNow();
    }
  };

  // Stage 1: fully-unprotected candidates only (neither hard nor soft).
  if (!ctx.lastResort) runRounds((c) => !isHardProtected(c) && softProtectionLabel(c) === null);
  // Stage 2: only reached if stage 1 didn't converge — soft protections now
  // yield too (still never hard-protected ones).
  // E561: the cards the eviction keeper holds (a 40%+ staple, a tutor, the last
  // answer of its kind) yield last of all, so a soft label that only says
  // "synergy engine piece" can't take Flux Channeler (40.6%) over a card the
  // deck plays less.
  if (!ctx.lastResort && exceedsBudget(total, ctx.deckBudget)) {
    runRounds((c) => !isHardProtected(c) && !keeps(c));
  }
  if (!ctx.lastResort && exceedsBudget(total, ctx.deckBudget)) {
    runLeastLoss((c) => !isHardProtected(c));
  }
  // Stage 4 (E1044): no cheaper same-role card is left. At $25 (about 27 cents
  // a card) eight of ten commanders ended over with 0%-play picks still seated
  // (Dragonlord Ojutai $0.69, Fires of Yavimaya $0.65 in The Ur-Dragon). Cut
  // the card with the least play per dollar for a cheaper one played at least
  // as often, in a role the deck is short of or none. A kept card (staple,
  // tutor, combo line, last answer), a protection piece and a combo-flavored
  // pick never go, and a role card leaves only from a role over its target.
  // Its savings floor is a fifth of the other stages' (VALUE_CUT_MIN_SAVINGS):
  // E1044's first try lowered the floor for every stage and lost Farseek in
  // four decks to same-role trades with no play-rate guard; this stage has one.
  // Stages 4 and 5 run only in the last-resort call, after the whole-deck
  // search: run before it, they churned decks the search brings under budget
  // anyway, and the search then traded Ponder, Lightning Greaves and Kenrith's
  // Transformation out along the new path (E1044's first gate).
  if (ctx.lastResort && exceedsBudget(total, ctx.deckBudget)) {
    runRounds(
      (c) => {
        if (isHardProtected(c) || keeps(c)) return false;
        if (readsAsProtection(c) || isFreeInteraction(c) || state.comboCardNames.has(c.name))
          return false;
        const role = countedRoleOf(c);
        return !role || isRoleSurplus(role);
      },
      'value',
      applied + MAX_VALUE_CUTS
    );
  }

  // Stage 5 (E1044): still over once every spell swap is spent. E561 holds up
  // to a fifth of the budget for nonbasic lands, so a $25 deck can end $1-2
  // over while carrying $2-5 of them. As a last resort a land that only fixes
  // mana leaves for a basic of the color the deck's spells need most per
  // source, priciest first. A land doing the deck's plan (Strip Mine in
  // Zo-Zu), a utility land, a staple land (40%+, Command Tower, the typed
  // duals), a wide fixer in a 3+ color deck and an owned land the budget
  // ignores stay. In one color no nonbasic fixes anything, so only a fetch
  // for a basic goes there.
  if (ctx.lastResort && exceedsBudget(total, ctx.deckBudget) && ctx.getBasicLand) {
    const identity = new Set(colorIdentity);
    const plan = readDeckLandPlan(nonLands(), commanders);
    const pipsOf = (color: string) =>
      nonLands().reduce(
        (n, c) => n + ((c.mana_cost ?? '').match(new RegExp(`\\{${color}\\}`, 'g'))?.length ?? 0),
        0
      );
    const sourcesOf = (color: string) =>
      state.categories.lands.filter((l) => producedManaColors(l, identity).includes(color)).length;
    const basicFor = (land: ScryfallCard): string => {
      if (identity.size === 0) return 'Wastes';
      const made = producedManaColors(land, identity).filter((c) => identity.has(c));
      const colors = made.length > 0 ? made : [...identity];
      // The color whose spells have the fewest sources per pip.
      return BASIC_BY_COLOR[
        colors.reduce((best, c) =>
          pipsOf(c) / Math.max(1, sourcesOf(c)) > pipsOf(best) / Math.max(1, sourcesOf(best))
            ? c
            : best
        )
      ];
    };
    // In three colors or more, the lands that reach most of them are the
    // manabase: Atraxa 25 traded Command Tower, Exotic Orchard, Path of
    // Ancestry and Evolving Wilds for basics in this stage's first run.
    const isWideFixer = (l: ScryfallCard): boolean =>
      identity.size >= 3 &&
      (producedManaColors(l, identity).filter((c) => identity.has(c)).length >= 3 ||
        /\bsearch your library for\b/i.test(l.oracle_text ?? ''));
    const landInclusion = new Map(
      (state.edhrecData?.cardlists.lands ?? []).map((c) => [c.name, c.inclusion])
    );
    // A land that only makes the deck's colors (two or more of them), or a
    // fetch for a basic. Anything else it does (cycling, a Scion, a card, the
    // monarch) makes it a utility land: the first gate found Spawning Bed,
    // Cryptic Caves and Forgotten Cave swapped under an "only fixes mana" label.
    const onlyFixes = (l: ScryfallCard): boolean => {
      if (isTaggedUtilityLand(l.name) || isUtilityLand(l)) return false;
      const text = (l.oracle_text ?? '').toLowerCase();
      if (/\bsearch your library for a basic land\b/.test(text)) return true;
      if (/cycling|\bsacrifice\b|\bdraw\b|\bcreate\b/.test(text)) return false;
      return producedManaColors(l, identity).filter((c) => identity.has(c)).length >= 2;
    };
    const cuttableLands = state.categories.lands
      .filter(
        (l) =>
          onlyFixes(l) &&
          (landInclusion.get(l.name) ?? 0) < STAPLE_INCLUSION_BAR &&
          !isWideFixer(l) &&
          !isBasicLandName(l.name) &&
          !planJobServed(l, plan) &&
          !isBudgetExempt(l) &&
          !l.isMustInclude &&
          !ctx.mustIncludeNames.has(l.name.toLowerCase())
      )
      .map((l) => ({ land: l, price: parsePrice(getCardPrice(l, ctx.currency)) ?? 0 }))
      .sort((a, b) => b.price - a.price);
    let landCuts = 0;
    for (const { land, price } of cuttableLands) {
      if (!exceedsBudget(total, ctx.deckBudget) || landCuts >= MAX_LAND_CUTS) break;
      const basicName = basicFor(land);
      const basic = await ctx.getBasicLand(basicName);
      if (!basic) continue;
      const savings = price - (parsePrice(getCardPrice(basic, ctx.currency)) ?? 0);
      if (savings < VALUE_CUT_MIN_SAVINGS) break; // sorted: no later land saves more
      const idx = state.categories.lands.indexOf(land);
      state.categories.lands[idx] = { ...basic };
      state.usedNames.delete(land.name);
      state.usedNames.add(basic.name);
      total -= savings;
      if (ctx.budgetTracker) ctx.budgetTracker.remainingBudget += savings;
      landCuts++;
      applied++;
      const sym = ctx.currency === 'EUR' ? '€' : '$';
      repairs.push({
        cut: land.name,
        added: basicName,
        reason: `Saves ${sym}${savings.toFixed(2)}: a basic for a land that only fixes mana, to fit your budget.`,
      });
    }
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

  if (!exceedsBudget(finalTotal, ctx.deckBudget)) {
    return { applied, finalTotal, repairs };
  }

  // Still over — say why, worded so it's equally honest whether 0 or N swaps
  // ran (never implies a partial job or an exhaustive search that didn't
  // happen). By this point BOTH stages have run, so "protected" here means
  // HARD only (soft protections already got their chance in stage 2) — if
  // every remaining priced card is hard-protected, that's the reason;
  // otherwise some cards (soft or never-protected) simply had no legal
  // cheaper alternative (a thin pool, or every candidate blocked by a hard
  // gate) — including the 0-swap case, since findReplacement really did
  // search every cuttable card in both stages.
  const remainingUnprotectedPriced = nonLands().filter((c) => {
    if (isHardProtected(c)) return false;
    const p = parsePrice(getCardPrice(c, ctx.currency));
    return p != null && p > 0;
  });
  const baseResidualReason =
    remainingUnprotectedPriced.length === 0
      ? 'every remaining card is protected or has no cheaper equivalent'
      : 'no cheaper alternative for the remaining cards';
  // Flag rather than silently understate: a must-include with no price data
  // is summed as $0 above (totalNow has no real number to use), so the
  // reported total is a floor, not the true total, whenever this fires.
  const unpriced = unpricedNonExempt();
  const unpricedNames = unpriced
    .slice(0, 3)
    .map((c) => c.name)
    .join(', ');
  const unpricedTail = unpriced.length > 3 ? `, and ${unpriced.length - 3} more` : '';
  const residualReason =
    unpriced.length > 0
      ? `${baseResidualReason}. ${unpriced.length} card${unpriced.length === 1 ? ' has' : 's have'} no price data and ${unpriced.length === 1 ? "isn't" : "aren't"} in the total: ${unpricedNames}${unpricedTail}`
      : baseResidualReason;

  return { applied, finalTotal, repairs, residualReason };
}
