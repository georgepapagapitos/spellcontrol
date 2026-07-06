import type { DeckCategory, ScryfallCard } from '@/deck-builder/types';
import type { GenerationState } from './state';
import {
  getCardRole,
  isProtectionPiece,
  isFreeInteraction,
  validateCardRole,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { calculateCardPriority } from '../cardPicking';
import { STAPLE_ROCK_NAMES } from './phaseStapleManaRocks';
import { routeCardByType } from '../categorize';
import type { BracketGuard } from '../bracketGuard';
import { LIFT_PICK_BOOST_MAX, LIFT_PICK_BOOST_SCALE } from '../packageBoost';
import {
  MUST_INCLUDE_BOOST,
  STAPLE_PROTECTION_BOOST,
  PROTECTION_PIECE_BOOST,
  FREE_INTERACTION_BOOST,
  COMBO_TRIM_BOOST,
  ROLE_DEFICIT_TRIM_BOOST,
  ROLE_SURPLUS_TRIM_PENALTY,
} from './trimResistanceConstants';

// ── Land-Squeeze Reconciliation (E88, iter-7 Slice B) ──
//
// deckGenerator.ts's auto-tune (computeAutoLandCount) can raise resolvedLandCount
// above the 37-land baseline (CONTROL/LANDFALL/REANIMATOR archetypes, high avg
// CMC — already live, e.g. Kozilek the Great Distortion at 40 lands). Sizing
// every type pass's targets off the RAISED land count shrinks nonLandCards, and
// every one of the 6 type targets shrinks proportionally — silently dropping the
// marginal roleless-premium picks (Fierce Guardianship-class cards with no
// role-deficit boost to keep them ahead of the new, lower cutoff) with no
// casualty-selection step ever seeing the loss (board E82/E88 diagnosis).
//
// The fix (see targetCounts.ts's typeTargetLandCount): size the type passes as
// if lands were still at baseline (so they pick their full, un-squeezed
// complement), and let THIS pass reconcile the resulting genuine surplus down
// to the real land count — globally, disclosed, and scored the same way
// phaseRoleSurplusRebalance.ts's survivalScoreOf already fixed for the SAME
// underlying issue (see that file's header): pick *position* within a type
// pass is not deck-wide comparable once curve-fit/early-ramp-CMC bonuses have
// scrambled it, so eviction order here uses calculateCardPriority + lift
// instead of deckGenerator.ts's position-based computeTrimResistance. Reuses
// the SAME calibrated protection-tier constants computeTrimResistance already
// applies, as ADDITIVE boosts (not skip conditions) — MUST_INCLUDE_BOOST is
// large enough that a locked card never actually loses, matching the accepted
// risk profile of the existing Smart Trim precedent, not a new one.
//
// Runs immediately before Smart Trim (deckGenerator.ts), right after
// stapleManaRocksPhase — by the time it runs, `squeezeDelta` cards should
// already equal the surplus this pass creates, so Smart Trim's own
// `currentCount > targetDeckSize` naturally becomes a no-op right after. Two
// independent passes composing in sequence: if some other, unrelated cause
// also pushes the deck over size, Smart Trim still mops up whatever's left —
// zero changes to Smart Trim's own code.
//
// ── Superset-pick wildcards (E82 attempt 6) ──
//
// E88 above only ever ADDS slots back (never new cards) and only fires when
// squeezeDelta > 0 (auto-tune raised land count past the 37-land baseline).
// Every auto-tuned deck that resolves BELOW 37 (the common case — most
// commanders cluster 33-36) got zero extra reach at all. Attempts 3-5 tried
// to widen this by pinning typeTargetLandCount to a lower anchor for every
// auto-tuned deck, which reproportioned the type/curve passes and silently
// dropped roleless premiums at PICK time (board E82 finding) — a bug class
// this reconcile pass structurally can't see or fix, because by the time it
// runs, a pick-time loss already never entered `state.categories`.
//
// Attempt 6 leaves typeTargetLandCount and every type/curve target byte-
// identical to today (E88, unmodified) and instead widens the reach of THIS
// already-safe reconcile pass: `wildcardCount = max(0, resolvedLandCount -
// 32)` (32 is computeAutoLandCount's own existing floor, not a new constant)
// leftover EDHREC-pool cards — ones that already cleared every pick-time gate
// via the same `pickFromPrefetchedWithCurve` every type pass uses — are
// scored with the SAME scoreOf as incumbents and folded into ONE combined
// sort/cut alongside them. A wildcard can only survive by outscoring a
// genuine incumbent under the identical metric that decides the cut, so the
// mechanism is additive-only on top of an unmodified (already-safe) pick
// phase — it cannot reproduce the pick-time loss, only compete at cut time,
// where the same protection-tier boosts (MUST_INCLUDE/STAPLE/PROTECTION/
// COMBO/role-deficit) that already protect incumbents apply equally to
// wildcards. `wildcardCount` is 0 (mechanism fully inert) whenever
// `landCountAutoTuned` is false — i.e. every user-set land count.

export interface LandSqueezeReconcileContext {
  /** EDHREC lift clusterScore lookup (deckGenerator.ts's liftScoreOf). */
  liftScoreOf: (name: string) => number;
  /** Balanced-roles targets; role deficit/surplus scoring is skipped (not
   *  gated) when this is null — same as computeTrimResistance. */
  roleTargets: Record<RoleKey, number> | null;
  currentRoleCounts: Record<RoleKey, number>;
  /** Cards to cut: max(0, resolvedLandCount - typeTargetLandCount). */
  squeezeDelta: number;
  /** Leftover EDHREC-pool cards that already cleared every pick-time gate
   *  (color identity, budget, rarity, cmc, arena, game-changer cap, bracket
   *  ceiling, role cap, synergy dependency) — built by deckGenerator.ts via
   *  the same pickFromPrefetchedWithCurve() every other EDHREC pick uses.
   *  Re-scored and re-ranked HERE by the SAME scoreOf blend that decides
   *  cuts, never the picker's own EDHREC-priority order (see header). */
  wildcardCandidates: ScryfallCard[];
  /** max(0, resolvedLandCount - 32) — see header for why 32 isn't a new
   *  constant. 0 when landCountAutoTuned is false (user-set land count) —
   *  mechanism fully inert. */
  wildcardCount: number;
  /** Same guard every EDHREC-pool pick already shares (deckGenerator.ts) —
   *  a kept wildcard is a genuine new add, so it must record here too or a
   *  later phase reusing this same guard (coherence repair, etc.) could
   *  admit one card too many past the user's target-bracket ceiling.
   *  Undefined when no bracket is targeted (ceilings all open). */
  bracketGuard?: BracketGuard;
}

export interface LandSqueezeReconcileResult {
  /** Names cut, in cut order (lowest score first) — for disclosure. */
  cut: string[];
  /** Wildcard names that survived the combined cut — the genuine net
   *  additions this pass makes (see header). Empty whenever every wildcard
   *  scored below the incumbents it would have had to displace, which is
   *  the common case — a wildcard "added" and then cut right back out in
   *  the same combined pass is not a net addition and isn't listed here. */
  wildcardsKept: string[];
}

const REACTIVE_ROLES: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];

/**
 * Pure, bounded post-fill pass: when the auto-tune raised land count past
 * baseline, cuts exactly `squeezeDelta` of the deck's lowest marginal-value
 * nonland cards (cross-category, never `lands`) to reconcile the type passes'
 * un-squeezed pick back down to the real land count — and, independently
 * (E82 attempt 6), folds up to `wildcardCount` leftover cards into the SAME
 * combined sort/cut so a wildcard can only survive by outscoring a genuine
 * incumbent (see header). No-op — `{ cut: [], wildcardsKept: [] }`, `state`
 * untouched — when both `squeezeDelta` and `wildcardCount` are `<= 0` (no
 * auto-tune, or an auto-tune that landed exactly at the 32-land floor).
 */
export function applyLandSqueezeReconcile(
  state: GenerationState,
  ctx: LandSqueezeReconcileContext
): LandSqueezeReconcileResult {
  if (ctx.squeezeDelta <= 0 && ctx.wildcardCount <= 0) return { cut: [], wildcardsKept: [] };

  const pool = state.edhrecData?.cardlists.allNonLand ?? [];
  const poolByName = new Map(pool.map((c) => [c.name, c]));

  // Pool-absent-incumbent fallback (never `?? 0` — see phaseRoleSurplusRebalance.ts's
  // roleAverageInclusion for the precedent this mirrors). Duplicated locally
  // rather than hoisted to a shared helper — a 6-line map-build with only two
  // consumers doesn't earn an extraction yet.
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
  const deckAveragePriority =
    pool.length > 0 ? pool.reduce((sum, c) => sum + calculateCardPriority(c), 0) / pool.length : 0;

  const scoreOf = (card: ScryfallCard): number => {
    const ec = poolByName.get(card.name);
    const role = validateCardRole(card);
    const roleFallback = role ? roleAverageInclusion.get(role) : undefined;
    let score = ec ? calculateCardPriority(ec) : (roleFallback ?? deckAveragePriority);
    // iter-10 Slice A: was `score += ctx.liftScoreOf(card.name)` — raw,
    // unscaled clusterScore (median ~2150, p75 ~8350, observed outliers
    // >20000, packageBoost.ts:137-143). Every OTHER lift-aware consumer
    // scales this term (packageBoost.ts's computeLiftPickBoosts,
    // phaseRoleSurplusRebalance.ts's survivalScoreOf); this was the one
    // outlier adding the raw signal directly, which let an unrelated theme's
    // clusterScore swamp the protection/free-interaction/combo tiers below —
    // the measured failure: a yuriko-b4 generation ranked on-theme ninja
    // wildcards at 6207-7973 (almost entirely clusterScore) over Commandeer
    // at 2414 (calculateCardPriority + a much smaller lift connection), so
    // Commandeer never had a chance under the additive tiers alone. Reusing
    // the already-validated scaler restores this site to the same
    // relationship every other consumer already has.
    score += Math.min(
      LIFT_PICK_BOOST_MAX,
      Math.max(0, ctx.liftScoreOf(card.name)) * LIFT_PICK_BOOST_SCALE
    );

    if (card.isMustInclude) score += MUST_INCLUDE_BOOST;
    if (card.isStapleRock || STAPLE_ROCK_NAMES.has(card.name)) score += STAPLE_PROTECTION_BOOST;
    if (isProtectionPiece(card)) score += PROTECTION_PIECE_BOOST;
    if (isFreeInteraction(card)) score += FREE_INTERACTION_BOOST;
    if (state.comboCardNames.has(card.name)) score += COMBO_TRIM_BOOST;
    if (ctx.roleTargets && role) {
      const target = ctx.roleTargets[role] ?? 0;
      const current = ctx.currentRoleCounts[role] ?? 0;
      if (current <= target) score += ROLE_DEFICIT_TRIM_BOOST;
      else if (current >= target + 3) score += ROLE_SURPLUS_TRIM_PENALTY;
    }
    return score;
  };

  // Rank wildcard candidates by the SAME scoreOf that decides the cut (never
  // the picker's own EDHREC-priority order — see header) and keep only the
  // top `actualAdd`. Graceful degrade if the leftover pool is smaller than
  // wildcardCount — never invents cards.
  const actualAdd = Math.min(ctx.wildcardCount, ctx.wildcardCandidates.length);
  const rankedWildcards = ctx.wildcardCandidates
    .map((card) => ({ card, score: scoreOf(card) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, actualAdd);
  const wildcardCardSet = new Set(rankedWildcards.map((w) => w.card));

  // Combined candidate list for ONE global sort/cut — not N independent
  // one-to-one swaps. Wildcards are listed FIRST, ahead of incumbents:
  // Array.prototype.sort is stable (ES2019+), so on an exact score tie the
  // wildcard (earlier in this pre-sort order) sorts into the cut region and
  // the incumbent survives — ties never displace an incumbent.
  const candidates: { card: ScryfallCard; score: number }[] = [...rankedWildcards];
  for (const cat of Object.keys(state.categories) as DeckCategory[]) {
    if (cat === 'lands') continue;
    for (const card of state.categories[cat]) {
      candidates.push({ card, score: scoreOf(card) });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  const toCut = candidates.slice(0, ctx.squeezeDelta + actualAdd);
  const cutSet = new Set(toCut.map((c) => c.card));
  for (const cat of Object.keys(state.categories) as DeckCategory[]) {
    if (cat === 'lands') continue;
    state.categories[cat] = state.categories[cat].filter((c) => !cutSet.has(c));
  }

  // Role-count bookkeeping — mirrors Smart Trim's own (deckGenerator.ts), not
  // touching usedNames either (same precedent: a trimmed card stays "used" so
  // nothing downstream re-picks it). Only genuinely-cut INCUMBENTS decrement
  // here — a cut wildcard was never added to currentRoleCounts (it's only
  // bumped below for the ones that actually survive), so it's excluded, not
  // decremented into some unrelated incumbent's tally.
  for (const { card } of toCut) {
    if (wildcardCardSet.has(card)) continue;
    const role = validateCardRole(card);
    if (role && ctx.currentRoleCounts[role] > 0) {
      ctx.currentRoleCounts[role]--;
    }
  }

  // Kept wildcards are the genuine net additions: route into their deck
  // category (same routeCardByType every other new-card-add uses), mark
  // used, and bump their role count once each (mirrors the decrement above).
  const wildcardsKept: string[] = [];
  for (const { card } of rankedWildcards) {
    if (cutSet.has(card)) continue;
    routeCardByType(card, state.categories);
    state.usedNames.add(card.name);
    wildcardsKept.push(card.name);
    const role = validateCardRole(card);
    if (role) ctx.currentRoleCounts[role] = (ctx.currentRoleCounts[role] ?? 0) + 1;
    if (state.gameChangerNames.has(card.name)) {
      card.isGameChanger = true;
      state.gameChangerCount.value++;
    }
    ctx.bracketGuard?.record(card.name);
  }

  // `cut` stays scoped to genuinely-cut INCUMBENTS (its pre-existing meaning
  // — a card that WAS in the deck and got removed). A wildcard that lost the
  // combined cut was never in the deck to begin with (only kept wildcards
  // ever reach `state.categories`, just above), so listing it here would
  // misreport "cut" a card the user never saw — that's what `wildcardsKept`
  // (or its absence) already discloses.
  const cut = toCut.filter((c) => !wildcardCardSet.has(c.card)).map((c) => c.card.name);
  return { cut, wildcardsKept };
}
