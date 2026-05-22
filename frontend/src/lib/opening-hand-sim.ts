/**
 * Monte-Carlo opening-hand statistics.
 *
 * `DeckTestHandPanel` deals exactly one hand and renders a single verdict.
 * This module runs many hands and reports a distribution so the user can see
 * "how often is this deck's opener actually keepable" rather than judging from
 * one lucky/unlucky draw.
 *
 * The simulator is intentionally decoupled from `ScryfallCard` — callers
 * classify their cards down to `SimCard` (land flag, mana value, deck role)
 * once, then hand the flat array in. That keeps this file pure, fast, and
 * trivially unit-testable against the `src/lib/**` coverage gate.
 */

import { mulberry32, shuffle } from './playtest/rng';

/** A card reduced to just the fields the opening-hand heuristics need. */
export interface SimCard {
  isLand: boolean;
  /** Converted mana cost. Lands are 0; only consulted for non-lands. */
  cmc: number;
  /** Deck role from the tagger, or null when unclassified / data not loaded. */
  role: 'ramp' | 'removal' | 'boardwipe' | 'cardDraw' | null;
  /**
   * Colour-identity letters (subset of W/U/B/R/G). Empty = colourless.
   * Only consulted for lands, to colour the land-count histogram.
   */
  colors: string[];
}

export interface SimOptions {
  /** Hands to simulate. Default 1000 — enough to stabilise rates to ~±1.5%. */
  iterations?: number;
  /** Cards per opening hand. Default 7. */
  handSize?: number;
  /**
   * How many London mulligans to allow when computing `keepableWithinMulligans`.
   * Default 2 (i.e. keep, or mull once, or mull twice).
   */
  mulliganDepth?: number;
  /** Seed for the PRNG. Omit for a fresh random run; pass a fixed value in tests. */
  seed?: number;
}

export interface SimResult {
  iterations: number;
  handSize: number;
  /** Histogram of land counts: index = lands in the opening hand, value = hand count. */
  landHistogram: number[];
  /**
   * Per land-count bucket, the aggregate colour breakdown of the lands across
   * every hand in that bucket. `landColorByCount[3] = { G: 412, C: 88 }` means
   * the simulated 3-land hands contained 412 green land-shares and 88
   * colourless ones. A multi-colour land adds one share to each of its
   * colours (mirrors the stats-panel mana curve). Keyed W/U/B/R/G plus `C`.
   */
  landColorByCount: Record<number, Record<string, number>>;
  /** Mean lands in the opening (pre-mulligan) hand. */
  avgLands: number;
  /** Fraction of pre-mulligan hands that pass the keep heuristic. */
  keepableRate: number;
  /**
   * Fraction of iterations where the opener — or one of the next
   * `mulliganDepth` fresh sevens — was keepable. Approximates the London
   * mulligan: it ignores that bottoming N cards weakens the kept hand, so
   * treat it as an upper bound on "I can find a hand to keep".
   */
  keepableWithinMulligansRate: number;
  /** Fraction of openers holding at least one ramp card. */
  rampRate: number;
  /** Fraction of openers with <= 1 land (mana screw). */
  screwRate: number;
  /** Fraction of openers with >= 5 lands (mana flood). */
  floodRate: number;
}

/**
 * The keep heuristic, shared with `DeckTestHandPanel` so the single-hand
 * verdict and the simulated rate never disagree.
 *
 * Ramp counts as a mana source — a "1 land + 2 rocks + a real play" hand is a
 * clear keep that the naive "2-4 lands" rule would wrongly mulligan. Three
 * conditions, all required:
 *   1. Effective mana sources (lands + ramp) is 2-4 — not screwed, not flooded.
 *   2. At least one non-land castable by turn 3 (CMC <= 3) — something to do.
 */
export function isKeepableHand(hand: readonly SimCard[]): boolean {
  let lands = 0;
  let ramp = 0;
  let hasEarlyPlay = false;
  for (const c of hand) {
    if (c.isLand) {
      lands += 1;
      continue;
    }
    if (c.role === 'ramp') ramp += 1;
    if (c.cmc <= 3) hasEarlyPlay = true;
  }
  const effective = lands + ramp;
  return effective >= 2 && effective <= 4 && hasEarlyPlay;
}

/** Run the opening-hand simulation. Pure given `opts.seed`. */
export function simulateOpeningHands(
  library: readonly SimCard[],
  opts: SimOptions = {}
): SimResult {
  const iterations = Math.max(1, Math.floor(opts.iterations ?? 1000));
  const handSize = Math.max(1, Math.floor(opts.handSize ?? 7));
  const mulliganDepth = Math.max(0, Math.floor(opts.mulliganDepth ?? 2));
  const rand = mulberry32(opts.seed ?? (Math.random() * 0xffffffff) >>> 0);

  const landHistogram = new Array<number>(handSize + 1).fill(0);
  const landColorByCount: Record<number, Record<string, number>> = {};
  let landSum = 0;
  let keepable = 0;
  let keepableWithinMulligans = 0;
  let withRamp = 0;
  let screw = 0;
  let flood = 0;

  // A library smaller than a hand can't produce a meaningful opener; bail with
  // a zeroed result rather than looping on a degenerate draw.
  const drawable = library.length >= handSize;

  for (let i = 0; i < iterations && drawable; i++) {
    // The pre-mulligan opening hand — every distribution stat is measured here.
    const opener = shuffle(library, rand).slice(0, handSize);

    let lands = 0;
    let ramp = 0;
    for (const c of opener) {
      if (c.isLand) lands += 1;
      else if (c.role === 'ramp') ramp += 1;
    }
    landHistogram[lands] += 1;
    landSum += lands;

    // Tally the colour identity of this hand's lands into its land-count
    // bucket. A multi-colour land contributes one share per colour; a
    // colourless land contributes one `C` share.
    const colorBucket = (landColorByCount[lands] ??= {});
    for (const c of opener) {
      if (!c.isLand) continue;
      const keys = c.colors.length > 0 ? c.colors : ['C'];
      for (const k of keys) colorBucket[k] = (colorBucket[k] ?? 0) + 1;
    }
    if (ramp > 0) withRamp += 1;
    if (lands <= 1) screw += 1;
    if (lands >= 5) flood += 1;

    const openerKeepable = isKeepableHand(opener);
    if (openerKeepable) keepable += 1;

    // London mulligan: redraw fresh sevens until one is keepable or we run out
    // of allowed mulligans. Each redraw is an independent shuffle.
    let foundKeep = openerKeepable;
    for (let m = 0; m < mulliganDepth && !foundKeep; m++) {
      foundKeep = isKeepableHand(shuffle(library, rand).slice(0, handSize));
    }
    if (foundKeep) keepableWithinMulligans += 1;
  }

  const denom = drawable ? iterations : 1;
  return {
    iterations,
    handSize,
    landHistogram,
    landColorByCount,
    avgLands: drawable ? landSum / iterations : 0,
    keepableRate: keepable / denom,
    keepableWithinMulligansRate: keepableWithinMulligans / denom,
    rampRate: withRamp / denom,
    screwRate: screw / denom,
    floodRate: flood / denom,
  };
}
