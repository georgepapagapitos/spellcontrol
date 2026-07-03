/**
 * Generation-side manabase math: how many sources of each color this deck
 * actually needs, and how to split basics so they close the *residual* deficit
 * after counting what the picked nonbasics and mana rocks already produce.
 *
 * The old basics split was raw pip proportion, which has two failure modes a
 * seasoned player would flinch at:
 *  1. It ignores what the nonbasic lands already make — an Azorius deck whose
 *     duals/utility skew white still got its basics split by pips, over-stacking
 *     Plains and starving Islands.
 *  2. All pips weigh the same — but a {W}{W} two-drop demands far more white
 *     sources than a single {W} in a six-drop (Karsten's castability tables:
 *     requirements rise steeply with pip count and fall with mana value).
 *
 * This module keeps the shape of that insight without the full hypergeometric
 * table: demand per cost = pips + 0.5 per pip beyond the first, scaled by an
 * earliness multiplier (1 + 0.1 × (5 − mv), clamped ≥ 1). Targets distribute the
 * deck's total color-production capacity across colors by that weighted demand,
 * with a 2-source floor for any splash the deck actually casts. The shortfall
 * verdict reuses colorShortfall's pacing-aware thresholds so the build report
 * and the editor's color-balance panel never disagree about "short".
 *
 * Hybrid pips count toward every color they can be paid with (same convention
 * as countColorPips and the analysis panel) — slightly generous to hybrid, but
 * hybrid costs genuinely are easier to cast.
 */
import type { ManabaseSummary, ManabaseColorLine, ScryfallCard } from '@/deck-builder/types';
import { producedManaColors, isManaSourceType } from '@/lib/mana-sources';
import { isColorShort, shortfallThresholdsForCurve } from './colorShortfall';

export const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;
export type ManaColor = (typeof WUBRG)[number];

const COLOR_NAMES: Record<ManaColor, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
};

/** Any demanded color is floored to this many sources (splash protection). */
const SPLASH_FLOOR = 2;

/** Colored pips of one card, per color (hybrid counts for every payable color). */
export function cardColorPips(card: ScryfallCard): Partial<Record<ManaColor, number>> {
  const out: Partial<Record<ManaColor, number>> = {};
  const costs: string[] = [];
  if (card.mana_cost) costs.push(card.mana_cost);
  for (const face of card.card_faces ?? []) if (face.mana_cost) costs.push(face.mana_cost);
  const symbolPattern = /\{([^}]+)\}/g;
  for (const cost of costs) {
    let match;
    while ((match = symbolPattern.exec(cost)) !== null) {
      for (const char of match[1]) {
        if ((WUBRG as readonly string[]).includes(char)) {
          const c = char as ManaColor;
          out[c] = (out[c] ?? 0) + 1;
        }
      }
    }
  }
  return out;
}

/**
 * Castability-weighted demand per color across the nonland cards.
 * Per card and color with k pips: (k + 0.5·(k−1)) × (1 + 0.1·max(0, 5 − mv)).
 */
export function weightedColorDemand(cards: ScryfallCard[]): Record<ManaColor, number> {
  const demand: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of cards) {
    const pips = cardColorPips(card);
    const mv = card.cmc ?? 0;
    const earliness = 1 + 0.1 * Math.max(0, 5 - mv);
    for (const c of WUBRG) {
      const k = pips[c] ?? 0;
      if (k > 0) demand[c] += (k + 0.5 * (k - 1)) * earliness;
    }
  }
  return demand;
}

/** Raw (unweighted) pip totals per color — the analysis panel's demand unit. */
export function rawColorPips(cards: ScryfallCard[]): Record<ManaColor, number> {
  const pips: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of cards) {
    const per = cardColorPips(card);
    for (const c of WUBRG) pips[c] += per[c] ?? 0;
  }
  return pips;
}

/** Basic land type word per color — also matches type lines ("Snow Land — Island"). */
export const BASIC_TYPE_COLORS: ReadonlyArray<[RegExp, ManaColor]> = [
  [/\bplains\b/, 'W'],
  [/\bisland\b/, 'U'],
  [/\bswamp\b/, 'B'],
  [/\bmountain\b/, 'R'],
  [/\bforest\b/, 'G'],
];

/**
 * What a fetch-type card's search clause asks for: any basic land ("basic land
 * card" — Evolving Wilds, Prismatic Vista) or specific basic types (Flooded
 * Strand: "Plains or Island card"). Null for non-fetch text. The single fetch
 * parser — the coherence audit and fetchableBasicColors both read it.
 */
export function fetchedBasicRequirement(
  card: ScryfallCard
): { anyBasic: boolean; colors: ManaColor[] } | null {
  const ot = (card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? '').toLowerCase();
  const m = ot.match(/search your library for [^.]*?card/);
  if (!m) return null;
  const clause = m[0];
  if (/\bbasic land\b/.test(clause)) return { anyBasic: true, colors: [...WUBRG] };
  const colors = BASIC_TYPE_COLORS.filter(([re]) => re.test(clause)).map(([, c]) => c);
  return colors.length > 0 ? { anyBasic: false, colors } : null;
}

/**
 * Colors a fetch-type LAND effectively provides (Karsten counts a fetch as a
 * source of every color it can find). Evolving Wilds / Prismatic Vista ("basic
 * land card") cover every identity color; typed fetches (Flooded Strand:
 * "Plains or Island card") cover the named basic types, clamped to identity.
 * Nonland tutors (Cultivate, Kor Cartographer) are ramp, not sources — callers
 * only ask this for lands. Returns [] for non-fetch text.
 */
export function fetchableBasicColors(
  card: ScryfallCard,
  identity: ReadonlySet<string>
): ManaColor[] {
  const req = fetchedBasicRequirement(card);
  if (!req) return [];
  return req.colors.filter((c) => identity.has(c));
}

/** Per-color source counts a card list produces, clamped to the deck identity.
 *  Fetch lands that produce nothing themselves count as sources of every color
 *  they can find (the Karsten convention). */
export function colorSourceCounts(
  cards: ScryfallCard[],
  identity: ReadonlySet<string>
): Record<ManaColor, number> {
  const sources: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of cards) {
    if (!isManaSourceType(card)) continue;
    let colors = producedManaColors(card, identity);
    const typeLine = (card.type_line || card.card_faces?.[0]?.type_line || '').toLowerCase();
    if (colors.length === 0 && typeLine.includes('land')) {
      colors = fetchableBasicColors(card, identity);
    }
    for (const c of colors) {
      if ((WUBRG as readonly string[]).includes(c) && identity.has(c)) {
        sources[c as ManaColor] += 1;
      }
    }
  }
  return sources;
}

/** Largest-remainder apportionment of `total` integer units by weight. */
function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const floors = exact.map(Math.floor);
  let remaining = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i] += 1;
    remaining -= 1;
  }
  return floors;
}

export interface BasicSplitInput {
  /** The deck's nonland cards (pip demand). */
  nonLandCards: ScryfallCard[];
  /** Nonbasic lands already picked (their production is counted first). */
  pickedLands: ScryfallCard[];
  /** Deck color identity (WUBRG letters). */
  identity: ReadonlySet<string>;
  /** Colors eligible for basics (identity colors with a basic type). */
  colors: string[];
  basicsNeeded: number;
}

/**
 * Split `basicsNeeded` across colors so basics close each color's residual
 * source deficit: desired sources by weighted demand (with a splash floor),
 * minus what the picked nonbasics and the deck's own rocks/dorks already
 * produce. Falls back to raw pip proportion when nothing is short, and to an
 * even split when there are no pips at all (the old behaviors, preserved).
 */
export function planBasicColorSplit(input: BasicSplitInput): Record<string, number> {
  const { nonLandCards, pickedLands, identity, colors, basicsNeeded } = input;
  const out: Record<string, number> = {};
  const eligible = colors.filter((c): c is ManaColor => (WUBRG as readonly string[]).includes(c));
  if (eligible.length === 0 || basicsNeeded <= 0) return out;

  const demand = weightedColorDemand(nonLandCards);
  const pips = rawColorPips(nonLandCards);
  const totalDemand = eligible.reduce((s, c) => s + demand[c], 0);

  // No colored pips at all → even split (previous behavior).
  if (totalDemand <= 0) {
    const per = Math.floor(basicsNeeded / eligible.length);
    const rem = basicsNeeded % eligible.length;
    eligible.forEach((c, i) => {
      out[c] = per + (i < rem ? 1 : 0);
    });
    return out;
  }

  const produced = colorSourceCounts(pickedLands, identity);
  const spellSources = colorSourceCounts(nonLandCards, identity);

  // Total color-production capacity once basics land: every source counts once
  // per color it makes, so duals legitimately push the sum past the land count.
  let capacity = basicsNeeded;
  for (const c of WUBRG) capacity += produced[c] + spellSources[c];

  // Desired sources per color: capacity share by weighted demand, splash-floored.
  const deficits = eligible.map((c) => {
    const desired = Math.max((demand[c] / totalDemand) * capacity, pips[c] > 0 ? SPLASH_FLOOR : 0);
    return Math.max(0, desired - produced[c] - spellSources[c]);
  });

  const allocated = deficits.some((d) => d > 0)
    ? apportion(deficits, basicsNeeded)
    : apportion(
        eligible.map((c) => pips[c]),
        basicsNeeded
      );
  eligible.forEach((c, i) => {
    out[c] = allocated[i];
  });
  return out;
}

/**
 * The build report's manabase self-explanation, computed over the FINAL deck
 * (after trims/audits/padding), so it describes what actually shipped.
 */
export function buildManabaseSummary(
  lands: ScryfallCard[],
  nonLandCards: ScryfallCard[],
  identity: ReadonlySet<string>
): ManabaseSummary {
  const demand = weightedColorDemand(nonLandCards);
  const pips = rawColorPips(nonLandCards);
  const landSources = colorSourceCounts(lands, identity);
  const spellSources = colorSourceCounts(nonLandCards, identity);

  const demanded = WUBRG.filter((c) => pips[c] > 0);
  const totalDemand = demanded.reduce((s, c) => s + demand[c], 0);
  let capacity = 0;
  for (const c of WUBRG) capacity += landSources[c] + spellSources[c];

  const curve: Record<number, number> = {};
  for (const card of nonLandCards) {
    const mv = Math.round(card.cmc ?? 0);
    curve[mv] = (curve[mv] ?? 0) + 1;
  }
  const thresholds = shortfallThresholdsForCurve(curve);

  const lines: ManabaseColorLine[] = demanded.map((c) => {
    const sources = landSources[c] + spellSources[c];
    const target =
      totalDemand > 0
        ? Math.max(Math.round((demand[c] / totalDemand) * capacity), SPLASH_FLOOR)
        : 0;
    return {
      color: c,
      pips: pips[c],
      sources,
      target,
      short: isColorShort(pips[c], sources, thresholds),
    };
  });

  // Headline: the worst under-target color, qualified with "early costs" when
  // most of its pips sit at mana value ≤ 2 (the Karsten-critical band).
  let note: string | undefined;
  const worst = lines
    .filter((l) => l.sources < l.target)
    .sort((a, b) => b.target - b.sources - (a.target - a.sources))[0];
  if (worst) {
    const worstColor = worst.color as ManaColor; // lines are built from WUBRG above
    const deficit = worst.target - worst.sources;
    const earlyPips = nonLandCards.reduce((s, card) => {
      if ((card.cmc ?? 0) > 2) return s;
      return s + (cardColorPips(card)[worstColor] ?? 0);
    }, 0);
    const early = worst.pips > 0 && earlyPips / worst.pips >= 0.5;
    note = `${deficit} ${COLOR_NAMES[worstColor]} source${deficit === 1 ? '' : 's'} short${
      early ? ' for costs at mana value ≤ 2' : ' of target'
    }`;
  }

  const nonlandSources = WUBRG.reduce((s, c) => s + spellSources[c], 0);
  return { lines, totalLands: lands.length, nonlandSources, note };
}
