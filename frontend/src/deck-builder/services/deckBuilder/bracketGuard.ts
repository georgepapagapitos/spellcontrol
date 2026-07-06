// Bracket band guardrail for generation: turns the estimator's per-card FLOOR
// signals (Game Changers, mass land denial, extra turns, stax) into pick-time
// ceilings derived from the user's target bracket, so a deck lands in-band BY
// CONSTRUCTION instead of overshooting and being patched by the post-gen
// bracketFit coach.
//
// Scope: only the per-card floors with no cross-card dependency. The 2-card
// combo floor is deliberately NOT handled here — generation actively boosts
// toward combos and a post-pick combo audit re-assembles them, so enforcing
// that floor needs combo-boost + audit suppression (a separate change).
//
// Ceilings come straight from bracketEstimator's floor thresholds:
//   Game Changers: 1+ -> B3, 4+ -> B4
//   Mass land denial: 1+ -> B4
//   Extra turns: 3+ -> B3
//   Stax: 3+ -> B3, 5+ -> B4
// so to stay at/below target N we cap each signal at the largest count that
// doesn't trip the next floor.
import type { TargetBracket } from '@/deck-builder/types';
import { isStaxPiece, isMassLandDenialFloor, isGameChangerCard } from './bracketEstimator';
import { isExtraTurn } from '@/deck-builder/services/tagger/client';

export interface BracketCeilings {
  gameChangers: number;
  massLandDenial: number;
  extraTurns: number;
  stax: number;
}

// `undefined`/`'all'` (no target picked) => no guardrail (all Infinity).
export function bracketCeilings(target: TargetBracket | undefined): BracketCeilings {
  if (target === undefined || target === 'all') {
    return {
      gameChangers: Infinity,
      massLandDenial: Infinity,
      extraTurns: Infinity,
      stax: Infinity,
    };
  }
  return {
    // 1 GC already forces B3, so B<=2 allows none; B3 allows up to 3 (4 -> B4).
    gameChangers: target <= 2 ? 0 : target === 3 ? 3 : Infinity,
    // Any MLD forces B4, so anything below B4 allows none.
    massLandDenial: target <= 3 ? 0 : Infinity,
    // 3 extra-turn cards force B3, so B<=2 allows at most 2.
    extraTurns: target <= 2 ? 2 : Infinity,
    // 3 stax -> B3, 5 stax -> B4. B<=2 allows 2; B3 allows 4.
    stax: target <= 2 ? 2 : target === 3 ? 4 : Infinity,
  };
}

// True when no ceiling is finite — i.e. the guard would never skip anything, so
// callers can skip constructing/passing it.
export function ceilingsAreOpen(c: BracketCeilings): boolean {
  return (
    c.gameChangers === Infinity &&
    c.massLandDenial === Infinity &&
    c.extraTurns === Infinity &&
    c.stax === Infinity
  );
}

// Tracks how many of each floor-triggering card have been picked so far and
// answers "would picking this one cross a ceiling?". Shared across all picking
// phases (like the gameChangerCount ref) so counts accumulate over the build.
//
// A card is gated under the first category it matches (GC > MLD > extra > stax);
// the rare card matching two floor lists counts once. This is a guardrail, not
// the post-gen estimate — the estimate (which counts every list) still runs and
// surfaces any residual drift.
export class BracketGuard {
  private counts = { gameChangers: 0, massLandDenial: 0, extraTurns: 0, stax: 0 };

  constructor(
    private readonly ceilings: BracketCeilings,
    private readonly gameChangerNames: Set<string>
  ) {}

  private category(name: string): keyof BracketCeilings | null {
    if (isGameChangerCard(name, this.gameChangerNames)) return 'gameChangers';
    if (isMassLandDenialFloor(name)) return 'massLandDenial';
    if (isExtraTurn(name)) return 'extraTurns';
    if (isStaxPiece(name)) return 'stax';
    return null;
  }

  // Would adding `name` push its signal past the target-bracket ceiling?
  exceedsCeiling(name: string): boolean {
    const cat = this.category(name);
    return cat !== null && this.counts[cat] >= this.ceilings[cat];
  }

  // Record an accepted card so later picks see the updated running count.
  record(name: string): void {
    const cat = this.category(name);
    if (cat !== null) this.counts[cat]++;
  }

  // Independent copy with the same ceilings/counts so far — for a caller
  // that needs to test a large batch of candidates against the current
  // picture without committing real `.record()`s for the (usually most of
  // them) it doesn't end up keeping (e.g. the land-squeeze wildcard scan).
  clone(): BracketGuard {
    const copy = new BracketGuard(this.ceilings, this.gameChangerNames);
    copy.counts = { ...this.counts };
    return copy;
  }
}
