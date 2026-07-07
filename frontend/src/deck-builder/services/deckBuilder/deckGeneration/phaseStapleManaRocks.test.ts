import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

function card(name: string, price: string, cmc = 1): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'uncommon',
    set: 'tst',
    set_name: 'Test',
    prices: { usd: price },
    legalities: { commander: 'legal' },
  } as ScryfallCard;
}

vi.mock('@/deck-builder/services/scryfall/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/deck-builder/services/scryfall/client')>();
  return {
    ...actual,
    getCardByName: vi.fn(async (name: string) => {
      const c = name === 'Sol Ring' ? card('Sol Ring', '40.00') : card('Arcane Signet', '5.00');
      // Real-world PDH facts: Sol Ring has no common printing (not_legal);
      // Arcane Signet is a CLB common downshift (legal).
      c.legalities = {
        commander: 'legal',
        paupercommander: c.name === 'Arcane Signet' ? 'legal' : 'not_legal',
      };
      return c;
    }),
  };
});

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: () => null,
  validateCardRole: () => null,
}));

import { stapleManaRocksPhase } from './phaseStapleManaRocks';
import { BudgetTracker } from '../budgetTracker';
import type { GenerationState } from './state';

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  return {
    context: {
      commander: card('Test Commander', '1.00'),
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

describe('stapleManaRocksPhase', () => {
  it('adds both staples with no budget tracker', async () => {
    const state = makeState();
    await stapleManaRocksPhase(state, null);
    expect(
      allCards(state)
        .map((c) => c.name)
        .sort()
    ).toEqual(['Arcane Signet', 'Sol Ring']);
  });

  it('gates on the dynamic effective cap, not just the static max (E79)', async () => {
    const state = makeState();
    // Static max is generous (50), but a near-exhausted BudgetTracker's
    // effective cap ($5 * 8 avg-cap floor with almost nothing left) should
    // still block the $40 Sol Ring.
    state.cfg.maxCardPrice = 50;
    const tracker = new BudgetTracker(6, 3, 'USD'); // avg $2/card, 8x cap = $16, 15% of $6 = $0.9 -> cap ~$0.9
    await stapleManaRocksPhase(state, tracker);
    const names = allCards(state).map((c) => c.name);
    expect(names).not.toContain('Sol Ring');
    expect(names).not.toContain('Arcane Signet');
  });

  it('deducts added staples from the budget tracker', async () => {
    const state = makeState();
    // A generous enough remaining budget/card-count that the dynamic
    // per-card cap (15% of remaining, or 8x average) clears $40 comfortably.
    const tracker = new BudgetTracker(1000, 5, 'USD');
    await stapleManaRocksPhase(state, tracker);
    expect(
      allCards(state)
        .map((c) => c.name)
        .sort()
    ).toEqual(['Arcane Signet', 'Sol Ring']);
    // $1000 - $40 (Sol Ring) - $5 (Arcane Signet) = $955
    expect(tracker.remainingBudget).toBeCloseTo(955, 2);
  });

  it('does not deduct for an owned, budget-exempt staple', async () => {
    const state = makeState();
    state.cfg.ignoreOwnedBudget = true;
    state.context.collectionNames = new Set(['Sol Ring', 'Arcane Signet']);
    const tracker = new BudgetTracker(1000, 5, 'USD');
    await stapleManaRocksPhase(state, tracker);
    expect(tracker.remainingBudget).toBe(1000);
  });

  it('PDH: skips Sol Ring (never common) but keeps Arcane Signet (downshift)', async () => {
    const state = makeState();
    state.cfg.mtgFormat = 'paupercommander';
    await stapleManaRocksPhase(state, null);
    expect(allCards(state).map((c) => c.name)).toEqual(['Arcane Signet']);
  });
});
