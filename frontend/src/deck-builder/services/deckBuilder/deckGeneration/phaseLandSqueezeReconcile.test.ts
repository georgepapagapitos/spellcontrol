import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

// Deterministic role signals — same pattern as phaseRoleSurplusRebalance.test.ts.
const ROLE_OF = new Map<string, RoleKey>();
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: vi.fn((name: string) => ROLE_OF.get(name) ?? null),
  validateCardRole: vi.fn((card: { name: string }) => ROLE_OF.get(card.name) ?? null),
  isProtectionPiece: vi.fn(() => false),
}));

import {
  applyLandSqueezeReconcile,
  type LandSqueezeReconcileContext,
} from './phaseLandSqueezeReconcile';
import type { GenerationState } from './state';
import { isProtectionPiece } from '@/deck-builder/services/tagger/client';

// ── helpers ──────────────────────────────────────────────────────────────────

function scryfallCard(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: { usd: '1.00' },
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function edhrecCard(name: string, inclusion: number): EDHRECCard {
  return { name, sanitized: name, primary_type: 'Artifact', inclusion, num_decks: 1000 };
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = scryfallCard('Test Commander');
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

function makeCtx(
  overrides: Partial<LandSqueezeReconcileContext> = {}
): LandSqueezeReconcileContext {
  return {
    liftScoreOf: () => 0,
    roleTargets: null,
    currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
    squeezeDelta: 0,
    ...overrides,
  };
}

beforeEach(() => {
  ROLE_OF.clear();
  vi.mocked(isProtectionPiece).mockReturnValue(false);
});

describe('applyLandSqueezeReconcile', () => {
  it('is an exact no-op when squeezeDelta is 0 — state.categories untouched', () => {
    const state = makeState();
    state.categories.creatures.push(scryfallCard('Filler_1'), scryfallCard('Filler_2'));
    const before = JSON.stringify(state.categories);

    const result = applyLandSqueezeReconcile(state, makeCtx({ squeezeDelta: 0 }));

    expect(result.cut).toEqual([]);
    expect(JSON.stringify(state.categories)).toBe(before);
  });

  it('cuts exactly squeezeDelta cards, lowest inclusion first, cross-category', () => {
    const state = makeState();
    const creatureCard = scryfallCard('Creature_low');
    const synergyCard = scryfallCard('Synergy_low');
    const highCard = scryfallCard('Payoff_high');
    state.categories.creatures.push(creatureCard);
    state.categories.synergy.push(synergyCard, highCard);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Creature_low', 5),
          edhrecCard('Synergy_low', 8),
          edhrecCard('Payoff_high', 90),
        ],
      },
    } as unknown as GenerationState['edhrecData'];

    const result = applyLandSqueezeReconcile(state, makeCtx({ squeezeDelta: 2 }));

    expect(result.cut).toHaveLength(2);
    // The two genuinely lowest-inclusion cards, regardless of which category
    // they came from — the actual regression test for "silo'd by type".
    expect(result.cut.sort()).toEqual(['Creature_low', 'Synergy_low'].sort());
    expect(state.categories.creatures).not.toContain(creatureCard);
    expect(state.categories.synergy).not.toContain(synergyCard);
    expect(state.categories.synergy).toContain(highCard);
  });

  it('never cuts lands even when squeezeDelta exceeds the nonland pool', () => {
    const state = makeState();
    const land = scryfallCard('Some Land', { type_line: 'Land' });
    state.categories.lands.push(land);
    state.categories.creatures.push(scryfallCard('Only_Nonland'));
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Only_Nonland', 10)] },
    } as unknown as GenerationState['edhrecData'];

    const result = applyLandSqueezeReconcile(state, makeCtx({ squeezeDelta: 5 }));

    expect(result.cut).toEqual(['Only_Nonland']);
    expect(state.categories.lands).toContain(land);
  });

  it('never cuts a must-include, staple rock, protection piece, or combo card even when it scores lowest by raw inclusion', () => {
    const state = makeState();
    const mustInclude = scryfallCard('Must Have', { isMustInclude: true });
    const stapleByFlag = scryfallCard('Flagged Staple', { isStapleRock: true });
    const stapleByName = scryfallCard('Sol Ring'); // name-based, no flag — the #1022-precedent fix
    const protectionPiece = scryfallCard('Heroic Intervention');
    const comboCard = scryfallCard('Combo Piece');
    const filler = scryfallCard('Genuine Filler');

    state.categories.synergy.push(
      mustInclude,
      stapleByFlag,
      stapleByName,
      protectionPiece,
      comboCard,
      filler
    );
    state.comboCardNames.add('Combo Piece');
    vi.mocked(isProtectionPiece).mockImplementation((c) => c.name === 'Heroic Intervention');
    // Every protected card has a WORSE (lower) raw inclusion than the filler —
    // proves the boosts, not luck, are what saves them.
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Must Have', 1),
          edhrecCard('Flagged Staple', 1),
          edhrecCard('Sol Ring', 1),
          edhrecCard('Heroic Intervention', 1),
          edhrecCard('Combo Piece', 1),
          edhrecCard('Genuine Filler', 50),
        ],
      },
    } as unknown as GenerationState['edhrecData'];

    const result = applyLandSqueezeReconcile(state, makeCtx({ squeezeDelta: 1 }));

    expect(result.cut).toEqual(['Genuine Filler']);
  });

  it('falls back to role-average inclusion (never 0) for a pool-absent incumbent', () => {
    const state = makeState();
    ROLE_OF.set('Absent Ramp Card', 'ramp');
    ROLE_OF.set('Weak Ramp Card', 'ramp');
    ROLE_OF.set('Other Ramp', 'ramp'); // counts toward the role average, not the incumbent
    const absentCard = scryfallCard('Absent Ramp Card'); // no EDHREC pool entry
    const weakButListedCard = scryfallCard('Weak Ramp Card');
    state.categories.ramp.push(absentCard, weakButListedCard);
    // Pool includes a genuinely-low-inclusion ramp card (2) and other ramp
    // entries the average is computed from — the pool-absent card should NOT
    // read as worse than the explicitly-listed low card (which would happen
    // under a naive `?? 0` fallback).
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('Weak Ramp Card', 2), edhrecCard('Other Ramp', 90)],
      },
    } as unknown as GenerationState['edhrecData'];

    const result = applyLandSqueezeReconcile(state, makeCtx({ squeezeDelta: 1 }));

    // The explicitly-listed, genuinely-low-inclusion card is cut, not the
    // pool-absent one (which falls back to the role's average, ~46, not 0).
    expect(result.cut).toEqual(['Weak Ramp Card']);
  });

  it('updates currentRoleCounts bookkeeping for cut role cards, mirroring Smart Trim', () => {
    const state = makeState();
    ROLE_OF.set('Ramp_1', 'ramp');
    state.categories.ramp.push(scryfallCard('Ramp_1'));
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Ramp_1', 5)] },
    } as unknown as GenerationState['edhrecData'];
    const currentRoleCounts = { ramp: 3, removal: 0, boardwipe: 0, cardDraw: 0 };

    applyLandSqueezeReconcile(state, makeCtx({ squeezeDelta: 1, currentRoleCounts }));

    expect(currentRoleCounts.ramp).toBe(2);
  });
});
