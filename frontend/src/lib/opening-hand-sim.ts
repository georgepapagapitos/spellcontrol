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
 * Ramp counts as a mana source, but only when the hand's lands can actually
 * cast it (CMC <= land count) — otherwise a 2-mana rock would paper over a
 * one-land hand it can't even deploy on curve. A 1-mana rock (Sol Ring, etc.)
 * legitimately rescues a one-lander; a 2-mana Signet does not. Three
 * conditions, all required:
 *   1. Effective mana sources (lands + castable ramp) is 2-4 — not screwed,
 *      not flooded.
 *   2. At least one non-land castable by turn 3 (CMC <= 3) — something to do.
 */
export function isKeepableHand(hand: readonly SimCard[]): boolean {
  let lands = 0;
  let hasEarlyPlay = false;
  for (const c of hand) {
    if (c.isLand) lands += 1;
    else if (c.cmc <= 3) hasEarlyPlay = true;
  }
  // Second pass: ramp only counts once the full land total is known, since
  // castability (CMC <= lands) depends on it and card order is arbitrary.
  let castableRamp = 0;
  for (const c of hand) {
    if (!c.isLand && c.role === 'ramp' && c.cmc <= lands) castableRamp += 1;
  }
  const effective = lands + castableRamp;
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

// ── Assembly clock — "typically online by turn N" ───────────────────────────

export interface AssemblyClockOptions {
  /** Runs to simulate. Default 1000, matching `simulateOpeningHands`. */
  iterations?: number;
  /** Cards in the opening hand. Default 7. */
  handSize?: number;
  /** Seed for the PRNG. Omit for a fresh random run; pass a fixed value in tests. */
  seed?: number;
  /**
   * Wildcard card names (tutors): each drawn copy substitutes for one missing
   * piece of whichever option is closest to done. Without these, tutor-reliant
   * decks (combo especially) clock absurdly slow — the raw draw math, but not
   * how the deck actually plays.
   */
  wildcards?: readonly string[];
}

export interface AssemblyClockResult {
  iterations: number;
  /**
   * Median 1-based turn on which the win path assembled — "typically online by
   * turn N". Turn 1 = the opening hand plus the first draw.
   */
  typicalTurn: number;
  /** 90th-percentile turn — 90% of simulated games were online by this turn. */
  p90Turn: number;
}

/**
 * How many turns until the deck's win path is in hand, across many simulated
 * games: shuffle, draw an opening hand, then draw one card per turn until any
 * one `options` entry is satisfied (`need` distinct `names` drawn). Duplicate
 * copies of a name only count once toward `need`.
 *
 * Deliberately a goldfish draw-clock: no tutors, cantrips, or mulligans are
 * modeled, so real games usually assemble sooner — surfaces state this. Options
 * naming cards the library no longer contains (stale persisted analysis after
 * an edit) are dropped; returns null when nothing viable remains.
 *
 * The `options` shape matches `WinCondition.assembly` from the T16 detector,
 * kept structural here so this file stays decoupled from deck-builder types.
 */
export function simulateAssemblyClock(
  libraryNames: readonly string[],
  options: ReadonlyArray<{ names: readonly string[]; need: number }>,
  opts: AssemblyClockOptions = {}
): AssemblyClockResult | null {
  const iterations = Math.max(1, Math.floor(opts.iterations ?? 1000));
  const handSize = Math.max(1, Math.floor(opts.handSize ?? 7));

  const inLibrary = new Set(libraryNames);
  const viable = options
    .map((o) => ({
      names: Array.from(new Set(o.names)).filter((n) => inLibrary.has(n)),
      need: o.need,
    }))
    .filter((o) => o.need <= 0 || o.names.length >= o.need);
  if (viable.length === 0) return null;

  // A zero-need option (e.g. a commander + partner combo — every piece starts
  // in the command zone) is online before the first draw.
  if (viable.some((o) => o.need <= 0)) {
    return { iterations, typicalTurn: 1, p90Turn: 1 };
  }

  // name → indices of the viable options it advances.
  const optionsByName = new Map<string, number[]>();
  viable.forEach((o, i) => {
    for (const n of o.names) {
      const hits = optionsByName.get(n);
      if (hits) hits.push(i);
      else optionsByName.set(n, [i]);
    }
  });

  // Wildcards that are actual option pieces stay pieces — a card is one or the
  // other, and the piece reading is the more specific one.
  const wildcardSet = new Set((opts.wildcards ?? []).filter((n) => !optionsByName.has(n)));

  const rand = mulberry32(opts.seed ?? (Math.random() * 0xffffffff) >>> 0);
  const turns: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const order = shuffle(libraryNames, rand);
    const remaining = viable.map((o) => o.need);
    const seen = new Set<string>();
    let wildcardsHeld = 0;
    // Every viable option's names are all present, so a full-library walk
    // always completes — each run records exactly one turn.
    for (let pos = 0; pos < order.length; pos++) {
      const name = order[pos];
      const hits = optionsByName.get(name);
      if (hits && !seen.has(name)) {
        seen.add(name);
        for (const oi of hits) remaining[oi] -= 1;
      } else if (wildcardSet.has(name)) {
        // Each drawn copy is one substitution — all held wildcards go to the
        // option closest to done (optimal, since only one option must finish).
        wildcardsHeld += 1;
      } else {
        continue; // filler, or a duplicate copy of a piece — state unchanged
      }
      if (Math.min(...remaining) <= wildcardsHeld) {
        // Cards seen by turn t = handSize + t (one draw per turn from turn 1),
        // so the draw at 0-based position `pos` lands on turn pos + 1 - handSize.
        turns.push(Math.max(1, pos + 1 - handSize));
        break;
      }
    }
  }

  turns.sort((a, b) => a - b);
  const at = (q: number) => turns[Math.min(turns.length - 1, Math.floor(turns.length * q))];
  return { iterations, typicalTurn: at(0.5), p90Turn: at(0.9) };
}
