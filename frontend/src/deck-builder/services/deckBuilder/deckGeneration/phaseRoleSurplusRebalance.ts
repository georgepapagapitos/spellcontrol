import type {
  CoherenceRepair,
  DeckCategory,
  DetectedCombo,
  MaxRarity,
  ScryfallCard,
} from '@/deck-builder/types';
import type { GenerationState } from './state';
import {
  getCardRole,
  isProtectionPiece,
  isOneSidedWipe,
  getWipeScope,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/card-text';
import { stampRoleSubtypes, routeCardByType, roleCapTolerance } from '../categorize';
import { computeRoleCounts } from '../commanderDeckAnalysis';
import { computeLiftPickBoosts } from '../packageBoost';
import { calculateCardPriority, PRICE_SANITY_RATIO, wipeQualityPenalty } from '../cardPicking';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { nonboFindings } from '../nonbo';
import { getLiftIndex } from './liftPools';
import { STAPLE_ROCK_NAMES } from './phaseStapleManaRocks';
import type { BudgetTracker } from '../budgetTracker';
import type { BracketGuard } from '../bracketGuard';
import {
  constrainsToCollection,
  notInCollection,
  exceedsMaxPrice,
  exceedsMaxRarity,
  exceedsCmcCap,
  notOnArena,
  isOwnedBudgetExempt,
  isOwnedRarityExempt,
  fitsColorIdentity,
} from '../deckFilters';

// ── Role-Surplus → Payoff Conversion (E87, iter-6 slice A) ──
//
// Pick-time role caps (#1008) hold, but several post-fill phases still push a
// reactive role (ramp/removal/boardwipe/cardDraw) over its cap without a
// later pass ever pulling it back: the Combo Integrity Audit's uncapped
// auditAdd/auditRemove (deckGenerator.ts:3683-3693, which never touches
// currentRoleCounts), phaseCoherenceRepair's findCandidate (no cap check on
// adds), phaseBracketConverge's pickFiller (no upper-cap check), and the
// role-cap escape hatch (cardPicking.ts, unbounded once triggered). Panel
// evidence (15-deck baseline, decks-sliceA-ship): ramp +47 / cardDraw +47 /
// removal +33 / boardwipe +12 slots panel-wide; the floor deck (Isshin,
// critic 5.7) ran 5 board wipes in a go-wide token shell, 3 of them
// self-nonbo'd by its own coherence findings.
//
// This is the ONE bounded post-fill pass that converts the worst of that
// surplus into an actual payoff pick — evicting down to the role's cap (not
// its target, respecting the shipped tolerance band), never touching a
// must-include/combo-piece/staple, preferring nonbo-flagged cards first, and
// requiring every replacement to clear the same hard gates every other swap
// pass in generation enforces (salt, bracket ceiling, game-changer cap,
// color identity, rarity/Arena/CMC, budget, the synergy-dependency guard) —
// plus its own destination role must have room too, so this can never just
// relocate the surplus onto a different reactive role.
//
// Runs from a FRESH recount (computeRoleCounts over the live nonland cards),
// never `state.currentRoleCounts` — the combo audit above drifts that
// incremental tally stale by never updating it, so trusting it here would
// both miss real surplus and imagine surplus that isn't there.
//
// Live-eval fixes (post-ship gate, first pass): eviction "worst first" is
// scored by the SAME priority+lift signal `findReplacement` uses for
// incoming candidates — NOT deckGenerator.ts's position-based
// computeTrimResistance, which looked plausible in isolation but produced
// the wrong order on real decks once curve-fit/early-ramp-CMC bonuses had
// scrambled a category array's pick-order-as-quality-proxy assumption (a
// 6%-inclusion 0-cmc rock got picked EARLY for curve reasons and out-survived
// a 90%-inclusion payoff picked later in the same type pass). A card with
// real EDHREC-lift connectivity to the deck also survives even when its
// regex tagger role reads as reactive (a token payoff mistagged 'removal'
// from its printed text isn't actually filler). And staples are protected by
// NAME (STAPLE_ROCK_NAMES), not `card.isStapleRock` — that flag is only ever
// set on a copy THIS generation's stapleManaRocksPhase itself adds; the
// common case is the staple already came in via normal EDHREC-pool picking
// (high inclusion), landing here flagless and, before this fix, evictable.
//
// Live-eval fixes (round 3): incoming candidates now clear a price-sanity
// gate (PRICE_SANITY_RATIO, reused from cardPicking.ts's #1011 tie-break) so
// a wildly-pricier candidate can't seat itself absent a combo reason; the
// pass runs role-exit conversions to exhaustion BEFORE any same-role
// "quality upgrade" swap, and caps those at MAX_SAME_ROLE_UPGRADES, so churn
// that doesn't reduce an overage can't crowd out the conversions that do —
// and its disclosure says "upgrade", never "fixed the cap"; and an
// incumbent absent from THIS generation's (possibly bracket-restricted) pool
// falls back to its role's average inclusion instead of 0, so a
// pool-omitted premium staple isn't guaranteed to look like the worst card
// in its role.

// Total conversions this pass may apply per deck. Precedent: MAX_AUDIT_SWAPS
// = 4 (deckGenerator.ts's Combo Integrity Audit), MAX_COHERENCE_SWAPS = 3
// (phaseCoherenceRepair.ts) — the panel evidence above puts realistic
// per-floor-deck conversions at 4-6, so 6 sits at the top of that observed
// range rather than leaving the bound open-ended.
export const MAX_SURPLUS_CONVERSIONS = 6;

// Same-role "quality upgrade" swaps (net-zero on the over-cap count — see
// destinationRoleOk) are a fallback, not the pass's job: they never reduce an
// overage, so letting them eat the whole 6-swap budget crowds out the real
// role-exit conversions the pass exists to make (meren-budget100: 5 of 6
// swaps were same-role cardDraw churn while removal, the deck's LARGEST
// disclosed overage, got zero attempts). A third of the total budget is
// generous enough to still polish a role once every genuine role-exit is
// exhausted, without being able to dominate it.
const MAX_SAME_ROLE_UPGRADES = 2;

// A replacement must beat the evicted card's own calculateCardPriority score
// (lift boost included) by at least this much to be worth the churn —
// anti-churn precedent: phaseBudgetConverge.ts's MIN_SAVINGS ("a swap below
// the threshold is churn, not a fix"). Sized to half of packageBoost.ts's
// LIFT_PICK_BOOST_MAX (30): enough that a marginal same-tier candidate can't
// trigger a swap on noise, low enough that a real lift-driven pick (up to
// +30) or a meaningfully higher-inclusion payoff still clears it.
const MIN_IMPROVEMENT_MARGIN = 15;

const REACTIVE_ROLES: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];

const ROLE_LABEL: Record<RoleKey, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipe',
  cardDraw: 'card draw',
};

export interface RoleSurplusRebalanceContext {
  /** name -> ScryfallCard map built during generation (for swap-in lookups). */
  scryfallCardMap: Map<string, ScryfallCard>;
  /** Balanced-roles targets; the pass is a no-op when this is null (no role
   *  targets were ever computed, so "over cap" is meaningless). */
  roleTargets: Record<RoleKey, number> | null;
  /** Complete/partial combos detected so far (combo pieces are protected). */
  detectedCombos: DetectedCombo[] | undefined;
  /** Cards the user pinned — never cut (lower-cased). */
  mustIncludeNames: Set<string>;
  /** Generation-wide synergy-dependency guard for replacements. */
  cardAllowed?: (card: ScryfallCard) => boolean;
  /** EDHREC lift clusterScore lookup (deckGenerator.ts's liftScoreOf). */
  liftScoreOf: (name: string) => number;
  // Hard gates, shared refs with every other picking/repair phase (counts accumulate).
  isSaltBlocked?: (name: string) => boolean;
  bracketGuard?: BracketGuard;
  gameChangerCount: { value: number };
  maxGameChangers: number;
  budgetTracker: BudgetTracker | null;
  maxCardPrice: number | null;
  maxRarity: MaxRarity;
  maxCmc: number | null;
  arenaOnly: boolean;
  currency: 'USD' | 'EUR';
  ignoreOwnedBudget: boolean;
  ignoreOwnedRarity: boolean;
  /** Total-deck budget ask (customization.deckBudget), independent of the
   *  per-card maxCardPrice cap — a swap's net price delta must not push the
   *  deck's real total over this. Null when no total-deck budget is set. */
  deckBudget: number | null;
  /** The deck's planned non-land type distribution (typeTargets from
   *  calculateTargetCounts) — E112/E113 coordination fix: feeds
   *  wipeQualityPenalty's own-board collateral term so the boardwipe role's
   *  eviction/replacement ranking judges wipe QUALITY (asymmetry +
   *  collateral), not just raw EDHREC priority. Undefined is a safe no-op
   *  (the collateral term drops out; the symmetric-vs-one-sided tier still
   *  applies). */
  deckTypeTargets?: Record<string, number>;
}

export interface RoleSurplusRebalanceResult {
  conversions: CoherenceRepair[];
}

// A price increase over this (in the swap's own currency) is disclosed in
// the reason text — "nothing moves silently" ethos already used by the
// budget-repair notes elsewhere in the build report. Not a gate (see
// PRICE_SANITY_RATIO for the hard reject) — just the transparency floor.
const DISCLOSE_PRICE_DELTA = 1;

function buildConversionReason(params: {
  role: RoleKey;
  have: number;
  target: number;
  nonbo: boolean;
  cutName: string;
  addedName: string;
  liftedBy?: string[];
  /** False for a same-role quality upgrade — a net-zero swap that does NOT
   *  reduce this role's over-cap count, so the wording must never claim it
   *  fixes the overage (defect 6b: dishonest disclosure). */
  isRoleExit: boolean;
  cutPrice: number;
  addedPrice: number;
  currency: 'USD' | 'EUR';
}): string {
  const roleLabel = ROLE_LABEL[params.role];
  const nonboClause = params.nonbo
    ? `; ${params.cutName} also worked against the deck's own plan (flagged as a nonbo)`
    : '';
  const sym = params.currency === 'EUR' ? '€' : '$';
  const priceClause =
    params.addedPrice - params.cutPrice > DISCLOSE_PRICE_DELTA
      ? ` (+${sym}${(params.addedPrice - params.cutPrice).toFixed(2)})`
      : '';
  const addedClause =
    params.liftedBy && params.liftedBy.length > 0
      ? `${params.isRoleExit ? 'Converted' : 'Upgraded'} to ${params.addedName}${priceClause}, lifted by ${params.liftedBy.slice(0, 3).join(', ')}.`
      : `${params.isRoleExit ? 'Converted' : 'Upgraded'} to ${params.addedName}${priceClause} for a stronger payoff.`;

  if (params.isRoleExit) {
    const capClause = `${roleLabel} was running ${params.have} vs a ${params.target} target — over cap`;
    return `${capClause}${nonboClause}. ${addedClause}`;
  }
  // Same-role swap: context for WHY this role's slots are under scrutiny at
  // all, without claiming this specific swap resolves the overage (it can't
  // — evicting and re-adding the same role nets to zero count change).
  const contextClause = `${roleLabel} is over cap (${params.have} vs ${params.target} target); this swap upgrades a slot within the role, it doesn't reduce the count`;
  return `${contextClause}${nonboClause}. ${addedClause}`;
}

/**
 * Bounded, disclosed post-fill pass: evicts the worst of any reactive role's
 * over-cap surplus and converts each slot into the best gated payoff
 * candidate the EDHREC pool offers. No-op (returns `{ conversions: [] }`
 * without touching `state`) when there are no role targets, no EDHREC pool,
 * or nothing is actually over cap.
 */
export function applyRoleSurplusRebalance(
  state: GenerationState,
  ctx: RoleSurplusRebalanceContext
): RoleSurplusRebalanceResult {
  const conversions: CoherenceRepair[] = [];
  const roleTargets = ctx.roleTargets;
  const pool = state.edhrecData?.cardlists.allNonLand;
  if (!roleTargets || !pool || pool.length === 0) return { conversions };
  const poolByName = new Map(pool.map((c) => [c.name, c]));

  // Neutral fallback for an incumbent with NO pool entry (E81 `?? 0` class of
  // bug): a card absent from THIS generation's pool isn't necessarily weak —
  // a bracket-restricted EDHREC pool systematically omits the highest-power
  // cards (premium removal, bombs), which is exactly what a hard-coded 0
  // default punishes hardest, guaranteeing it looks like the single worst
  // card in its role (atraxa-bracket2: Path to Exile and Atraxa, Grand
  // Unifier both evicted for exactly this reason while a genuinely weak,
  // pool-listed low-inclusion card survived). Falls back to that role's own
  // average pool inclusion — neutral, neither best nor worst by default.
  const roleAverageInclusion = new Map<RoleKey, number>();
  for (const role of REACTIVE_ROLES) {
    const entries = pool.filter((c) => getCardRole(c.name) === role);
    if (entries.length > 0) {
      roleAverageInclusion.set(
        role,
        entries.reduce((sum, c) => sum + c.inclusion, 0) / entries.length
      );
    }
  }

  const { commander, partnerCommander } = state.context;
  const commanders = [commander, partnerCommander].filter((c): c is ScryfallCard => c != null);
  const colorIdentity = state.context.colorIdentity;
  const ownedOnly = constrainsToCollection(state.cfg.collectionStrategy);
  const collectionNames = state.context.collectionNames;

  const nonLands = (): ScryfallCard[] =>
    (Object.entries(state.categories) as [DeckCategory, ScryfallCard[]][])
      .filter(([cat]) => cat !== 'lands')
      .flatMap(([, cards]) => cards);

  // Fresh recount (see header) — the single source of truth for this pass.
  const liveRoleCounts = { ...computeRoleCounts(nonLands()).roleCounts } as Record<RoleKey, number>;

  const capOf = (role: RoleKey): number => {
    const target = roleTargets[role] ?? 0;
    return target + roleCapTolerance(target, role);
  };
  const isOverCap = (role: RoleKey): boolean => {
    const target = roleTargets[role] ?? 0;
    return target > 0 && (liveRoleCounts[role] ?? 0) > capOf(role);
  };
  if (!REACTIVE_ROLES.some(isOverCap)) return { conversions };

  const completeComboNames = new Set<string>();
  for (const combo of ctx.detectedCombos ?? []) {
    if (!combo.isComplete) continue;
    for (const n of combo.cards) completeComboNames.add(n);
  }

  const isProtected = (card: ScryfallCard): boolean =>
    !!card.isMustInclude ||
    ctx.mustIncludeNames.has(card.name.toLowerCase()) ||
    state.comboCardNames.has(card.name) ||
    completeComboNames.has(card.name) ||
    completeComboNames.has(frontFaceName(card.name)) ||
    !!card.isStapleRock ||
    STAPLE_ROCK_NAMES.has(card.name) ||
    // #1022 gap fix: a roleless protection/free-interaction piece (Heroic
    // Intervention/Fierce Guardianship-class) shouldn't be evictable here just
    // because it happens to also carry a reactive-role tag — every sibling
    // pass (Smart Trim, phaseBracketConverge, phaseBudgetConverge,
    // phaseCoherenceRepair) already checks this; this pass hadn't yet.
    isProtectionPiece(card);

  // Nonbo-flagged cards evict first (E80 tie-in — the Isshin motivating case:
  // self-damaging wipes in a go-wide token shell). Recomputed here from the
  // same pure building blocks coherenceAudit.ts uses at the very end of
  // generation — that audit hasn't run yet at this insertion point (it's
  // report-only, over the truly-final deck), so this re-derives the nonbo
  // signal rather than reading a finding list that doesn't exist yet.
  const invested = new Set(analyzeDeckSynergy([...commanders, ...nonLands()]).invested);
  const nonboNames = new Set(
    nonboFindings(nonLands(), invested)
      .map((f) => f.card)
      .filter((c): c is string => !!c)
  );

  // Real (not per-card-capped) deck total, tracked live across swaps so a
  // conversion's net price delta can be checked against the ACTUAL remaining
  // headroom to the total-deck budget ask — a per-card cap alone (BudgetTracker
  // .getEffectiveCap) can't see that THIS swap also removes a cheaper card,
  // so it let a $1.75 upgrade through even though the deck had only $1.38 of
  // headroom left (krenko-budget50 breach).
  const priceOf = (card: ScryfallCard): number => {
    const p = getCardPrice(card, ctx.currency);
    return p ? parseFloat(p) || 0 : 0;
  };
  let runningTotal =
    ctx.deckBudget != null
      ? [...nonLands(), ...state.categories.lands].reduce((sum, c) => sum + priceOf(c), 0)
      : 0;

  const removeCard = (card: ScryfallCard, category: DeckCategory, role: RoleKey) => {
    state.categories[category] = state.categories[category].filter((c) => c !== card);
    state.usedNames.delete(card.name);
    if (card.name.includes(' // ')) state.usedNames.delete(frontFaceName(card.name));
    liveRoleCounts[role] = Math.max(0, (liveRoleCounts[role] ?? 0) - 1);
  };

  const addCard = (card: ScryfallCard) => {
    stampRoleSubtypes(card);
    routeCardByType(card, state.categories);
    state.usedNames.add(card.name);
    if (card.name.includes(' // ')) state.usedNames.add(frontFaceName(card.name));
    const role = getCardRole(card.name);
    if (role) liveRoleCounts[role] = (liveRoleCounts[role] ?? 0) + 1;
    if (state.gameChangerNames.has(card.name)) {
      card.isGameChanger = true;
      ctx.gameChangerCount.value++;
    }
    ctx.bracketGuard?.record(card.name);
    if (!isOwnedBudgetExempt(card.name, collectionNames, ctx.ignoreOwnedBudget)) {
      ctx.budgetTracker?.deductCard(card);
    }
  };

  // A candidate's OWN role (if any) must not be pushed over ITS cap — this is
  // what keeps the pass from relocating the surplus onto a sibling reactive
  // role. A candidate sharing the EVICTED card's own role is always fine
  // regardless of that role's current count: the swap removes one and adds
  // one back into the SAME role, netting to zero change — checking it
  // against the (not-yet-decremented) pre-swap count would reject a same-role
  // quality upgrade every single time a role is over cap, which is exactly
  // the case this pass runs in. On a thin/narrow pool (e.g. mono-color) a
  // same-role upgrade can be the only kind of legal replacement available at
  // all — wrongly blocking it here silently zeroed out entire decks.
  const destinationRoleOk = (card: ScryfallCard, evictedRole: RoleKey): boolean => {
    const role = getCardRole(card.name);
    if (!role || role === evictedRole) return true;
    return (liveRoleCounts[role] ?? 0) < capOf(role);
  };

  // Priority+lift "survival score" — the SAME signal used to rank incoming
  // candidates, applied symmetrically to outgoing ones. Deliberately NOT
  // deckGenerator.ts's computeTrimResistance: that function's base term is
  // "position within its category array", a proxy for "picked early = good"
  // that holds for the ORIGINAL type-pass pick order but breaks by the time
  // this pass runs — curve-fit and the early-ramp CMC bonus can plant a
  // 0-cost, low-inclusion rock near the front of `categories.ramp` (small
  // index = high resistance) while a much better card lands later in the
  // same pass (large index = low resistance), inverting eviction order on
  // real decks (Kozilek: Mox Diamond/Manakin survived, Thran Dynamo/Rise of
  // the Eldrazi got cut). Folding in liftScoreOf also protects a card whose
  // regex tagger role reads reactive but is actually a live payoff (Krenko's
  // Warstorm Surge, tagged 'removal', lift-connected to the goblin cluster).
  // E112/E113 coordination fix: for the boardwipe role specifically, fold in
  // wipeQualityPenalty (asymmetry + own-board collateral) so a symmetric or
  // high-collateral wipe scores as the WORST card to keep even when its raw
  // EDHREC priority is high — otherwise this survival score is priority-only
  // and a low-priority-but-deck-appropriate wipe (Wrath of God for an
  // enchantress deck) gets evicted ahead of a higher-priority but
  // self-nuking one (Farewell/Austere Command), the exact opposite of what
  // E112 exists to prevent. See cardPicking.ts's wipeQualityPenalty doc for
  // why this is a dominant term, not a capped nudge.
  const survivalScoreOf = (
    card: ScryfallCard,
    role: RoleKey,
    liftBoosts: Map<string, number>
  ): number => {
    const ec = poolByName.get(card.name);
    const priority = ec ? calculateCardPriority(ec) : (roleAverageInclusion.get(role) ?? 0);
    const quality =
      role === 'boardwipe'
        ? wipeQualityPenalty(card, isOneSidedWipe, getWipeScope, ctx.deckTypeTargets)
        : 0;
    return priority + (liftBoosts.get(card.name) ?? 0) - quality;
  };

  // Best pool candidate clearing every hard gate the pick-time path enforces
  // — mirrors findCandidate (phaseCoherenceRepair.ts) / findReplacement
  // (phaseBudgetConverge.ts), ranked by calculateCardPriority blended with
  // the validated EDHREC lift clusterScore boost (packageBoost.ts's
  // computeLiftPickBoosts — reused untouched, not re-derived).
  const findReplacement = (
    evictedScore: number,
    evictedPrice: number,
    evictedRole: RoleKey,
    /** false = role-exit only (defect 6a): a candidate sharing the evicted
     *  card's own role is rejected here, forcing a genuine reduction in the
     *  over-cap role's count rather than a same-role churn that leaves the
     *  overage exactly as bad as before. */
    allowSameRole: boolean
  ): ScryfallCard | null => {
    const eligible = pool.filter(
      (c) =>
        !state.usedNames.has(c.name) &&
        !state.bannedCards.has(c.name) &&
        ctx.scryfallCardMap.has(c.name) &&
        !ctx.isSaltBlocked?.(c.name) &&
        (!ownedOnly || !notInCollection(c.name, collectionNames))
    );
    const liftBoosts = computeLiftPickBoosts(
      eligible.map((c) => c.name),
      ctx.liftScoreOf
    );
    // E112/E113 coordination fix: the SAME wipeQualityPenalty survivalScoreOf
    // applies above also has to govern which REPLACEMENT candidate wins a
    // boardwipe slot — otherwise a symmetric/high-collateral wipe can still
    // win re-entry here on raw priority alone even after a worse one was
    // just evicted for exactly that reason (this is the "pick-time swap"
    // shape of the krenko regression: Vandalblast evicted, a higher-
    // inclusion but self-nuking symmetric wipe seated in its place).
    const ranked = eligible
      .map((ec) => {
        const role = getCardRole(ec.name);
        const scryfallCard = role === 'boardwipe' ? ctx.scryfallCardMap.get(ec.name) : undefined;
        const quality = scryfallCard
          ? wipeQualityPenalty(scryfallCard, isOneSidedWipe, getWipeScope, ctx.deckTypeTargets)
          : 0;
        return { ec, score: calculateCardPriority(ec) + (liftBoosts.get(ec.name) ?? 0) - quality };
      })
      .sort((a, b) => b.score - a.score);

    for (const { ec, score } of ranked) {
      if (score < evictedScore + MIN_IMPROVEMENT_MARGIN) break; // sorted desc — nothing further clears the bar
      const card = ctx.scryfallCardMap.get(ec.name)!;
      if (ctx.cardAllowed && !ctx.cardAllowed(card)) continue;
      if (!fitsColorIdentity(card, colorIdentity)) continue;
      const isGC = state.gameChangerNames.has(ec.name);
      if (isGC && ctx.gameChangerCount.value >= ctx.maxGameChangers) continue;
      if (ctx.bracketGuard?.exceedsCeiling(ec.name)) continue;
      if (!isOwnedBudgetExempt(ec.name, collectionNames, ctx.ignoreOwnedBudget)) {
        const cap = ctx.budgetTracker?.getEffectiveCap(ctx.maxCardPrice) ?? ctx.maxCardPrice;
        if (exceedsMaxPrice(card, cap, ctx.currency)) continue;
      }
      if (!isOwnedRarityExempt(ec.name, collectionNames, ctx.ignoreOwnedRarity)) {
        if (exceedsMaxRarity(card, ctx.maxRarity)) continue;
      }
      if (exceedsCmcCap(card, ctx.maxCmc)) continue;
      if (notOnArena(card, ctx.arenaOnly)) continue;
      if (!destinationRoleOk(card, evictedRole)) continue;
      if (!allowSameRole && getCardRole(ec.name) === evictedRole) continue; // defect 6a: role-exit phase only
      // Price sanity (E80/#1011 precedent — cardPicking.ts's PRICE_SANITY_RATIO
      // = 20, reused verbatim): a candidate dramatically pricier than the card
      // it's replacing is never worth it absent a live combo reason (Kozilek
      // seated a $3000 Mishra's Workshop over a $0.77 card, nearly doubling
      // the deck total with zero price disclosure). Floor the evicted price
      // at $1 so a near-free eviction can't block every candidate outright.
      if (!state.comboCardNames.has(ec.name) && !completeComboNames.has(ec.name)) {
        if (priceOf(card) > Math.max(1, evictedPrice) * PRICE_SANITY_RATIO) continue;
      }
      // Total-deck budget headroom (see runningTotal doc above) — independent
      // of, and in addition to, the per-card maxCardPrice/effectiveCap gate.
      if (
        ctx.deckBudget != null &&
        !isOwnedBudgetExempt(ec.name, collectionNames, ctx.ignoreOwnedBudget)
      ) {
        const delta = priceOf(card) - evictedPrice;
        const alreadyOverAsk = runningTotal > ctx.deckBudget;
        if (alreadyOverAsk ? delta >= 0 : runningTotal + delta > ctx.deckBudget) continue;
      }
      return card;
    }
    return null;
  };

  // One attempt at a single swap. Tries every currently-evictable candidate
  // worst-first (survival score ascending, nonbo-flagged first) so a single
  // stubborn card with no clearing replacement can't stall the whole pass
  // while other genuinely-worse surplus cards still have a legal conversion
  // available (this silently zeroed out Talrand/meren-budget100/
  // the-ur-dragon/atraxa-bracket2 and cut Isshin off after 1 of ~4 expected
  // conversions). `allowSameRole` gates whether a same-role candidate (net-
  // zero on the over-cap count) is eligible at all — see the two-phase
  // caller below (defect 6a).
  const tryOneConversion = (
    allowSameRole: boolean
  ): { didConvert: boolean; wasSameRole: boolean } => {
    const overCapRoles = REACTIVE_ROLES.filter(isOverCap);
    if (overCapRoles.length === 0) return { didConvert: false, wasSameRole: false };

    const evictable: {
      card: ScryfallCard;
      category: DeckCategory;
      role: RoleKey;
      nonbo: boolean;
    }[] = [];
    for (const cat of Object.keys(state.categories) as DeckCategory[]) {
      if (cat === 'lands') continue;
      const cards = state.categories[cat];
      for (const card of cards) {
        const role = getCardRole(card.name);
        if (!role || !overCapRoles.includes(role)) continue;
        if (isProtected(card)) continue;
        evictable.push({ card, category: cat, role, nonbo: nonboNames.has(card.name) });
      }
    }
    if (evictable.length === 0) return { didConvert: false, wasSameRole: false };

    const liftBoosts = computeLiftPickBoosts(
      evictable.map((e) => e.card.name),
      ctx.liftScoreOf
    );
    const scored = evictable
      .map((e) => ({ ...e, survival: survivalScoreOf(e.card, e.role, liftBoosts) }))
      .sort((a, b) => Number(b.nonbo) - Number(a.nonbo) || a.survival - b.survival);

    for (const candidate of scored) {
      const roleTarget = roleTargets[candidate.role] ?? 0;
      const beforeCount = liveRoleCounts[candidate.role] ?? 0;
      // Never evict below the role's own target — should be unreachable (the
      // outer isOverCap guard only evicts from counts strictly over cap, and
      // cap >= target by construction), asserted defensively rather than
      // trusted silently.
      if (beforeCount - 1 < roleTarget) continue;

      const evictedPrice = priceOf(candidate.card);
      const replacement = findReplacement(
        candidate.survival,
        evictedPrice,
        candidate.role,
        allowSameRole
      );
      if (!replacement) continue; // this candidate has no legal upgrade — try the next-worst one

      const wasSameRole = getCardRole(replacement.name) === candidate.role;
      removeCard(candidate.card, candidate.category, candidate.role);
      addCard(replacement);
      runningTotal += priceOf(replacement) - evictedPrice;
      conversionsApplied++;

      const liftedBy = getLiftIndex(state).get(replacement.name.toLowerCase())?.liftedBy;
      conversions.push({
        cut: candidate.card.name,
        added: replacement.name,
        reason: buildConversionReason({
          role: candidate.role,
          have: beforeCount,
          target: roleTarget,
          nonbo: candidate.nonbo,
          cutName: candidate.card.name,
          addedName: replacement.name,
          liftedBy,
          isRoleExit: !wasSameRole,
          cutPrice: evictedPrice,
          addedPrice: priceOf(replacement),
          currency: ctx.currency,
        }),
      });
      return { didConvert: true, wasSameRole };
    }

    // Every currently-evictable candidate in this round was rejected —
    // truly nothing left to convert this way.
    return { didConvert: false, wasSameRole: false };
  };

  let conversionsApplied = 0;
  let sameRoleUpgrades = 0;

  // Phase 1 (defect 6a): true role-exit conversions ONLY — a candidate whose
  // role differs from the evicted card's (or has none) actually REDUCES the
  // over-cap role's count. Runs to exhaustion across every over-cap role
  // before phase 2 ever starts, so the bounded 6-swap budget is spent on
  // real fixes first.
  while (conversionsApplied < MAX_SURPLUS_CONVERSIONS) {
    if (!tryOneConversion(false).didConvert) break;
  }

  // Phase 2: same-role quality upgrades — net-zero on the role's count (see
  // destinationRoleOk doc), so these never reduce an overage. Only attempted
  // once phase 1 is exhausted, and capped well below the total budget so
  // churn can't crowd out the pass's actual job (meren-budget100: 5 of 6
  // swaps were same-role churn on cardDraw while removal, the deck's
  // largest disclosed overage, got zero attempts).
  while (
    conversionsApplied < MAX_SURPLUS_CONVERSIONS &&
    sameRoleUpgrades < MAX_SAME_ROLE_UPGRADES
  ) {
    const result = tryOneConversion(true);
    if (!result.didConvert) break;
    if (result.wasSameRole) sameRoleUpgrades++;
  }

  return { conversions };
}
