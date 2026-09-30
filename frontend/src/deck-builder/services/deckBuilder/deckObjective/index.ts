/**
 * The whole-deck objective (E513, first slice): ONE explicit score for a
 * finished card list, with hard constraints kept apart, so a later local
 * search can seed from the current generator and judge every 1:1 / 2:2 swap
 * against the whole deck instead of through ~25 sequential repair phases.
 *
 * WHY. Two composition changes failed their ship gates on 2026-09-29 for the
 * same structural reason (E509 collection sourcing 12/28 regressed, E510
 * synergy ratio 12/31): a local priority change is zero-sum against finite
 * slots, and the later repair phases redistribute the displacement onto
 * premium cards (Path to Exile, Lightning Greaves, Skullclamp, Grave Pact,
 * Hermit Druid). A score over the whole deck sees the card that left, not
 * only the card that arrived.
 *
 * THIS SLICE builds and validates the score. It is generation-INERT: nothing
 * in the generator calls it.
 *
 * ── Contract ───────────────────────────────────────────────────────────────
 *
 *   const ctx = createObjectiveContext({ colorIdentity, customization, edhrec, roleTargets, ... })
 *   scoreDeck(deck, ctx) → { total, terms, violations, feasible }
 *   compareScores(a, b)  → > 0 when a is the better deck
 *
 * Pure and deterministic: the goldfish uses the context's fixed seed. Every
 * term is in card-equivalents (1 ≈ one solid card slot) and higher is better;
 * penalty terms are negative. `total` is Σ weight × value and is only
 * comparable between decks scored under ONE context (same page, targets,
 * combos, seed). Every nonzero term names the cards behind it
 * (`terms[k].detail.cards`): that is what a "why" factor reads later.
 *
 * ── Terms (terms/*.ts carries each one's formula and constants) ───────────
 *
 *   quality      EDHREC inclusion as a prior; off-page cards read from the
 *                page floor and their global-popularity peers, never as 0.
 *   signature    E510 synergy strength (shrunk ratio lift), apart from quality.
 *   roles        ramp/draw/removal/wipes vs targets, soft saturating both ways.
 *   interaction  answer quality (hits, speed, cost, mode) + protection.
 *   curve        phase shares vs the plan's pacing-aware targets.
 *   mana         goldfish castability, commander on curve, screw, flood.
 *   combos       complete combos from the commander's combo set.
 *   synergy      card-facts producer → payoff matching, commander-weighted.
 *   lift         E71 card-page lift from seeds that are in the deck.
 *   nonbo        hard nonbos and qualified payoffs (coherence audit) and a
 *                graded cost for symmetric wipes on the deck's own board.
 *   winline      finishers and win combos, timed by the assembly clock.
 *   ownership    collection builds: the price bar an unowned card must
 *                clear, plus an owned-card bonus under "Lean on mine".
 *   tutors       each tutor at the best card it can find in this deck.
 *   engines      repeating card draw, apart from one-shot draw.
 *
 * Hard constraints (constraints.ts): size, singleton, identity, legality,
 * bans, must-includes, card price and budget, rarity, Tiny Leaders, Arena,
 * Game Changer limit, bracket ceilings and the combo floor, owned-only and
 * owned-share.
 */
import { checkConstraints } from './constraints';
import { qualityTerm, signatureTerm } from './terms/quality';
import { rolesTerm } from './terms/roles';
import { interactionTerm } from './terms/interaction';
import { curveTerm } from './terms/curve';
import { manaTerm } from './terms/mana';
import { combosTerm } from './terms/combos';
import { liftTerm, synergyTerm } from './terms/synergy';
import { nonboTerm } from './terms/nonbo';
import { winlineTerm } from './terms/winline';
import { ownershipTerm } from './terms/ownership';
import { tutorsTerm } from './terms/tutors';
import { enginesTerm } from './terms/engines';
import { finishTerm, type TermFn } from './terms/shared';
import {
  TERM_KEYS,
  type ObjectiveContext,
  type ObjectiveDeck,
  type ObjectiveScore,
  type TermKey,
  type TermResult,
} from './types';

export * from './types';
export {
  createObjectiveContext,
  defaultFactsOf,
  DEFAULT_SIM_GAMES,
  DEFAULT_SIM_SEED,
  DEFAULT_WEIGHTS,
  toFactsInput,
} from './context';
export { cardIneligibility, checkConstraints, ownedShare } from './constraints';

export const TERMS: Readonly<Record<TermKey, TermFn>> = {
  quality: qualityTerm,
  signature: signatureTerm,
  roles: rolesTerm,
  interaction: interactionTerm,
  curve: curveTerm,
  mana: manaTerm,
  combos: combosTerm,
  synergy: synergyTerm,
  lift: liftTerm,
  nonbo: nonboTerm,
  winline: winlineTerm,
  ownership: ownershipTerm,
  tutors: tutorsTerm,
  engines: enginesTerm,
};

/** Score a deck under a context. See the header for the contract. */
export function scoreDeck(deck: ObjectiveDeck, ctx: ObjectiveContext): ObjectiveScore {
  const terms = {} as Record<TermKey, TermResult>;
  let total = 0;
  for (const key of TERM_KEYS) {
    const weight = ctx.weights[key];
    // A zero weight skips the work (the goldfish is the expensive term) but
    // still reports the term, so ablations read like any other score.
    const result =
      weight === 0
        ? finishTerm({ value: 0, summary: 'weight 0 (skipped)', cards: [] }, 0)
        : finishTerm(TERMS[key](deck, ctx), weight);
    terms[key] = result;
    total += result.contribution;
  }
  const violations = checkConstraints(deck, ctx);
  return { total, terms, violations, feasible: violations.length === 0 };
}

/** Σ magnitude of a score's hard-constraint violations. */
export function infeasibility(score: ObjectiveScore): number {
  return score.violations.reduce((s, v) => s + v.magnitude, 0);
}

/**
 * Lexicographic: a feasible deck beats an infeasible one; two infeasible
 * decks compare by how far they break (less is better); then by total.
 * Positive when `a` is better.
 */
export function compareScores(a: ObjectiveScore, b: ObjectiveScore): number {
  const ia = infeasibility(a);
  const ib = infeasibility(b);
  if (ia !== ib) return ib - ia;
  return a.total - b.total;
}

/** Per-term contribution deltas (a − b), for prescreens and ablations. */
export function termDeltas(a: ObjectiveScore, b: ObjectiveScore): Record<TermKey, number> {
  const out = {} as Record<TermKey, number>;
  for (const k of TERM_KEYS) out[k] = a.terms[k].contribution - b.terms[k].contribution;
  return out;
}

/** Per-term VALUE deltas (a − b), before weights: what a weight fit reads. */
export function valueDeltas(a: ObjectiveScore, b: ObjectiveScore): Record<TermKey, number> {
  const out = {} as Record<TermKey, number>;
  for (const k of TERM_KEYS) out[k] = a.terms[k].value - b.terms[k].value;
  return out;
}
