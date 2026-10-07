/**
 * Substitute ranking v2 (E517): a linear score over the role-conditioned
 * features in features.ts, plus a bounded deck-context term.
 *
 * FOR THE SUGGESTION SURFACES ONLY: the collection lane's owned alternatives
 * (`buildSubstitutionOptions`) and the card preview's Swap / Similar cards
 * strips. Deck generation keeps its validated greedy `buildSubstitutionPlan`
 * and its own weights; nothing in the generator imports this module.
 */
import type { CardFacts } from '../cardFacts/schema';
import { deckFit, type DeckFit, type DeckProfile } from './deckContext';
import {
  FEATURES,
  pairFeatures,
  primaryRole,
  type FeatureSources,
  type FeatureVector,
  type PairEvidence,
  type SubstituteRole,
} from './features';

export type SubstituteWeights = Record<(typeof FEATURES)[number], number>;

/**
 * FITTED, not hand-tuned: `node scripts/substitute-eval.mjs --fit` prints
 * them. A pairwise logistic ranker (L2, λ picked by leave-one-role-out) over
 * the hand-graded judgments in cardFacts/substitutes.fixtures.ts and
 * ./judgments.fixtures.ts, plus 30 random cards per query as grade 0, with
 * every weight held to its sign (a similarity feature can only raise a score,
 * a polarity clash only lower it). The constraint zeroes two: cardTags
 * (collinear with roleTags) and polarity (it never fired in any ranker's top
 * five; roleStrength already rejects the false friends it would catch, and
 * reasons.ts still names a clash as a con).
 *
 * Held out, leave-one-role-out (2026-09-29; 80 queries, lane B's 89 rows plus
 * 1,417 pooled judgments; 95% intervals resampled over query families):
 *   Similar cards  nDCG@5 0.144 (v1) → 0.827, Δ +0.68 [+0.59, +0.76]
 *   owned lane     nDCG@5 0.756 (v1) → 0.788, Δ +0.03 [-0.04, +0.13]; v1 already
 *                  led with EDHREC's similar lists. nDCG@10 +0.08 [+0.00, +0.17]
 *   cold start     both without EDHREC's lists: +0.23 [+0.11, +0.36]
 * EDHREC similar is the strongest single signal (-0.26 without it), then role
 * strength (-0.03) and structure (-0.02). Re-fit after regenerating
 * card-facts.json or adding judgments (`--fit` says when this table is
 * stale); never hand-edit a number.
 *
 * `narrowing` is the one weight that is NOT fitted (E517 slice 2): a penalty
 * for a substitute that hits less of the board than the card it replaces
 * (Plummet's "with flying" for Murder), read from the extractor's object
 * filters. Fitting it moved every other weight; fixed, it changes nothing for
 * a card with no filter. Held out, on the weights above: nDCG@5 0.790 → 0.794
 * owned lane, 0.827 → 0.831 Similar cards, no metric lower. The grid -4 … -8 is
 * one plateau (-1 … -3 sit within 0.002 under it), so -4 is the smallest weight
 * on it.
 */
export const SUBSTITUTE_WEIGHTS: SubstituteWeights = {
  roleTags: 0.8021,
  cardTags: 0,
  sameEffect: 0.3396,
  polarity: 0,
  interaction: 1.9932,
  narrowing: -4,
  roleStrength: 3.3748,
  mv: 0.536,
  type: 1.1132,
  edhrec: 5.2912,
  taggerRole: 0.3818,
  taggerSub: 0.7106,
  taggerTags: 1.5807,
};

/**
 * The deck-context term (deckContext.ts, fit in 0..1): half the median score
 * gap between a query's grade-3 and grade-2 substitutes, so a deck that feeds
 * a card reorders it within its grade but never lifts it over a better one.
 * The judgments carry no deck, so this is derived, not fitted.
 */
export const DECK_FIT_WEIGHT = 0.9446;

/**
 * The Similar cards strip drops a card scoring under this: the 5th percentile
 * of real substitutes' scores (grade 2-3), which drops 97% of grade-0 cards.
 */
export const SIMILAR_FLOOR = 6.1294;

export function linearScore(x: FeatureVector, w: SubstituteWeights = SUBSTITUTE_WEIGHTS): number {
  let s = 0;
  for (const f of FEATURES) s += w[f] * x[f];
  return s;
}

export interface SubstituteScore {
  /** Total: function similarity plus the deck-context term. Only its order is meaningful. */
  score: number;
  /** The role the query was conditioned on (null: whole cards). */
  role: SubstituteRole | null;
  x: FeatureVector;
  evidence: PairEvidence;
  deck: DeckFit | null;
}

export interface ScoreOptions {
  /** The role the query card is being replaced as; defaults to its primary role. */
  role?: SubstituteRole | null;
  /** The deck the substitute goes into, for the context term. */
  deck?: DeckProfile | null;
  weights?: SubstituteWeights;
}

/** Score C as a substitute for Q. */
export function scoreSubstitute(
  q: CardFacts,
  c: CardFacts,
  src: FeatureSources,
  opts: ScoreOptions = {}
): SubstituteScore {
  const role = opts.role === undefined ? primaryRole(q) : opts.role;
  const { x, evidence } = pairFeatures(q, c, role ?? '', src);
  const fit = opts.deck ? deckFit(c, opts.deck) : null;
  const score = linearScore(x, opts.weights) + (fit ? DECK_FIT_WEIGHT * fit.fit : 0);
  return { score, role, x, evidence, deck: fit };
}
