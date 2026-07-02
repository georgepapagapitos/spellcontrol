import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiftEntry, ScryfallCard } from '@/deck-builder/types';

const fetchCardLiftPoolMock = vi.fn<(name: string) => Promise<LiftEntry[]>>();
vi.mock('@/deck-builder/services/edhrec/client', () => ({
  fetchCardLiftPool: (name: string) => fetchCardLiftPoolMock(name),
}));

const getCardsByNamesMock = vi.fn<() => Promise<Map<string, ScryfallCard>>>();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardsByNames: (...args: unknown[]) =>
    getCardsByNamesMock(...(args as Parameters<typeof getCardsByNamesMock>)),
}));

import { liftPicksPhase } from './phaseLiftPicks';
import type { GenerationState } from './state';

function card(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 3,
    type_line: 'Creature',
    color_identity: ['G'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

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
  const commander = card('Cmd', { name: 'Cmd' });
  const synergy = [card('Sun A', { isThemeSynergyCard: true })];
  const creatures = [card('Filler B')];
  return {
    context: {
      commander,
      partnerCommander: null,
      colorIdentity: ['G'],
      customization: {} as GenerationState['context']['customization'],
      collectionNames: undefined,
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
      creatures,
      synergy,
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
    gameChangerNames: new Set<string>(),
    combos: [],
    edhrecData: { cardlists: { allNonLand: [] } } as unknown as GenerationState['edhrecData'],
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

describe('liftPicksPhase', () => {
  beforeEach(() => {
    fetchCardLiftPoolMock.mockReset();
    getCardsByNamesMock.mockReset();
    fetchCardLiftPoolMock.mockResolvedValue([]);
    getCardsByNamesMock.mockResolvedValue(new Map());
  });

  it('returns undefined when the generation had no EDHREC data', async () => {
    const state = makeState({ edhrecData: null });
    expect(await liftPicksPhase(state)).toBeUndefined();
    expect(fetchCardLiftPoolMock).not.toHaveBeenCalled();
  });

  it('produces picks from seeded pools, owned flag from the collection', async () => {
    const state = makeState({
      context: { ...makeState().context, collectionNames: new Set(['Bomb Card']) },
    });
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd' ? [entry({ name: 'Bomb Card', lift: 10, coPlayPct: 30, numDecks: 200 })] : []
    );
    getCardsByNamesMock.mockResolvedValue(new Map([['Bomb Card', card('Bomb Card')]]));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks).toEqual([
      { name: 'Bomb Card', kind: 'bomb', liftedBy: ['Cmd'], lowSample: false, owned: true },
    ]);
    expect(result?.liftPicksNote).toBeUndefined();
  });

  it('hard-filters an off-color and an over-budget candidate even with huge lift', async () => {
    const state = makeState();
    state.cfg.maxCardPrice = 5;
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd'
        ? [
            entry({ name: 'OffColor Card', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Pricey Card', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Good Card', lift: 6, coPlayPct: 20, numDecks: 200 }),
          ]
        : []
    );
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['OffColor Card', card('OffColor Card', { color_identity: ['R'] })],
        ['Pricey Card', card('Pricey Card', { prices: { usd: '50' } })],
        ['Good Card', card('Good Card', { prices: { usd: '1' } })],
      ])
    );

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Good Card']);
    expect(result?.liftPicksNote).toBe('2 higher-lift candidates hidden: off-color');
  });

  it('excludes banned and already-in-deck names from candidates', async () => {
    const state = makeState();
    state.usedNames.add('In Deck Card');
    state.bannedCards.add('Banned Card');
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd'
        ? [
            entry({ name: 'In Deck Card', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Banned Card', lift: 50, coPlayPct: 90, numDecks: 500 }),
            entry({ name: 'Fresh Card', lift: 6, coPlayPct: 20, numDecks: 200 }),
          ]
        : []
    );
    getCardsByNamesMock.mockResolvedValue(new Map([['Fresh Card', card('Fresh Card')]]));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks.map((p) => p.name)).toEqual(['Fresh Card']);
  });

  it('soft-fails to undefined (no throw) when a lift-pool fetch rejects', async () => {
    const state = makeState();
    fetchCardLiftPoolMock.mockRejectedValue(new Error('network down'));

    await expect(liftPicksPhase(state)).resolves.toBeUndefined();
  });

  it('marks a pick unowned when absent from the collection', async () => {
    const state = makeState({
      context: { ...makeState().context, collectionNames: new Set(['Someone Else']) },
    });
    fetchCardLiftPoolMock.mockImplementation(async (seed) =>
      seed === 'Cmd' ? [entry({ name: 'Bomb Card', lift: 10, coPlayPct: 30, numDecks: 200 })] : []
    );
    getCardsByNamesMock.mockResolvedValue(new Map([['Bomb Card', card('Bomb Card')]]));

    const result = await liftPicksPhase(state);
    expect(result?.packagePicks[0]?.owned).toBe(false);
  });
});
