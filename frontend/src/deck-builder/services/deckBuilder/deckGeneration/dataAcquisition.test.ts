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
  // No-op defaults so bracketEstimator.ts's wrapped calls (used by the
  // enrichment + estimateBracket integration tests below) don't blow up on
  // an unmocked export — every signal in those tests comes from the explicit
  // combos/gameChangerNames passed in, not from tag data.
  hasTag: () => false,
  getCardRole: () => null,
  isMassLandDenial: () => false,
  isExtraTurn: () => false,
}));

const ensureCombosCachedMock = vi.fn();
const offlineGetCombosByIdsMock = vi.fn();
vi.mock('@/lib/offline', () => ({
  ensureCombosCached: () => ensureCombosCachedMock(),
  offlineGetCombosByIds: (...args: unknown[]) => offlineGetCombosByIdsMock(...args),
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
import { detectCombosPhase } from './phaseDetectCombos';
import { estimateBracket } from '../bracketEstimator';
import type { GenerationState } from './state';
import type { EDHRECCombo } from '@/deck-builder/types';
import type { OfflineCombo } from '@/lib/offline/types';

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

// EDHREC always returns bracketTag: null (client.ts hard-codes it) — its
// comboId is verbatim the Commander Spellbook variant id, which is what the
// enrichment below looks up.
function edhrecCombo(comboId: string, cardNames: string[]): EDHRECCombo {
  return {
    comboId,
    cards: cardNames.map((name) => ({ name, id: name })),
    results: ['Win the game'],
    deckCount: 500,
    rank: 1,
    bracket: null,
    bracketTag: null,
    prereqCount: 0,
    cardCount: cardNames.length,
    href: null,
  };
}

function offlineComboRow(id: string, bracketTag: string | null, cardCount = 2): OfflineCombo {
  return {
    id,
    identity: 'C',
    produces: ['Win the game'],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 500,
    legalities: { commander: 'legal' },
    cardCount,
    bracket: null,
    bracketTag,
    cards: [],
  };
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
    ensureCombosCachedMock.mockResolvedValue(false);
    offlineGetCombosByIdsMock.mockResolvedValue(new Map());
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

// Regression coverage for the generation/deck-page bracket disagreement:
// EDHREC's own combo feed hard-codes bracketTag: null (client.ts), so before
// this enrichment every combo generation saw was untagged — an Exhibition/Core
// loop wrongly floored the deck, and a Ruthless two-card combo read as a slow
// Bracket 3 line instead of the automatic Bracket 4 its tag means. Verified
// live 2026-09-24 that EDHREC's comboId IS the Commander Spellbook variant id
// verbatim (e.g. "1529-1887" for both), which is what makes this id lookup
// against the local Spellbook dataset (lib/offline) possible.
describe('acquireCommanderDataPhase — combo bracketTag enrichment', () => {
  beforeEach(() => {
    clearGenerationCache();
    vi.clearAllMocks();
    prefetchBasicLandsMock.mockResolvedValue(undefined);
    getGameChangerNamesMock.mockResolvedValue(new Set());
    loadTaggerDataMock.mockResolvedValue({});
    hasTaggerDataMock.mockReturnValue(true);
    loadCardSimilarMock.mockResolvedValue({});
    hasCardSimilarMock.mockReturnValue(true);
  });

  it('tags an EDHREC combo with the real Spellbook bracketTag looked up by id', async () => {
    fetchCommanderCombosRawMock.mockResolvedValue([edhrecCombo('1-2', ['Card A', 'Card B'])]);
    ensureCombosCachedMock.mockResolvedValue(true);
    offlineGetCombosByIdsMock.mockResolvedValue(new Map([['1-2', offlineComboRow('1-2', 'E')]]));

    const state = makeState();
    await acquireCommanderDataPhase(state);

    expect(offlineGetCombosByIdsMock).toHaveBeenCalledWith(['1-2']);
    expect(state.combos).toHaveLength(1);
    expect(state.combos[0].bracketTag).toBe('E');
  });

  it('leaves bracketTag null and never fails generation when the local dataset is not cached', async () => {
    fetchCommanderCombosRawMock.mockResolvedValue([edhrecCombo('1-2', ['Card A', 'Card B'])]);
    ensureCombosCachedMock.mockResolvedValue(false);

    const state = makeState();
    const result = await acquireCommanderDataPhase(state);

    expect(offlineGetCombosByIdsMock).not.toHaveBeenCalled();
    expect(state.combos[0].bracketTag).toBeNull();
    expect(result.cacheableIntegrityNotes).toEqual([]); // still a success, not a fetch failure
  });

  it('leaves bracketTag null and never fails generation when the id lookup throws', async () => {
    fetchCommanderCombosRawMock.mockResolvedValue([edhrecCombo('1-2', ['Card A', 'Card B'])]);
    ensureCombosCachedMock.mockResolvedValue(true);
    offlineGetCombosByIdsMock.mockRejectedValue(new Error('IDB wedged'));

    const state = makeState();
    const result = await acquireCommanderDataPhase(state);

    expect(state.combos[0].bracketTag).toBeNull();
    expect(result.usingCache).toBe(false);
  });

  it('an EDHREC combo enriched with the E (Exhibition) tag sets no combo floor once detected', async () => {
    fetchCommanderCombosRawMock.mockResolvedValue([
      edhrecCombo('1-2', ['Hullbreaker Horror', 'Sol Ring']),
    ]);
    ensureCombosCachedMock.mockResolvedValue(true);
    offlineGetCombosByIdsMock.mockResolvedValue(new Map([['1-2', offlineComboRow('1-2', 'E')]]));

    const state = makeState({
      categories: {
        lands: [],
        ramp: [],
        cardDraw: [],
        singleRemoval: [],
        boardWipes: [],
        creatures: [],
        synergy: [scryfallCard('Hullbreaker Horror'), scryfallCard('Sol Ring')],
        utility: [],
      },
    });
    await acquireCommanderDataPhase(state);
    const detected = detectCombosPhase(state);
    expect(detected?.[0].bracketTag).toBe('E');
    expect(detected?.[0].isComplete).toBe(true);

    const est = estimateBracket(
      ['Hullbreaker Horror', 'Sol Ring'],
      detected,
      2,
      undefined,
      { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
      new Set(),
      []
    );
    expect(est.hardFloors).toEqual([]);
    expect(est.bracket).toBe(2); // Core baseline — no floor fired
  });

  it('an EDHREC two-card combo enriched with the R (Ruthless) tag floors the estimate at Bracket 4', async () => {
    fetchCommanderCombosRawMock.mockResolvedValue([
      edhrecCombo('3-4', ['Combo Piece A', 'Combo Piece B']),
    ]);
    ensureCombosCachedMock.mockResolvedValue(true);
    offlineGetCombosByIdsMock.mockResolvedValue(new Map([['3-4', offlineComboRow('3-4', 'R')]]));

    const state = makeState({
      categories: {
        lands: [],
        ramp: [],
        cardDraw: [],
        singleRemoval: [],
        boardWipes: [],
        creatures: [],
        synergy: [scryfallCard('Combo Piece A'), scryfallCard('Combo Piece B')],
        utility: [],
      },
    });
    await acquireCommanderDataPhase(state);
    const detected = detectCombosPhase(state);
    expect(detected?.[0].bracketTag).toBe('R');

    const est = estimateBracket(
      ['Combo Piece A', 'Combo Piece B'],
      detected,
      2,
      undefined,
      { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
      new Set(),
      []
    );
    expect(est.bracket).toBe(4);
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

  // LIVE (stress sweep 2026-09-24): a motif no card matched said "Built by
  // function instead" but shipped 97 lands and 2 spells, because the dead
  // art: constraint rode along on every later fill.
  it('rebuilds an empty art pool by function and drops the dead motif constraint', async () => {
    buildAlternatePoolMock
      .mockResolvedValueOnce({
        data: edhrecData(),
        dataSource: 'art-theme',
        poolSize: 0,
        effectiveConstraint: 'art:zzzz-not-a-tag',
      })
      .mockResolvedValueOnce({
        data: edhrecData(),
        dataSource: 'oracle-role',
        poolSize: 180,
        effectiveConstraint: '',
      });
    const state = makeState();
    (state.context.customization as unknown as { generationMode: string }).generationMode =
      'art-theme';
    const result = await acquireCardPoolPhase(state, { usingCache: false, scryfallQuery: '' });

    expect(buildAlternatePoolMock).toHaveBeenCalledTimes(2);
    expect(buildAlternatePoolMock.mock.calls[1][0]).toBe('oracle-role');
    expect(result.scryfallQuery).not.toContain('art:');
    expect(state.dataSource).toBe('oracle-role');
    expect(result.altPool?.relaxedNote).toMatch(/Built by function instead/);
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
