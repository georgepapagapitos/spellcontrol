// EDHREC card-pool selection: priority scoring and the two prefetched-map
// pickers (flat + curve-aware). Extracted verbatim from deckGenerator.ts.
import { logger } from '@/lib/util/logger';
import type { ScryfallCard, EDHRECCard, MaxRarity, CollectionStrategy } from '@/deck-builder/types';
import { getCardPrice, getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { hasCurveRoom } from './curveUtils';
import { wipeAsymmetryTieBreak, wipeScopeCollateralTieBreak } from './wipeTieBreaks';
import { BudgetTracker } from './budgetTracker';
import type { BracketGuard } from './bracketGuard';
import { matchesExpectedType, roleCapTolerance, ROLE_CAP_HATCH_MAX_PER_PASS } from './categorize';
import type { RoleKey, WipeScope } from '@/deck-builder/services/tagger/client';
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
  notLegalForFormat,
  fitsSpellSlot,
} from './deckFilters';

/**
 * The staple bar: a card in this share (%) of the commander's own EDHREC decks
 * is part of how the deck is played, not a choice among substitutes. Such a
 * card may break the curve and, without a deck budget, is never held back by a
 * role cap and (at the Balanced/Staples end of the dial) is tried before
 * role-deficit ordering decides the rest of a type pass (E532). Role boosts
 * reach 150+ points, so without the tier a 25% ramp spell outranks a 55%
 * roleless payoff.
 */
export const STAPLE_INCLUSION_BAR = 40;

/**
 * Hard role-cap gate for the primary pick loop (E77 iter-4). Distinct from
 * the soft `computeRoleBoosts` over-target penalty (still priority noise a
 * high-synergy/combo score can drown out) — this is an actual skip once a
 * role is at target+tolerance, so filler can't crowd out payoffs no matter
 * how it scores. `currentRoleCounts` is a snapshot the caller owns; this
 * module clones it and updates the clone live as THIS call picks cards, so
 * the gate sees this pass's own picks (fixing the "computed once per type
 * pass" staleness) without mutating the caller's shared counters — the
 * caller's own post-pass bookkeeping remains the source of truth across
 * passes.
 */
export interface RoleCapConfig {
  /** name -> validated role (see tagger/client.ts's validateCardRole). */
  cardRoleMap: Map<string, RoleKey>;
  roleTargets: Record<RoleKey, number>;
  currentRoleCounts: Record<RoleKey, number>;
  /** Shared across every gated path in the generation — incremented whenever
   *  the escape hatch admits an over-cap card, so the build report can
   *  disclose it in one aggregate note (never silent). */
  overflowCounts?: Partial<Record<RoleKey, number>>;
  /** E532: staples (STAPLE_INCLUSION_BAR) admitted while their role was
   *  already at cap, disclosed next to overflowCounts (never silent). */
  stapleOverflowCounts?: Partial<Record<RoleKey, number>>;
  /** E532: combo-line pieces the tier protected past a cap (see the tier). */
  comboOverflowCounts?: Partial<Record<RoleKey, number>>;
  /** E109 board-centric wipe-asymmetry preference: when set, a boardwipe-role
   *  candidate that spares the caller's own board (isOneSidedWipe,
   *  tagger/client.ts) is always tried before a symmetric one — see
   *  wipeAsymmetryTieBreak. Undefined (the common case, every deck whose
   *  plan isn't board-centric) is a no-op. */
  isOneSidedWipe?: (card: ScryfallCard) => boolean;
  /** Unordered name-pair keys the tie-break has actually decided (mirrors
   *  priceSanityDecided below) — the build report's "N one-sided wipes
   *  preferred" count. */
  wipeAsymmetryDecided?: Set<string>;
  /** E112 own-board scope-collateral preference: among two boardwipe-role
   *  candidates that tie on the isOneSidedWipe tie-break above (both
   *  symmetric, or both already one-sided — see wipeScopeCollateralTieBreak),
   *  prefer whichever destroys/exiles less of the deck's own non-creature
   *  permanent mass (getWipeScope, tagger/client.ts — already returns the
   *  empty/no-collateral scope for a one-sided wipe, so this never
   *  re-litigates the isOneSidedWipe axis above). Unlike isOneSidedWipe,
   *  this is NOT gated on the board-centric preference — scope mismatch (an
   *  enchantress deck's own Farewell) is a separate concern from player-
   *  asymmetry and matters for any deck with real non-creature permanent
   *  density, not just go-wide/attack-trigger board-centric plans. */
  getWipeScope?: (card: ScryfallCard) => WipeScope;
  /** The deck's planned non-land type distribution (typeTargets from
   *  calculateTargetCounts) — the "own board mass" the scope-collateral
   *  tie-break weighs a wipe's printed scope against. Same source
   *  isBoardCentricPlan already reads for creature density. */
  deckTypeTargets?: Record<string, number>;
}

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
  liftTieBreak?: Map<string, number>,
  /** Staples <-> Brew dial (see calculateCardPriority); 0.5 = today's formula. */
  brewLevel: number = 0.5,
  /** Format legality gate (notLegalForFormat) — undefined defaults to the
   *  base Commander legality check. Fixes a real leak: this picker never
   *  checked commander legality at all, so a banned card in the EDHREC/lift
   *  pool could ship. */
  mtgFormat?: string
): ScryfallCard[] {
  const result: ScryfallCard[] = [];
  const preferOwned = collectionStrategy === 'prefer';

  // Filter and sort candidates (with combo boost + owned-first bias if enabled)
  const candidates = edhrecCards
    .filter((c) => !usedNames.has(c.name) && !bannedCards.has(c.name))
    .sort(
      (a, b) =>
        priorityWithBoosts(b, comboPriorityBoost, preferOwned, collectionNames, brewLevel) -
          priorityWithBoosts(a, comboPriorityBoost, preferOwned, collectionNames, brewLevel) ||
        liftTie(b.name, liftTieBreak) - liftTie(a.name, liftTieBreak)
    );

  // Shared validation for a single candidate
  const tryPick = (edhrecCard: EDHRECCard): boolean => {
    const isGC = gameChangerNames.has(edhrecCard.name);
    if (isGC && gameChangerCount.value >= maxGameChangers) return false;

    const scryfallCard = cardMap.get(edhrecCard.name);
    if (!scryfallCard) return false;
    if (cardAllowed && !cardAllowed(scryfallCard)) return false;
    if (notLegalForFormat(scryfallCard, mtgFormat)) return false;
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

// Staples <-> Synergy dial: reweights calculateCardPriority's inclusion vs
// synergy terms. 0 = Staples, 0.5 = Balanced (default), 1 = Synergy. Every
// term is piecewise-linear through exactly its Balanced value at 0.5, so a
// Balanced build is byte-identical to the pre-dial formula.
//
// The ends are deliberately strong. The first version (1.5x/0.4x inclusion,
// 0.4x/1.6x synergy, theme-list floor untouched) measured almost no movement
// (E238: mean play rate 40.0% at Staples vs 39.7% at Brew): the flat +100
// theme-list floor outranked any inclusion difference, and most of the
// repair/trim phases scored at Balanced whatever the dial said, so they
// quietly re-picked what the dial had passed over. Now Staples is a pure
// play-rate ranking (no synergy term, no list floor) and Synergy is a
// synergy ranking with play rate as a tie-breaker, and the dial reaches every
// generation phase that scores cards (state.cfg.brewLevel).
//
// Linear scaling still preserves within-tier order, so at full Staples a card
// is never rewarded for being obscure, and at full Synergy a zero-synergy card
// never leapfrogs a synergy card on popularity alone.
function inclusionMultiplier(brewLevel: number): number {
  // Staples(0)=2.0 · Balanced(0.5)=1.0 · Synergy(1)=0.25
  return brewLevel <= 0.5 ? 1 + 2 * (0.5 - brewLevel) : 1 - 1.5 * (brewLevel - 0.5);
}
function synergyMultiplier(brewLevel: number): number {
  // Staples(0)=0 · Balanced(0.5)=1.0 · Synergy(1)=2.2
  return brewLevel <= 0.5 ? 2 * brewLevel : 1 + 2.4 * (brewLevel - 0.5);
}
function themeListFloor(brewLevel: number): number {
  // EDHREC's high-synergy/top-card lists: Staples(0)=0 · Balanced/Synergy=100
  return 100 * Math.min(1, 2 * brewLevel);
}

// Calculate a priority score for EDHREC cards
// High synergy cards (from theme) should be prioritized over generic high-inclusion cards
export function calculateCardPriority(card: EDHRECCard, brewLevel: number = 0.5): number {
  const synergy = card.synergy ?? 0;
  const inclusion = card.inclusion;
  const inclusionMul = inclusionMultiplier(brewLevel);
  const synergyMul = synergyMultiplier(brewLevel);

  // Cards from theme synergy lists (highsynergycards, topcards, etc.) get top priority
  if (card.isThemeSynergyCard) {
    // Theme synergy cards get a big boost: 100 + synergy bonus + inclusion
    // This ensures they're prioritized over regular high-inclusion cards
    return themeListFloor(brewLevel) + synergy * 50 * synergyMul + inclusion * inclusionMul;
  }

  // New cards get a small relevancy boost to compensate for having fewer total decks,
  // but not enough to override established staples with high inclusion/synergy
  const newCardBoost = card.isNewCard ? 25 : 0;

  // If synergy score is high (> 0.3), boost the card
  if (synergy > 0.3) {
    return synergy * 100 * synergyMul + inclusion * inclusionMul + newCardBoost;
  }

  // For low/no synergy cards, just use inclusion
  return inclusion * inclusionMul + newCardBoost;
}

// Owned-first ('prefer' strategy): a bounded boost so owned cards win ties and
// near-ties, without dredging a weak owned card over a premium staple.
// Applied in the sort comparator ONLY (not calculateCardPriority), so
// ownership changes pick *preference*, never a card's type classification or
// its right to break curve.
// ponytail: single tunable constant; raise if the owned bias feels too weak.
export const OWNED_PRIORITY_BOOST = 40;

// E122: theme/high-synergy cards (isHighSynergyCard) score on a much wider
// scale — a 100-point floor plus up to +50 synergy and +100 inclusion (see
// calculateCardPriority), often further stacked with a comboPriorityBoost/
// role-deficit term of 100+ (categorize.ts's computeRoleBoosts) — so the
// filler-tier OWNED_PRIORITY_BOOST=40 above is proportionally tiny there and
// rarely crosses a real gap. Sizing data (E122 PR, live EDHREC pulls, two
// strongly-themed commanders): adjacent-ranked theme candidates typically sit
// 2-30 points apart, with genuine quality tiers (a format staple vs a
// commander-specific niche pick) starting around 60-80+. 60 sits just above
// that near-tie band without reaching into it — an owned card can leapfrog a
// handful of ranks of real noise, but a Wild Growth-tier staple (a `~80pt`
// raw gap over a niche owned enchantress payoff in one live dump) still wins
// outright. This is a SEPARATE constant, not a raised OWNED_PRIORITY_BOOST,
// so the filler tier's existing near-tie sizing is untouched.
export const OWNED_PRIORITY_BOOST_THEME_TIER = 60;

function priorityWithBoosts(
  card: EDHRECCard,
  comboPriorityBoost: Map<string, number> | undefined,
  preferOwned: boolean,
  collectionNames: Set<string> | undefined,
  brewLevel: number = 0.5
): number {
  const ownedBoost =
    preferOwned && collectionNames?.has(card.name)
      ? isHighSynergyCard(card)
        ? OWNED_PRIORITY_BOOST_THEME_TIER
        : OWNED_PRIORITY_BOOST
      : 0;
  return (
    calculateCardPriority(card, brewLevel) + (comboPriorityBoost?.get(card.name) ?? 0) + ownedBoost
  );
}

// EDHREC lift clusterScore (E71 slice 2), keyed lowercase. A SECONDARY sort
// key only — it breaks an EXACT priorityWithBoosts tie, never outranks a
// higher-priority card and never grants curve-breaking rights (the curve gate
// below runs on isHighSynergyCard/inclusion/combo boost, untouched by lift).
function liftTie(name: string, liftTieBreak: Map<string, number> | undefined): number {
  return liftTieBreak?.get(name.toLowerCase()) ?? 0;
}

// E80 diagnosis (board): with no budget set, `computeRoleBoosts`'s "early
// ramp" bonus (categorize.ts) multiplies the role-deficit boost up to 2x for
// CMC<=1 candidates vs 1.5x for CMC<=2 — a legitimate curve-fill heuristic,
// but completely price-blind. That multiplier gap (150 vs 112.5 boost points
// in the Yuriko live dump) swamps an 8-13 point inclusion gap, so a $1,119
// 0-cmc Mox Diamond (12.5% inclusion) outranks $1-2 same-role rocks with
// genuinely higher inclusion (Fellwar Stone 14.9%, Thought Vessel 20.8%) by a
// wide priority-score margin. That's not a near-tie, so this can't live as a
// simple last-place tie-break — it has to re-order comparable pairs before
// the boosted-priority comparison runs.
//
// Bounded by construction (opt-in via `enabled`, default off = today's sort
// order untouched):
//  - only compares cards sharing a role (never reorders across roles/slots,
//    never touches a card with no role at all)
//  - "comparable" = within PRICE_SANITY_INCLUSION_BAND points of RAW EDHREC
//    inclusion (not the boosted score) — catches genuine substitutes (Mox
//    Diamond 12.5 vs Fellwar Stone 14.9, a 2.4pt gap) while leaving a
//    genuinely-better pick alone when there's no comparable cheap option
//    (Kozilek dump: Grim Monolith 22% combo pick vs Mind Stone 86%, a 64pt
//    gap — never treated as comparable)
//  - only fires on a >PRICE_SANITY_RATIO price ratio ("dramatically
//    cheaper"), so ordinary premium-vs-budget spreads never trigger it
//  - inert whenever either side's price is missing or non-positive
//  - never reorders a pair where either card is carrying a live combo boost
//    — combo assembly is a deliberate "worth the price" signal this must
//    never fight
//  - a pure comparator tie-break: it can only change which of two
//    already-eligible same-role candidates is *tried first* — every hard
//    gate (curve room, price cap, rarity, cmc cap, bracket ceiling, role cap)
//    still runs on each card exactly as before, so it can never make an
//    ineligible card eligible.
export const PRICE_SANITY_INCLUSION_BAND = 15; // percentage points
export const PRICE_SANITY_RATIO = 20; // "dramatically cheaper" multiple

function priceSanityTieBreak(
  a: EDHRECCard,
  b: EDHRECCard,
  cardMap: Map<string, ScryfallCard>,
  cardRoleMap: Map<string, RoleKey> | undefined,
  comboBoost: Map<string, number> | undefined,
  currency: 'USD' | 'EUR',
  enabled: boolean
): number {
  if (!enabled || !cardRoleMap) return 0;

  const roleA = cardRoleMap.get(a.name);
  const roleB = cardRoleMap.get(b.name);
  if (!roleA || !roleB || roleA !== roleB) return 0;

  // Never fight a real combo-assembly signal.
  if ((comboBoost?.get(a.name) ?? 0) > 0 || (comboBoost?.get(b.name) ?? 0) > 0) return 0;

  if (Math.abs(a.inclusion - b.inclusion) > PRICE_SANITY_INCLUSION_BAND) return 0;

  const cardA = cardMap.get(a.name);
  const cardB = cardMap.get(b.name);
  if (!cardA || !cardB) return 0;
  const priceA = parseFloat(getCardPrice(cardA, currency) ?? '');
  const priceB = parseFloat(getCardPrice(cardB, currency) ?? '');
  if (!isFinite(priceA) || !isFinite(priceB) || priceA <= 0 || priceB <= 0) return 0;

  const ratio = priceA > priceB ? priceA / priceB : priceB / priceA;
  if (ratio < PRICE_SANITY_RATIO) return 0;

  return priceA < priceB ? -1 : 1;
}

// Board-wipe tie-breaks (E109/E112/E113) live in wipeTieBreaks.ts.
export {
  wipeOwnBoardCollateral,
  wipeQualityPenalty,
  WIPE_QUALITY_SYMMETRIC_PENALTY,
  WIPE_QUALITY_COLLATERAL_BASE,
  WIPE_QUALITY_COLLATERAL_SCALE,
} from './wipeTieBreaks';

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
  liftTieBreak?: Map<string, number>,
  roleCapConfig?: RoleCapConfig,
  /** E80 price-sanity tie-break (see priceSanityTieBreak). Callers resolve the
   *  smart default (deckGenerator.ts's resolvePriceSanity) before passing this. */
  priceSanity: boolean = false,
  /** Raw combo-assembly boost (pre role/package blend) — used ONLY to keep
   *  price-sanity from ever reordering a live combo pick. Separate from the
   *  blended `comboPriorityBoost` above, which also carries role-deficit
   *  boosts that would otherwise make this guard fire on almost every card. */
  comboOnlyBoost?: Map<string, number>,
  /** Shared across the whole generation: records an unordered name-pair key
   *  the first time price-sanity actually FLIPS the outcome away from what
   *  raw priority alone would have picked (a genuine tie, or an outright
   *  disagreement) — never incremented when price-sanity's verdict merely
   *  agrees with priority's. `.size` after generation is the build report's
   *  "N cheaper near-equivalents preferred" count. A Set (not a running
   *  counter) so repeat comparator calls on the same pair during sort() can
   *  never double-count it. */
  priceSanityDecided?: Set<string>,
  /** Staples <-> Brew dial (see calculateCardPriority); 0.5 = today's formula. */
  brewLevel: number = 0.5,
  /** Format legality gate (notLegalForFormat) — undefined defaults to the
   *  base Commander legality check. Fixes a real leak: this picker never
   *  checked commander legality at all (notCommanderLegal was only wired
   *  into the lift-picks/PDH paths), so a banned card in the EDHREC pool
   *  could ship. */
  mtgFormat?: string,
  /** E532: names tried first with the staples and allowed past the curve
   *  (protectionPicks.ts: at most two protection pieces for a commander that
   *  must survive). Every other gate still applies. */
  admitFirst?: ReadonlySet<string>,
  /** E532: combo-line pieces to protect from the staple tier
   *  (typePassPick.ts's baselineComboSeats). */
  comboLinePieces?: ReadonlySet<string>,
  /** E532 off: the pre-E532 pass, for baselineComboSeats' dry run. */
  e532Off = false
): ScryfallCard[] {
  const result: ScryfallCard[] = [];
  const preferOwned = collectionStrategy === 'prefer';
  const isStaple = (c: EDHRECCard) => c.inclusion >= STAPLE_INCLUSION_BAR;

  // Live-updating clone of the role-cap snapshot (see RoleCapConfig doc) —
  // undefined when balanced roles isn't active, matching the existing
  // `roleTargets ? ... : ...` pattern everywhere else in the generator.
  const liveRoleCounts = roleCapConfig ? { ...roleCapConfig.currentRoleCounts } : undefined;
  // Candidates skipped ONLY for being over their role's cap — replayed as an
  // escape hatch if the pass would otherwise ship short (never drop deck size
  // to satisfy a soft target).
  const capSkipped: EDHRECCard[] = [];
  let allowCapOverflow = false;
  // `bands` tolerance bands above target: 1 is the cap, 2 the staple ceiling.
  const atRoleCap = (edhrecCard: EDHRECCard, bands = 1): boolean => {
    if (!roleCapConfig || !liveRoleCounts) return false;
    const role = roleCapConfig.cardRoleMap.get(edhrecCard.name);
    if (!role) return false;
    const target = roleCapConfig.roleTargets[role] ?? 0;
    if (target <= 0) return false;
    return (liveRoleCounts[role] ?? 0) >= target + bands * roleCapTolerance(target);
  };
  // A staple passes the cap (E532: Kaito, Bane of Nightmares at 54.9% was
  // skipped on card draw while a 5.6% Jace passed on removal), up to a second
  // tolerance band so the cap still means something: the settings stress panel
  // showed ramp at 24 on a target of 14 when staples had no ceiling. Its
  // admission past the cap is counted in stapleOverflowCounts below. Not under
  // a deck budget: a card past its cap is money a later phase has to claw
  // back, and on Meren at $100 that ended $7.45 over after 20 substitutions.
  // Combo pieces the tier protects (below) pass the cap the same way. The
  // dry run behind them (e532Off) replays the passes as they were before E532.
  const protectedCombos = e532Off ? new Set<string>() : (comboLinePieces ?? new Set<string>());
  const capExempt = (c: EDHRECCard) =>
    !e532Off && !budgetTracker && (isStaple(c) || protectedCombos.has(c.name)) && !atRoleCap(c, 2);
  const roleCapBlocks = (edhrecCard: EDHRECCard): boolean =>
    !allowCapOverflow && !capExempt(edhrecCard) && atRoleCap(edhrecCard);

  // Filter and sort ALL candidates by priority (synergy + combo + owned-first bias)
  const allCandidates = edhrecCards
    .filter((c) => !usedNames.has(c.name) && !bannedCards.has(c.name))
    .sort((a, b) => {
      // Checked before price-sanity/priority — see wipeAsymmetryTieBreak's
      // doc for why this preference must be unconditional, not banded.
      const wipePref = wipeAsymmetryTieBreak(
        a,
        b,
        cardMap,
        roleCapConfig?.cardRoleMap,
        roleCapConfig?.isOneSidedWipe,
        roleCapConfig?.wipeAsymmetryDecided
      );
      if (wipePref !== 0) return wipePref;
      const scopePref = wipeScopeCollateralTieBreak(
        a,
        b,
        cardMap,
        roleCapConfig?.cardRoleMap,
        roleCapConfig?.getWipeScope,
        roleCapConfig?.deckTypeTargets
      );
      if (scopePref !== 0) return scopePref;
      const sanity = priceSanityTieBreak(
        a,
        b,
        cardMap,
        roleCapConfig?.cardRoleMap,
        comboOnlyBoost,
        currency,
        priceSanity
      );
      const priorityDiff =
        priorityWithBoosts(b, comboPriorityBoost, preferOwned, collectionNames, brewLevel) -
        priorityWithBoosts(a, comboPriorityBoost, preferOwned, collectionNames, brewLevel);
      if (sanity !== 0) {
        // Only "decided" when it disagrees with (or breaks an exact tie in)
        // the raw priority order — an agreeing verdict would have picked the
        // same winner anyway, so it's not the tie-break doing any work.
        if (priceSanityDecided && Math.sign(priorityDiff) !== Math.sign(sanity)) {
          priceSanityDecided.add([a.name, b.name].sort().join('|'));
        }
        return sanity;
      }
      return priorityDiff || liftTie(b.name, liftTieBreak) - liftTie(a.name, liftTieBreak);
    });

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

  const processCards = (
    candidates: EDHRECCard[],
    requireTypeCheckForUnknown: boolean,
    maxAdmits: number = Infinity
  ): void => {
    let admitted = 0;
    for (const edhrecCard of candidates) {
      if (result.length >= count) break;
      if (admitted >= maxAdmits) break;
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

      // Hard role cap: skip (never a must-include/combo/land — those never
      // reach this pool-based picker) once the role is at target+tolerance.
      // Stashed for the escape-hatch replay below rather than lost outright.
      if (roleCapBlocks(edhrecCard)) {
        if (!capSkipped.includes(edhrecCard)) capSkipped.push(edhrecCard);
        continue;
      }

      const scryfallCard = cardMap.get(edhrecCard.name);
      if (!scryfallCard) continue;
      // E525: every caller seats the result in a spell slot, and a pool's
      // type label can't keep a land out (Dryad Arbor is a Creature to it).
      if (!fitsSpellSlot(scryfallCard)) continue;
      if (cardAllowed && !cardAllowed(scryfallCard)) continue;
      if (notLegalForFormat(scryfallCard, mtgFormat)) continue;

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
        // Partial-mode owned quota still short: an owned candidate needs the
        // SAME curve-break allowance a staple gets, or it never gets one —
        // unowned staples (usually >40% inclusion) sort first and fill every
        // curve slot before an owned niche pick (usually <40% inclusion) gets
        // a turn, so the requested owned% silently under-delivers even when
        // plenty of owned cards exist (E128 audit finding).
        const ownedQuotaShort =
          isPartialMode &&
          enforceQuotas &&
          collectionNames!.has(edhrecCard.name) &&
          ownedPicked < ownedTarget;
        if (
          !isHighSynergyCard(edhrecCard) &&
          !isStaple(edhrecCard) &&
          comboBoost < 100 &&
          !ownedQuotaShort &&
          !admitFirst?.has(edhrecCard.name) &&
          !protectedCombos.has(edhrecCard.name)
        ) {
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
      admitted++;
      usedNames.add(edhrecCard.name);
      if (scryfallCard.name !== edhrecCard.name) usedNames.add(scryfallCard.name);
      currentCurveCounts[cmc] = (currentCurveCounts[cmc] ?? 0) + 1;
      if (!ownedExempt) budgetTracker?.deductCard(scryfallCard);
      if (liveRoleCounts && roleCapConfig) {
        const role = roleCapConfig.cardRoleMap.get(edhrecCard.name);
        const past = isStaple(edhrecCard)
          ? roleCapConfig.stapleOverflowCounts
          : roleCapConfig.comboOverflowCounts;
        if (role && !allowCapOverflow && past && atRoleCap(edhrecCard)) {
          past[role] = (past[role] ?? 0) + 1;
        }
        if (role) {
          liveRoleCounts[role] = (liveRoleCounts[role] ?? 0) + 1;
          // Every card reaching this point during the Phase-5 replay was
          // skipped for cap in phases 1-4 — allowCapOverflow being true here
          // means this acceptance IS an overflow admission.
          if (allowCapOverflow && roleCapConfig.overflowCounts) {
            roleCapConfig.overflowCounts[role] = (roleCapConfig.overflowCounts[role] ?? 0) + 1;
          }
        }
      }

      // Track ownership for quota enforcement
      if (isPartialMode) {
        if (collectionNames!.has(edhrecCard.name)) ownedPicked++;
        else unownedPicked++;
      }
    }
  };

  // Phase 0 (E532): the admitFirst names, then staples, go before anything
  // role boosts promoted. Role boosts still order the staples and everything
  // below them. Staples stay out of the tier where another ordering
  // is the user's or the design's call: toward the Synergy end of the dial,
  // under 'prefer' (the owned boost decides near-ties, E122), for board wipes
  // (the one-sided/collateral tie-breaks decide those, E109/E112), and under a
  // deck budget, where pick order is spending order: staples first spent the
  // budget on play rate and budget convergence then cut the cheap role cards
  // (all three budget decks on the E532 panel came out worse).
  // ponytail: a price-sanity pair straddling the bar (E80) is ordered by the
  // tier, not by price. Fold the tie-break in if a live deck shows one.
  const stapleTier = !e532Off && brewLevel <= 0.5 && !preferOwned && !budgetTracker;
  // Board wipes keep their own order (the one-sided and collateral
  // tie-breaks, E109/E112, sort allCandidates): a >=40% wipe leads, and so
  // does every wipe those tie-breaks rank ahead of it. Kept out entirely,
  // Toxic Deluge (42.9% on Obeka's Wheels page) lost its slot to a 14%
  // Aetherize and All Is Dust (91.9% on Kozilek) to rocks.
  const isWipe = (c: EDHRECCard) => roleCapConfig?.cardRoleMap.get(c.name) === 'boardwipe';
  const lastStapleWipe = allCandidates.reduce(
    (last, c, i) => (isStaple(c) && isWipe(c) ? i : last),
    -1
  );
  const wipeMayLead = (c: EDHRECCard, i: number) => isStaple(c) || i < lastStapleWipe;
  // The admitFirst names lead: sorted among the staples, an 18.8% Swiftfoot
  // Boots lost Meren's last artifact slot to them and never reached the deck.
  const admitted = allCandidates.filter((c) => !e532Off && !!admitFirst?.has(c.name));
  const staples = allCandidates.filter(
    (c, i) =>
      stapleTier && (isWipe(c) ? wipeMayLead(c, i) : isStaple(c)) && !admitFirst?.has(c.name)
  );
  // A staple takes a filler slot, never a combo slot: the combo-line pieces
  // the passes seat without the tier (typePassPick.ts's baselineComboSeats)
  // lead it, and pass the cap and the curve like a staple. The E532 gate lost
  // Hermit Druid + Thassa's Oracle, Karn + Mycosynth Lattice and Hullbreaker
  // Horror + Mox Amber to staples without it.
  const combos = allCandidates.filter(
    (c) => protectedCombos.has(c.name) && !admitFirst?.has(c.name)
  );
  processCards([...combos, ...admitted, ...staples.filter((c) => !combos.includes(c))], true);

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

  // Phase 5: role-cap escape hatch. Never ship a type pass short to respect a
  // soft role target — admit the least-over-target cap-skipped candidates
  // first (every other gate above still applied when they were first
  // considered). The resulting surplus is still visible downstream via
  // roleTargets/roleCounts (buildReport.ts's roleExcesses reads the final
  // counts, not how the pick loop got there).
  if (roleCapConfig && liveRoleCounts && result.length < count && capSkipped.length > 0) {
    capSkipped.sort((a, b) => {
      const roleA = roleCapConfig.cardRoleMap.get(a.name);
      const roleB = roleCapConfig.cardRoleMap.get(b.name);
      const overA = roleA
        ? (liveRoleCounts[roleA] ?? 0) - (roleCapConfig.roleTargets[roleA] ?? 0)
        : 0;
      const overB = roleB
        ? (liveRoleCounts[roleB] ?? 0) - (roleCapConfig.roleTargets[roleB] ?? 0)
        : 0;
      return overA - overB;
    });
    allowCapOverflow = true;
    processCards(capSkipped, true, ROLE_CAP_HATCH_MAX_PER_PASS);
  }

  return result;
}

// Merge type-specific cards with allNonLand cards (which includes topcards, highsynergycards, etc.)
// This ensures cards from generic EDHREC lists get considered for each type slot
// IMPORTANT: Sort by priority so high-synergy cards come first, not last!
export function mergeWithAllNonLand(
  typeSpecificCards: EDHRECCard[],
  allNonLand: EDHRECCard[],
  /** Staples <-> Brew dial (see calculateCardPriority); 0.5 = today's formula. */
  brewLevel: number = 0.5
): EDHRECCard[] {
  const seenNames = new Set(typeSpecificCards.map((c) => c.name));
  const additionalCards = allNonLand.filter(
    (c) => c.primary_type === 'Unknown' && !seenNames.has(c.name)
  );
  // Merge and sort by priority - high synergy cards should come FIRST
  const merged = [...typeSpecificCards, ...additionalCards];
  return merged.sort(
    (a, b) => calculateCardPriority(b, brewLevel) - calculateCardPriority(a, brewLevel)
  );
}
