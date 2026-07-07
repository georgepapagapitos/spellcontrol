import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: () => null,
  validateCardRole: () => null,
  isProtectionPiece: () => false,
  isFreeInteraction: () => false,
}));

import { smartTrimPhase } from './phaseSmartTrim';
import type { GenerationState } from './state';

function card(name: string, isMustInclude = false): ScryfallCard {
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
    isMustInclude,
  } as ScryfallCard;
}

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

function allCards(state: GenerationState): ScryfallCard[] {
  return Object.values(state.categories).flat();
}

describe('smartTrimPhase', () => {
  it('is a no-op when the deck is at or under the target size', () => {
    const state = makeState();
    state.categories.creatures = [card('A'), card('B')];
    smartTrimPhase(state, { targetDeckSize: 2, landTarget: 0, roleTargets: null });
    expect(allCards(state)).toHaveLength(2);
  });

  it('trims the weakest (earliest-position) cards first down to target size', () => {
    const state = makeState();
    // Position-based resistance: later index = lower priority = cut first.
    state.categories.creatures = [card('Best'), card('Middle'), card('Weakest')];
    smartTrimPhase(state, { targetDeckSize: 2, landTarget: 0, roleTargets: null });
    const names = allCards(state).map((c) => c.name);
    expect(names).toEqual(['Best', 'Middle']);
  });

  it('never trims a must-include card even when it is the last-position filler', () => {
    const state = makeState();
    state.categories.creatures = [card('Best'), card('Locked', true)];
    smartTrimPhase(state, { targetDeckSize: 1, landTarget: 0, roleTargets: null });
    const names = allCards(state).map((c) => c.name);
    expect(names).toEqual(['Locked']);
  });

  it('respects the land-trim budget — never cuts a non-must-include land below the target', () => {
    const state = makeState();
    state.categories.lands = [card('Land1'), card('Land2')];
    state.categories.creatures = [card('Spell')];
    // 3 cards, target 2 — land target is 2, so the excess card must come from
    // creatures (position-based resistance ties are irrelevant here; the
    // land-trim budget of 0 means neither land is eligible).
    smartTrimPhase(state, { targetDeckSize: 2, landTarget: 2, roleTargets: null });
    expect(state.categories.lands).toHaveLength(2);
    expect(allCards(state)).toHaveLength(2);
  });
});
