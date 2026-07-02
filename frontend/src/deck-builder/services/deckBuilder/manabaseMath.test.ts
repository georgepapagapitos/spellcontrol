import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  buildManabaseSummary,
  cardColorPips,
  colorSourceCounts,
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
    // Arcane Signet produces W and U → 2 colored nonland source entries.
    expect(summary.nonlandSources).toBe(2);
    const w = summary.lines[0];
    // W sources: Fountain + 2×Plains + Tower + Signet = 5.
    expect(w.sources).toBe(5);
    expect(w.pips).toBe(3); // Wall {W} + Verdict {W}{W}
    expect(w.target).toBeGreaterThanOrEqual(2);
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
});
