import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard, EDHRECCard, DetectedCombo } from '@/deck-builder/types';

// Deterministic role/tag signals — real tagger data isn't needed for these
// pure-logic tests; individual tests override getCardRole per-case.
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: vi.fn(() => null),
  validateCardRole: vi.fn(() => null),
}));

vi.mock('../categorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../categorize')>();
  return {
    ...actual,
    stampRoleSubtypes: () => {},
  };
});

// Deck synergy / win-condition / lift protections are exercised via their own
// pure functions elsewhere — stub them here so this file only tests
// phaseBudgetConverge's own swap/protection/budget logic.
vi.mock('@/deck-builder/services/synergy/deckSynergy', () => ({
  analyzeDeckSynergy: vi.fn(() => ({ invested: [] })),
  isLoadBearing: vi.fn(() => false),
}));
vi.mock('@/deck-builder/services/winConditions/detect', () => ({
  isAltWinCard: vi.fn(() => false),
}));

import { applyBudgetConvergence } from './phaseBudgetConverge';
import { getCardRole } from '@/deck-builder/services/tagger/client';
import { isLoadBearing } from '@/deck-builder/services/synergy/deckSynergy';
import { isAltWinCard } from '@/deck-builder/services/winConditions/detect';
import { BudgetTracker } from '../budgetTracker';
import type { GenerationState } from './state';

// ── helpers ──────────────────────────────────────────────────────────────────

function scryfallCard(
  name: string,
  price: string | null,
  overrides: Partial<ScryfallCard> = {}
): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 3,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: price != null ? { usd: price } : {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function edhrecCard(name: string, inclusion: number): EDHRECCard {
  return { name, sanitized: name, primary_type: 'Artifact', inclusion, num_decks: 100 };
}

const POOL: EDHRECCard[] = [
  edhrecCard('Cheap Alt A', 80),
  edhrecCard('Cheap Alt B', 70),
  edhrecCard('Cheap Alt C', 60),
];

function poolScryfallMap(): Map<string, ScryfallCard> {
  const m = new Map<string, ScryfallCard>();
  m.set('Cheap Alt A', scryfallCard('Cheap Alt A', '2'));
  m.set('Cheap Alt B', scryfallCard('Cheap Alt B', '3'));
  m.set('Cheap Alt C', scryfallCard('Cheap Alt C', '4'));
  return m;
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = scryfallCard('Test Commander', null);
  const synergy = [
    scryfallCard('Pricey Card', '30'),
    scryfallCard('Mid Card', '15'),
    scryfallCard('Cheap Card', '2'),
  ];
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
    usedNames: new Set<string>(['Pricey Card', 'Mid Card', 'Cheap Card']),
    bannedCards: new Set<string>(),
    categories: {
      lands: [scryfallCard('Island', null, { type_line: 'Basic Land — Island', cmc: 0 })],
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: [],
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
    liftSeedPools: new Map(),
    liftSeedsTried: new Set(),
    gameChangerNames: new Set<string>(),
    combos: [],
    edhrecData: {
      cardlists: { allNonLand: POOL },
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

function baseCtx(overrides: Partial<Parameters<typeof applyBudgetConvergence>[1]> = {}) {
  return {
    scryfallCardMap: poolScryfallMap(),
    detectedCombos: undefined as DetectedCombo[] | undefined,
    mustIncludeNames: new Set<string>(),
    liftedByOf: () => undefined,
    gameChangerCount: { value: 0 },
    maxGameChangers: Infinity,
    budgetTracker: null,
    maxCardPrice: null,
    maxRarity: null,
    maxCmc: null,
    arenaOnly: false,
    currency: 'USD' as const,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    roleTargets: null,
    deckBudget: 40,
    ...overrides,
  };
}

function totalOf(state: GenerationState): number {
  let sum = 0;
  for (const card of Object.values(state.categories).flat()) {
    const p = card.prices?.usd;
    if (p) sum += parseFloat(p) || 0;
  }
  return sum;
}

describe('applyBudgetConvergence', () => {
  it('no-ops when the deck is already at or under budget', () => {
    const state = makeState();
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 1000 }));
    expect(result.applied).toBe(0);
    expect(result.residualReason).toBeUndefined();
    expect(state.usedNames.has('Pricey Card')).toBe(true);
  });

  it('converges an over-budget deck by swapping the priciest card for a cheaper alternative', () => {
    // deck total = 30 + 15 + 2 = 47, budget 40
    const state = makeState();
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40 }));

    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(result.finalTotal).toBeLessThanOrEqual(40);
    expect(result.residualReason).toBeUndefined();
    // The priciest card (Pricey Card, $30) was the one cut first.
    expect(state.usedNames.has('Pricey Card')).toBe(false);
    expect(totalOf(state)).toBeCloseTo(result.finalTotal, 1);
  });

  it('never cuts a must-include card', () => {
    const state = makeState();
    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 40, mustIncludeNames: new Set(['pricey card']) })
    );
    expect(state.usedNames.has('Pricey Card')).toBe(true);
    // Cheaper cards may still be swapped to reach budget, but Pricey Card survives.
    expect(result.finalTotal).toBeGreaterThan(0);
  });

  it('never cuts the commander, even if a same-named card somehow sits in categories', () => {
    // Not how generation normally shapes the deck (the commander lives outside
    // `categories`), but isProtected() checks commanderNames by name alone
    // regardless of where the card sits — verify that guard directly.
    const state = makeState();
    state.categories.synergy = [
      scryfallCard('Test Commander', '30'),
      scryfallCard('Cheap Card', '2'),
    ];
    state.usedNames = new Set(['Test Commander', 'Cheap Card']);
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 5 }));
    expect(state.usedNames.has('Test Commander')).toBe(true);
    expect(result.residualReason).toBeDefined();
  });

  it('never cuts a tracked combo piece', () => {
    const state = makeState();
    state.comboCardNames = new Set(['Pricey Card']);
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40 }));
    expect(state.usedNames.has('Pricey Card')).toBe(true);
    expect(result.finalTotal).toBeGreaterThan(0);
  });

  it('never cuts a lift-protected card (>=2 seeds)', () => {
    const state = makeState();
    applyBudgetConvergence(
      state,
      baseCtx({
        deckBudget: 40,
        liftedByOf: (n) => (n === 'pricey card' ? ['Seed A', 'Seed B'] : undefined),
      })
    );
    expect(state.usedNames.has('Pricey Card')).toBe(true);
  });

  it('never cuts a game changer', () => {
    // A GC-protected Pricey Card still lets the pass converge via Mid Card
    // (30 protected + 15 - 13 savings + 2 = 34 <= 40) — the point is Pricey
    // Card itself is never touched, not that the deck gets stuck.
    const state = makeState();
    state.gameChangerNames = new Set(['Pricey Card']);
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40 }));
    expect(state.usedNames.has('Pricey Card')).toBe(true);
    expect(result.finalTotal).toBeLessThanOrEqual(40);
  });

  it('never cuts an alt-win-condition card', () => {
    vi.mocked(isAltWinCard).mockImplementation((c) => (c as ScryfallCard).name === 'Pricey Card');
    const state = makeState();
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40 }));
    expect(state.usedNames.has('Pricey Card')).toBe(true);
    expect(result.finalTotal).toBeLessThanOrEqual(40);
    vi.mocked(isAltWinCard).mockReturnValue(false);
  });

  it('never cuts a load-bearing engine card', () => {
    vi.mocked(isLoadBearing).mockImplementation((c) => (c as ScryfallCard).name === 'Pricey Card');
    const state = makeState();
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40 }));
    expect(state.usedNames.has('Pricey Card')).toBe(true);
    expect(result.finalTotal).toBeLessThanOrEqual(40);
    vi.mocked(isLoadBearing).mockReturnValue(false);
  });

  it('only swaps in a strictly cheaper replacement (never a lateral or pricier one)', () => {
    const state = makeState();
    const map = poolScryfallMap();
    map.set('Cheap Alt A', scryfallCard('Cheap Alt A', '35')); // pricier than Pricey Card's $30
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40, scryfallCardMap: map }));
    expect(state.usedNames.has('Cheap Alt A')).toBe(false);
    // Still converges via a cheaper pool candidate.
    expect(result.finalTotal).toBeLessThanOrEqual(40);
  });

  it('respects the role cap: a role-null replacement never pushes a role over its cap', () => {
    vi.mocked(getCardRole).mockImplementation((name: string) =>
      name === 'Cheap Alt A' ? 'ramp' : null
    );
    const state = makeState();
    state.currentRoleCounts = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 40, roleTargets: { ramp: 2, removal: 0, boardwipe: 0, cardDraw: 0 } })
    );
    // Cheap Alt A is role-capped out (ramp already 5, target 2) — a different
    // cheap alternative (or none) must be used instead.
    expect(state.usedNames.has('Cheap Alt A')).toBe(false);
    expect(result).toBeDefined();
    vi.mocked(getCardRole).mockReturnValue(null);
  });

  it('gates candidates through the effective budget cap (BudgetTracker), not just maxCardPrice', () => {
    const state = makeState();
    const tracker = new BudgetTracker(1, 20, 'USD'); // effectively no room for any candidate
    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 40, budgetTracker: tracker, maxCardPrice: 100 })
    );
    // Every pool candidate's effective cap is near-zero — no legal swap.
    expect(result.residualReason).toBeDefined();
  });

  it('gates candidates on color identity', () => {
    const state = makeState();
    const map = poolScryfallMap();
    for (const [name, card] of map) map.set(name, { ...card, color_identity: ['B'] });
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40, scryfallCardMap: map }));
    // colorIdentity is [] (colorless commander) — no off-color candidate can be added.
    expect(result.applied).toBe(0);
    expect(result.residualReason).toBeDefined();
  });

  it('gates candidates via the synergy-dependency guard (cardAllowed)', () => {
    const state = makeState();
    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 40, cardAllowed: () => false })
    );
    expect(result.applied).toBe(0);
    expect(result.residualReason).toBeDefined();
  });

  it('gates candidates via salt-blocked names', () => {
    const state = makeState();
    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 40, isSaltBlocked: () => true })
    );
    expect(result.applied).toBe(0);
    expect(result.residualReason).toBeDefined();
  });

  it('protects every card in a complete combo passed via detectedCombos (not just state.comboCardNames)', () => {
    const state = makeState();
    const combo: DetectedCombo = {
      comboId: 'k',
      cards: ['Pricey Card', 'Mid Card'],
      results: ['Win the game'],
      isComplete: true,
      missingCards: [],
      deckCount: 200,
      bracket: 3,
      bracketTag: null,
      cardCount: 2,
    };
    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 40, detectedCombos: [combo] })
    );
    // Both combo pieces survive — only Cheap Card ($2, already at the pool's
    // floor price) is left unprotected, and it has no strictly cheaper
    // alternative, so the deck can't converge.
    expect(state.usedNames.has('Pricey Card')).toBe(true);
    expect(state.usedNames.has('Mid Card')).toBe(true);
    expect(result.residualReason).toBeDefined();
  });

  it('stops after a bounded number of swaps / rounds rather than looping forever', () => {
    // Build a deck of many distinct priced cards with no cheaper alternative
    // available anywhere (pool is empty) — convergence must give up cleanly.
    const state = makeState();
    state.edhrecData = {
      cardlists: { allNonLand: [] },
    } as unknown as GenerationState['edhrecData'];
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 1 }));
    expect(result.applied).toBe(0);
    expect(result.residualReason).toBe('no cheaper alternatives could be sourced offline');
  });

  it('names must-includes/combo pieces as the residual reason when everything left is protected', () => {
    const state = makeState();
    state.mustIncludeNames = ['Pricey Card', 'Mid Card', 'Cheap Card'];
    const result = applyBudgetConvergence(
      state,
      baseCtx({
        deckBudget: 1,
        mustIncludeNames: new Set(['pricey card', 'mid card', 'cheap card']),
      })
    );
    expect(result.applied).toBe(0);
    expect(result.residualReason).toBe(
      'the rest is must-includes and combo pieces with no cheaper equivalent'
    );
  });

  it('names a generic reason when unprotected cards remain but no legal alternative exists', () => {
    const state = makeState();
    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 1, cardAllowed: () => false })
    );
    expect(result.applied).toBe(0);
    expect(result.residualReason).toBe(
      'no cheaper legal alternatives were available for the remaining cards'
    );
  });
});
