import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCard, LiftEntry, ScryfallCard } from '@/deck-builder/types';

const getCardsByNamesMock = vi.fn<() => Promise<Map<string, ScryfallCard>>>();
const upgradeCardPrintingsMock =
  vi.fn<(map: Map<string, ScryfallCard>, query: string, strict: boolean) => Promise<void>>();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardsByNames: (...args: unknown[]) =>
    getCardsByNamesMock(...(args as Parameters<typeof getCardsByNamesMock>)),
  getCardPrice: () => '1.00',
  upgradeCardPrintings: (...args: Parameters<typeof upgradeCardPrintingsMock>) =>
    upgradeCardPrintingsMock(...args),
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

function scryfallCard(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
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

beforeEach(() => {
  getCardsByNamesMock.mockReset();
  upgradeCardPrintingsMock.mockReset();
  upgradeCardPrintingsMock.mockResolvedValue(undefined);
});

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

describe('gapAnalysisPhase constraint gates (E71 controls audit)', () => {
  // Suggestions must honor the same rarity/Arena/CMC caps and Scryfall filter
  // as generation itself — a Tiny Leaders Arena-only common-capped build must
  // not be told to consider a 6-mana paper-only mythic.
  function stateWithCandidates(): GenerationState {
    return makeState({
      edhrecData: {
        cardlists: {
          allNonLand: [
            edhrecCard('Violator', { inclusion: 90 }),
            edhrecCard('Fine', { inclusion: 50 }),
          ],
        },
      } as unknown as GenerationState['edhrecData'],
    });
  }

  it('drops suggestions over the rarity cap unless owned-exempt', async () => {
    const state = stateWithCandidates();
    state.cfg.maxRarity = 'uncommon';
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Violator', scryfallCard('Violator', { rarity: 'mythic' })],
        ['Fine', scryfallCard('Fine')],
      ])
    );

    expect((await gapAnalysisPhase(state))?.map((c) => c.name)).toEqual(['Fine']);

    // Owned + ignoreOwnedRarity => the mythic is exempt and may surface.
    state.cfg.ignoreOwnedRarity = true;
    state.context.collectionNames = new Set(['Violator']);
    expect((await gapAnalysisPhase(state))?.map((c) => c.name)).toEqual(['Violator', 'Fine']);
  });

  it('drops non-Arena suggestions in Arena-only mode', async () => {
    const state = stateWithCandidates();
    state.cfg.arenaOnly = true;
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Violator', scryfallCard('Violator', { games: ['paper'] })],
        ['Fine', scryfallCard('Fine', { games: ['paper', 'arena'] })],
      ])
    );

    expect((await gapAnalysisPhase(state))?.map((c) => c.name)).toEqual(['Fine']);
  });

  it('drops suggestions over the mana-value cap', async () => {
    const state = stateWithCandidates();
    state.cfg.maxCmc = 3;
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Violator', scryfallCard('Violator', { cmc: 6 })],
        ['Fine', scryfallCard('Fine')],
      ])
    );

    expect((await gapAnalysisPhase(state))?.map((c) => c.name)).toEqual(['Fine']);
  });

  it('enforces the effective Scryfall filter via the strict printing upgrade', async () => {
    const state = stateWithCandidates();
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Violator', scryfallCard('Violator')],
        ['Fine', scryfallCard('Fine')],
      ])
    );
    upgradeCardPrintingsMock.mockImplementation(async (map) => {
      map.delete('Violator'); // no printing matches the query
    });

    const result = await gapAnalysisPhase(state, { effectiveScryfallQuery: 'is:full-art' });
    expect(upgradeCardPrintingsMock).toHaveBeenCalledWith(expect.any(Map), 'is:full-art', true);
    expect(result?.map((c) => c.name)).toEqual(['Fine']);
  });

  it('skips the printing upgrade when no filter is set', async () => {
    const state = stateWithCandidates();
    getCardsByNamesMock.mockResolvedValue(
      new Map([
        ['Violator', scryfallCard('Violator')],
        ['Fine', scryfallCard('Fine')],
      ])
    );

    await gapAnalysisPhase(state);
    expect(upgradeCardPrintingsMock).not.toHaveBeenCalled();
  });
});
