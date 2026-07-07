import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiftEntry, ScryfallCard } from '@/deck-builder/types';

const fetchCardLiftPoolMock = vi.fn<(name: string) => Promise<LiftEntry[]>>();
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCardLiftPool: (name: string) => fetchCardLiftPoolMock(name),
}));

import { ensureLiftPools, getLiftIndex, MAX_LIFT_SEEDS } from './liftPools';
import type { GenerationState } from './state';

function entry(overrides: Partial<LiftEntry> & { name: string }): LiftEntry {
  return {
    lift: 1,
    coPlayPct: 10,
    numDecks: 200,
    potentialDecks: 1000,
    lowSample: false,
    ...overrides,
  };
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = { name: 'Cmd' } as ScryfallCard;
  return {
    context: {
      commander,
      partnerCommander: null,
      colorIdentity: [],
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
    usedNames: new Set(),
    bannedCards: new Set(),
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
    gameChangerNames: new Set(),
    combos: [],
    edhrecData: { cardlists: { allNonLand: [] } } as unknown as GenerationState['edhrecData'],
    dataSource: 'base',
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

beforeEach(() => {
  fetchCardLiftPoolMock.mockReset();
  fetchCardLiftPoolMock.mockResolvedValue([]);
});

describe('ensureLiftPools', () => {
  it('bails without fetching when the generation has no EDHREC data', async () => {
    const state = makeState({ edhrecData: null });
    const pools = await ensureLiftPools(state, ['Cmd']);
    expect(pools.size).toBe(0);
    expect(fetchCardLiftPoolMock).not.toHaveBeenCalled();
  });

  it('fetches and stores each new seed, skipping empty pools', async () => {
    const state = makeState();
    fetchCardLiftPoolMock.mockImplementation(async (name) =>
      name === 'A' ? [entry({ name: 'X' })] : []
    );
    const pools = await ensureLiftPools(state, ['A', 'B']);
    expect(pools.has('A')).toBe(true);
    expect(pools.has('B')).toBe(false);
    expect(state.liftSeedsTried).toEqual(new Set(['A', 'B']));
  });

  it('does not re-fetch a seed already tried (success or failure)', async () => {
    const state = makeState();
    fetchCardLiftPoolMock.mockResolvedValue([entry({ name: 'X' })]);
    await ensureLiftPools(state, ['A']);
    await ensureLiftPools(state, ['A']);
    expect(fetchCardLiftPoolMock).toHaveBeenCalledTimes(1);
  });

  it('caps attempts at MAX_LIFT_SEEDS across calls', async () => {
    const state = makeState();
    fetchCardLiftPoolMock.mockResolvedValue([]);
    const seeds = Array.from({ length: MAX_LIFT_SEEDS + 5 }, (_, i) => `Seed${i}`);
    await ensureLiftPools(state, seeds);
    expect(fetchCardLiftPoolMock).toHaveBeenCalledTimes(MAX_LIFT_SEEDS);
    expect(state.liftSeedsTried.size).toBe(MAX_LIFT_SEEDS);
  });

  it('soft-fails a rejected fetch instead of throwing', async () => {
    const state = makeState();
    fetchCardLiftPoolMock.mockRejectedValue(new Error('network down'));
    await expect(ensureLiftPools(state, ['A'])).resolves.toBeDefined();
    expect(state.liftSeedsTried.has('A')).toBe(true);
  });
});

describe('getLiftIndex', () => {
  it('memoizes: a second read with no new pools does not rebuild', async () => {
    const state = makeState();
    fetchCardLiftPoolMock.mockResolvedValue([entry({ name: 'X', lift: 10, coPlayPct: 50 })]);
    await ensureLiftPools(state, ['A']);
    const first = getLiftIndex(state);
    const second = getLiftIndex(state);
    expect(second).toBe(first); // same object identity — not rebuilt
  });

  it('rebuilds once a new pool is added', async () => {
    const state = makeState();
    fetchCardLiftPoolMock.mockResolvedValue([entry({ name: 'X', lift: 10, coPlayPct: 50 })]);
    await ensureLiftPools(state, ['A']);
    const first = getLiftIndex(state);
    await ensureLiftPools(state, ['B']);
    const second = getLiftIndex(state);
    expect(second).not.toBe(first);
  });

  it('empty pools yield an empty index', () => {
    const state = makeState();
    expect(getLiftIndex(state).size).toBe(0);
  });
});
