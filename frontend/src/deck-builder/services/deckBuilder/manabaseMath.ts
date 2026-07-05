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
 * earliness multiplier (1 + 0.1 × (5 − mv), clamped ≥ 1). The basic-land split
 * distributes the deck's total color-production capacity across colors by that
 * weighted demand, with a 2-source floor for any splash the deck actually
 * casts (plus a 1-basic-per-demanded-color floor so a Basic-supertype search
 * effect always has a real target, even when nonbasic duals already cover the
 * color on paper).
 *
 * The build report's per-color `target`/`short` is a separate, simpler bar:
 * `short` reuses colorShortfall's pacing-aware ratio × raw pips (the same
 * coverage bar the editor's color-balance panel judges by), and `target` is
 * that same bar made concrete as a sources count, feasibility-capped so
 * per-color targets can't sum past the deck's actual mana-source count.
 * `short` is exactly `sources < target` — one baseline, so the boolean and the
 * note can never disagree.
 *
 * Hybrid pips count toward every color they can be paid with (same convention
 * as countColorPips and the analysis panel) — slightly generous to hybrid, but
 * hybrid costs genuinely are easier to cast.
 */
import type { ManabaseSummary, ManabaseColorLine, ScryfallCard } from '@/deck-builder/types';
import { producedManaColors, isManaSourceType } from '@/lib/mana-sources';
import { shortfallThresholdsForCurve } from './colorShortfall';

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
  const floored = enforceFloor(
    eligible.map((c) => pips[c] > 0),
    allocated
  );
  eligible.forEach((c, i) => {
    out[c] = floored[i];
  });
  return out;
}

/**
 * Every flagged index gets at least 1, redistributed from whichever index
 * currently holds the most — the total never changes, just who holds it.
 * Two uses: (1) every color with real pip demand gets >= 1 basic, even when
 * nonbasic duals/rocks already "solve" it on paper (a Basic-supertype search
 * effect like Sword of the Animist whiffs on a shockland that happens to
 * produce the same color); (2) a demanded color's shortfall target never
 * rounds down to 0 under the feasibility cap, which would silently un-flag a
 * color with literally zero sources.
 */
function enforceFloor(flagged: boolean[], allocated: number[]): number[] {
  const FLOOR = 1;
  const result = [...allocated];
  for (let i = 0; i < result.length; i++) {
    if (!flagged[i]) continue;
    while (result[i] < FLOOR) {
      let donor = -1;
      for (let j = 0; j < result.length; j++) {
        if (j === i || result[j] <= FLOOR) continue;
        if (donor === -1 || result[j] > result[donor]) donor = j;
      }
      if (donor === -1) break; // nothing left to redistribute
      result[donor] -= 1;
      result[i] += 1;
    }
  }
  return result;
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
  const pips = rawColorPips(nonLandCards);
  const landSources = colorSourceCounts(lands, identity);
  const spellSources = colorSourceCounts(nonLandCards, identity);

  // Cheap guard: a color can only be "demanded" if it's within the commander's
  // identity. Every legal nonland card's pips already fall within identity —
  // this only matters if an identity-illegal card ever slips into nonLandCards
  // upstream (see the Combo Integrity Audit's fitsColorIdentity gate) — but
  // the manabase repair must never chase a pip count that shouldn't exist,
  // recommending an off-identity basic land.
  const demanded = WUBRG.filter((c) => pips[c] > 0 && identity.has(c));

  const curve: Record<number, number> = {};
  for (const card of nonLandCards) {
    const mv = Math.round(card.cmc ?? 0);
    curve[mv] = (curve[mv] ?? 0) + 1;
  }
  const thresholds = shortfallThresholdsForCurve(curve);

  // Per-color target = the same coverage bar `isColorShort` judges against
  // (ratio × pips, forgiven under the splash-forgiveness floor), made concrete
  // as a sources count so `short` and the note both read the *same* number —
  // they used to disagree because `short` came from this bar while the note's
  // deficit came from an unrelated, separately-computed capacity-share target.
  const rawTargets = demanded.map((c) => {
    const sources = landSources[c] + spellSources[c];
    const gated = sources === 0 || pips[c] >= thresholds.minDemand;
    // pips[c] >= 1 here (demanded filter), so ceil(pips*ratio) is always >= 1.
    return gated ? Math.ceil(pips[c] * thresholds.ratio) : sources;
  });

  // A 5-color deck's raw per-color bars are computed independently, so they
  // can still sum past the deck's actual mana-source count. Scale down
  // proportionally to what's achievable — never up, so this can only relax a
  // flag, never invent one — reusing the same largest-remainder apportionment
  // as the basic-land split. Count *actual* producers (colored or colorless),
  // not just permanents of a mana-source-eligible type — a vanilla creature is
  // "not an instant/sorcery" but produces nothing.
  const producesMana = (c: ScryfallCard): boolean => {
    if (!isManaSourceType(c)) return false;
    if (producedManaColors(c, identity).length > 0) return true;
    const typeLine = (c.type_line || c.card_faces?.[0]?.type_line || '').toLowerCase();
    return typeLine.includes('land') && fetchableBasicColors(c, identity).length > 0;
  };
  const totalPermanents =
    lands.filter(producesMana).length + nonLandCards.filter(producesMana).length;
  const sumTargets = rawTargets.reduce((a, b) => a + b, 0);
  const capped =
    sumTargets > totalPermanents && totalPermanents > 0
      ? apportion(rawTargets, totalPermanents)
      : rawTargets;
  // Largest-remainder rounding can crush a color's capped share to 0 — which
  // would silently un-flag a color with literally zero sources. Every
  // demanded color keeps a floor of 1 (same redistribution as the basic
  // split's floor; a no-op when nothing needed capping in the first place).
  const targets = enforceFloor(
    demanded.map(() => true),
    capped
  );

  const lines: ManabaseColorLine[] = demanded.map((c, i) => {
    const sources = landSources[c] + spellSources[c];
    const target = targets[i];
    return { color: c, pips: pips[c], sources, target, short: sources < target };
  });

  // Headline: every short color, worst-deficit first — not just the worst
  // one. A single short color keeps the "early costs" qualifier (mana value
  // ≤ 2 band); several are just listed, since a shared qualifier would be
  // misleading across colors with different curves.
  const shortLines = lines
    .filter((l) => l.short)
    .sort((a, b) => b.target - b.sources - (a.target - a.sources));
  let note: string | undefined;
  if (shortLines.length === 1) {
    const worst = shortLines[0];
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
  } else if (shortLines.length > 1) {
    note =
      shortLines
        .map((l) => {
          const deficit = l.target - l.sources;
          return `${deficit} ${COLOR_NAMES[l.color as ManaColor]} source${deficit === 1 ? '' : 's'}`;
        })
        .join(', ') + ' short of target';
  }

  // Colorless mana doesn't gate on a WUBRG identity check, so it's counted
  // independent of `colorSourceCounts` (which only ever tallies WUBRG).
  const nonlandColorless = nonLandCards.filter(
    (c) => isManaSourceType(c) && producedManaColors(c, identity).includes('C')
  ).length;
  const nonlandSources = WUBRG.reduce((s, c) => s + spellSources[c], 0) + nonlandColorless;

  // A colorless commander has zero WUBRG pips, so `lines` is legitimately
  // empty — but the deck still has a real manabase worth a one-line summary
  // instead of a silent blank.
  if (lines.length === 0 && !WUBRG.some((c) => identity.has(c))) {
    const landColorless = lands.filter(
      (c) => isManaSourceType(c) && producedManaColors(c, identity).includes('C')
    ).length;
    const total = landColorless + nonlandColorless;
    note = total > 0 ? `${total} colorless mana source${total === 1 ? '' : 's'}` : undefined;
    // ponytail: target = total (no colorless curve-based demand heuristic
    // exists yet; upgrade if colorless shortfall detection is ever wanted).
    lines.push({ color: 'C', pips: 0, sources: total, target: total, short: false });
  }

  return { lines, totalLands: lands.length, nonlandSources, note };
}
