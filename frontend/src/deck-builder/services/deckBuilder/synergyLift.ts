// EDHREC synergy read as a RATIO, not a subtraction (E510). Pure — no I/O.
//
// EDHREC's `synergy` is a difference of two play rates:
//
//   synergy = (share of THIS page's decks playing the card)
//           − (share of decks in the page's colour identity playing it)
//
// Our parsed EDHRECCard carries the first as `inclusion` (a PERCENT, 0-100)
// and the difference as `synergy` (a FRACTION: 0.75 = +75 points), so the
// colour-identity baseline is already on every row:
//
//   baselinePct = inclusion − synergy × 100
//
// That holds for every page kind we read: a commander page, a partner-pair
// page and a commander×theme page all measure against the decks sharing that
// page's colour identity (a theme page's own decks are the numerator; the
// colours' decks are still the baseline).
//
// A subtraction buries commander-specific cards. 40% here vs 20% in the
// colours reads +20 (twice as played), and outranks 12% vs 1% at +11 (twelve
// times as played). The ratio (lift) says which card this commander actually
// asks for. Three problems with a raw ratio, and what this module does:
//
// 1. Thin samples. A page with 15 decks can show 3/15 = 20% for a card the
//    colours play at 2%: a lift of 10 from three decks. The commander rate is
//    shrunk toward the baseline with a beta prior worth SYNERGY_PRIOR_DECKS
//    decks (see its comment for the derivation):
//
//      shrunkPct = (N × inclusion + α × baselinePct) / (N + α)
//
//    where N is the card's `potential_decks` (decks on this page that could
//    play it). Large pages barely move (N=22,305: 0.04%); a 15-deck page
//    keeps 75% of its own evidence.
//
// 2. Baselines near zero. A card the colours almost never play has a lift
//    that explodes on noise (1 deck / 0.1%). The baseline is floored at
//    BASELINE_FLOOR_PCT, the level EDHREC's own lists bottom out at, so the
//    ratio stops measuring "how obscure" below it.
//
// 3. Irrelevance. A card 3% of this commander's decks play, against a 0.3%
//    baseline, has a big ratio and nobody plays it. That is the exact failure
//    that killed Hyper Focus (E230): it promoted the least-played cards.
//
// Two readings come out of the shrunk ratio, for two jobs:
//
//   score    = support × log2(lift),  support = min(1, shrunkPct / 10%)
//   strength = (shrunkPct / 100) × log2(lift)
//
// `score` RANKS (calculateCardPriority, the hidden-gem tail, the Coach gap
// pick). Once a card is in at least SUPPORT_FULL_PCT of the commander's decks
// it is a real choice of that player base, and it ranks by its ratio alone:
// 12% vs 1% (log2 12 = 3.6) now clearly outranks 40% vs 20% (log2 2 = 1).
// Below that play rate the ratio is scaled down linearly, so a 3%-played card
// can't ride a big ratio past real cards (the Hyper Focus guard).
//
// `strength` DEFINES a signature card (isSignatureSynergy). It is the card's
// term of the KL divergence between the commander's card distribution and its
// colours', "played a lot AND played far more than the colours", the same
// rate × lift shape as the validated E71 card-page lift score (liftSynergy.ts
// edgeScore). It can't rank for the promote job: it reads 12% vs 1% (0.43)
// and 40% vs 20% (0.40) as equals.
//
// Both are negative when the commander's players avoid a card (lift < 1) and
// zero at lift 1.
//
// Worked values from live EDHREC rows (Meren of Clan Nel Toth, 22,305 decks):
//   Spore Frog          75.6% vs  5.5%  lift 13.8   score 3.79  strength 2.86
//   Grim Haruspex       49.4% vs  3.7%  lift 13.3   score 3.74  strength 1.85
//   Sakura-Tribe Elder  83.0% vs 28.3%  lift  2.9   score 1.55  strength 1.29
//   Blood Artist        54.5% vs 21.1%  lift  2.6   score 1.37  strength 0.75
//   Heroic Intervention 17.0% vs 32.1%  lift  0.53  score −0.92 strength −0.16
import type { EDHRECCard } from '@/deck-builder/types';

/**
 * Pseudo-count α of the beta prior that pulls a page's play rate toward its
 * colours' rate: the prior is worth α decks of "this commander plays it like
 * its colours do".
 *
 * Derived by simulation over the 90 EDHREC pages cached by the LIVE_GEN
 * panels (23,595 card rows, 2026-09-29), scratchpad scripts alpha-sim*.mjs:
 *
 * 1. Every card on a page with ≥ 5,000 decks (9,218 cards, whose observed
 *    rate is the true rate to within about a point) was resampled as if its
 *    page had only 10, 25, 50, 100, 250 or 1,000 decks, shrunk with α, and
 *    scored against the truth. Mean squared error of `strength`, summed
 *    across the six sizes, relative to α=50:
 *
 *      α:     0     2     5    10    15    20    30    50    75   100
 *           2.04  1.82  1.82  2.11  2.53  2.99  3.95  6.00  8.71 11.51
 *
 *    (log2(lift) bottoms out at α=5 too.) Commanders genuinely differ from
 *    their colours (the method-of-moments between-commander spread gives a
 *    Bühlmann k ≈ 12 at the median card), so heavy shrinkage throws away
 *    real signal.
 * 2. A thin page LISTS a card because it was seen, so its rows carry a
 *    winner's curse the first simulation can't see. Modelled explicitly: 1,500
 *    noise cards per page played exactly at their colours' rate (0.2-3%,
 *    below a big page's list cutoff), resampled with the real cards, kept
 *    only when seen (k ≥ 1). α=5 still has the lowest strength error at 8,
 *    15, 60 and 150 decks (ties α=2 at 30), and reads 0.02% of the listed
 *    noise as a signature card at 8 decks (0% from 15 up), while it recovers
 *    50% of the true signature cards at 8 decks against 24% at α=10.
 *
 * So α=5: a 15-deck page keeps 75% of its own evidence, a 300-deck page 98%.
 *
 * (The E71 lift constant LIFT_CONFIDENCE_K = 50 is a different quantity, a
 * co-play edge's confidence weight, and is not reused here: at 50 this
 * prior's error is 3× the optimum.)
 */
export const SYNERGY_PRIOR_DECKS = 5;

/** Floor on the colour-identity baseline, in percent. EDHREC's commander
 *  lists bottom out near 1-5% inclusion; below 1% a baseline is "the colours
 *  don't play it", and dividing by 0.1% vs 0.9% measures obscurity, not fit. */
export const BASELINE_FLOOR_PCT = 1;

/**
 * Play rate (percent of the commander's decks, shrunk) at which a card's
 * ratio counts in full for ranking. The same 10% the hidden-gem surface
 * already uses as its line between a real choice and the low-inclusion tail
 * (hiddenGems.ts GEM_INCLUSION_CEILING); below it `score` scales linearly
 * with play rate, which below the line is `strength` × 10 exactly.
 */
export const SUPPORT_FULL_PCT = 10;

/**
 * The old signature bar, EDHREC synergy above +0.3 (30 points more played
 * than in the colours). Kept as half of the signature test so nothing it
 * marked drops out, and calculateCardPriority keeps its old priority as a
 * floor for these cards.
 */
export const LEGACY_SIGNATURE_SYNERGY = 0.3;

/**
 * The ratio half of the signature test: strength at or above this, with the
 * commander playing the card at least twice as often as its colours. It ADDS
 * the specific cards a subtraction under-reads (Overgrowth in Sythis, 32% vs
 * 3.7%, +0.28; Pestilence Rats in Karumonix, 31% vs 1.8%, +0.29). 0.9 is the
 * bar that, on its own, would keep the signature set the size of the old one
 * (2,820 rows vs 2,648 over the 90 cached pages); unioned with the old bar the
 * tier grows by the 480 rows only the ratio sees.
 */
export const SIGNATURE_STRENGTH = 0.9;
/** A ratio-signature card is played at least twice as often as in its colours. */
export const SIGNATURE_MIN_LIFT = 2;

/**
 * Anti-synergy: the commander's players avoid a card its colours usually
 * play. Both bars, deliberately conservative:
 *  - lift ≤ 0.5: played at half the colours' rate or less, the mirror of the
 *    signature bar's doubling (log2 lift ≤ −1). The shrinkage above already
 *    pulls a thin page's rates toward lift 1, so a small page has to show a
 *    real gap to cross it.
 *  - baseline ≥ 15%: the colours genuinely play it. Below that, halving a
 *    niche card's rate is a few decks and says nothing about avoidance.
 * Over the 90 cached pages this flags 740 of 23,595 rows (3.1%), e.g. Llanowar
 * Elves and Cultivate in Sythis (enchantress ramp instead), Mind Stone in
 * Yuriko, Path of Ancestry in Meren.
 */
export const ANTI_SYNERGY_MAX_LIFT = 0.5;
export const ANTI_SYNERGY_MIN_BASELINE_PCT = 15;

/** The fields a reading needs. A gap-analysis or other derived row that
 *  carries only inclusion + synergy reads unshrunk (no sample size). */
export type SynergyFields = Pick<EDHRECCard, 'inclusion' | 'synergy'> & {
  num_decks?: number;
  potential_decks?: number;
};

export interface SynergyReading {
  /** This page's play rate, percent (EDHREC's inclusion, clamped to 0-100). */
  commanderPct: number;
  /** The colour-identity play rate, percent, floored at BASELINE_FLOOR_PCT. */
  baselinePct: number;
  /** Decks the commander rate is measured over; null when the row doesn't say. */
  sampleDecks: number | null;
  /** commanderPct shrunk toward baselinePct by SYNERGY_PRIOR_DECKS. */
  shrunkPct: number;
  /** shrunkPct / baselinePct. 1 = plays it like its colours. */
  lift: number;
  /** min(1, shrunkPct / SUPPORT_FULL_PCT) × log2(lift): the ranking signal. */
  score: number;
  /** (shrunkPct / 100) × log2(lift): the signature test's signal. */
  strength: number;
}

/**
 * The deck count behind a row's play rate. `potential_decks` when EDHREC
 * sent it; otherwise recovered from `num_decks` and the percent (they are the
 * same ratio). Null when neither is available (rows the app synthesizes, not
 * EDHREC), and those are read unshrunk: there is no sample size to weigh.
 */
function sampleDecksOf(card: SynergyFields): number | null {
  if (card.potential_decks && card.potential_decks > 0) return card.potential_decks;
  if (card.num_decks && card.num_decks > 0 && card.inclusion > 0) {
    return (card.num_decks * 100) / card.inclusion;
  }
  return null;
}

/**
 * Read a row's synergy as a ratio. Null when the row carries no synergy (a
 * synthesized pool row, a fallback card), which every caller treats as "no
 * evidence either way" (score 0, lift 1).
 */
export function readSynergy(card: SynergyFields): SynergyReading | null {
  const synergy = card.synergy;
  if (synergy == null || !Number.isFinite(synergy) || !Number.isFinite(card.inclusion)) {
    return null;
  }
  const commanderPct = Math.min(100, Math.max(0, card.inclusion));
  const baselinePct = Math.min(100, Math.max(BASELINE_FLOOR_PCT, commanderPct - synergy * 100));
  const sampleDecks = sampleDecksOf(card);
  const shrunkPct =
    sampleDecks == null
      ? commanderPct
      : (sampleDecks * commanderPct + SYNERGY_PRIOR_DECKS * baselinePct) /
        (sampleDecks + SYNERGY_PRIOR_DECKS);
  // shrunkPct can only be 0 when the row itself says 0% and there's no
  // sample to shrink with; log2(0) would be −∞, so read that as "not played"
  // (score and strength 0): a 0% row has nothing to rank.
  if (shrunkPct <= 0) {
    return {
      commanderPct,
      baselinePct,
      sampleDecks,
      shrunkPct: 0,
      lift: 0,
      score: 0,
      strength: 0,
    };
  }
  const lift = shrunkPct / baselinePct;
  const bits = Math.log2(lift);
  const score = Math.min(1, shrunkPct / SUPPORT_FULL_PCT) * bits;
  const strength = (shrunkPct / 100) * bits;
  return { commanderPct, baselinePct, sampleDecks, shrunkPct, lift, score, strength };
}

/** The ranking signal alone; 0 when the row carries no synergy. */
export function synergyScore(card: SynergyFields): number {
  return readSynergy(card)?.score ?? 0;
}

/**
 * The shared "signature card" predicate: the one definition behind every
 * place that used to ask `synergy > 0.3` (the generator's high-synergy tier,
 * Brew's theme slot, Coach's lift seeds). A UNION, so it only ever adds:
 * the old bar, or the ratio test.
 */
export function isSignatureSynergy(card: SynergyFields): boolean {
  if ((card.synergy ?? 0) > LEGACY_SIGNATURE_SYNERGY) return true;
  const r = readSynergy(card);
  return r != null && r.strength >= SIGNATURE_STRENGTH && r.lift >= SIGNATURE_MIN_LIFT;
}

/** The commander's players avoid a card its colours usually play. */
export function isAntiSynergy(card: SynergyFields): boolean {
  const r = readSynergy(card);
  return (
    r != null && r.lift <= ANTI_SYNERGY_MAX_LIFT && r.baselinePct >= ANTI_SYNERGY_MIN_BASELINE_PCT
  );
}

/** Descending-score comparator for synergy-ordered lists. */
export function bySynergyScore(a: SynergyFields, b: SynergyFields): number {
  return synergyScore(b) - synergyScore(a);
}
