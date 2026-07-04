import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  buildManabaseSummary,
  cardColorPips,
  colorSourceCounts,
  fetchableBasicColors,
  planBasicColorSplit,
  weightedColorDemand,
} from './manabaseMath';

/** Real-card shapes: name + the fields the math actually reads. */
function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 0,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

const supremeVerdict = card({
  name: 'Supreme Verdict',
  mana_cost: '{1}{W}{W}{U}',
  cmc: 4,
  type_line: 'Sorcery',
});
const wallOfOmens = card({ name: 'Wall of Omens', mana_cost: '{1}{W}', cmc: 2 });
const knightOfWhiteOrchid = card({
  name: 'Knight of the White Orchid',
  mana_cost: '{W}{W}',
  cmc: 2,
});
const counterspell = card({
  name: 'Counterspell',
  mana_cost: '{U}{U}',
  cmc: 2,
  type_line: 'Instant',
});
const graveTitan = card({ name: 'Grave Titan', mana_cost: '{4}{B}{B}', cmc: 6 });

const plains = card({ name: 'Plains', type_line: 'Basic Land — Plains', produced_mana: ['W'] });
const island = card({ name: 'Island', type_line: 'Basic Land — Island', produced_mana: ['U'] });
const hallowedFountain = card({
  name: 'Hallowed Fountain',
  type_line: 'Land — Plains Island',
  produced_mana: ['W', 'U'],
  oracle_text: '({T}: Add {W} or {U}.)',
});
const commandTower = card({
  name: 'Command Tower',
  type_line: 'Land',
  produced_mana: ['W', 'U', 'B', 'R', 'G'],
  oracle_text: '{T}: Add one mana of any color in your commander’s color identity.',
});
const solRing = card({
  name: 'Sol Ring',
  type_line: 'Artifact',
  mana_cost: '{1}',
  cmc: 1,
  produced_mana: ['C'],
  oracle_text: '{T}: Add {C}{C}.',
});
const arcaneSignet = card({
  name: 'Arcane Signet',
  type_line: 'Artifact',
  mana_cost: '{2}',
  cmc: 2,
  produced_mana: ['W', 'U', 'B', 'R', 'G'],
  oracle_text: '{T}: Add one mana of any color in your commander’s color identity.',
});
const cultivate = card({
  name: 'Cultivate',
  type_line: 'Sorcery',
  mana_cost: '{2}{G}',
  cmc: 3,
  oracle_text: 'Search your library for up to two basic land cards…',
});

const WU = new Set(['W', 'U']);

describe('cardColorPips', () => {
  it('counts pips per color, hybrid toward every payable color, across DFC faces', () => {
    expect(cardColorPips(supremeVerdict)).toEqual({ W: 2, U: 1 });
    expect(cardColorPips(card({ mana_cost: '{W/U}{2/R}' }))).toEqual({ W: 1, U: 1, R: 1 });
    const dfc = card({
      mana_cost: undefined,
      card_faces: [
        { name: 'Front', type_line: 'Creature', mana_cost: '{B}{B}' },
        { name: 'Back', type_line: 'Creature', mana_cost: '{R}' },
      ],
    });
    expect(cardColorPips(dfc)).toEqual({ B: 2, R: 1 });
  });
});

describe('weightedColorDemand', () => {
  it('weighs an early double-pip far above a late single pip (Karsten steepness)', () => {
    // {W}{W} at mv2: (2 + 0.5) × 1.3 = 3.25 · {4}{B}{B} at mv6: 2.5 × 1.0 = 2.5
    // {U}{U} at mv2: 3.25 · single {W} at mv2: 1 × 1.3 = 1.3
    const demand = weightedColorDemand([knightOfWhiteOrchid, graveTitan, wallOfOmens]);
    expect(demand.W).toBeCloseTo(3.25 + 1.3, 5);
    expect(demand.B).toBeCloseTo(2.5, 5);
    // Equal raw pips (2W-in-one-cost vs 2B-in-one-cost) — the early cost demands more.
    expect(demand.W).toBeGreaterThan(demand.B);
  });
});

describe('colorSourceCounts', () => {
  it('counts real producers, clamps contextual fixers to identity, skips rituals and colorless rocks', () => {
    const sources = colorSourceCounts(
      [hallowedFountain, commandTower, plains, solRing, arcaneSignet, cultivate],
      WU
    );
    // Hallowed Fountain (W+U) + Command Tower (clamped W+U) + Plains (W) +
    // Arcane Signet (clamped W+U). Sol Ring is colorless; Cultivate is a ritual-type sorcery.
    expect(sources).toEqual({ W: 4, U: 3, B: 0, R: 0, G: 0 });
  });
});

describe('fetchableBasicColors + fetch-aware colorSourceCounts', () => {
  const evolvingWilds = card({
    name: 'Evolving Wilds',
    type_line: 'Land',
    oracle_text:
      '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
  });
  const floodedStrand = card({
    name: 'Flooded Strand',
    type_line: 'Land',
    oracle_text:
      '{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.',
  });
  const windsweptHeath = card({
    name: 'Windswept Heath',
    type_line: 'Land',
    oracle_text:
      '{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Plains card, put it onto the battlefield, then shuffle.',
  });

  it('reads basic-land fetches as all identity colors, typed fetches as their types', () => {
    expect(fetchableBasicColors(evolvingWilds, WU)).toEqual(['W', 'U']);
    expect(fetchableBasicColors(floodedStrand, WU)).toEqual(['W', 'U']);
    // Off-identity fetch types are clamped: Windswept Heath in WU covers only W.
    expect(fetchableBasicColors(windsweptHeath, WU)).toEqual(['W']);
    expect(fetchableBasicColors(plains, WU)).toEqual([]);
  });

  it('counts fetch lands as sources of what they find, but never a nonland tutor', () => {
    const sources = colorSourceCounts([evolvingWilds, floodedStrand, cultivate], WU);
    expect(sources.W).toBe(2);
    expect(sources.U).toBe(2);
    // Kor Cartographer (creature land-tutor) is ramp, not a source: land-only guard.
    const korCartographer = card({
      name: 'Kor Cartographer',
      type_line: 'Creature — Kor Scout',
      mana_cost: '{3}{W}',
      cmc: 4,
      oracle_text:
        'When this creature enters, you may search your library for a Plains card, put it onto the battlefield tapped, then shuffle.',
    });
    expect(colorSourceCounts([korCartographer], WU)).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0 });
  });
});

describe('planBasicColorSplit', () => {
  it('closes the residual deficit: W-skewed nonbasics push basics toward the starved color', () => {
    // Equal W/U pip demand, but every picked nonbasic already makes W.
    const nonland = [wallOfOmens, card({ name: 'Azorius Bird', mana_cost: '{1}{U}', cmc: 2 })];
    const wSources = Array.from({ length: 4 }, (_, i) =>
      card({ name: `W Land ${i}`, type_line: 'Land', produced_mana: ['W'] })
    );
    const split = planBasicColorSplit({
      nonLandCards: nonland,
      pickedLands: wSources,
      identity: WU,
      colors: ['W', 'U'],
      basicsNeeded: 6,
    });
    // Old pip-proportional split: 3/3. Residual: W already has 4 sources, U has 0.
    expect(split.U).toBeGreaterThan(split.W);
    expect(split.W + split.U).toBe(6);
  });

  it('guarantees a splash floor and honors weighted early demand (hand-computed)', () => {
    // W: two {W}{W} two-drops → weighted 6.5 · U: one {U} five-drop → 1.
    const nonland = [
      knightOfWhiteOrchid,
      card({ ...knightOfWhiteOrchid, name: 'Adanto Vanguard' }),
      card({ name: 'Late Blue', mana_cost: '{4}{U}', cmc: 5 }),
    ];
    const split = planBasicColorSplit({
      nonLandCards: nonland,
      pickedLands: [],
      identity: WU,
      colors: ['W', 'U'],
      basicsNeeded: 6,
    });
    // capacity 6 → desired W 5.2, U floored to 2 → apportion({5.2, 2}, 6) = {4, 2}.
    expect(split).toEqual({ W: 4, U: 2 });
  });

  it('falls back to even split with no pips, and gives a single color everything', () => {
    expect(
      planBasicColorSplit({
        nonLandCards: [],
        pickedLands: [],
        identity: WU,
        colors: ['W', 'U'],
        basicsNeeded: 5,
      })
    ).toEqual({ W: 3, U: 2 });
    expect(
      planBasicColorSplit({
        nonLandCards: [wallOfOmens],
        pickedLands: [],
        identity: new Set(['W']),
        colors: ['W'],
        basicsNeeded: 5,
      })
    ).toEqual({ W: 5 });
  });

  it('floors every demanded color at >= 1 basic even when nonbasics fully cover it on paper', () => {
    // Yuriko/Isshin-style bug: W is fully covered by 10 nonbasic W lands (its
    // computed deficit is 0), but it still has real pip demand — a Basic
    // supertype search effect (Sword of the Animist, most fetches) needs an
    // actual basic of that color, not just color-equivalent mana.
    const wSources = Array.from({ length: 10 }, (_, i) =>
      card({ name: `W Land ${i}`, type_line: 'Land', produced_mana: ['W'] })
    );
    const split = planBasicColorSplit({
      nonLandCards: [knightOfWhiteOrchid, counterspell],
      pickedLands: wSources,
      identity: WU,
      colors: ['W', 'U'],
      basicsNeeded: 5,
    });
    expect(split.W).toBeGreaterThanOrEqual(1);
    expect(split.W + split.U).toBe(5);
  });

  it('allocates exactly basicsNeeded even when nothing is short (pip fallback)', () => {
    // Sources already exceed every desire → deficits all zero → raw pip proportion.
    const manyDuals = Array.from({ length: 30 }, (_, i) =>
      card({ name: `Dual ${i}`, type_line: 'Land', produced_mana: ['W', 'U'] })
    );
    const split = planBasicColorSplit({
      nonLandCards: [wallOfOmens, counterspell],
      pickedLands: manyDuals,
      identity: WU,
      colors: ['W', 'U'],
      basicsNeeded: 3,
    });
    expect(split.W + split.U).toBe(3);
  });
});

describe('buildManabaseSummary', () => {
  it('reports demanded colors only, with sources, targets and land/rock counts', () => {
    const lands = [hallowedFountain, plains, plains, island, commandTower];
    const nonland = [wallOfOmens, supremeVerdict, counterspell, solRing, arcaneSignet];
    const summary = buildManabaseSummary(lands, nonland, WU);
    expect(summary.lines.map((l) => l.color)).toEqual(['W', 'U']);
    expect(summary.totalLands).toBe(5);
    // Arcane Signet produces W and U (2 colored entries) + Sol Ring produces
    // colorless (1) → 3 nonland source entries.
    expect(summary.nonlandSources).toBe(3);
    const w = summary.lines[0];
    // W sources: Fountain + 2×Plains + Tower + Signet = 5.
    expect(w.sources).toBe(5);
    expect(w.pips).toBe(3); // Wall {W} + Verdict {W}{W}
    expect(w.target).toBeGreaterThanOrEqual(1);
    expect(w.short).toBe(w.sources < w.target);
  });

  it('flags a starved color and phrases the note against early costs', () => {
    // Heavy early white demand, but the manabase is almost all blue.
    const lands = [island, island, island, island, island, plains];
    const nonland = [
      knightOfWhiteOrchid,
      card({ ...knightOfWhiteOrchid, name: 'Adanto Vanguard' }),
      wallOfOmens,
      counterspell,
    ];
    const summary = buildManabaseSummary(lands, nonland, WU);
    const w = summary.lines.find((l) => l.color === 'W');
    expect(w?.short).toBe(true);
    expect(summary.note).toMatch(/white sources? short for costs at mana value ≤ 2/);
  });

  it('emits no note when every color meets its target', () => {
    const lands = [hallowedFountain, commandTower, plains, island];
    const preordain = card({ name: 'Preordain', mana_cost: '{U}', cmc: 1, type_line: 'Sorcery' });
    const nonland = [wallOfOmens, preordain];
    const summary = buildManabaseSummary(lands, nonland, WU);
    expect(summary.note).toBeUndefined();
  });

  it('never disagrees: short is exactly sources < target, and the note names every short color', () => {
    // Isshin-style: W and R equally starved, both should be flagged AND named.
    // A handful of off-color filler lands give the deck a realistic total
    // mana-source count (a real 99-card deck never runs on a single land).
    const wr = new Set(['W', 'R']);
    const wCard = card({ name: 'Double W', mana_cost: '{W}{W}', cmc: 2 });
    const rCard = card({ name: 'Double R', mana_cost: '{R}{R}', cmc: 2 });
    const filler = Array.from({ length: 8 }, (_, i) =>
      card({ name: `Island ${i}`, type_line: 'Basic Land — Island', produced_mana: ['U'] })
    );
    const summary = buildManabaseSummary(filler, [wCard, rCard], wr);

    // Every line satisfies the single invariant, by construction.
    for (const l of summary.lines) expect(l.short).toBe(l.sources < l.target);

    const shortColors = summary.lines.filter((l) => l.short).map((l) => l.color);
    expect(shortColors.sort()).toEqual(['R', 'W']);
    expect(summary.note).toMatch(/red/);
    expect(summary.note).toMatch(/white/);
  });

  it('caps per-color targets so they can never sum past the deck\'s actual mana sources', () => {
    // 5-color deck, heavy pips in every color, but a small, mono-color-only
    // manabase — the old capacity-share math let per-color targets sum to
    // multiples of the real source count (Ur-Dragon: 153 target vs 95 total).
    const wubrg = new Set(['W', 'U', 'B', 'R', 'G']);
    const heavy = (c: string) =>
      card({ name: `Heavy ${c}`, mana_cost: `{${c}}{${c}}{${c}}{${c}}{${c}}{${c}}{${c}}`, cmc: 7 });
    const nonland = (['W', 'U', 'B', 'R', 'G'] as const).map(heavy);
    // 10 lands total, 2 per color, no multicolor overlap — a tight manabase.
    const lands = (['W', 'U', 'B', 'R', 'G'] as const).flatMap((c) => [
      card({ name: `${c} Land A`, type_line: 'Land', produced_mana: [c] }),
      card({ name: `${c} Land B`, type_line: 'Land', produced_mana: [c] }),
    ]);
    const summary = buildManabaseSummary(lands, nonland, wubrg);
    const totalPermanents = lands.length; // no nonland mana sources in this deck
    const sumTargets = summary.lines.reduce((s, l) => s + l.target, 0);
    expect(sumTargets).toBeLessThanOrEqual(totalPermanents);
    // The invariant still holds after capping.
    for (const l of summary.lines) expect(l.short).toBe(l.sources < l.target);
  });

  it('gives a colorless commander a real, non-blank manabase summary', () => {
    const colorless = new Set<string>();
    const solRingCard = solRing; // produces 'C'
    const wastes = card({ name: 'Wastes', type_line: 'Basic Land — Wastes', produced_mana: ['C'] });
    const eldraziObelisk = card({
      name: 'Eldrazi Temple',
      type_line: 'Land',
      produced_mana: ['C'],
    });
    const summary = buildManabaseSummary(
      [wastes, wastes, eldraziObelisk],
      [solRingCard],
      colorless
    );
    // No WUBRG pips at all, but the manabase panel still needs a real,
    // renderable line (not a blank section) — a single {C} entry.
    expect(summary.lines).toEqual([
      { color: 'C', pips: 0, sources: 4, target: 4, short: false },
    ]);
    // …and nonlandSources/the note both reflect the real colorless base.
    expect(summary.nonlandSources).toBe(1);
    expect(summary.note).toMatch(/colorless/);
  });
});
