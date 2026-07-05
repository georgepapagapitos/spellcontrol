import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

// Deterministic role signals — individual tests set `ROLE_OF` per case rather
// than depending on real tagger/bundled JSON data.
const ROLE_OF = new Map<string, RoleKey>();
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: vi.fn((name: string) => ROLE_OF.get(name) ?? null),
  validateCardRole: vi.fn((card: { name: string }) => ROLE_OF.get(card.name) ?? null),
  getRampSubtype: vi.fn(() => null),
  getRemovalSubtype: vi.fn(() => null),
  getBoardwipeSubtype: vi.fn(() => null),
  getCardDrawSubtype: vi.fn(() => null),
}));

vi.mock('../categorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../categorize')>();
  return {
    ...actual,
    stampRoleSubtypes: () => {},
  };
});

// Nonbo findings are individually pure-function tested elsewhere (nonbo.ts);
// this file only needs control over WHICH cards are flagged.
const NONBO_FLAGGED = new Set<string>();
vi.mock('../nonbo', () => ({
  nonboFindings: vi.fn((cards: ScryfallCard[]) =>
    cards
      .filter((c) => NONBO_FLAGGED.has(c.name))
      .map((c) => ({ kind: 'nonbo', severity: 'warn', card: c.name, message: 'nonbo' }))
  ),
}));
vi.mock('@/deck-builder/services/synergy/deckSynergy', () => ({
  analyzeDeckSynergy: vi.fn(() => ({ invested: [] })),
}));

import {
  applyRoleSurplusRebalance,
  MAX_SURPLUS_CONVERSIONS,
  type RoleSurplusRebalanceContext,
} from './phaseRoleSurplusRebalance';
import type { GenerationState } from './state';

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

// Deterministic, test-controlled trim resistance: lower name-suffix number =
// lower resistance = evicted first, unless explicitly overridden per-card.
// Isolated from the real computeTrimResistance (deckGenerator.ts) so these
// tests exercise THIS phase's ordering/gating logic, not that function.
function makeCtx(
  state: GenerationState,
  overrides: Partial<RoleSurplusRebalanceContext> = {}
): RoleSurplusRebalanceContext {
  return {
    scryfallCardMap: new Map(
      (state.edhrecData?.cardlists.allNonLand ?? []).map((c) => [c.name, scryfallCard(c.name)])
    ),
    roleTargets: null,
    detectedCombos: undefined,
    mustIncludeNames: new Set<string>(),
    liftScoreOf: () => 0,
    computeTrimResistance: (_card, positionIndex) => -positionIndex,
    gameChangerCount: { value: 0 },
    maxGameChangers: Infinity,
    budgetTracker: null,
    maxCardPrice: null,
    maxRarity: null,
    maxCmc: null,
    arenaOnly: false,
    currency: 'USD',
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    ...overrides,
  };
}

function addRampCards(state: GenerationState, count: number, prefix = 'Ramp'): ScryfallCard[] {
  const cards = Array.from({ length: count }, (_, i) => scryfallCard(`${prefix}_${i + 1}`));
  for (const c of cards) {
    ROLE_OF.set(c.name, 'ramp');
    state.usedNames.add(c.name);
  }
  state.categories.synergy.push(...cards);
  return cards;
}

describe('applyRoleSurplusRebalance', () => {
  beforeEach(() => {
    ROLE_OF.clear();
    NONBO_FLAGGED.clear();
  });

  it('is a no-op when no role target is set', () => {
    const state = makeState();
    addRampCards(state, 8);
    const before = state.categories.synergy;
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets: null }));
    expect(result.conversions).toEqual([]);
    expect(state.categories.synergy).toBe(before);
  });

  it('is an exact no-op when nothing is over its role cap', () => {
    const state = makeState();
    addRampCards(state, 5); // target 5, cap 7 — well under
    const before = state.categories.synergy;
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));
    expect(result.conversions).toEqual([]);
    expect(state.categories.synergy).toBe(before);
    expect(state.usedNames.size).toBe(5);
  });

  it('evicts ramp surplus down to cap and seats a gated payoff candidate', () => {
    const state = makeState();
    addRampCards(state, 8); // target 5 -> tolerance max(2, round(1))=2 -> cap 7; 1 over
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Payoff A', 90)] },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    expect(result.conversions).toHaveLength(1);
    expect(result.conversions[0].added).toBe('Payoff A');
    expect(state.usedNames.has('Payoff A')).toBe(true);
    expect(state.usedNames.has(result.conversions[0].cut)).toBe(false);
    // Exactly evicted down to cap (7), not to target (5).
    const remainingRamp = state.categories.synergy.filter((c) => ROLE_OF.get(c.name) === 'ramp');
    expect(remainingRamp).toHaveLength(7);
  });

  it('never evicts a must-include, combo piece, or staple rock', () => {
    const state = makeState();
    const cards = addRampCards(state, 8);
    cards[0].isMustInclude = true;
    state.comboCardNames.add(cards[1].name);
    cards[2].isStapleRock = true;
    // Give the protected cards the LOWEST resistance so an unprotected
    // ordering would pick them first if protection weren't enforced.
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Payoff A', 90)] },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const ctx = makeCtx(state, {
      roleTargets,
      computeTrimResistance: (card) =>
        card.isMustInclude || card.isStapleRock || state.comboCardNames.has(card.name) ? -100 : 0,
    });
    const result = applyRoleSurplusRebalance(state, ctx);

    expect(result.conversions).toHaveLength(1);
    const cutName = result.conversions[0].cut;
    expect([cards[0].name, cards[1].name, cards[2].name]).not.toContain(cutName);
    expect(state.usedNames.has(cards[0].name)).toBe(true);
    expect(state.usedNames.has(cards[1].name)).toBe(true);
    expect(state.usedNames.has(cards[2].name)).toBe(true);
  });

  it('evicts a nonbo-flagged card before a lower-resistance non-flagged one', () => {
    const state = makeState();
    const cards = addRampCards(state, 8);
    // cards[7] ("Ramp_8") would normally be evicted first (lowest resistance
    // via -positionIndex), but cards[0] is nonbo-flagged and must go first.
    NONBO_FLAGGED.add(cards[0].name);
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Payoff A', 90)] },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    expect(result.conversions).toHaveLength(1);
    expect(result.conversions[0].cut).toBe(cards[0].name);
    expect(result.conversions[0].reason).toMatch(/nonbo/);
  });

  it('rejects a salt-blocked / off-color / rarity-capped candidate and falls through to a legal one', () => {
    const state = makeState();
    addRampCards(state, 8);
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('Salty Payoff', 95), edhrecCard('Legal Payoff', 80)],
      },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const ctx = makeCtx(state, {
      roleTargets,
      isSaltBlocked: (name) => name === 'Salty Payoff',
    });
    const result = applyRoleSurplusRebalance(state, ctx);

    expect(result.conversions).toHaveLength(1);
    expect(result.conversions[0].added).toBe('Legal Payoff');
    expect(state.usedNames.has('Salty Payoff')).toBe(false);
  });

  it('applies no conversion when every candidate is gated out', () => {
    const state = makeState();
    addRampCards(state, 8);
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Salty Payoff', 95)] },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const ctx = makeCtx(state, {
      roleTargets,
      isSaltBlocked: () => true,
    });
    const result = applyRoleSurplusRebalance(state, ctx);
    expect(result.conversions).toEqual([]);
  });

  it('never pushes a same-role or any other role over ITS OWN cap (destination cap re-check)', () => {
    const state = makeState();
    addRampCards(state, 8); // ramp target 5, cap 7 -> 1 over
    const removalCards = Array.from({ length: 4 }, (_, i) => scryfallCard(`Removal_${i + 1}`));
    for (const c of removalCards) {
      ROLE_OF.set(c.name, 'removal');
      state.usedNames.add(c.name);
    }
    state.categories.synergy.push(...removalCards); // removal target 2, cap 4 -> already AT cap
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('Removal Candidate', 95), edhrecCard('Generic Payoff', 80)],
      },
    } as unknown as GenerationState['edhrecData'];
    ROLE_OF.set('Removal Candidate', 'removal');
    const roleTargets = { ramp: 5, removal: 2, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    expect(result.conversions).toHaveLength(1);
    // Removal Candidate would win on raw priority (95 > 80) but is blocked —
    // removal is already at its own cap (4).
    expect(result.conversions[0].added).toBe('Generic Payoff');
  });

  it('allows a deficit-role candidate to win the vacated slot (no artificial non-reactive-only filter)', () => {
    const state = makeState();
    addRampCards(state, 8); // ramp: over cap
    // removal target 8, currently only 1 in deck -> deeply under cap
    const removalCard = scryfallCard('Removal_1');
    ROLE_OF.set(removalCard.name, 'removal');
    state.usedNames.add(removalCard.name);
    state.categories.synergy.push(removalCard);
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('Removal Payoff', 90), edhrecCard('Generic Payoff', 70)],
      },
    } as unknown as GenerationState['edhrecData'];
    ROLE_OF.set('Removal Payoff', 'removal');
    const roleTargets = { ramp: 5, removal: 8, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    expect(result.conversions).toHaveLength(1);
    // The higher-priority REMOVAL-role candidate is a legitimate winner —
    // its own role (removal) has plenty of room under cap.
    expect(result.conversions[0].added).toBe('Removal Payoff');
  });

  it('never applies more than MAX_SURPLUS_CONVERSIONS swaps', () => {
    const state = makeState();
    addRampCards(state, 20); // target 3 -> tolerance max(2, round(0.6))=2 -> cap 5; 15 over
    state.edhrecData = {
      cardlists: {
        allNonLand: Array.from({ length: 10 }, (_, i) => edhrecCard(`Payoff_${i + 1}`, 90 - i)),
      },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 3, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    expect(result.conversions).toHaveLength(MAX_SURPLUS_CONVERSIONS);
  });

  it('still functions (priority-only ranking) when lift pools are empty', () => {
    const state = makeState();
    addRampCards(state, 8);
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Payoff A', 90)] },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    // liftScoreOf always 0 (default in makeCtx) — clusterScore contributes nothing.
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));
    expect(result.conversions).toHaveLength(1);
    expect(result.conversions[0].added).toBe('Payoff A');
  });
});
