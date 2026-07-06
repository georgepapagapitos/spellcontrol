import { describe, it, expect } from 'vitest';
import {
  calculateTargetCounts,
  computeAutoLandCount,
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
    hyperFocus: false,
    balancedRoles: true,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    advancedTargets: {
      curvePercentages: null,
      typePercentages: null,
      roleTargets: null,
      edhrecBlendWeight: null,
      edhrecInclusionThreshold: null,
    },
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
});

describe('calculateTargetCounts — advanced overrides', () => {
  // NOTE: applyAdvancedOverrides only rewrites the *specified* types/buckets and
  // leaves the pre-seeded fallback ones in place — so the grand total exceeds
  // nonLand. These tests pin that real behavior (a refactor must preserve it),
  // not an idealized "normalizes to nonLand" that the code does not implement.
  it('type percentage overrides make the dominant type the largest target', () => {
    const c = makeCustomization({
      landCount: 37,
      advancedTargets: {
        curvePercentages: null,
        typePercentages: { creature: 50, instant: 25, sorcery: 25 },
        roleTargets: null,
        edhrecBlendWeight: null,
        edhrecInclusionThreshold: null,
      },
    });
    const { typeTargets } = calculateTargetCounts(c);
    expect(typeTargets.creature).toBeGreaterThan(typeTargets.instant);
    expect(typeTargets.creature).toBeGreaterThan(typeTargets.sorcery);
    // 50% of 62 non-lands, minus the rounding fixup applied to creature
    expect(typeTargets.creature).toBeGreaterThanOrEqual(28);
  });

  it('curve percentage overrides populate the specified CMC buckets', () => {
    const c = makeCustomization({
      landCount: 37,
      advancedTargets: {
        curvePercentages: { 1: 25, 2: 25, 3: 25, 4: 25 },
        typePercentages: null,
        roleTargets: null,
        edhrecBlendWeight: null,
        edhrecInclusionThreshold: null,
      },
    });
    const { curveTargets } = calculateTargetCounts(c);
    const overridden = curveTargets[1] + curveTargets[2] + curveTargets[3] + curveTargets[4];
    expect(overridden).toBe(nonLand(37)); // the four overridden buckets re-total exactly
    expect(curveTargets[1]).toBeGreaterThan(0);
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

describe('computeAutoLandCount', () => {
  it('stays at 37 for a plain goodstuff deck with average ramp/curve', () => {
    expect(computeAutoLandCount(Archetype.GOODSTUFF, 5, 3.2)).toBe(37);
  });

  it('scales down for an elf-ball/tribal deck dense with ramp (Lathril-shaped)', () => {
    // Tribal archetype delta (-1) + strong ramp density (>=10 => -2) = -3 => 34
    const auto = computeAutoLandCount(Archetype.TRIBAL, 20, 2.4);
    expect(auto).toBeLessThan(37);
    expect(auto).toBeGreaterThanOrEqual(32);
  });

  it('nudges up for a high-curve control/ramp deck', () => {
    const auto = computeAutoLandCount(Archetype.CONTROL, 3, 4.0);
    expect(auto).toBeGreaterThan(37);
    expect(auto).toBeLessThanOrEqual(40);
  });

  it('never goes below the 32-land floor even with extreme inputs', () => {
    expect(computeAutoLandCount(Archetype.TRIBAL, 999, 0.5)).toBeGreaterThanOrEqual(32);
  });

  it('never exceeds the 40-land ceiling even with extreme inputs', () => {
    expect(computeAutoLandCount(Archetype.LANDFALL, 0, 10)).toBeLessThanOrEqual(40);
  });
});
