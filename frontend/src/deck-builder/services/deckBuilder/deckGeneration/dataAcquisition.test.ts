import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCommanderData, ScryfallCard } from '@/deck-builder/types';

const fetchCommanderCombosRawMock = vi.fn();
const fetchCommanderDataMock = vi.fn();
vi.mock('@/deck-builder/services/edhrec/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCommanderCombosRaw: (...args: unknown[]) => fetchCommanderCombosRawMock(...args),
  fetchCommanderData: (...args: unknown[]) => fetchCommanderDataMock(...args),
}));

const prefetchBasicLandsMock = vi.fn(async () => undefined);
const getGameChangerNamesMock = vi.fn(async () => new Set<string>());
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  prefetchBasicLands: () => prefetchBasicLandsMock(),
  getGameChangerNames: () => getGameChangerNamesMock(),
}));

const loadTaggerDataMock = vi.fn(async () => ({}));
const hasTaggerDataMock = vi.fn(() => true);
vi.mock('@/deck-builder/services/tagger/client', () => ({
  loadTaggerData: () => loadTaggerDataMock(),
  hasTaggerData: () => hasTaggerDataMock(),
}));

const loadCardSimilarMock = vi.fn(async () => ({}));
const hasCardSimilarMock = vi.fn(() => true);
vi.mock('../cardSimilar', () => ({
  loadCardSimilar: () => loadCardSimilarMock(),
  hasCardSimilar: () => hasCardSimilarMock(),
}));

const buildAlternatePoolMock = vi.fn();
vi.mock('../phaseAlternatePool', () => ({
  buildAlternatePool: (...args: unknown[]) => buildAlternatePoolMock(...args),
}));

import {
  acquireCommanderDataPhase,
  acquireCardPoolPhase,
  populateGenerationCachePhase,
  clearGenerationCache,
} from './dataAcquisition';
import type { GenerationState } from './state';

function scryfallCard(name: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Legendary Creature',
    color_identity: ['U'],
    keywords: [],
    rarity: 'mythic',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

function edhrecData(): EDHRECCommanderData {
  return {
    themes: [],
    stats: {
      avgPrice: 0,
      numDecks: 100,
      deckSize: 81,
      manaCurve: {},
      typeDistribution: {
        creature: 0,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 0,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 0, nonbasic: 0, total: 0 },
    },
    cardlists: {
      creatures: [],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [],
      allNonLand: [],
    },
    similarCommanders: [],
  };
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = scryfallCard('Test Commander');
  return {
    context: {
      commander,
      partnerCommander: null,
      colorIdentity: ['U'],
      customization: {
        generationMode: 'edhrec',
        mustIncludeCards: [],
        tempMustIncludeCards: [],
      } as unknown as GenerationState['context']['customization'],
      selectedThemes: [],
    },
    cfg: {
      format: 99,
      mtgFormat: 'commander',
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
      brewLevel: 0.5,
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

describe('acquireCommanderDataPhase', () => {
  beforeEach(() => {
    clearGenerationCache();
    vi.clearAllMocks();
    prefetchBasicLandsMock.mockResolvedValue(undefined);
    getGameChangerNamesMock.mockResolvedValue(new Set(['Sol Ring']));
    fetchCommanderCombosRawMock.mockResolvedValue([]);
    loadTaggerDataMock.mockResolvedValue({});
    hasTaggerDataMock.mockReturnValue(true);
    loadCardSimilarMock.mockResolvedValue({});
    hasCardSimilarMock.mockReturnValue(true);
  });

  it('fetches fresh data on a cache miss and surfaces no integrity notes when everything succeeds', async () => {
    const state = makeState();
    const result = await acquireCommanderDataPhase(state);
    expect(result.usingCache).toBe(false);
    expect(state.gameChangerNames).toEqual(new Set(['Sol Ring']));
    expect(state.combos).toEqual([]);
    expect(result.integrityNotes).toEqual([]);
    expect(result.cacheableIntegrityNotes).toEqual([]);
  });

  it('surfaces combo/substitute/tagger integrity notes when their fetches fail', async () => {
    fetchCommanderCombosRawMock.mockRejectedValue(new Error('network down'));
    hasCardSimilarMock.mockReturnValue(false);
    hasTaggerDataMock.mockReturnValue(false);
    const state = makeState();
    state.cfg.comboCountSetting = 1;
    state.context.collectionNames = new Set(['Sol Ring']);
    const result = await acquireCommanderDataPhase(state);
    expect(result.cacheableIntegrityNotes).toHaveLength(2); // combo + substitute
    expect(result.integrityNotes).toHaveLength(3); // + tagger
  });

  it('reuses the module-level cache populated by populateGenerationCachePhase on a matching regeneration', async () => {
    const state1 = makeState();
    state1.edhrecData = edhrecData();
    state1.gameChangerNames = new Set(['Sol Ring']);
    populateGenerationCachePhase(state1, { usingCache: false, cacheableIntegrityNotes: ['note1'] });

    const state2 = makeState(); // same commander/context shape → cache key matches
    const result = await acquireCommanderDataPhase(state2);
    expect(result.usingCache).toBe(true);
    expect(state2.edhrecData).toBe(state1.edhrecData);
    expect(state2.gameChangerNames).toEqual(new Set(['Sol Ring']));
    expect(result.integrityNotes).toContain('note1');
    // Cache hit skips the fresh-fetch battery entirely.
    expect(prefetchBasicLandsMock).not.toHaveBeenCalled();
    expect(fetchCommanderCombosRawMock).not.toHaveBeenCalled();
  });
});

describe('acquireCardPoolPhase', () => {
  beforeEach(() => {
    clearGenerationCache();
    vi.clearAllMocks();
  });

  it('is a no-op on a cache hit — no fetches, scryfallQuery/altPool unchanged', async () => {
    const state = makeState();
    const result = await acquireCardPoolPhase(state, {
      usingCache: true,
      scryfallQuery: 'f:commander',
    });
    expect(result).toEqual({ altPool: null, scryfallQuery: 'f:commander' });
    expect(fetchCommanderDataMock).not.toHaveBeenCalled();
    expect(buildAlternatePoolMock).not.toHaveBeenCalled();
  });

  it('routes to buildAlternatePool for a non-edhrec generation mode and appends its effective constraint', async () => {
    buildAlternatePoolMock.mockResolvedValue({
      data: edhrecData(),
      dataSource: 'base',
      poolSize: 10,
      effectiveConstraint: 'year<=2010',
    });
    const state = makeState();
    (state.context.customization as unknown as { generationMode: string }).generationMode =
      'historical';
    const result = await acquireCardPoolPhase(state, { usingCache: false, scryfallQuery: '' });
    expect(buildAlternatePoolMock).toHaveBeenCalledTimes(1);
    expect(state.edhrecData).not.toBeNull();
    expect(result.scryfallQuery).toBe('year<=2010');
  });
});

describe('populateGenerationCachePhase', () => {
  beforeEach(() => clearGenerationCache());

  it('does not populate the cache on a cache hit (usingCache=true)', async () => {
    const state = makeState();
    state.edhrecData = edhrecData();
    populateGenerationCachePhase(state, { usingCache: true, cacheableIntegrityNotes: [] });
    // A subsequent acquire on a fresh state should still miss (nothing cached).
    const result = await acquireCommanderDataPhase(makeState());
    expect(result.usingCache).toBe(false);
  });

  it('does not populate the cache when there is no EDHREC data', async () => {
    const state = makeState();
    state.edhrecData = null;
    populateGenerationCachePhase(state, { usingCache: false, cacheableIntegrityNotes: [] });
    const result = await acquireCommanderDataPhase(makeState());
    expect(result.usingCache).toBe(false);
  });
});
