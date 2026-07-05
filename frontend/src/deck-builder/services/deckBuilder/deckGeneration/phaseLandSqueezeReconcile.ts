import type { DeckCategory, ScryfallCard } from '@/deck-builder/types';
import type { GenerationState } from './state';
import {
  getCardRole,
  isProtectionPiece,
  validateCardRole,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import { calculateCardPriority } from '../cardPicking';
import { STAPLE_ROCK_NAMES } from './phaseStapleManaRocks';
import {
  MUST_INCLUDE_BOOST,
  STAPLE_PROTECTION_BOOST,
  PROTECTION_PIECE_BOOST,
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

export interface LandSqueezeReconcileContext {
  /** EDHREC lift clusterScore lookup (deckGenerator.ts's liftScoreOf). */
  liftScoreOf: (name: string) => number;
  /** Balanced-roles targets; role deficit/surplus scoring is skipped (not
   *  gated) when this is null — same as computeTrimResistance. */
  roleTargets: Record<RoleKey, number> | null;
  currentRoleCounts: Record<RoleKey, number>;
  /** Cards to cut: max(0, resolvedLandCount - typeTargetLandCount). */
  squeezeDelta: number;
}

export interface LandSqueezeReconcileResult {
  /** Names cut, in cut order (lowest score first) — for disclosure. */
  cut: string[];
}

const REACTIVE_ROLES: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];

/**
 * Pure, bounded post-fill pass: when the auto-tune raised land count past
 * baseline, cuts exactly `squeezeDelta` of the deck's lowest marginal-value
 * nonland cards (cross-category, never `lands`) to reconcile the type passes'
 * un-squeezed pick back down to the real land count. No-op — `{ cut: [] }`,
 * `state` untouched — when `squeezeDelta <= 0` (the common case: no auto-tune,
 * or the auto-tune lowered/left land count at baseline).
 */
export function applyLandSqueezeReconcile(
  state: GenerationState,
  ctx: LandSqueezeReconcileContext
): LandSqueezeReconcileResult {
  if (ctx.squeezeDelta <= 0) return { cut: [] };

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
    score += ctx.liftScoreOf(card.name);

    if (card.isMustInclude) score += MUST_INCLUDE_BOOST;
    if (card.isStapleRock || STAPLE_ROCK_NAMES.has(card.name)) score += STAPLE_PROTECTION_BOOST;
    if (isProtectionPiece(card)) score += PROTECTION_PIECE_BOOST;
    if (state.comboCardNames.has(card.name)) score += COMBO_TRIM_BOOST;
    if (ctx.roleTargets && role) {
      const target = ctx.roleTargets[role] ?? 0;
      const current = ctx.currentRoleCounts[role] ?? 0;
      if (current <= target) score += ROLE_DEFICIT_TRIM_BOOST;
      else if (current >= target + 3) score += ROLE_SURPLUS_TRIM_PENALTY;
    }
    return score;
  };

  const candidates: { card: ScryfallCard; score: number }[] = [];
  for (const cat of Object.keys(state.categories) as DeckCategory[]) {
    if (cat === 'lands') continue;
    for (const card of state.categories[cat]) {
      candidates.push({ card, score: scoreOf(card) });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  const toCut = candidates.slice(0, ctx.squeezeDelta);
  const cutSet = new Set(toCut.map((c) => c.card));
  for (const cat of Object.keys(state.categories) as DeckCategory[]) {
    if (cat === 'lands') continue;
    state.categories[cat] = state.categories[cat].filter((c) => !cutSet.has(c));
  }

  // Role-count bookkeeping — mirrors Smart Trim's own (deckGenerator.ts), not
  // touching usedNames either (same precedent: a trimmed card stays "used" so
  // nothing downstream re-picks it).
  for (const { card } of toCut) {
    const role = validateCardRole(card);
    if (role && ctx.currentRoleCounts[role] > 0) {
      ctx.currentRoleCounts[role]--;
    }
  }

  return { cut: toCut.map((c) => c.card.name) };
}
