import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

function card(name: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 1,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    inclusion: 50,
  } as unknown as ScryfallCard;
}

const pickMock = vi.fn();
vi.mock('../cardPicking', () => ({
  pickFromPrefetchedWithCurve: (...args: unknown[]) => pickMock(...args),
}));

import { wildcardScanPhase } from './phaseWildcardScan';
import type { GenerationState } from './state';

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  return {
    context: {
      commander: card('Test Commander'),
      partnerCommander: null,
      colorIdentity: ['W'],
      customization: {} as GenerationState['context']['customization'],
    },
    cfg: {
      format: 99,
      maxCardPrice: null,
      budgetOption: undefined,
      targetBracket: undefined,
      maxRarity: null,
      maxCmc: null,
      arenaOnly: false,
      scryfallQuery: '',
      preferredSet: undefined,
      maxGameChangers: Infinity,
      deckBudget: null,
      currency: 'USD',
      ignoreOwnedBudget: false,
      ignoreOwnedRarity: false,
      collectionStrategy: 'full',
      collectionOwnedPercent: 75,
      comboCountSetting: 0,
      selectedThemesWithSlugs: [],
    },
    usedNames: new Set<string>(),
    bannedCards: new Set<string>(),
    categories: {
      lands: [],
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: [],
      synergy: [],
      utility: [],
    },
    currentCurveCounts: {},
    currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
    currentSubtypeCounts: {},
    staticComboBoosts: new Map(),
    comboCardNames: new Set(),
    comboCards: new Map(),
    gameChangerCount: { value: 0 },
    mustIncludeNames: [],
    mustIncludeSources: new Map(),
    saltIndex: new Map(),
    liftSeedPools: new Map(),
    liftSeedsTried: new Set(),
    gameChangerNames: new Set<string>(),
    combos: [],
    edhrecData: null,
    dataSource: 'base',
    baseData: null,
    themeOverlapCounts: new Map(),
    roleTargets: null,
    roleTargetBreakdown: undefined,
    detectedArchetype: undefined,
    resolvedPacing: 'balanced',
    detectedPacing: 'balanced',
    swapCandidates: undefined,
    detectedCombos: undefined,
    gapAnalysis: undefined,
    deckScore: undefined,
    cardInclusionMap: undefined,
    cardRelevancyMap: undefined,
    stats: undefined,
    representativeStats: undefined,
    usedThemes: undefined,
    ...overrides,
  } as GenerationState;
}

function baseCtx() {
  return {
    landCountAutoTuned: false,
    typeTargetLandCount: 32,
    scryfallCardMap: new Map<string, ScryfallCard>(),
    budgetTracker: null,
    bracketGuard: undefined,
    isCardAllowedBySynergyDependencies: () => true,
    liftTieBreak: new Map<string, number>(),
    resolvePriceSanity: () => true,
    isOverRoleCap: () => false,
    roleTargets: null,
  };
}

describe('wildcardScanPhase', () => {
  it('is inert (zero cost, empty result) when land count was never auto-tuned', () => {
    const state = makeState();
    const result = wildcardScanPhase(state, baseCtx());
    expect(result).toEqual({ wildcardCount: 0, wildcardCandidates: [] });
    expect(pickMock).not.toHaveBeenCalled();
  });

  it('is inert when the auto-tune landed exactly at the 32-land floor', () => {
    const state = makeState();
    const result = wildcardScanPhase(state, {
      ...baseCtx(),
      landCountAutoTuned: true,
      typeTargetLandCount: 32,
    });
    expect(result).toEqual({ wildcardCount: 0, wildcardCandidates: [] });
    expect(pickMock).not.toHaveBeenCalled();
  });

  it('scans the pool and computes wildcardCount above the 32-land floor', () => {
    const state = makeState();
    state.edhrecData = {
      themes: [],
      stats: {} as GenerationState['edhrecData'] extends null ? never : never,
      cardlists: { allNonLand: [card('A'), card('B')] },
      similarCommanders: [],
    } as unknown as GenerationState['edhrecData'];
    pickMock.mockReturnValue([card('A'), card('B')]);
    const result = wildcardScanPhase(state, {
      ...baseCtx(),
      landCountAutoTuned: true,
      typeTargetLandCount: 36,
    });
    expect(result.wildcardCount).toBe(4);
    expect(pickMock).toHaveBeenCalledTimes(1);
    expect(result.wildcardCandidates.map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('filters candidates that are over their role cap', () => {
    const state = makeState();
    state.edhrecData = {
      themes: [],
      stats: {},
      cardlists: { allNonLand: [card('A'), card('B')] },
      similarCommanders: [],
    } as unknown as GenerationState['edhrecData'];
    pickMock.mockReturnValue([card('A'), card('B')]);
    const result = wildcardScanPhase(state, {
      ...baseCtx(),
      landCountAutoTuned: true,
      typeTargetLandCount: 36,
      isOverRoleCap: (c) => c.name === 'A',
    });
    expect(result.wildcardCandidates.map((c) => c.name)).toEqual(['B']);
  });
});
