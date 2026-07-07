import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

const roleMap: Record<string, string | null> = {};

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: (name: string) => roleMap[name] ?? null,
}));

vi.mock('../categorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../categorize')>();
  return {
    ...actual,
    stampRoleSubtypes: () => {},
  };
});

import { postGenFixupPhase } from './phasePostGenFixup';
import type { GenerationState } from './state';

function scryfallCard(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Creature — Human',
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

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = scryfallCard('Commander');
  return {
    context: {
      commander,
      partnerCommander: null,
      colorIdentity: [],
      customization: {
        balancedRoles: true,
        mustIncludeCards: [],
        tempMustIncludeCards: [],
        tinyLeaders: false,
      } as unknown as GenerationState['context']['customization'],
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

describe('postGenFixupPhase', () => {
  it('no-ops when there is no EDHREC data', () => {
    const state = makeState();
    state.edhrecData = null;
    const result = postGenFixupPhase(state, {
      roleTargets: { ramp: 4, removal: 0, boardwipe: 0, cardDraw: 0 },
      swapCandidates: undefined,
      scryfallCardMap: new Map(),
    });
    expect(result.fixupSwaps).toBe(0);
  });

  it('no-ops when balancedRoles is off', () => {
    const state = makeState();
    state.context.customization.balancedRoles = false;
    state.edhrecData = {
      cardlists: { allNonLand: [] },
    } as unknown as GenerationState['edhrecData'];
    const result = postGenFixupPhase(state, {
      roleTargets: { ramp: 4, removal: 0, boardwipe: 0, cardDraw: 0 },
      swapCandidates: undefined,
      scryfallCardMap: new Map(),
    });
    expect(result.fixupSwaps).toBe(0);
  });

  it('swaps in a ramp candidate when ramp is at <=50% of target, evicting the weakest filler', () => {
    const state = makeState();
    const filler = scryfallCard('Filler');
    const rampCard = scryfallCard('Rampant Growth', { cmc: 2 });
    roleMap['Rampant Growth'] = 'ramp';
    state.categories.creatures = [filler];
    state.usedNames = new Set(['Filler']);
    state.currentRoleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    state.edhrecData = {
      cardlists: { allNonLand: [{ name: 'Rampant Growth', inclusion: 60 }] },
    } as unknown as GenerationState['edhrecData'];
    const swapCandidates: Record<string, ScryfallCard[]> = {};

    const result = postGenFixupPhase(state, {
      roleTargets: { ramp: 4, removal: 0, boardwipe: 0, cardDraw: 0 },
      swapCandidates,
      scryfallCardMap: new Map([['Rampant Growth', rampCard]]),
    });

    expect(result.fixupSwaps).toBe(1);
    expect(state.usedNames.has('Filler')).toBe(false);
    expect(state.usedNames.has('Rampant Growth')).toBe(true);
    expect(state.currentRoleCounts.ramp).toBe(1);
    expect(swapCandidates['type:creature']).toEqual([filler]);
  });
});
