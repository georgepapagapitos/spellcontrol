import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCard, LiftEntry, ScryfallCard } from '@/deck-builder/types';

const getCardsByNamesMock = vi.fn<() => Promise<Map<string, ScryfallCard>>>();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardsByNames: (...args: unknown[]) =>
    getCardsByNamesMock(...(args as Parameters<typeof getCardsByNamesMock>)),
  getCardPrice: () => '1.00',
}));
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: () => null,
}));

import { gapAnalysisPhase } from './phaseGapAnalysis';
import type { GenerationState } from './state';

function edhrecCard(name: string, overrides: Partial<EDHRECCard> = {}): EDHRECCard {
  return {
    name,
    sanitized: name,
    primary_type: 'Creature',
    inclusion: 50,
    num_decks: 100,
    ...overrides,
  };
}

function scryfallCard(name: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
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
  const commander = scryfallCard('Cmd');
  return {
    context: {
      commander,
      partnerCommander: null,
      colorIdentity: [],
      customization: {} as GenerationState['context']['customization'],
      collectionNames: new Set<string>(),
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

beforeEach(() => getCardsByNamesMock.mockReset());

describe('gapAnalysisPhase', () => {
  it('returns undefined without a collection or without EDHREC data', async () => {
    const noCollection = makeState({
      context: { ...makeState().context, collectionNames: undefined },
    });
    expect(await gapAnalysisPhase(noCollection)).toBeUndefined();

    const noEdhrec = makeState({ edhrecData: null });
    expect(await gapAnalysisPhase(noEdhrec)).toBeUndefined();
  });

  it('an empty lift index (the default) leaves output identical to priority-only ranking', async () => {
    const state = makeState({
      edhrecData: {
        cardlists: {
          allNonLand: [edhrecCard('A', { inclusion: 90 }), edhrecCard('B', { inclusion: 10 })],
        },
      } as unknown as GenerationState['edhrecData'],
    });
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['A', scryfallCard('A')],
        ['B', scryfallCard('B')],
      ])
    );

    const result = await gapAnalysisPhase(state);
    expect(result?.map((c) => c.name)).toEqual(['A', 'B']); // pure priority (inclusion) order
    expect(result?.every((c) => c.liftedBy === undefined)).toBe(true);
  });

  it('breaks an EXACT priority tie by lift clusterScore, and attaches liftedBy', async () => {
    const state = makeState({
      edhrecData: {
        cardlists: {
          allNonLand: [
            edhrecCard('Low Lift', { inclusion: 50 }),
            edhrecCard('High Lift', { inclusion: 50 }),
          ],
        },
      } as unknown as GenerationState['edhrecData'],
      liftSeedPools: new Map([
        ['Cmd', [entry({ name: 'High Lift', lift: 10, coPlayPct: 50, numDecks: 500 })]],
      ]),
    });
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Low Lift', scryfallCard('Low Lift')],
        ['High Lift', scryfallCard('High Lift')],
      ])
    );

    const result = await gapAnalysisPhase(state);
    expect(result?.map((c) => c.name)).toEqual(['High Lift', 'Low Lift']);
    expect(result?.find((c) => c.name === 'High Lift')?.liftedBy).toEqual(['Cmd']);
    expect(result?.find((c) => c.name === 'Low Lift')?.liftedBy).toBeUndefined();
  });

  it('never outranks a strictly higher-priority card, even with a huge lift score', async () => {
    const state = makeState({
      edhrecData: {
        cardlists: {
          allNonLand: [
            edhrecCard('Staple', { inclusion: 90 }),
            edhrecCard('Fringe', { inclusion: 5 }),
          ],
        },
      } as unknown as GenerationState['edhrecData'],
      liftSeedPools: new Map([
        ['Cmd', [entry({ name: 'Fringe', lift: 50, coPlayPct: 90, numDecks: 1000 })]],
      ]),
    });
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Staple', scryfallCard('Staple')],
        ['Fringe', scryfallCard('Fringe')],
      ])
    );

    const result = await gapAnalysisPhase(state);
    expect(result?.map((c) => c.name)).toEqual(['Staple', 'Fringe']);
  });
});
