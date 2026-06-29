import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard, EDHRECCard } from '@/deck-builder/types';

// Tagger reads bundled JSON keyed by card name. Mock so signals are
// deterministic — every signal we want comes from the explicit gameChangerNames
// set passed to the estimator, not from tag data that may be absent in tests.
vi.mock('@/deck-builder/services/tagger/client', () => ({
  hasTag: vi.fn(() => false),
  isMassLandDenial: vi.fn(() => false),
  isExtraTurn: vi.fn(() => false),
  getCardRole: vi.fn(() => null),
}));

// stampRoleSubtypes is a no-op in tests.
vi.mock('../categorize', () => ({
  stampRoleSubtypes: () => {},
}));

import { applyBracketConvergence } from './phaseBracketConverge';
import type { GenerationState } from './state';

// ── helpers ──────────────────────────────────────────────────────────────────

function scryfallCard(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
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
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function edhrecCard(name: string, inclusion: number): EDHRECCard {
  return { name, sanitized: name, primary_type: 'Artifact', inclusion, num_decks: 100 };
}

// A pool of soft-neutral fillers the convergence pass can swap in.
const FILLER_POOL: EDHRECCard[] = [
  edhrecCard('Safe Filler A', 80),
  edhrecCard('Safe Filler B', 70),
  edhrecCard('Safe Filler C', 60),
];

function fillerScryfallMap(): Map<string, ScryfallCard> {
  const m = new Map<string, ScryfallCard>();
  for (const c of FILLER_POOL) m.set(c.name, scryfallCard(c.name));
  return m;
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = scryfallCard('Test Commander');
  // A handful of vanilla spells + a single "Power Card" the estimator will count
  // as a Game Changer (1 GC → hard floor Bracket 3).
  const synergy = [
    scryfallCard('Power Card'),
    scryfallCard('Spell A'),
    scryfallCard('Spell B'),
    scryfallCard('Spell C'),
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
    usedNames: new Set<string>(['Power Card', 'Spell A', 'Spell B', 'Spell C']),
    bannedCards: new Set<string>(),
    categories: {
      lands: [scryfallCard('Island', { type_line: 'Basic Land — Island', cmc: 0 })],
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
    gameChangerNames: new Set<string>(['Power Card']),
    combos: [],
    edhrecData: {
      cardlists: { allNonLand: FILLER_POOL },
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

function deckSize(state: GenerationState): number {
  return Object.values(state.categories).flat().length;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('applyBracketConvergence', () => {
  it('no-ops when no target bracket is set', () => {
    const state = makeState();
    state.cfg.targetBracket = undefined;
    const result = applyBracketConvergence(state, {
      scryfallCardMap: fillerScryfallMap(),
      detectedCombos: undefined,
      mustIncludeNames: new Set(),
    });
    expect(result.applied).toBe(0);
    expect(state.categories.synergy.some((c) => c.name === 'Power Card')).toBe(true);
  });

  it('no-ops when the deck already estimates at or below target', () => {
    const state = makeState();
    state.cfg.targetBracket = 3; // 1 GC → floor 3, target 3 → in-band
    const result = applyBracketConvergence(state, {
      scryfallCardMap: fillerScryfallMap(),
      detectedCombos: undefined,
      mustIncludeNames: new Set(),
    });
    expect(result.applied).toBe(0);
    expect(result.finalBracket).toBeLessThanOrEqual(3);
    expect(state.categories.synergy.some((c) => c.name === 'Power Card')).toBe(true);
  });

  it('converges an overshooting deck down to the target via a 1-for-1 swap', () => {
    const state = makeState();
    state.cfg.targetBracket = 2; // 1 GC floors at 3 → overshoots target 2
    const before = deckSize(state);

    const result = applyBracketConvergence(state, {
      scryfallCardMap: fillerScryfallMap(),
      detectedCombos: undefined,
      mustIncludeNames: new Set(),
    });

    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(result.finalBracket).toBeLessThanOrEqual(2);
    // The offending Game Changer was cut...
    expect(state.usedNames.has('Power Card')).toBe(false);
    expect(state.categories.synergy.some((c) => c.name === 'Power Card')).toBe(false);
    // ...and replaced by a soft-neutral filler — deck size preserved (100-card legality).
    expect(deckSize(state)).toBe(before);
  });

  it('breaks an incidental 2-card combo to converge a target-2 deck', () => {
    const state = makeState();
    state.cfg.targetBracket = 2;
    // No game changer — the combo is the only over-target signal.
    state.gameChangerNames = new Set();
    state.categories.synergy = [
      scryfallCard('Combo A'),
      scryfallCard('Combo B'),
      scryfallCard('Spell A'),
      scryfallCard('Spell B'),
    ];
    state.usedNames = new Set(['Combo A', 'Combo B', 'Spell A', 'Spell B']);
    const combo = {
      comboId: 'k',
      cards: ['Combo A', 'Combo B'],
      results: ['Win the game'],
      isComplete: true,
      missingCards: [],
      deckCount: 200,
      bracket: 3,
      bracketTag: null,
      cardCount: 2,
    };

    const result = applyBracketConvergence(state, {
      scryfallCardMap: fillerScryfallMap(),
      detectedCombos: [combo],
      mustIncludeNames: new Set(),
    });

    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(result.finalBracket).toBeLessThanOrEqual(2);
    // Exactly one combo piece cut (breaks the combo without gutting both).
    const remaining = ['Combo A', 'Combo B'].filter((n) => state.usedNames.has(n));
    expect(remaining).toHaveLength(1);
  });

  it('never cuts a must-include card, leaving an honest residual above target', () => {
    const state = makeState();
    state.cfg.targetBracket = 2;
    const result = applyBracketConvergence(state, {
      scryfallCardMap: fillerScryfallMap(),
      detectedCombos: undefined,
      mustIncludeNames: new Set(['power card']),
    });
    expect(result.applied).toBe(0);
    expect(state.categories.synergy.some((c) => c.name === 'Power Card')).toBe(true);
    expect(result.finalBracket).toBeGreaterThan(2);
  });

  it('never cuts the commander even when it is the power source', () => {
    const state = makeState();
    state.cfg.targetBracket = 2;
    // Make the commander itself the only Game Changer.
    state.gameChangerNames = new Set(['Test Commander']);
    state.categories.synergy = state.categories.synergy.filter((c) => c.name !== 'Power Card');
    state.usedNames.delete('Power Card');

    const result = applyBracketConvergence(state, {
      scryfallCardMap: fillerScryfallMap(),
      detectedCombos: undefined,
      mustIncludeNames: new Set(),
    });
    expect(result.applied).toBe(0);
    expect(result.finalBracket).toBeGreaterThan(2);
  });

  it('no-ops offline (no EDHREC pool to source safe fillers)', () => {
    const state = makeState();
    state.cfg.targetBracket = 2;
    state.edhrecData = null;
    const result = applyBracketConvergence(state, {
      scryfallCardMap: fillerScryfallMap(),
      detectedCombos: undefined,
      mustIncludeNames: new Set(),
    });
    expect(result.applied).toBe(0);
    expect(state.categories.synergy.some((c) => c.name === 'Power Card')).toBe(true);
  });

  // ── powering UP (under-target) ──────────────────────────────────────────────

  // A deck with no Game Changer, a pool that offers one, and a target above its
  // Core floor: the GC should be swapped in for the weakest card.
  function underTargetState(): GenerationState {
    const state = makeState();
    state.cfg.targetBracket = 3; // no GC in deck → Core (2), under target 3
    state.gameChangerNames = new Set(['Pool GC']); // the GC lives in the pool, not the deck
    state.categories.synergy = [
      scryfallCard('Spell A'),
      scryfallCard('Spell B'),
      scryfallCard('Spell C'),
      scryfallCard('Spell D'),
    ];
    state.usedNames = new Set(['Spell A', 'Spell B', 'Spell C', 'Spell D']);
    return state;
  }

  it('powers an under-target deck UP by swapping in a Game Changer', () => {
    const state = underTargetState();
    const before = deckSize(state);
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Pool GC', 95), ...FILLER_POOL] },
    } as unknown as GenerationState['edhrecData'];
    const map = fillerScryfallMap();
    map.set('Pool GC', scryfallCard('Pool GC'));

    const result = applyBracketConvergence(state, {
      scryfallCardMap: map,
      detectedCombos: undefined,
      mustIncludeNames: new Set(),
    });

    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(result.finalBracket).toBeGreaterThanOrEqual(3);
    // The Game Changer is now in the deck...
    expect(state.usedNames.has('Pool GC')).toBe(true);
    // ...and the deck stayed exactly its size (1-for-1 swap, 100-card legality).
    expect(deckSize(state)).toBe(before);
  });

  it('no-ops UP when the target pool has no Game Changer to add', () => {
    const state = underTargetState();
    state.gameChangerNames = new Set(); // no GC anywhere → pool is all soft fillers
    const before = deckSize(state);

    const result = applyBracketConvergence(state, {
      scryfallCardMap: fillerScryfallMap(),
      detectedCombos: undefined,
      mustIncludeNames: new Set(),
    });

    expect(result.applied).toBe(0);
    expect(result.finalBracket).toBeLessThan(3); // honestly under target — nothing to add
    expect(deckSize(state)).toBe(before);
  });

  it('leaves a deck already at target untouched (UP boundary)', () => {
    const state = makeState();
    state.cfg.targetBracket = 3; // default deck's 1 GC ('Power Card') → estimates exactly 3
    state.gameChangerNames = new Set(['Power Card', 'Pool GC']);
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Pool GC', 95), ...FILLER_POOL] },
    } as unknown as GenerationState['edhrecData'];
    const map = fillerScryfallMap();
    map.set('Pool GC', scryfallCard('Pool GC'));

    const result = applyBracketConvergence(state, {
      scryfallCardMap: map,
      detectedCombos: undefined,
      mustIncludeNames: new Set(),
    });

    expect(result.applied).toBe(0);
    expect(state.usedNames.has('Pool GC')).toBe(false); // no needless power-up
    expect(state.usedNames.has('Power Card')).toBe(true); // and no needless cut
  });
});
