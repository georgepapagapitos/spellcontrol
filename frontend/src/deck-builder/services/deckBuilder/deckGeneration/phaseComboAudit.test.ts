import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard, DetectedCombo, EDHRECCard } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: () => null,
  isProtectionPiece: () => false,
  isFreeInteraction: () => false,
}));

vi.mock('../categorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../categorize')>();
  return {
    ...actual,
    stampRoleSubtypes: () => {},
  };
});

import { comboIntegrityAuditPhase } from './phaseComboAudit';
import { BudgetTracker } from '../budgetTracker';
import type { GenerationState } from './state';

function scryfallCard(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Creature — Human',
    color_identity: ['U'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function edhrecCard(name: string, inclusion: number): EDHRECCard {
  return { name, id: name, inclusion } as unknown as EDHRECCard;
}

function combo(id: string, cards: string[], missingCards: string[]): DetectedCombo {
  return {
    comboId: id,
    cards,
    results: [],
    isComplete: missingCards.length === 0,
    missingCards,
    deckCount: 500,
    bracket: 3,
    bracketTag: null,
    cardCount: cards.length,
  };
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = scryfallCard('Commander');
  return {
    context: {
      commander,
      partnerCommander: null,
      colorIdentity: ['U'],
      customization: {
        mustIncludeCards: [],
        tempMustIncludeCards: [],
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
      comboCountSetting: 1,
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

describe('comboIntegrityAuditPhase', () => {
  it('no-ops when combos were never requested (comboCountSetting <= 0)', () => {
    const state = makeState();
    state.cfg.comboCountSetting = 0;
    state.edhrecData = {
      cardlists: { allNonLand: [] },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [combo('c1', ['A', 'B'], ['B'])];
    const result = comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map(),
      budgetTracker: null,
      bracketGuard: undefined,
    });
    expect(result).toEqual({
      detectedCombos,
      repairs: [],
      budgetSkipped: 0,
      bracketBlocked: 0,
    });
  });

  it('swaps in a multi-combo enabler, evicting the weakest filler, and completes both near-misses', () => {
    const state = makeState();
    const filler = scryfallCard('Filler');
    const pieceA = scryfallCard('PieceA');
    const pieceB = scryfallCard('PieceB');
    const enabler = scryfallCard('Enabler');
    state.categories.creatures = [pieceA, pieceB, filler];
    state.usedNames = new Set(['PieceA', 'PieceB', 'Filler']);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Filler', 1),
          edhrecCard('PieceA', 50),
          edhrecCard('PieceB', 50),
          edhrecCard('Enabler', 80),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [
      combo('c1', ['PieceA', 'Enabler'], ['Enabler']),
      combo('c2', ['PieceB', 'Enabler'], ['Enabler']),
    ];

    const result = comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map([['Enabler', enabler]]),
      budgetTracker: null,
      bracketGuard: undefined,
    });

    expect(state.categories.creatures.map((c) => c.name).sort()).toEqual([
      'Enabler',
      'PieceA',
      'PieceB',
    ]);
    expect(state.usedNames.has('Filler')).toBe(false);
    expect(state.usedNames.has('Enabler')).toBe(true);
    expect(state.bannedCards.has('Filler')).toBe(true);
    expect(result.repairs).toEqual([expect.objectContaining({ cut: 'Filler', added: 'Enabler' })]);
    expect(result.detectedCombos?.every((dc) => dc.isComplete)).toBe(true);
    expect(result.budgetSkipped).toBe(0);
    expect(result.bracketBlocked).toBe(0);
  });

  it('skips an enabler that exceeds the budget cap and applies no swap', () => {
    const state = makeState();
    const filler = scryfallCard('Filler');
    const pieceA = scryfallCard('PieceA');
    const pieceB = scryfallCard('PieceB');
    const enabler = scryfallCard('Enabler', { prices: { usd: '40.00' } });
    state.categories.creatures = [pieceA, pieceB, filler];
    state.usedNames = new Set(['PieceA', 'PieceB', 'Filler']);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Filler', 1),
          edhrecCard('PieceA', 50),
          edhrecCard('PieceB', 50),
          edhrecCard('Enabler', 80),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [
      combo('c1', ['PieceA', 'Enabler'], ['Enabler']),
      combo('c2', ['PieceB', 'Enabler'], ['Enabler']),
    ];
    const tracker = new BudgetTracker(6, 3, 'USD'); // near-exhausted effective cap

    const result = comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map([['Enabler', enabler]]),
      budgetTracker: tracker,
      bracketGuard: undefined,
    });

    expect(state.categories.creatures.map((c) => c.name).sort()).toEqual([
      'Filler',
      'PieceA',
      'PieceB',
    ]);
    expect(result.repairs).toEqual([]);
    expect(result.budgetSkipped).toBeGreaterThan(0);
    // No swap applied, so the returned list is the same reference (no rebuild).
    expect(result.detectedCombos).toBe(detectedCombos);
  });
});
