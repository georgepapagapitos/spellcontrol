/**
 * Mana-base metrics: what the goldfish says about the lands and rocks as a
 * whole, in three numbers a player can check by hand.
 *
 * - Tempo cost of tapped lands: the same games (same seed, same shuffles) are
 *   played twice, once as the deck is and once with every land that can enter
 *   tapped made to enter untapped. The mana the two decks have available on
 *   turns 1 to 5, summed, is the loss in mana-turns. Both runs share their
 *   random streams, so the difference is the lands and little else. A deck
 *   with no such lands loses exactly 0.
 * - Tipping point: the first turn the deck's typical spell can be cast (mana
 *   and colors) in at least 80% of games, and in at least 90%. Two bars
 *   because the two published implementations use different ones. The typical
 *   spell has the deck's average mana value and one pip of each of its two
 *   most-played colors.
 * - Mana utilization (Knight's Ertai paper): mana spent on spells over mana
 *   available, turns 1 to the bracket's turn budget, as the mean game and the
 *   unlucky tenth. The goldfish casts the biggest spell it can each turn and
 *   plans nothing ahead, so this is a floor on what a real player does.
 *
 * Runs after paint in slices like the assembly clock (`./clock.ts`), cached by
 * deck, and the same numbers as the synchronous `computeManaBaseMetrics`.
 */

import { TURN_EXPECTATIONS } from '@spellcontrol/deck-metrics';
import type { ScryfallCard } from '@/deck-builder/types';
import { simulateManaDeck, simulateManaDeckSteps } from './engine';
import type { Utilization } from './engine-helpers';
import { compileManaDeck } from './index';
import { parseManaCost } from './cost';
import { librarySeed } from './opening-hand-sim';
import { MANA_SYMBOLS, type ManaCard, type ManaDeck, type ManaSimResult } from './types';

/** Games per run. A tipping share's interval is about two points each way at 50%. */
export const METRIC_GAMES = 2000;
/** Turns the tapped-land cost is summed over. */
export const TAPPED_TURNS = 5;
/** The two tipping-point bars. */
export const TIPPING_BARS = [0.8, 0.9] as const;
/** Turns the simulation plays. Covers the tipping curve and every bracket budget. */
export const METRIC_TURNS = 10;

/** The turn budget the utilization is read over for a bracket: Wizards' earliest-end expectation, never under 4. */
export function turnBudget(bracket: number | null | undefined): number {
  const b = bracket === undefined || bracket === null ? 3 : Math.min(5, Math.max(1, bracket));
  return Math.max(4, TURN_EXPECTATIONS[b as 1 | 2 | 3 | 4 | 5]);
}

export interface ManaBaseMetrics {
  /** Games simulated per run. */
  runs: number;
  tapped: {
    /** Lands in the library that can enter tapped (a conditional land counts). */
    lands: number;
    /** Mana-turns lost on turns 1 to {@link TAPPED_TURNS}, against the same deck with those lands untapped. */
    lost: number;
    /** Index = turn (0 unused): mana available with the lands as they are. */
    actual: number[];
    /** Index = turn (0 unused): mana available with them untapped. */
    untapped: number[];
  };
  tipping: {
    /** The typical spell, as a cost: "{3}{W}{U}". */
    cost: string;
    /** Index = turn (0 unused): share of games able to cast it that turn. */
    curve: number[];
    /** First turn at each bar of {@link TIPPING_BARS}; null when not reached by the last turn played. */
    turns: (number | null)[];
  };
  utilization: Utilization;
}

const LAND_ENTERS_UNTAPPED = new Set(['untapped', 'shock', 'bond']);

/** Can this card, played as a land, enter tapped? */
function entersTapped(card: ManaCard): boolean {
  const f = card.land;
  if (!f) return false;
  return !LAND_ENTERS_UNTAPPED.has(f.entry.kind) || (f.fetch?.tapped ?? false);
}

/** The deck with every land that can enter tapped entering untapped. Same slots, same names. */
export function untappedVariant(deck: ManaDeck): ManaDeck {
  const fix = (c: ManaCard): ManaCard =>
    entersTapped(c)
      ? {
          ...c,
          land: {
            ...(c.land as NonNullable<ManaCard['land']>),
            entry: { kind: 'untapped' },
            fetch: c.land?.fetch ? { ...c.land.fetch, tapped: false } : null,
          },
        }
      : c;
  return { commanders: deck.commanders.map(fix), library: deck.library.map(fix) };
}

/**
 * The deck's typical spell: its average mana value (2 to 6) with one pip of
 * each of the two colors its spells ask for most. A colorless deck's is all
 * generic.
 */
export function typicalSpell(deck: ManaDeck): string {
  const spells = deck.library.filter((c) => c.cost && !c.landCard);
  if (spells.length === 0) return '{3}';
  const mv = spells.reduce((s, c) => s + (c.cost as { mv: number }).mv, 0) / spells.length;
  const n = Math.min(6, Math.max(2, Math.round(mv)));
  const demand = new Array<number>(MANA_SYMBOLS.length).fill(0);
  for (const c of spells) {
    for (const pip of (c.cost as { pips: readonly number[] }).pips) {
      // A hybrid or multi-source pip is split over the colors it can be paid with.
      const bits = MANA_SYMBOLS.map((_, b) => b).filter((b) => pip & (1 << b));
      for (const b of bits) demand[b] += 1 / bits.length;
    }
  }
  const colors = MANA_SYMBOLS.map((s, b) => ({ s, d: demand[b], b }))
    .filter((x) => x.d > 0 && x.s !== 'C')
    .sort((a, b) => b.d - a.d || a.b - b.b)
    .slice(0, 2);
  return `{${n - colors.length}}${colors.map((x) => `{${x.s}}`).join('')}`;
}

/** The first turn the curve reaches the bar, or null. */
export function firstTurnAt(curve: readonly number[], bar: number): number | null {
  for (let t = 1; t < curve.length; t++) if (curve[t] >= bar) return t;
  return null;
}

/** Read the three metrics out of the two runs. */
export function readMetrics(
  deck: ManaDeck,
  main: ManaSimResult,
  free: ManaSimResult,
  cost: string
): ManaBaseMetrics {
  const actual = main.mana.average.slice(0, TAPPED_TURNS + 1);
  const untapped = free.mana.average.slice(0, TAPPED_TURNS + 1);
  let lost = 0;
  for (let t = 1; t <= TAPPED_TURNS; t++) lost += untapped[t] - actual[t];
  const curve = main.tipping ?? [];
  return {
    runs: main.games,
    tapped: { lands: deck.library.filter(entersTapped).length, lost, actual, untapped },
    tipping: { cost, curve, turns: TIPPING_BARS.map((bar) => firstTurnAt(curve, bar)) },
    utilization: main.utilization,
  };
}

function setup(deck: ManaDeck, budget: number, games: number) {
  const cost = typicalSpell(deck);
  const seed = librarySeed([...deck.commanders, ...deck.library]);
  return {
    cost,
    main: {
      games,
      seed,
      maxTurn: METRIC_TURNS,
      typicalCost: parseManaCost(cost) ?? undefined,
      utilTurns: budget,
    },
    free: { games, seed, maxTurn: TAPPED_TURNS },
  };
}

/** Synchronous, for tests and scripts. */
export function computeManaBaseMetrics(
  deck: ManaDeck,
  budget: number,
  games = METRIC_GAMES
): ManaBaseMetrics {
  const s = setup(deck, budget, games);
  return readMetrics(
    deck,
    simulateManaDeck(deck, s.main),
    simulateManaDeck(untappedVariant(deck), s.free),
    s.cost
  );
}

// ── After paint, in slices, shared ──────────────────────────────────────────

/** Milliseconds of engine work per slice, checked between turns. */
const SLICE_MS = 6;
const CACHE_SIZE = 16;

const cache = new Map<string, ManaBaseMetrics | null>();
const inflight = new Map<string, Promise<ManaBaseMetrics | null>>();

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The identity of one set of metrics: the deck's cards and the turn budget. */
export function metricsKey(
  commanders: readonly { name: string }[],
  library: readonly { name: string }[],
  budget: number,
  games = METRIC_GAMES
): string {
  const names = (l: readonly { name: string }[]) =>
    l
      .map((c) => c.name)
      .sort()
      .join('|');
  return [names(commanders), names(library), budget, games].join('#');
}

export function peekManaBaseMetrics(key: string): ManaBaseMetrics | null | undefined {
  return cache.get(key);
}

/** The same numbers as {@link computeManaBaseMetrics}, computed after paint in slices. Concurrent asks share a run. */
export function manaBaseMetricsAsync(
  commanders: readonly ScryfallCard[],
  library: readonly ScryfallCard[],
  budget: number,
  games = METRIC_GAMES
): Promise<ManaBaseMetrics | null> {
  const key = metricsKey(commanders, library, budget, games);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const running = inflight.get(key);
  if (running) return running;

  const run = (async () => {
    await yieldToBrowser();
    const deck = compileManaDeck({ commanders, library });
    if (!deck.library.some((c) => c.cost && !c.landCard)) return null;
    const s = setup(deck, budget, games);
    const slice = { until: 0 };
    const play = async (d: ManaDeck, o: object): Promise<ManaSimResult> => {
      const steps = simulateManaDeckSteps(d, { ...o, budget: slice });
      let step: IteratorResult<void, ManaSimResult>;
      do {
        slice.until = performance.now() + SLICE_MS;
        step = steps.next();
        if (!step.done) await yieldToBrowser();
      } while (!step.done);
      return step.value;
    };
    const main = await play(deck, s.main);
    const free = await play(untappedVariant(deck), s.free);
    return readMetrics(deck, main, free, s.cost);
  })()
    .then((metrics) => {
      cache.set(key, metrics);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
      return metrics;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}
