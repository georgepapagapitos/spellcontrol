import { describe, it, expect, vi } from 'vitest';
import type { DetectedCombo, EDHRECCard, ScryfallCard } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: () => null,
}));

import { cardRelevancyPhase } from './phaseCardRelevancy';
import type { GenerationState } from './state';

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

function edhrecCard(name: string, overrides: Partial<EDHRECCard> = {}): EDHRECCard {
  return {
    name,
    sanitized: name,
    primary_type: 'Creature',
    inclusion: 20,
    num_decks: 100,
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
    edhrecData: {
      cardlists: { allNonLand: [], lands: [] },
    } as unknown as GenerationState['edhrecData'],
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

function detectedCombo(overrides: Partial<DetectedCombo> = {}): DetectedCombo {
  return {
    comboId: 'c1',
    cards: [],
    results: ['Win the game'],
    isComplete: true,
    missingCards: [],
    deckCount: 500,
    bracket: 3,
    bracketTag: 'S',
    cardCount: 2,
    ...overrides,
  };
}

describe('cardRelevancyPhase', () => {
  it('floors an in-deck card missing from EDHREC data instead of hard-zeroing it', () => {
    const state = makeState({
      categories: {
        lands: [],
        ramp: [scryfallCard('Eiganjo, Seat of the Empire', { deckRole: 'removal' })],
        cardDraw: [],
        singleRemoval: [],
        boardWipes: [],
        creatures: [scryfallCard('Untagged Filler', { deckRole: undefined })],
        synergy: [],
        utility: [],
      },
    });

    const relMap = cardRelevancyPhase(state, null, {}, {}, undefined, undefined, undefined);

    expect(relMap).toBeDefined();
    expect(relMap!['Eiganjo, Seat of the Empire']).toBeGreaterThan(0);
    expect(relMap!['Untagged Filler']).toBeGreaterThan(0);
    // Role-tagged floor reads higher than the untagged baseline.
    expect(relMap!['Eiganjo, Seat of the Empire']).toBeGreaterThan(relMap!['Untagged Filler']);
  });

  it('boosts every piece of a detected combo consistently, not just the pre-pick-slice ones', () => {
    const skullclamp = scryfallCard('Skullclamp');
    const kikiJiki = scryfallCard('Kiki-Jiki, Mirror Breaker');
    const state = makeState({
      categories: {
        lands: [],
        ramp: [],
        cardDraw: [],
        singleRemoval: [],
        boardWipes: [],
        creatures: [kikiJiki],
        synergy: [skullclamp],
        utility: [],
      },
      edhrecData: {
        cardlists: {
          allNonLand: [edhrecCard('Skullclamp'), edhrecCard('Kiki-Jiki, Mirror Breaker')],
          lands: [],
        },
      } as unknown as GenerationState['edhrecData'],
      // Skullclamp made the small pre-pick EDHREC combo slice; Kiki-Jiki did not.
      staticComboBoosts: new Map([['Skullclamp', 75]]),
    });

    const combos = [
      detectedCombo({
        comboId: 'kiki-clamp',
        cards: ['Skullclamp', 'Kiki-Jiki, Mirror Breaker'],
      }),
    ];

    const relMap = cardRelevancyPhase(state, null, {}, {}, undefined, undefined, combos);

    expect(relMap).toBeDefined();
    expect(relMap!['Kiki-Jiki, Mirror Breaker']).toBeGreaterThan(0);
    // Without the combo-boost cross-wire, Kiki-Jiki would score identically to
    // a generic 20%-inclusion card and stay flat while Skullclamp is boosted.
    const kikiBase = relMap!['Kiki-Jiki, Mirror Breaker'];
    const clampBase = relMap!['Skullclamp'];
    expect(kikiBase).toBeGreaterThan(20); // base scoreRecommendation alone tops out near inclusion (20)
    expect(clampBase).toBeGreaterThan(20);
  });

  it('boosts a gap-analysis-suggested missing combo piece, not just in-deck cards', () => {
    const state = makeState({
      categories: {
        lands: [],
        ramp: [],
        cardDraw: [],
        singleRemoval: [],
        boardWipes: [],
        creatures: [scryfallCard('Skirk Prospector')],
        synergy: [],
        utility: [],
      },
      edhrecData: {
        cardlists: { allNonLand: [edhrecCard('Skirk Prospector')], lands: [] },
      } as unknown as GenerationState['edhrecData'],
    });

    const combos = [
      detectedCombo({
        comboId: 'near-miss',
        cards: ['Skirk Prospector', 'Kiki-Jiki, Mirror Breaker'],
        isComplete: false,
        missingCards: ['Kiki-Jiki, Mirror Breaker'],
      }),
    ];

    const gapAnalysis = [
      {
        name: 'Kiki-Jiki, Mirror Breaker',
        price: null,
        inclusion: 20,
        synergy: 0,
        cmc: 3,
        typeLine: 'Creature',
      },
    ];

    const relMap = cardRelevancyPhase(state, null, {}, {}, undefined, gapAnalysis, combos);

    expect(relMap).toBeDefined();
    // A flat-scoring gap suggestion (inclusion 20, no synergy) would otherwise
    // land at ~20; the combo-piece boost must push it above that.
    expect(relMap!['Kiki-Jiki, Mirror Breaker']).toBeGreaterThan(20);
  });
});
