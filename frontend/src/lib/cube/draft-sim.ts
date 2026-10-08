// How draftable is this cube, really? Seed a pod of bots, run them through a
// standard 3-pack booster draft off the cube's own cards, build each bot's
// best two-colour deck, then report on the outcome across many pods. Pure and
// deterministic (same cube + seed → same result) so it can run in a worker and
// in the live stress harness without flaking.
//
// Scope: this measures DRAFTABILITY, not deck quality — a bot is a simple,
// legible heuristic (power + synergy snowball + a one-time colour commitment),
// not a competitive drafter. The point is exposing structural cube problems
// (too few playables in most pairs, an archetype nobody can actually build),
// not grading individual picks.
//
// Board E461 extends this same module with a SECOND pod model,
// `simulateCommanderDraft`, for a Commander cube's combined spells+legends
// pool: bots draft naturally (no guaranteed legend slot, per the design doc's
// open question 5), take a commander when a good one appears, then draft
// inside that commander's colour identity instead of a 2-colour pair. It
// shares the pack-dealing/pass-around mechanics with the limited-format pod
// below (`dealAndDraft`) and the module's RNG/seed conventions, but needs its
// own scoring and deck-building because a singleton, identity-restricted
// Commander pool isn't a parameter tweak on "best 23-card 2-colour deck" (see
// the design doc's Finding 5). Deliberately kept in ONE module rather than
// forked into a new file — the two models share more machinery (packs, seed,
// axis snowball, RNG) than they differ, and a second `draft-sim-*.ts` leaf
// would just be that machinery copy-pasted.
//
// Board E462 teaches the commander pod about Partner/Background: a bot whose
// commander has a Partner-family keyword or can choose a Background may draft
// a second, compatible legend and use both, with the combined colour identity
// (see `isCompatiblePartnerCard`) — at most one pairing, same as the real
// rules allow.

import { COLORS, isLand, identityColors, COLOR_PAIRS, type ColorPair, type CubeCard } from './core';
import { sizeInfo, type CubeSize } from './targets';
import {
  computePowerBasis,
  draftablePoolAxes,
  rawPower,
  AXIS_LABEL,
  type PowerBasis,
} from './objective';
import {
  isLegendCandidate,
  legendIdentityOf,
  partnerKindOf,
  partnerNameOf,
  isChooseABackgroundLegend,
  isBackground,
  LEGEND_BUCKETS,
  type LegendIdentity,
} from './legend';
import { mulberry32, shuffle } from '../playtest/rng';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';

/** Canonical `ColorPair` for two (unordered) colours — the reverse of what a
 *  string pair like 'WU' already gives you by indexing. `core` only exposes
 *  this lookup keyed off a card's colours (`pairOf`); a bot's committed
 *  colours are computed from popularity counts, not a card, so it needs the
 *  same lookup built from `COLOR_PAIRS` itself. */
const PAIR_BY_COLORS = new Map<string, ColorPair>(
  COLOR_PAIRS.map((p) => [[...p].sort().join(''), p])
);

const PACKS_PER_PLAYER = 3;
const CARDS_PER_PACK = 15;
const PLAYABLE_TARGET = 23;
/**
 * Pick number (0-indexed, own picks only) a bot commits to its two colours at.
 * 8 is roughly the midpoint of pack 1 — enough picks to read what's actually
 * open without stubbornly staying open the way real over-cautious drafters do.
 */
const COMMIT_PICK = 8;
/**
 * A deck "leans into" an archetype axis once it carries at least this many
 * combined enabler+payoff cards (with at least one of each — a payoff-only or
 * enabler-only pile isn't a functioning archetype). 4 is deliberately small:
 * a 23-card deck has far less room than a whole cube, so this is a floor for
 * "more than incidental overlap," not the cube-level `minDepth` bar.
 */
const LEAN_MIN_TOTAL = 4;

function realColorsOf(card: CubeCard): string[] {
  return card.colors.filter((c) => (COLORS as readonly string[]).includes(c));
}

function isPlayableInPair(card: CubeCard, pair: ColorPair): boolean {
  const colors = realColorsOf(card);
  return colors.length === 0 || colors.every((c) => pair.includes(c));
}

/** Deterministic seed from the cube's contents alone, order-independent.
 *  A local FNV-1a copy of refine.ts's private `deriveSeed` — that
 *  one isn't exported, and the coordinator said not to touch refine.ts/core.ts
 *  to export it. Dedupe later if a shared `lib/cube/seed.ts` leaf appears. */
function deriveSeed(cube: CubeCard[]): number {
  const key = `draft-sim#${cube
    .map((c) => c.oracleId)
    .sort()
    .join('|')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface DrafterState {
  picks: CubeCard[];
  pickCount: number;
  colorCounts: Partial<Record<string, number>>;
  axisCounts: Map<AxisKey, number>;
  commitPair: ColorPair | null;
}

function newDrafterState(): DrafterState {
  return { picks: [], pickCount: 0, colorCounts: {}, axisCounts: new Map(), commitPair: null };
}

function axesOf(card: CubeCard): Set<AxisKey> {
  return new Set<AxisKey>([...(card.synergyProducers ?? []), ...(card.synergyPayoffs ?? [])]);
}

/** How much a bot wants this pack card, given what it's picked so far. Higher wins. */
function scoreCard(card: CubeCard, state: DrafterState, basis: PowerBasis): number {
  if (isLand(card)) {
    // Lands don't count toward the 23-playable bar, so bots value them only
    // mildly — enough to occasionally take a fixing land, never over a real
    // spell. rawPower's cmc-0 tempo term isn't meaningful for lands, so it's
    // not used here.
    const onColor = !state.commitPair || isPlayableInPair(card, state.commitPair);
    return onColor ? 0.4 : 0.3;
  }
  let score = rawPower(card, basis);
  for (const ax of axesOf(card)) {
    // Synergy snowball: an axis a bot has already invested in is worth more,
    // capped so one hyper-narrow axis can't dominate every pick.
    score += Math.min(state.axisCounts.get(ax) ?? 0, 6) * 0.05;
  }
  if (state.commitPair) {
    const colors = realColorsOf(card);
    if (colors.length === 0) {
      // colourless always fits, no bonus or penalty
    } else if (colors.every((c) => state.commitPair!.includes(c))) {
      score += 0.5;
    } else if (colors.some((c) => state.commitPair!.includes(c))) {
      score -= 0.3; // a splash card — usable, not preferred
    } else {
      score -= 1; // off-colour: only picked when nothing else is worth it
    }
  }
  return score;
}

function commitColors(state: DrafterState): ColorPair {
  const ranked = [...COLORS].sort(
    (a, b) =>
      (state.colorCounts[b] ?? 0) - (state.colorCounts[a] ?? 0) ||
      COLORS.indexOf(a) - COLORS.indexOf(b)
  );
  const [c1, c2] = ranked;
  return PAIR_BY_COLORS.get([c1, c2].sort().join(''))!; // every 2 of WUBRG is one of the 10 pairs
}

function takePick(state: DrafterState, pack: CubeCard[], basis: PowerBasis): void {
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < pack.length; i++) {
    const s = scoreCard(pack[i], state, basis);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  const [card] = pack.splice(bestIdx, 1);
  state.picks.push(card);
  state.pickCount++;
  if (!isLand(card)) {
    for (const c of realColorsOf(card)) state.colorCounts[c] = (state.colorCounts[c] ?? 0) + 1;
    for (const ax of axesOf(card)) state.axisCounts.set(ax, (state.axisCounts.get(ax) ?? 0) + 1);
  }
  if (state.commitPair === null && state.pickCount === COMMIT_PICK) {
    state.commitPair = commitColors(state);
  }
}

/**
 * One seeded pod: shuffle the pool, cut it into `players * 3` packs of up to
 * 15 cards, and pass them around for 3 rounds (packs 1 and 3 pass left, pack 2
 * passes right — the standard draft convention). A pool short of
 * `players * 45` cards yields shorter (or empty) packs near the end rather
 * than failing — those picks just don't happen, which is the honest outcome
 * for a cube that can't actually feed this many drafters. Generic over the
 * drafter state shape so both pod models (limited 2-colour, commander
 * identity-restricted) share this mechanic instead of each re-implementing
 * pack dealing and the pass-around order.
 */
function dealAndDraft<S>(
  pool: CubeCard[],
  players: number,
  rand: () => number,
  newState: () => S,
  takeOnePick: (state: S, pack: CubeCard[]) => void
): S[] {
  const perPlayerCards = PACKS_PER_PLAYER * CARDS_PER_PACK;
  // Canonical order first — same pool in ANY input order must shuffle
  // identically for a given seed (mirrors refine.ts's own same-pool-any-order
  // determinism contract). A plain in-place shuffle of `pool` as given would
  // instead depend on its incoming order, since Fisher-Yates swaps by index.
  const canonical = [...pool].sort((a, b) => a.oracleId.localeCompare(b.oracleId));
  const drawPool = shuffle(canonical, rand).slice(
    0,
    Math.min(canonical.length, players * perPlayerCards)
  );
  const totalPacks = players * PACKS_PER_PLAYER;
  const packs: CubeCard[][] = [];
  for (let i = 0; i < totalPacks; i++) {
    packs.push(drawPool.slice(i * CARDS_PER_PACK, (i + 1) * CARDS_PER_PACK));
  }

  const states = Array.from({ length: players }, newState);
  for (let round = 0; round < PACKS_PER_PLAYER; round++) {
    let held = packs.slice(round * players, (round + 1) * players);
    const passLeft = round !== 1;
    for (let step = 0; step < CARDS_PER_PACK; step++) {
      for (let seat = 0; seat < players; seat++) {
        if (held[seat].length > 0) takeOnePick(states[seat], held[seat]);
      }
      const prev = held;
      held = prev.map((_, seat) =>
        passLeft ? prev[(seat + 1) % players] : prev[(seat - 1 + players) % players]
      );
    }
  }
  return states;
}

function draftPod(
  cube: CubeCard[],
  players: number,
  rand: () => number,
  basis: PowerBasis
): DrafterState[] {
  return dealAndDraft(cube, players, rand, newDrafterState, (state, pack) =>
    takePick(state, pack, basis)
  );
}

/** The best 23-or-fewer non-land playables a drafted pool can field in one
 *  two-colour pair (colourless cards count in every pair). Ties break on
 *  total power, then on `COLOR_PAIRS` order, so the choice is deterministic. */
function buildBestDeck(pool: CubeCard[], basis: PowerBasis): { pair: ColorPair; deck: CubeCard[] } {
  const nonland = pool.filter((c) => !isLand(c));
  let best: { pair: ColorPair; deck: CubeCard[]; power: number } | undefined;
  for (const pair of COLOR_PAIRS) {
    const eligible = nonland
      .filter((c) => isPlayableInPair(c, pair))
      .sort((a, b) => rawPower(b, basis) - rawPower(a, basis));
    const deck = eligible.slice(0, PLAYABLE_TARGET);
    const power = deck.reduce((s, c) => s + rawPower(c, basis), 0);
    if (
      !best ||
      deck.length > best.deck.length ||
      (deck.length === best.deck.length && power > best.power)
    ) {
      best = { pair, deck, power };
    }
  }
  return best!; // COLOR_PAIRS is never empty
}

/** Archetype axes a single built deck actually leans into (see `LEAN_MIN_TOTAL`). */
function leanedAxes(deck: CubeCard[]): Set<AxisKey> {
  const tally = new Map<AxisKey, { e: number; y: number }>();
  for (const c of deck) {
    for (const ax of c.synergyProducers ?? []) tally.set(ax, bump(tally.get(ax), 'e'));
    for (const ax of c.synergyPayoffs ?? []) tally.set(ax, bump(tally.get(ax), 'y'));
  }
  const out = new Set<AxisKey>();
  for (const [ax, t] of tally) if (t.e > 0 && t.y > 0 && t.e + t.y >= LEAN_MIN_TOTAL) out.add(ax);
  return out;
}
function bump(t: { e: number; y: number } | undefined, key: 'e' | 'y'): { e: number; y: number } {
  const next = t ?? { e: 0, y: 0 };
  next[key]++;
  return next;
}

export interface DraftSimOptions {
  /** How many pods to draft. Default 50. */
  runs?: number;
  /** Override the cube-derived seed (mainly for tests). */
  seed?: number;
}

export interface PairShare {
  pair: ColorPair;
  label: string;
  /** 0..1 share of all decks whose best pair was this one. */
  share: number;
}

export interface UndraftedArchetype {
  axis: AxisKey;
  label: string;
}

export interface DraftSimResult {
  runs: number;
  playersPerRun: number;
  packsPerPlayer: number;
  cardsPerPack: number;
  /** runs * playersPerRun. */
  totalDecks: number;
  /** True when the cube has fewer than `sizeInfo(size).players * 45` cards —
   *  the pod actually drafted is smaller than the size's own nominal pod. */
  shortCube: boolean;
  /** 0..1 share of decks that reached 23 non-land playables in two colours. */
  reachedBarShare: number;
  /** All 10 colour pairs, sorted by share descending. */
  pairShares: PairShare[];
  /** Axes the cube's pool can support (has both an enabler and a payoff
   *  somewhere) that no drafted deck, across every run, ever leaned into. */
  undraftedArchetypes: UndraftedArchetype[];
}

/**
 * Draft the cube `options.runs` times (default 50) with seeded bots, build
 * each drafter's best two-colour deck, and report draftability. Pure and
 * deterministic: the same cube (any card order) + size + seed always returns
 * the same result.
 */
export function simulateDraft(
  cube: CubeCard[],
  size: CubeSize,
  options: DraftSimOptions = {}
): DraftSimResult {
  const runs = Math.max(1, Math.floor(options.runs ?? 50));
  const basis = computePowerBasis(cube);
  const perPlayerCards = PACKS_PER_PLAYER * CARDS_PER_PACK;
  const nominalPlayers = sizeInfo(size).players;
  const players = Math.max(1, Math.min(nominalPlayers, Math.floor(cube.length / perPlayerCards)));
  const shortCube = cube.length < nominalPlayers * perPlayerCards;
  const baseSeed = (options.seed ?? deriveSeed(cube)) >>> 0;

  const pairCounts = new Map<ColorPair, number>(COLOR_PAIRS.map((p) => [p, 0]));
  let reachedBar = 0;
  let totalDecks = 0;
  const leaned = new Set<AxisKey>();

  for (let run = 0; run < runs; run++) {
    // A distinct, deterministic stream per run — same base seed, so the whole
    // result is reproducible, but no two runs draft identically.
    const rand = mulberry32((baseSeed + run * 0x9e3779b1) >>> 0);
    const drafters = draftPod(cube, players, rand, basis);
    for (const state of drafters) {
      const { pair, deck } = buildBestDeck(state.picks, basis);
      totalDecks++;
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
      if (deck.length >= PLAYABLE_TARGET) reachedBar++;
      for (const ax of leanedAxes(deck)) leaned.add(ax);
    }
  }

  const pairShares: PairShare[] = COLOR_PAIRS.map((pair) => ({
    pair,
    label: pair,
    share: totalDecks ? (pairCounts.get(pair) ?? 0) / totalDecks : 0,
  })).sort((a, b) => b.share - a.share || a.label.localeCompare(b.label));

  const undraftedArchetypes: UndraftedArchetype[] = draftablePoolAxes(cube)
    .filter((ax) => !leaned.has(ax))
    .map((ax) => ({ axis: ax, label: AXIS_LABEL.get(ax) ?? ax }));

  return {
    runs,
    playersPerRun: players,
    packsPerPlayer: PACKS_PER_PLAYER,
    cardsPerPack: CARDS_PER_PACK,
    totalDecks,
    shortCube,
    reachedBarShare: totalDecks ? reachedBar / totalDecks : 0,
    pairShares,
    undraftedArchetypes,
  };
}

// ── Commander pod (board E461) ──────────────────────────────────────────────
// A Commander cube's pod builds one 60-card Commander-Legends-style deck per
// drafter (commander + 59 other cards) — a deliberately SMALLER, draft-only
// shape than the app's normal 100-card singleton format (design doc open
// question 2 keeps that for saved decks). Basics fill whatever's left after
// the drafted playables (unlimited supply, always legal, the same way a
// limited deck's own land base isn't drafted card-for-card), so the bar this
// measures is NOT "did the draft alone produce all 59 other cards" — it's
// whether the pod produced a real PLAYABLE CORE: a commander plus enough
// on-identity non-land picks to build around. That's the same shape question
// the limited pod's own 23-card bar asks (see PLAYABLE_TARGET above); a first
// pass here required 35 (deck size minus commander minus a 24-land manabase)
// and measured 4-11% buildable on a real collection — a number that reads as
// "Commander drafts almost always fail," which isn't true and was the wrong
// bar, not a wrong pool. 78-100% of 30-45 picks landing on-identity is a
// bar no real draft (limited or Commander) clears at that rate.

/** How many on-identity non-land playables, alongside a commander, count as
 *  a real playable core — deliberately the SAME number as the limited pod's
 *  `PLAYABLE_TARGET` (23 of 45 picks), not deck-size-minus-manabase (35).
 *  Exported so the UI states the exact same bar the sim measures against. */
export const COMMANDER_PLAYABLE_TARGET = PLAYABLE_TARGET;
/** Matches scoreCard's on-identity bonus scale below. */
const COMMANDER_BONUS = 0.5;
/**
 * Own-pick index (0-indexed, inclusive) after which a bot with no commander
 * yet force-commits to the best legend it has already drafted (or keeps
 * waiting if it hasn't picked one up at all yet — see `takeCommanderPick`).
 * Deliberately as early as `COMMIT_PICK` anchors the limited pod's colour
 * commitment: reaching `COMMANDER_PLAYABLE_TARGET` (23) identity-legal
 * playables out of 45 total picks needs most of the draft to happen AFTER
 * commitment, mirroring how a real Commander Legends drafter locks their
 * commander early and spends the rest of the draft mostly in one identity —
 * an off-identity card is a genuinely dead pick in that format, not merely a
 * worse one, so real drafters commit hard and early.
 */
const COMMANDER_COMMIT_DEADLINE = 8;

function isIdentityLegal(card: CubeCard, identity: readonly string[]): boolean {
  return identityColors(card).every((c) => identity.includes(c));
}

interface CommanderDrafterState {
  picks: CubeCard[];
  pickCount: number;
  axisCounts: Map<AxisKey, number>;
  /** Every legend-candidate card drafted so far, whether or not it triggered
   *  a commit — the pool `COMMANDER_COMMIT_DEADLINE`'s fallback picks from. */
  legendCandidates: CubeCard[];
  commander: CubeCard | null;
  /** Set once `commander` is, from `identityColors(commander)` — kept
   *  alongside `commander` (rather than re-derived) so a hybrid/colour-
   *  indicator commander's identity is fixed at commit time. Merged with the
   *  partner/Background's own colours the moment one is drafted (see
   *  `isCompatiblePartnerCard`), so every legality check downstream of that
   *  pick already sees the combined identity for free. */
  identity: string[] | null;
  /** A Partner/Background legend drafted alongside `commander` (board E462) —
   *  at most one; a second is scored as an ordinary card, same as real
   *  Commander rules allow only a pair, never three. */
  partnerCard: CubeCard | null;
}

function newCommanderDrafterState(): CommanderDrafterState {
  return {
    picks: [],
    pickCount: 0,
    axisCounts: new Map(),
    legendCandidates: [],
    commander: null,
    identity: null,
    partnerCard: null,
  };
}

/**
 * Is `card` a legal second commander alongside `commander` (board E462)? Only
 * the shapes `simulateCommanderDraft` can check without a full rules engine:
 * plain Partner pairs with any other plain Partner, Friends forever the same
 * way with its own keyword, Partner with `<Name>` requires that EXACT card,
 * and a choose-a-Background legend pairs with any Background. Doctor's
 * companion is deliberately excluded — correctly requires one side to be a
 * Doctor-typed creature, which is real rules work this pure heuristic sim
 * doesn't do (see legend.ts's own doc on why it's still LABEL-only there).
 */
function isCompatiblePartnerCard(commander: CubeCard, card: CubeCard): boolean {
  if (card.oracleId === commander.oracleId) return false;
  const kind = partnerKindOf(commander);
  if (kind === 'partner' || kind === 'friends-forever') return partnerKindOf(card) === kind;
  if (kind === 'partner-with') {
    const name = partnerNameOf(commander);
    return name != null && card.name.toLowerCase() === name.toLowerCase();
  }
  if (isChooseABackgroundLegend(commander)) return isBackground(card);
  return false;
}

/**
 * How much a bot wants this pack card. Before a commander is locked, a legend
 * that clears `qualityBar` (see `commanderQualityBar`) gets a strong bonus —
 * "takes a commander when a good one appears," not the first legend seen
 * regardless of power. Once locked, an off-identity card is nearly worthless
 * (it is a dead card in a singleton, colour-identity-restricted deck) — UNLESS
 * it's a still-unclaimed legal Partner/Background for this exact commander, in
 * which case it's worth exactly as much as an on-identity card (drafting it
 * legally expands the identity, so it's never actually a dead pick). An
 * on-identity card gets the same synergy snowball the limited pod's bots use.
 */
function scoreCommanderCard(
  card: CubeCard,
  state: CommanderDrafterState,
  basis: PowerBasis,
  qualityBar: number
): number {
  if (isLand(card)) {
    if (!state.identity) return 0.35;
    return isIdentityLegal(card, state.identity) ? 0.4 : 0.05;
  }
  const power = rawPower(card, basis);
  if (!state.commander) {
    return isLegendCandidate(card) && power >= qualityBar ? power + COMMANDER_BONUS : power;
  }
  if (isIdentityLegal(card, state.identity!)) {
    let score = power;
    for (const ax of axesOf(card)) {
      score += Math.min(state.axisCounts.get(ax) ?? 0, 6) * 0.05;
    }
    return score;
  }
  if (!state.partnerCard && isCompatiblePartnerCard(state.commander, card)) return power;
  return -1;
}

function takeCommanderPick(
  state: CommanderDrafterState,
  pack: CubeCard[],
  basis: PowerBasis,
  qualityBar: number
): void {
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < pack.length; i++) {
    const s = scoreCommanderCard(pack[i], state, basis, qualityBar);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  const [card] = pack.splice(bestIdx, 1);
  state.picks.push(card);
  state.pickCount++;
  if (!isLand(card)) {
    for (const ax of axesOf(card)) state.axisCounts.set(ax, (state.axisCounts.get(ax) ?? 0) + 1);
  }
  if (isLegendCandidate(card)) state.legendCandidates.push(card);

  if (!state.commander && isLegendCandidate(card) && rawPower(card, basis) >= qualityBar) {
    state.commander = card;
    state.identity = identityColors(card);
    // A compatible partner/Background may already sit in `state.picks` from
    // BEFORE this commit (nothing flagged it at pick time, since there was no
    // commander yet to check it against) — look for one now, not just on
    // future picks.
    attachPartnerIfPresent(state);
  } else if (
    !state.commander &&
    state.pickCount >= COMMANDER_COMMIT_DEADLINE &&
    state.legendCandidates.length > 0
  ) {
    const best = state.legendCandidates.reduce((a, b) =>
      rawPower(b, basis) > rawPower(a, basis) ? b : a
    );
    state.commander = best;
    state.identity = identityColors(best);
    attachPartnerIfPresent(state);
  } else if (
    state.commander &&
    !state.partnerCard &&
    isCompatiblePartnerCard(state.commander, card)
  ) {
    state.partnerCard = card;
    state.identity = [...new Set([...state.identity!, ...identityColors(card)])];
  }
}

/** Scans everything already drafted for a legal Partner/Background match to
 *  the just-committed `state.commander` — the commit can land well after a
 *  compatible card was already picked up as an ordinary card (nothing could
 *  flag it before there was a commander to check it against), so this is the
 *  retroactive half of the same pairing the post-commit branch above handles
 *  for future picks. */
function attachPartnerIfPresent(state: CommanderDrafterState): void {
  const commander = state.commander!;
  const match = state.picks.find(
    (c) => c.oracleId !== commander.oracleId && isCompatiblePartnerCard(commander, c)
  );
  if (match) {
    state.partnerCard = match;
    state.identity = [...new Set([...state.identity!, ...identityColors(match)])];
  }
}

function draftCommanderPod(
  combined: CubeCard[],
  players: number,
  rand: () => number,
  basis: PowerBasis,
  qualityBar: number
): CommanderDrafterState[] {
  return dealAndDraft(combined, players, rand, newCommanderDrafterState, (state, pack) =>
    takeCommanderPick(state, pack, basis, qualityBar)
  );
}

/**
 * The power bar a legend must clear to be worth committing to immediately —
 * the median `rawPower` across every commander candidate in the cube's OWN
 * legend section. Pool-derived (not a fixed constant) so it scales with how
 * strong the cube's legends actually are, the same way `computePowerBasis`
 * scales power to the pool rather than a global constant. No legends at all
 * → Infinity, so no bot ever "finds a good one" (an honest zero-commander
 * result, not a crash).
 */
function commanderQualityBar(legends: CubeCard[], basis: PowerBasis): number {
  if (legends.length === 0) return Infinity;
  const powers = legends.map((c) => rawPower(c, basis)).sort((a, b) => a - b);
  return powers[Math.floor((powers.length - 1) / 2)];
}

export interface CommanderIdentityShare {
  identity: LegendIdentity;
  /** 0..1 share of ALL drafted decks (commander or not) whose commander landed here. */
  share: number;
}

export interface CommanderDraftSimResult {
  runs: number;
  playersPerRun: number;
  packsPerPlayer: number;
  cardsPerPack: number;
  /** runs * playersPerRun. */
  totalDecks: number;
  /** True when the combined spells+legends pool has fewer cards than the
   *  size's own nominal pod needs — see `DraftSimResult.shortCube`. */
  shortCube: boolean;
  /** 0..1 share of decks that ended with a commander AND at least
   *  `COMMANDER_PLAYABLE_TARGET` (23) identity-legal non-land playables — a
   *  real playable core, basics filling the rest of the 60-card deck. */
  builtDeckShare: number;
  /** 0..1 share of decks that never landed a commander at all — the
   *  "couldn't even start" half of the decks `builtDeckShare` excludes,
   *  distinct from "got one but couldn't fill 23 playables around it." */
  noCommanderShare: number;
  /** All 16 identity buckets (5 colours + 10 pairs + 3+), by how often a
   *  drafted deck's commander landed there, sorted by share descending. */
  identityShares: CommanderIdentityShare[];
  /** Identity buckets the legend section actually supplies at least one
   *  candidate for, but that no drafted deck, across every run, ever reached
   *  a playable core (>=23 on-identity non-land playables) with. */
  unbuildableIdentities: LegendIdentity[];
}

/**
 * Draft a Commander cube's combined spells+legends pool `options.runs` times
 * (default 50): bots draft naturally off the whole pool (legends fall at
 * natural odds, same as the sample pack — no guaranteed per-pack legend
 * slot), take a commander when a good one appears, then draft inside that
 * commander's colour identity for the rest of the pod. Pure and deterministic
 * like `simulateDraft`; same seed contract (derived from the combined pool
 * unless overridden).
 */
export function simulateCommanderDraft(
  spells: CubeCard[],
  legends: CubeCard[],
  size: CubeSize,
  options: DraftSimOptions = {}
): CommanderDraftSimResult {
  const runs = Math.max(1, Math.floor(options.runs ?? 50));
  const combined = [...spells, ...legends];
  const basis = computePowerBasis(combined);
  const perPlayerCards = PACKS_PER_PLAYER * CARDS_PER_PACK;
  const nominalPlayers = sizeInfo(size).players;
  const players = Math.max(
    1,
    Math.min(nominalPlayers, Math.floor(combined.length / perPlayerCards))
  );
  const shortCube = combined.length < nominalPlayers * perPlayerCards;
  const baseSeed = (options.seed ?? deriveSeed(combined)) >>> 0;
  const qualityBar = commanderQualityBar(legends, basis);

  // The baseline "unbuildable identities" scores against: every identity the
  // legend section can actually supply a commander candidate for, regardless
  // of whether any pod happened to draft one — the same "the pool CAN support
  // this" baseline `draftablePoolAxes` gives the limited pod's archetype
  // report.
  const supportedIdentities = new Set<LegendIdentity>(legends.map((c) => legendIdentityOf(c)));

  const identityCounts = new Map<LegendIdentity, number>(LEGEND_BUCKETS.map((id) => [id, 0]));
  const builtByIdentity = new Map<LegendIdentity, number>(LEGEND_BUCKETS.map((id) => [id, 0]));
  let builtDecks = 0;
  let noCommanderDecks = 0;
  let totalDecks = 0;

  for (let run = 0; run < runs; run++) {
    const rand = mulberry32((baseSeed + run * 0x9e3779b1) >>> 0);
    const drafters = draftCommanderPod(combined, players, rand, basis, qualityBar);
    for (const state of drafters) {
      totalDecks++;
      if (!state.commander) {
        noCommanderDecks++;
        continue;
      }
      const identity = legendIdentityOf(state.commander);
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);

      const nonland = state.picks.filter(
        (c) =>
          !isLand(c) &&
          c.oracleId !== state.commander!.oracleId &&
          c.oracleId !== state.partnerCard?.oracleId
      );
      const eligible = nonland
        .filter((c) => isIdentityLegal(c, state.identity!))
        .sort((a, b) => rawPower(b, basis) - rawPower(a, basis));
      if (eligible.length >= COMMANDER_PLAYABLE_TARGET) {
        builtDecks++;
        builtByIdentity.set(identity, (builtByIdentity.get(identity) ?? 0) + 1);
      }
    }
  }

  const identityShares: CommanderIdentityShare[] = LEGEND_BUCKETS.map((identity) => ({
    identity,
    share: totalDecks ? (identityCounts.get(identity) ?? 0) / totalDecks : 0,
  })).sort(
    (a, b) =>
      b.share - a.share || LEGEND_BUCKETS.indexOf(a.identity) - LEGEND_BUCKETS.indexOf(b.identity)
  );

  const unbuildableIdentities = LEGEND_BUCKETS.filter(
    (id) => supportedIdentities.has(id) && (builtByIdentity.get(id) ?? 0) === 0
  );

  return {
    runs,
    playersPerRun: players,
    packsPerPlayer: PACKS_PER_PLAYER,
    cardsPerPack: CARDS_PER_PACK,
    totalDecks,
    shortCube,
    builtDeckShare: totalDecks ? builtDecks / totalDecks : 0,
    noCommanderShare: totalDecks ? noCommanderDecks / totalDecks : 0,
    identityShares,
    unbuildableIdentities,
  };
}
