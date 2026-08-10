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

// ── Land-drop curve — "on curve" probability per turn ────────────────────────

export interface LandDropCurveOptions {
  /** Runs to simulate. Default 1000. */
  iterations?: number;
  /** Cards in the opening hand. Default 7. */
  handSize?: number;
  /** Mulligans allowed before settling for the current hand (same policy as
   *  `simulateOpeningHands`). Default 2. */
  mulliganDepth?: number;
  /** Highest turn to report. Default 5. */
  maxTurn?: number;
  /** Seed for the PRNG. Omit for a fresh random run; pass a fixed value in tests. */
  seed?: number;
}

export interface LandDropCurveResult {
  iterations: number;
  maxTurn: number;
  /**
   * Fraction of games with a land available for every turn 1..N — i.e. total
   * lands seen (kept hand + one draw per turn) is >= N. 1-indexed; index 0 is
   * unused. Draw-per-turn only: it does not know which spells are in hand, so
   * it can't tell a land drop was skipped by choice.
   */
  onCurveRate: number[];
}

/**
 * Estimate turn-by-turn "did you have a land to play" odds: keep a hand via
 * the same mulligan policy as `simulateOpeningHands`, then draw one card per
 * turn and check whether cumulative lands seen has kept pace with the turn
 * count. No mana curve of the spells themselves is modeled — this is purely
 * "how often does the deck's land ratio keep you on curve."
 */
export function simulateLandDropCurve(
  library: readonly SimCard[],
  opts: LandDropCurveOptions = {}
): LandDropCurveResult {
  const iterations = Math.max(1, Math.floor(opts.iterations ?? 1000));
  const handSize = Math.max(1, Math.floor(opts.handSize ?? 7));
  const mulliganDepth = Math.max(0, Math.floor(opts.mulliganDepth ?? 2));
  const maxTurn = Math.max(1, Math.floor(opts.maxTurn ?? 5));
  const rand = mulberry32(opts.seed ?? (Math.random() * 0xffffffff) >>> 0);

  const onCurveCount = new Array<number>(maxTurn + 1).fill(0);
  const drawable = library.length >= handSize;

  for (let i = 0; i < iterations && drawable; i++) {
    let order = shuffle(library, rand);
    let hand = order.slice(0, handSize);
    for (let m = 0; m < mulliganDepth && !isKeepableHand(hand); m++) {
      order = shuffle(library, rand);
      hand = order.slice(0, handSize);
    }

    let landsSoFar = hand.reduce((n, c) => n + (c.isLand ? 1 : 0), 0);
    for (let turn = 1; turn <= maxTurn; turn++) {
      const drawIndex = handSize + turn - 1;
      if (drawIndex < order.length && order[drawIndex].isLand) landsSoFar += 1;
      if (landsSoFar >= turn) onCurveCount[turn] += 1;
    }
  }

  const denom = drawable ? iterations : 1;
  return { iterations, maxTurn, onCurveRate: onCurveCount.map((n) => n / denom) };
}

// ── Assembly clock — "typically online by turn N" ───────────────────────────

/** A library card the assembly clock needs: a `SimCard` plus its name. */
export interface ClockCard extends SimCard {
  name: string;
}

export interface AssemblyClockOptions {
  /** Runs to simulate. Default 1000, matching `simulateOpeningHands`. */
  iterations?: number;
  /** Cards in the opening hand. Default 7. */
  handSize?: number;
  /** Seed for the PRNG. Omit for a fresh random run; pass a fixed value in tests. */
  seed?: number;
  /**
   * Tutor card names. A cast tutor fetches the cheapest still-missing piece of
   * whichever option is closest to done — into HAND, so it still has to be
   * cast. Without these, tutor-reliant decks (combo especially) clock absurdly
   * slow: the raw draw math, but not how the deck plays.
   */
  wildcards?: readonly string[];
}

export interface AssemblyClockResult {
  iterations: number;
  /**
   * Median 1-based turn on which the win path came online — every piece drawn
   * AND cast. Turn 1 = the opening hand plus the first draw.
   */
  typicalTurn: number;
  /** 90th-percentile turn — 90% of simulated games were online by this turn. */
  p90Turn: number;
}

/**
 * How many turns until the deck's win path is assembled *and paid for*, across
 * many simulated games: shuffle, draw an opening hand, then each turn draw a
 * card, make a land drop, and spend that turn's mana until any one `options`
 * entry is satisfied (`need` distinct `names` cast). Duplicate copies of a name
 * only count once toward `need`.
 *
 * The mana model is what separates this from raw draw math: a piece in hand you
 * can't cast is not online, so a four-piece combo of five-drops correctly clocks
 * slower than two one-drops, and a tutor costs its mana plus a second cast for
 * what it fetches. Cast `role: 'ramp'` adds a mana from the next turn and cast
 * `role: 'cardDraw'` draws two (see the ponytail notes below); openers use the
 * same two-mulligan keep policy as `simulateOpeningHands`.
 *
 * Still a goldfish: no colors, no rituals or free spells, no opponent and no
 * interaction, so real games vary in both directions. Surfaces state this.
 * Options naming cards the library no longer contains (stale persisted analysis
 * after an edit) are dropped; returns null when nothing viable remains.
 *
 * The `options` shape matches `WinCondition.assembly` from the T16 detector,
 * kept structural here so this file stays decoupled from deck-builder types.
 */
export function simulateAssemblyClock(
  library: readonly ClockCard[],
  options: ReadonlyArray<{ names: readonly string[]; need: number }>,
  opts: AssemblyClockOptions = {}
): AssemblyClockResult | null {
  const iterations = Math.max(1, Math.floor(opts.iterations ?? 1000));
  const handSize = Math.max(1, Math.floor(opts.handSize ?? 7));

  // First copy of a name wins — every printing of a card costs the same.
  const cmcByName = new Map<string, number>();
  for (const c of library) if (!cmcByName.has(c.name)) cmcByName.set(c.name, c.cmc);

  const viable = options
    .map((o) => ({
      names: Array.from(new Set(o.names)).filter((n) => cmcByName.has(n)),
      need: o.need,
    }))
    .filter((o) => o.need <= 0 || o.names.length >= o.need);
  if (viable.length === 0) return null;

  // A zero-need option (e.g. a commander + partner combo — every piece starts
  // in the command zone) is online before the first draw.
  if (viable.some((o) => o.need <= 0)) {
    return { iterations, typicalTurn: 1, p90Turn: 1 };
  }

  const pieceNames = new Set(viable.flatMap((o) => o.names));
  // A tutor that is itself a combo piece stays a piece — a card is one or the
  // other, and the piece reading is the more specific one.
  const tutorNames = new Set((opts.wildcards ?? []).filter((n) => !pieceNames.has(n)));

  const rand = mulberry32(opts.seed ?? (Math.random() * 0xffffffff) >>> 0);
  const turns: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let order = shuffle(library, rand);
    let hand = order.slice(0, handSize);
    // Same keep policy as `simulateOpeningHands` (2 mulligans), then London:
    // bottom one card per mulligan taken. Cards left in `order[0..handSize)`
    // are never drawn again, so bottoming is just dropping them from hand.
    let mulls = 0;
    while (mulls < 2 && !isKeepableHand(hand)) {
      order = shuffle(library, rand);
      hand = order.slice(0, handSize);
      mulls += 1;
    }
    for (let m = 0; m < mulls; m++) {
      // Priciest card that isn't a land or part of the win path — what a real
      // player bottoms first.
      let worst = -1;
      for (let h = 0; h < hand.length; h++) {
        if (hand[h].isLand || pieceNames.has(hand[h].name)) continue;
        if (worst < 0 || hand[h].cmc > hand[worst].cmc) worst = h;
      }
      if (worst >= 0) hand.splice(worst, 1);
    }
    let nextDraw = handSize;
    let lands = 0;
    let rampOnline = 0; // mana from ramp that has had a turn to untap
    let rampPending = 0; // ramp cast this turn — online next turn
    const cast = new Set<string>(); // distinct piece names actually paid for

    const missing = (o: { names: string[]; need: number }) =>
      o.need - o.names.reduce((n, nm) => n + (cast.has(nm) ? 1 : 0), 0);
    const closest = () => Math.min(...viable.map(missing));

    // Cast priority class: 0 ramp, 1 needed piece, 2 tutor, 3 card draw,
    // -1 uncastable (filler, a land, or a duplicate of a piece already paid).
    const classOf = (c: ClockCard): number =>
      pieceNames.has(c.name)
        ? cast.has(c.name)
          ? -1
          : 1
        : tutorNames.has(c.name)
          ? 2
          : c.isLand
            ? -1
            : c.role === 'ramp'
              ? 0
              : c.role === 'cardDraw'
                ? 3
                : -1;

    // Drawing the whole library always supplies every piece and enough lands,
    // so this terminates; the bound is a guard, not the expected exit.
    let onlineTurn = order.length;
    for (let turn = 1; turn <= order.length; turn++) {
      if (nextDraw < order.length) hand.push(order[nextDraw++]);

      const landIdx = hand.findIndex((c) => c.isLand);
      if (landIdx >= 0) {
        hand.splice(landIdx, 1);
        lands += 1;
      }

      rampOnline += rampPending;
      rampPending = 0;
      let budget = lands + rampOnline;

      for (;;) {
        // ponytail: greedy sequencing — ramp and draw before pieces unless the
        // deck is one piece from done, then finishing beats developing. A real
        // player plans the whole curve; add lookahead only if medians move.
        const priority = closest() <= 1 ? [1, 2, 0, 3] : [0, 3, 1, 2];
        let pick = -1;
        for (const want of priority) {
          for (let h = 0; h < hand.length; h++) {
            if (classOf(hand[h]) !== want || hand[h].cmc > budget) continue;
            if (pick < 0 || hand[h].cmc < hand[pick].cmc) pick = h;
          }
          if (pick >= 0) break;
        }
        if (pick < 0) break;

        const card = hand[pick];
        hand.splice(pick, 1);
        budget -= card.cmc;

        if (pieceNames.has(card.name)) {
          cast.add(card.name);
        } else if (tutorNames.has(card.name)) {
          // Fetched to HAND, not the battlefield — it still costs a cast. This
          // is the whole point of pricing tutors rather than treating a drawn
          // one as the missing piece outright.
          const target = viable
            .filter((o) => missing(o) > 0)
            .sort((a, b) => missing(a) - missing(b))[0];
          const held = new Set(hand.map((c) => c.name));
          const want = target?.names
            .filter((n) => !cast.has(n) && !held.has(n))
            .sort((a, b) => (cmcByName.get(a) ?? 0) - (cmcByName.get(b) ?? 0))[0];
          if (want) {
            hand.push({
              name: want,
              cmc: cmcByName.get(want) ?? 0,
              isLand: false,
              role: null,
              colors: [],
            });
          }
        } else if (card.role === 'cardDraw') {
          // ponytail: every draw spell is +2 cards. Rhystic Study is an engine
          // and Sign in Blood is exactly two; without ANY draw the clock is
          // one-card-per-turn, which is what actually dominated the medians.
          for (let d = 0; d < 2 && nextDraw < order.length; d++) hand.push(order[nextDraw++]);
        } else {
          rampPending += 1; // ponytail: every ramp spell is +1 mana. Sol Ring is
          // +2 and a dork is summoning-sick; ramp COUNT drives the median, not
          // which rock it was. Model individual output if the numbers demand it.
        }
      }

      if (closest() <= 0) {
        onlineTurn = turn;
        break;
      }
    }
    turns.push(onlineTurn);
  }

  turns.sort((a, b) => a - b);
  const at = (q: number) => turns[Math.min(turns.length - 1, Math.floor(turns.length * q))];
  return { iterations, typicalTurn: at(0.5), p90Turn: at(0.9) };
}
