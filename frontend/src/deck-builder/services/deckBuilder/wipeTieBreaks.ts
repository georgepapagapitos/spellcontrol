// Board-wipe tie-breaks and eviction penalties (E109/E112/E113), moved out of
// cardPicking.ts unchanged (E532) so that file stays under its size limit.
// cardPicking.ts re-exports the public ones for existing importers.
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { RoleKey, WipeScope } from '@/deck-builder/services/tagger/client';

// E109 board-centric wipe-asymmetry preference: among two boardwipe-role
// candidates, always try a one-sided wipe (isOneSidedWipe, tagger/client.ts
// — spares the caster's own board) before a symmetric one, regardless of the
// priority/inclusion gap between them. Deliberately unconditional (not
// banded like priceSanityTieBreak above) — a capped additive boost (the
// packageBoost.ts visibility-boost family) tops out well below the real
// inclusion gap between a niche one-sided wipe and a top symmetric staple
// (same "boost couldn't close a 20+ point gap" shape as E103's extra-combat
// slice), so the comparator has to be the thing that actually wins the slot,
// not a nudge that competes with it.
//
// `isOneSidedWipe` is injected (mirrors packageBoost.ts's `isProducer`
// params for the untap/blink/exile/extra-combat visibility boosts) so this
// module doesn't need a value import from tagger/client.ts; undefined
// (the common case — every deck whose plan isn't board-centric) is a no-op.
// Bounded by construction: only fires when both candidates already share the
// 'boardwipe' role (never reorders across roles or touches a non-wipe card),
// and only when their one-sidedness actually differs (two symmetric wipes,
// or two one-sided wipes, fall through to ordinary priority). `decided`
// records only the pairs where this actually flipped the outcome (mirrors
// `priceSanityDecided`) — the build report's "N one-sided wipes preferred".
export function wipeAsymmetryTieBreak(
  a: EDHRECCard,
  b: EDHRECCard,
  cardMap: Map<string, ScryfallCard>,
  cardRoleMap: Map<string, RoleKey> | undefined,
  isOneSidedWipe: ((card: ScryfallCard) => boolean) | undefined,
  decided?: Set<string>
): number {
  if (!isOneSidedWipe || !cardRoleMap) return 0;
  if (cardRoleMap.get(a.name) !== 'boardwipe' || cardRoleMap.get(b.name) !== 'boardwipe') return 0;

  const cardA = cardMap.get(a.name);
  const cardB = cardMap.get(b.name);
  if (!cardA || !cardB) return 0;

  const oneSidedA = isOneSidedWipe(cardA);
  const oneSidedB = isOneSidedWipe(cardB);
  if (oneSidedA === oneSidedB) return 0;

  decided?.add([a.name, b.name].sort().join('|'));
  return oneSidedA ? -1 : 1;
}

// E112 own-board scope-collateral preference: among two boardwipe-role
// candidates that tied on wipeAsymmetryTieBreak above (both symmetric, or
// both already one-sided), prefer whichever destroys/exiles less of the
// deck's OWN non-creature permanent mass. Creatures are expected collateral
// for nearly every wrath — the mismatch that actually hurts a plan is a wipe
// that ALSO nukes the non-creature type the deck is heavy in (an
// enchantress deck's own enchantments, an artifact deck's own rocks). Not
// gated on the board-centric preference (unlike wipeAsymmetryTieBreak) — see
// getWipeScope's doc field in RoleCapConfig above for why this is a
// separate, always-on axis. `getWipeScope` already returns the empty scope
// for a one-sided wipe, so this naturally scores it as zero collateral
// without re-deriving that check here.
// Exported for reuse: phaseRoleSurplusRebalance.ts's post-fill eviction
// ordering needs the SAME collateral signal this comparator uses at pick
// time (E112/E113 unification) — a low-collateral wipe shouldn't win the
// pick-time slot only to be the first one evicted afterward on a signal
// that ignores collateral entirely.
export function wipeOwnBoardCollateral(
  card: ScryfallCard,
  getWipeScope: (card: ScryfallCard) => WipeScope,
  deckTypeTargets: Record<string, number>
): number {
  const scope = getWipeScope(card);
  const nonLandTotal = Object.values(deckTypeTargets).reduce((sum, v) => sum + v, 0) || 1;
  const enchantmentShare = (deckTypeTargets.enchantment ?? 0) / nonLandTotal;
  const artifactShare = (deckTypeTargets.artifact ?? 0) / nonLandTotal;
  let collateral = 0;
  if (scope.all || scope.enchantments) collateral += enchantmentShare;
  if (scope.all || scope.artifacts) collateral += artifactShare;
  return collateral;
}

// Exported for reuse: phaseRoleSurplusRebalance.ts folds this into its
// post-fill eviction/replacement scoring for the boardwipe role specifically
// (E112/E113 coordination fix). Root cause of the sythis/krenko regressions
// this closes: wipeAsymmetryTieBreak/wipeScopeCollateralTieBreak above only
// ever run when two boardwipe candidates are DIRECTLY compared in the SAME
// pickFromPrefetchedWithCurve sort — they're silent once a wipe's fate is
// decided by rationing elsewhere (the role-cap escape hatch admitting all of
// them at pick time, then this pass's priority-only survival/replacement
// scoring deciding which one survives). The same asymmetry+collateral
// signal has to govern that decision too, or a low-quality high-inclusion
// wipe (a splashy modal sweeper) can win the pick-time slot on raw priority
// and then never get evicted because eviction ranking never looked at
// quality at all.
//
// Deliberately NOT a capped nudge (packageBoost.ts's ~15-30 range) — same
// "has to actually win the slot" rationale as wipeAsymmetryTieBreak's own doc.
// Both quality axes are TIERS that dominate calculateCardPriority's ~0-250
// range (plus a ~30 lift boost), so raw popularity can never keep a worse wipe:
//  - asymmetry: a symmetric wipe is always worse to keep than a one-sided one
//    (WIPE_QUALITY_SYMMETRIC_PENALTY).
//  - own-board collateral: a wipe that ALSO nukes the deck's own enchantments /
//    artifacts is always worse to keep than a clean same-asymmetry wipe. This
//    MUST be a tier too, not a small scaled nudge — a splashy modal sweeper
//    (Farewell, 16-26% incl) out-includes a clean Wrath (10%) by more than a
//    share-scaled penalty could ever cover, so it would survive on raw
//    popularity (the E103 "a small nudge can't close a 20-40pt inclusion gap"
//    lesson, learned again the hard way in iter-15 r3). So any nonzero
//    collateral clears a flat BASE tier at once, then a share-scaled term
//    orders collateral-bearing wipes among themselves (more own-board mass
//    threatened = worse).
export const WIPE_QUALITY_SYMMETRIC_PENALTY = 1000;
export const WIPE_QUALITY_COLLATERAL_BASE = 400;
export const WIPE_QUALITY_COLLATERAL_SCALE = 200;

export function wipeQualityPenalty(
  card: ScryfallCard,
  isOneSidedWipe: (card: ScryfallCard) => boolean,
  getWipeScope: (card: ScryfallCard) => WipeScope,
  deckTypeTargets: Record<string, number> | undefined
): number {
  let penalty = isOneSidedWipe(card) ? 0 : WIPE_QUALITY_SYMMETRIC_PENALTY;
  if (deckTypeTargets) {
    const collateral = wipeOwnBoardCollateral(card, getWipeScope, deckTypeTargets);
    if (collateral > 0) {
      penalty += WIPE_QUALITY_COLLATERAL_BASE + collateral * WIPE_QUALITY_COLLATERAL_SCALE;
    }
  }
  return penalty;
}

export function wipeScopeCollateralTieBreak(
  a: EDHRECCard,
  b: EDHRECCard,
  cardMap: Map<string, ScryfallCard>,
  cardRoleMap: Map<string, RoleKey> | undefined,
  getWipeScope: ((card: ScryfallCard) => WipeScope) | undefined,
  deckTypeTargets: Record<string, number> | undefined
): number {
  if (!getWipeScope || !cardRoleMap || !deckTypeTargets) return 0;
  if (cardRoleMap.get(a.name) !== 'boardwipe' || cardRoleMap.get(b.name) !== 'boardwipe') return 0;

  const cardA = cardMap.get(a.name);
  const cardB = cardMap.get(b.name);
  if (!cardA || !cardB) return 0;

  const collateralA = wipeOwnBoardCollateral(cardA, getWipeScope, deckTypeTargets);
  const collateralB = wipeOwnBoardCollateral(cardB, getWipeScope, deckTypeTargets);
  if (collateralA === collateralB) return 0;
  return collateralA < collateralB ? -1 : 1;
}
