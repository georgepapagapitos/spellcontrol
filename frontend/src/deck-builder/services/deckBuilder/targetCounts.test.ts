import { describe, it, expect } from 'vitest';
import {
  calculateTargetCounts,
  computeAutoLandCount,
  computeLandCountSizingAnchor,
  computeEffectiveNonBasicLandCount,
  isDefaultLandCount,
  DEFAULT_LAND_COUNT,
} from './targetCounts';
import { Archetype } from '@/deck-builder/types';
import type { Customization, EDHRECCommanderStats } from '@/deck-builder/types';

// Static (no-localStorage) Customization factory — mirrors the store default
// shape without importing the store, which reads localStorage at module load.
function makeCustomization(overrides: Partial<Customization> = {}): Customization {
  return {
    deckFormat: 99,
    landCount: 37,
    nonBasicLandCount: 15,
    bannedCards: [],
    banLists: [],
    mustIncludeCards: [],
    tempBannedCards: [],
    tempMustIncludeCards: [],
    maxCardPrice: null,
    deckBudget: null,
    budgetOption: 'any',
    gameChangerLimit: 'unlimited',
    targetBracket: 'all',
    maxRarity: null,
    tinyLeaders: false,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 1,
    balancedRoles: true,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    saltTolerance: 2,
    generationMode: 'edhrec',
    artThemeTag: '',
    historicalYear: 2005,
    permanentsOnly: false,
    brewLevel: 0.5,
    ...overrides,
  };
}

const sum = (o: Record<string | number, number>) => Object.values(o).reduce((a, b) => a + b, 0);

// deckCards = 100 - 1 commander = 99; nonLand = 99 - landCount
const nonLand = (landCount: number) => 99 - landCount;

describe('calculateTargetCounts — fallback path (no EDHREC stats)', () => {
  it('reserves the requested land count and distributes the rest across non-lands', () => {
    const { composition } = calculateTargetCounts(makeCustomization({ landCount: 37 }));
    expect(composition.lands).toBe(37);
    // 99-card Commander known defaults
    expect(composition.ramp).toBe(10);
    expect(composition.cardDraw).toBe(10);
    expect(composition.creatures).toBe(25);
  });

  it('fallback type targets sum exactly to the non-land card count', () => {
    const { typeTargets } = calculateTargetCounts(makeCustomization({ landCount: 37 }));
    expect(sum(typeTargets)).toBe(nonLand(37));
  });

  it('accounts for a partner commander taking an extra slot', () => {
    const withPartner = calculateTargetCounts(makeCustomization(), undefined, true);
    const solo = calculateTargetCounts(makeCustomization(), undefined, false);
    expect(sum(withPartner.typeTargets)).toBe(sum(solo.typeTargets) - 1);
  });

  it('clamps an absurd land count to deckCards - 1', () => {
    const { composition } = calculateTargetCounts(makeCustomization({ landCount: 999 }));
    expect(composition.lands).toBe(98);
  });

  // E128: the DeckCustomizer slider already floors interactive input at 32
  // (see components/deck/DeckCustomizer.tsx's RangeSlider min={32}) — this
  // guards any auto/programmatic caller that bypasses the slider, matching
  // the same number rather than inventing a second one.
  it('floors an absurdly low land count to the slider minimum (32)', () => {
    const { composition } = calculateTargetCounts(makeCustomization({ landCount: 5 }));
    expect(composition.lands).toBe(32);
  });

  it('floors a zero/negative land count the same way', () => {
    expect(calculateTargetCounts(makeCustomization({ landCount: 0 })).composition.lands).toBe(32);
    expect(calculateTargetCounts(makeCustomization({ landCount: -10 })).composition.lands).toBe(32);
  });
});

describe('calculateTargetCounts — EDHREC stats path', () => {
  const stats: EDHRECCommanderStats = {
    avgPrice: 200,
    numDecks: 1000,
    deckSize: 81,
    manaCurve: { 1: 10, 2: 20, 3: 20, 4: 15, 5: 10, 6: 5 },
    typeDistribution: {
      creature: 30,
      instant: 8,
      sorcery: 7,
      artifact: 10,
      enchantment: 6,
      land: 37,
      planeswalker: 2,
      battle: 0,
    },
    landDistribution: { basic: 12, nonbasic: 25, total: 37 },
  };

  it('uses percentage-based targets and still reserves the land count', () => {
    const { composition, typeTargets, curveTargets } = calculateTargetCounts(
      makeCustomization({ landCount: 36 }),
      stats
    );
    expect(composition.lands).toBe(36);
    expect(Object.keys(typeTargets).length).toBeGreaterThan(0);
    expect(Object.keys(curveTargets).length).toBeGreaterThan(0);
  });
});

describe('calculateTargetCounts — landCountOverride', () => {
  it('honors the override over customization.landCount', () => {
    const { composition } = calculateTargetCounts(
      makeCustomization({ landCount: 37 }),
      undefined,
      false,
      undefined,
      33
    );
    expect(composition.lands).toBe(33);
  });

  it('falls back to customization.landCount when no override is given', () => {
    const { composition } = calculateTargetCounts(makeCustomization({ landCount: 37 }));
    expect(composition.lands).toBe(37);
  });
});

describe('calculateTargetCounts — typeTargetLandCount (E88)', () => {
  it('is byte-identical to omitting it when equal to the resolved land count', () => {
    const omitted = calculateTargetCounts(
      makeCustomization({ landCount: 37 }),
      undefined,
      false,
      undefined,
      40
    );
    const explicit = calculateTargetCounts(
      makeCustomization({ landCount: 37 }),
      undefined,
      false,
      undefined,
      40,
      40
    );
    expect(explicit).toEqual(omitted);
  });

  it('sizes typeTargets/curveTargets off the SMALLER typeTargetLandCount while composition.lands reports the real (larger) count', () => {
    const { composition, typeTargets } = calculateTargetCounts(
      makeCustomization({ landCount: 40 }),
      undefined,
      false,
      undefined,
      40,
      DEFAULT_LAND_COUNT // 37 — as if lands were still at baseline
    );
    // Actual land generation target is unaffected...
    expect(composition.lands).toBe(40);
    // ...but the nonland type-pass budget is sized off 99 - 37 = 62, not 99 - 40 = 59.
    expect(sum(typeTargets)).toBe(nonLand(DEFAULT_LAND_COUNT));
    expect(sum(typeTargets)).not.toBe(nonLand(40));
  });

  it('is a no-op (identical to the explicit-user-choice path) when typeTargetLandCount equals landCountOverride', () => {
    const withParam = calculateTargetCounts(
      makeCustomization({ landCount: 37 }),
      undefined,
      false,
      undefined,
      35,
      35
    );
    const withoutParam = calculateTargetCounts(
      makeCustomization({ landCount: 37 }),
      undefined,
      false,
      undefined,
      35
    );
    expect(withParam).toEqual(withoutParam);
  });
});

describe('isDefaultLandCount', () => {
  it('is true at the untouched store defaults', () => {
    expect(isDefaultLandCount(makeCustomization({ landCount: 37, nonBasicLandCount: 15 }))).toBe(
      true
    );
  });

  it('is false once the user has changed land count', () => {
    expect(isDefaultLandCount(makeCustomization({ landCount: 34, nonBasicLandCount: 15 }))).toBe(
      false
    );
  });

  it('is false once the user has changed nonbasic land count', () => {
    expect(isDefaultLandCount(makeCustomization({ landCount: 37, nonBasicLandCount: 18 }))).toBe(
      false
    );
  });
});

describe('computeAutoLandCount (Karsten formula)', () => {
  // round(31.42 + 3.13*avgCmc - 0.28*rampDensity), clamped [32, 40].
  // Archetype no longer feeds the formula — passed values are arbitrary.

  it('matches the known-value case: avgCmc 3.0, ramp 12 => 37', () => {
    // 31.42 + 3.13*3.0 - 0.28*12 = 31.42 + 9.39 - 3.36 = 37.45 => round 37
    expect(computeAutoLandCount(Archetype.GOODSTUFF, 12, 3.0)).toBe(37);
  });

  it('clamps to the 32-land floor for low curve + heavy ramp (Lathril-shaped)', () => {
    // 31.42 + 3.13*2.0 - 0.28*30 = 31.42 + 6.26 - 8.4 = 29.28 => round 29 => floor 32
    expect(computeAutoLandCount(Archetype.TRIBAL, 30, 2.0)).toBe(32);
  });

  it('clamps to the 40-land ceiling for a high-curve, ramp-light deck (Kozilek-shaped)', () => {
    // 31.42 + 3.13*5.0 - 0.28*14 = 31.42 + 15.65 - 3.92 = 43.15 => round 43 => ceiling 40
    expect(computeAutoLandCount(Archetype.CONTROL, 14, 5.0)).toBe(40);
  });

  it('never goes below the 32-land floor even with extreme inputs', () => {
    expect(computeAutoLandCount(Archetype.TRIBAL, 999, 0)).toBeGreaterThanOrEqual(32);
  });

  it('never exceeds the 40-land ceiling even with extreme inputs', () => {
    expect(computeAutoLandCount(Archetype.LANDFALL, 0, 10)).toBeLessThanOrEqual(40);
  });
});

// E94: the legacy archetype-delta heuristic, recovered verbatim under a new
// name for its ORIGINAL job — sizing typeTargetLandCount's pass proportions
// — never the delivered land count (Karsten owns that now). Expectations are
// the same ones computeAutoLandCount had before Karsten replaced it.
describe('computeLandCountSizingAnchor (recovered legacy heuristic, sizing-only)', () => {
  it('stays at 37 for a plain goodstuff deck with average ramp/curve', () => {
    expect(computeLandCountSizingAnchor(Archetype.GOODSTUFF, 5, 3.2)).toBe(37);
  });

  it('scales down for an elf-ball/tribal deck dense with ramp (Lathril-shaped)', () => {
    // Tribal archetype delta (-1) + strong ramp density (>=10 => -2) = -3 => 34
    const anchor = computeLandCountSizingAnchor(Archetype.TRIBAL, 20, 2.4);
    expect(anchor).toBeLessThan(37);
    expect(anchor).toBeGreaterThanOrEqual(32);
  });

  it('nudges up for a high-curve control/ramp deck', () => {
    const anchor = computeLandCountSizingAnchor(Archetype.CONTROL, 3, 4.0);
    expect(anchor).toBeGreaterThan(37);
    expect(anchor).toBeLessThanOrEqual(40);
  });

  it('never goes below the 32-land floor even with extreme inputs', () => {
    expect(computeLandCountSizingAnchor(Archetype.TRIBAL, 999, 0.5)).toBeGreaterThanOrEqual(32);
  });

  it('never exceeds the 40-land ceiling even with extreme inputs', () => {
    expect(computeLandCountSizingAnchor(Archetype.LANDFALL, 0, 10)).toBeLessThanOrEqual(40);
  });
});

// E100: nonBasicLandCount is a flat user-facing customization that the
// Karsten auto-tune raise otherwise leaves untouched — so a raise lands
// entirely as basics, diluting the manabase. This scales it by the same
// overflow-past-anchor amount the land-squeeze reconcile already tracks —
// EXCEPT for mono-color identities (live-differ gate regression: krenko/
// talrand traded their one colored source for a colorless/tapped utility
// land), which pass the input through verbatim regardless of the raise.
// colorIdentityCount: 2 (a generic multi-color deck) is used as the default
// "scaling applies" case throughout except where a test is specifically
// about the color-count gate.
describe('computeEffectiveNonBasicLandCount', () => {
  it('is byte-identical to the input when the land count was never auto-tuned', () => {
    expect(computeEffectiveNonBasicLandCount(15, false, 43, 37, 2)).toBe(15);
  });

  it('is byte-identical to the input when auto-tuned but resolved count never exceeds the anchor', () => {
    // Kozilek-shaped: Karsten resolves at or below the legacy sizing anchor.
    expect(computeEffectiveNonBasicLandCount(15, true, 37, 37, 0)).toBe(15);
    expect(computeEffectiveNonBasicLandCount(15, true, 34, 37, 2)).toBe(15);
  });

  it('scales up by exactly the overflow when the auto-tune raises past the anchor (kozilek-shaped, colorless)', () => {
    // resolvedLandCount 43 vs anchor 41 => +2 nonbasic slots, never a drop.
    // Kozilek is colorless (colorIdentityCount 0) — a pure utility upgrade,
    // no colored source to trade away, so it still scales.
    expect(computeEffectiveNonBasicLandCount(15, true, 43, 41, 0)).toBe(17);
  });

  it('scales up for a multi-color identity the same way (incoming nonbasics are fixers)', () => {
    expect(computeEffectiveNonBasicLandCount(15, true, 43, 41, 4)).toBe(17);
  });

  it('passes the input through verbatim for a mono-color identity even when auto-tuned past the anchor (krenko/talrand-shaped)', () => {
    // Same raise as the kozilek/multi-color cases above (43 vs anchor 41),
    // but colorIdentityCount 1 — the differ regression: a mono deck's one
    // colored source gets traded for colorless/tapped utility, dropping
    // colored sources against a manabase-math target that was already short.
    expect(computeEffectiveNonBasicLandCount(15, true, 43, 41, 1)).toBe(15);
  });

  it('never reduces the nonbasic count as the raise grows — monotonically non-decreasing', () => {
    const base = computeEffectiveNonBasicLandCount(15, true, 37, 37, 2);
    const raised1 = computeEffectiveNonBasicLandCount(15, true, 39, 37, 2);
    const raised2 = computeEffectiveNonBasicLandCount(15, true, 40, 37, 2);
    expect(raised1).toBeGreaterThanOrEqual(base);
    expect(raised2).toBeGreaterThanOrEqual(raised1);
  });

  it('respects an explicit user nonBasicLandCount verbatim (auto-tune is inert whenever the user customized it)', () => {
    // landCountAutoTuned is always false once the user has touched
    // nonBasicLandCount (isDefaultLandCount requires ===15) — this call
    // models that guaranteed-false case for a user's explicit 25.
    expect(computeEffectiveNonBasicLandCount(25, false, 43, 37, 1)).toBe(25);
  });
});
