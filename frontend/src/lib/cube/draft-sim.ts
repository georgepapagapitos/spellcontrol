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

import { COLORS, isLand, COLOR_PAIRS, type ColorPair, type CubeCard } from './core';
import { sizeInfo, type CubeSize } from './targets';
import {
  computePowerBasis,
  draftablePoolAxes,
  rawPower,
  AXIS_LABEL,
  type PowerBasis,
} from './objective';
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
 *  ponytail: a local FNV-1a copy of refine.ts's private `deriveSeed` — that
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
 * One seeded pod: shuffle the cube, cut it into `players * 3` packs of up to
 * 15 cards, and pass them around for 3 rounds (packs 1 and 3 pass left, pack 2
 * passes right — the standard draft convention). A cube short of
 * `players * 45` cards yields shorter (or empty) packs near the end rather
 * than failing — those picks just don't happen, which is the honest outcome
 * for a cube that can't actually feed this many drafters.
 */
function draftPod(
  cube: CubeCard[],
  players: number,
  rand: () => number,
  basis: PowerBasis
): DrafterState[] {
  const perPlayerCards = PACKS_PER_PLAYER * CARDS_PER_PACK;
  // Canonical order first — same cube in ANY input order must shuffle
  // identically for a given seed (mirrors refine.ts's own same-pool-any-order
  // determinism contract). A plain in-place shuffle of `cube` as given would
  // instead depend on its incoming order, since Fisher-Yates swaps by index.
  const canonical = [...cube].sort((a, b) => a.oracleId.localeCompare(b.oracleId));
  const drawPool = shuffle(canonical, rand).slice(
    0,
    Math.min(canonical.length, players * perPlayerCards)
  );
  const totalPacks = players * PACKS_PER_PLAYER;
  const packs: CubeCard[][] = [];
  for (let i = 0; i < totalPacks; i++) {
    packs.push(drawPool.slice(i * CARDS_PER_PACK, (i + 1) * CARDS_PER_PACK));
  }

  const states = Array.from({ length: players }, newDrafterState);
  for (let round = 0; round < PACKS_PER_PLAYER; round++) {
    let held = packs.slice(round * players, (round + 1) * players);
    const passLeft = round !== 1;
    for (let step = 0; step < CARDS_PER_PACK; step++) {
      for (let seat = 0; seat < players; seat++) {
        if (held[seat].length > 0) takePick(states[seat], held[seat], basis);
      }
      const prev = held;
      held = prev.map((_, seat) =>
        passLeft ? prev[(seat + 1) % players] : prev[(seat - 1 + players) % players]
      );
    }
  }
  return states;
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
