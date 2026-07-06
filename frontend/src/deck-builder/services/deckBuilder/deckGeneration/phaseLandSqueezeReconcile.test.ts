import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

// Deterministic role signals — same pattern as phaseRoleSurplusRebalance.test.ts.
const ROLE_OF = new Map<string, RoleKey>();
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: vi.fn((name: string) => ROLE_OF.get(name) ?? null),
  validateCardRole: vi.fn((card: { name: string }) => ROLE_OF.get(card.name) ?? null),
  isProtectionPiece: vi.fn(() => false),
  isFreeInteraction: vi.fn(() => false),
}));

import {
  applyLandSqueezeReconcile,
  type LandSqueezeReconcileContext,
} from './phaseLandSqueezeReconcile';
import { detectCombosPhase } from './phaseDetectCombos';
import type { GenerationState } from './state';
import { isProtectionPiece, isFreeInteraction } from '@/deck-builder/services/tagger/client';
import { FREE_INTERACTION_BOOST } from './trimResistanceConstants';

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
    wildcardCandidates: [],
    wildcardCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  ROLE_OF.clear();
  vi.mocked(isProtectionPiece).mockReturnValue(false);
  vi.mocked(isFreeInteraction).mockReturnValue(false);
});

describe('applyLandSqueezeReconcile', () => {
  it('is an exact no-op when squeezeDelta and wildcardCount are both 0 — state.categories untouched', () => {
    const state = makeState();
    state.categories.creatures.push(scryfallCard('Filler_1'), scryfallCard('Filler_2'));
    const before = JSON.stringify(state.categories);

    const result = applyLandSqueezeReconcile(state, makeCtx({ squeezeDelta: 0 }));

    expect(result.cut).toEqual([]);
    expect(result.wildcardsKept).toEqual([]);
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

  it('E82 attempt-7: protects a piece of a DETECTED-COMPLETE combo even though it was never in the small top-N "attempted" comboCardNames set (Doomsday/Thassa\'s Oracle repro)', () => {
    const state = makeState();
    const comboPieceA = scryfallCard('Doomsday');
    const comboPieceB = scryfallCard("Thassa's Oracle");
    const filler = scryfallCard('Genuine Filler');
    state.categories.synergy.push(comboPieceA, comboPieceB, filler);
    // Both combo pieces score WORSE than the filler by raw inclusion — proves
    // the combo-completeness protection, not luck, is what saves Doomsday.
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Doomsday', 1),
          edhrecCard("Thassa's Oracle", 1),
          edhrecCard('Genuine Filler', 50),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    // A real EDHREC combo dataset containing this pairing — comboCardNames
    // (the top-N "attempted" boost list) is deliberately left EMPTY here,
    // mirroring the bug: this combo never cleared comboSliceCount/
    // comboInclusionFloor, so the only signal deckGenerator.ts has for it is
    // detectCombosPhase finding it genuinely complete in the current picks.
    state.combos = [
      {
        comboId: 'doomsday-thassa',
        cards: [
          { name: 'Doomsday', id: 'a' },
          { name: "Thassa's Oracle", id: 'b' },
        ],
        results: ['Win the game'],
        deckCount: 13598,
        rank: 50,
        bracket: null,
        bracketTag: null,
        prereqCount: 0,
        cardCount: 2,
        href: null,
      },
    ];

    // The exact fold deckGenerator.ts performs right before calling the
    // reconcile: preview detectCombosPhase against the current picks and fold
    // any complete combo's cards into comboCardNames.
    for (const dc of detectCombosPhase(state) ?? []) {
      if (dc.isComplete) for (const name of dc.cards) state.comboCardNames.add(name);
    }
    expect(state.comboCardNames.has('Doomsday')).toBe(true);

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

  // ── E82 attempt 6: superset-pick wildcards ──

  function setupWildcardComparisonState(): GenerationState {
    const state = makeState();
    state.categories.creatures.push(scryfallCard('Incumbent_Low'), scryfallCard('Incumbent_High'));
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Incumbent_Low', 20),
          edhrecCard('Incumbent_High', 60),
          edhrecCard('Weak_Wildcard', 1),
          edhrecCard('Strong_Wildcard', 95),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    return state;
  }

  it('is byte-identical to the no-wildcard baseline when every wildcard candidate scores below every incumbent', () => {
    const weakWildcard = scryfallCard('Weak_Wildcard');

    const before = applyLandSqueezeReconcile(
      setupWildcardComparisonState(),
      makeCtx({ squeezeDelta: 1, wildcardCandidates: [], wildcardCount: 0 })
    );
    const after = applyLandSqueezeReconcile(
      setupWildcardComparisonState(),
      makeCtx({ squeezeDelta: 1, wildcardCandidates: [weakWildcard], wildcardCount: 1 })
    );

    // Every wildcard added is the exact one cut back out — the deck's real
    // cards (and cut order) are unaffected.
    expect(after.cut).toEqual(before.cut);
    expect(after.wildcardsKept).toEqual([]);
  });

  it('displaces the deck-wide-weakest incumbent when a wildcard scores higher', () => {
    const state = setupWildcardComparisonState();
    const strongWildcard = scryfallCard('Strong_Wildcard');

    const result = applyLandSqueezeReconcile(
      state,
      makeCtx({ squeezeDelta: 0, wildcardCandidates: [strongWildcard], wildcardCount: 1 })
    );

    expect(result.wildcardsKept).toEqual(['Strong_Wildcard']);
    expect(result.cut).toEqual(['Incumbent_Low']);
    expect(state.categories.creatures.map((c) => c.name)).not.toContain('Incumbent_Low');
    expect(state.categories.creatures.map((c) => c.name)).toContain('Incumbent_High');
    // Routed via routeCardByType (no role mapped in this fixture) — lands
    // straight into 'synergy', the type-router's default bucket.
    expect(state.categories.synergy.map((c) => c.name)).toContain('Strong_Wildcard');
  });

  it('protects a must-include and a protection piece even when the combined cut count grows via wildcards', () => {
    const state = makeState();
    const mustInclude = scryfallCard('Must Have', { isMustInclude: true });
    const protectionPiece = scryfallCard('Heroic Intervention');
    const filler1 = scryfallCard('Filler_1');
    const filler2 = scryfallCard('Filler_2');
    state.categories.synergy.push(mustInclude, protectionPiece, filler1, filler2);
    vi.mocked(isProtectionPiece).mockImplementation((c) => c.name === 'Heroic Intervention');
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Must Have', 1),
          edhrecCard('Heroic Intervention', 1),
          edhrecCard('Filler_1', 30),
          edhrecCard('Filler_2', 40),
          edhrecCard('Weak_Wildcard', 10),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const weakWildcard = scryfallCard('Weak_Wildcard');

    // squeezeDelta(1) + actualAdd(1) = 2 — a bigger combined cut than
    // squeezeDelta alone, exactly the "cut count grows via wildcards" case.
    const result = applyLandSqueezeReconcile(
      state,
      makeCtx({ squeezeDelta: 1, wildcardCandidates: [weakWildcard], wildcardCount: 1 })
    );

    expect(result.cut).not.toContain('Must Have');
    expect(result.cut).not.toContain('Heroic Intervention');
    expect(result.cut).toEqual(['Filler_1']);
    expect(result.wildcardsKept).toEqual([]);
  });

  it('E82 attempt-7: drops a kept wildcard whose price blows the deck-budget headroom, restoring the incumbent it displaced', () => {
    const state = setupWildcardComparisonState();
    // Overwrite the fixture's default $1.00 prices: incumbents are cheap, the
    // wildcard is expensive enough to blow a tight budget even though it
    // scores far above both incumbents (same score shape as "displaces the
    // deck-wide-weakest incumbent", which passes with a generous/null budget).
    state.categories.creatures = [
      scryfallCard('Incumbent_Low', { prices: { usd: '0.50' } }),
      scryfallCard('Incumbent_High', { prices: { usd: '5.00' } }),
    ];
    const strongWildcard = scryfallCard('Strong_Wildcard', { prices: { usd: '50.00' } });
    state.cfg.deckBudget = 10; // currentTotal 5.50 → 4.50 headroom, nowhere near $50

    const result = applyLandSqueezeReconcile(
      state,
      makeCtx({ squeezeDelta: 0, wildcardCandidates: [strongWildcard], wildcardCount: 1 })
    );

    expect(result.wildcardsKept).toEqual([]);
    expect(result.cut).toEqual([]);
    expect(state.categories.creatures.map((c) => c.name)).toEqual([
      'Incumbent_Low',
      'Incumbent_High',
    ]);
  });

  it('E82 attempt-7: keeps a wildcard that fits within deck-budget headroom (gate is a ceiling, not a blanket block)', () => {
    const state = setupWildcardComparisonState();
    state.categories.creatures = [
      scryfallCard('Incumbent_Low', { prices: { usd: '0.50' } }),
      scryfallCard('Incumbent_High', { prices: { usd: '5.00' } }),
    ];
    const strongWildcard = scryfallCard('Strong_Wildcard', { prices: { usd: '2.00' } });
    state.cfg.deckBudget = 100; // currentTotal 5.50 → 94.50 headroom, plenty for $2

    const result = applyLandSqueezeReconcile(
      state,
      makeCtx({ squeezeDelta: 0, wildcardCandidates: [strongWildcard], wildcardCount: 1 })
    );

    expect(result.wildcardsKept).toEqual(['Strong_Wildcard']);
    expect(result.cut).toEqual(['Incumbent_Low']);
  });

  it('E82 attempt-7: non-budget decks (deckBudget null) are unaffected by the gate — passthrough', () => {
    // Same shape as the dropped-wildcard case above, but with the default
    // null deckBudget from makeState()/setupWildcardComparisonState() — the
    // $50 wildcard is kept exactly as it was pre-fix, since the gate is
    // wholly inert without an active budget.
    const state = setupWildcardComparisonState();
    state.categories.creatures = [
      scryfallCard('Incumbent_Low', { prices: { usd: '0.50' } }),
      scryfallCard('Incumbent_High', { prices: { usd: '5.00' } }),
    ];
    const strongWildcard = scryfallCard('Strong_Wildcard', { prices: { usd: '50.00' } });
    expect(state.cfg.deckBudget).toBeNull();

    const result = applyLandSqueezeReconcile(
      state,
      makeCtx({ squeezeDelta: 0, wildcardCandidates: [strongWildcard], wildcardCount: 1 })
    );

    expect(result.wildcardsKept).toEqual(['Strong_Wildcard']);
    expect(result.cut).toEqual(['Incumbent_Low']);
  });

  it('gives a free-interaction card FREE_INTERACTION_BOOST, saving it over a worse-inclusion filler (iter-10 Slice A)', () => {
    const state = makeState();
    const filler = scryfallCard('Genuine Filler 2');
    const freeInteractionCard = scryfallCard('Commandeer');
    state.categories.synergy.push(filler, freeInteractionCard);
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('Genuine Filler 2', 50), edhrecCard('Commandeer', 5)],
      },
    } as unknown as GenerationState['edhrecData'];
    vi.mocked(isFreeInteraction).mockImplementation((c) => c.name === 'Commandeer');

    // Raw inclusion alone would cut Commandeer (5 < 50); FREE_INTERACTION_BOOST
    // (100) must flip that — proves the boost tier works in isolation
    // (liftScoreOf returns 0 for both via the default makeCtx).
    const result = applyLandSqueezeReconcile(state, makeCtx({ squeezeDelta: 1 }));

    expect(result.cut).toEqual(['Genuine Filler 2']);
  });

  it('regression: the unscaled-lift bug let a high-clusterScore incumbent outrank a free-interaction candidate — the scaling fix restores the correct order (iter-10 Slice A / board E82)', () => {
    // Measured shape from the yuriko-b4 debug log: on-theme ninja wildcards
    // scored 6207-7973 (almost entirely raw clusterScore) against
    // Commandeer's 2414 (calculateCardPriority + a much smaller lift
    // connection). A flat FREE_INTERACTION_BOOST alone (+100) cannot close
    // a multi-thousand-point gap — only scaling the lift term the same way
    // every other lift-aware consumer already does (packageBoost.ts's
    // computeLiftPickBoosts) restores a fair fight.
    const state = makeState();
    const incumbent = scryfallCard('On-Theme Wildcard');
    const candidate = scryfallCard('Commandeer');
    state.categories.synergy.push(incumbent, candidate);
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('On-Theme Wildcard', 90), edhrecCard('Commandeer', 52)],
      },
    } as unknown as GenerationState['edhrecData'];
    vi.mocked(isFreeInteraction).mockImplementation((c) => c.name === 'Commandeer');
    const liftScoreOf = (name: string) => (name === 'On-Theme Wildcard' ? 6500 : 2400);

    // squeezeDelta: 1 cuts exactly the lowest-scoring of the two.
    const result = applyLandSqueezeReconcile(state, makeCtx({ squeezeDelta: 1, liftScoreOf }));

    // Pre-fix (raw, unscaled lift): incumbent = 90 + 6500 = 6590; candidate =
    // 52 + 2400 + 100 = 2552 → candidate would have been cut. Post-fix
    // (lift capped at LIFT_PICK_BOOST_MAX=30 via LIFT_PICK_BOOST_SCALE):
    // incumbent = 90 + 30 = 120; candidate = 52 + 18 + FREE_INTERACTION_BOOST
    // (100) = 170 → incumbent is now the lower score and gets cut instead.
    expect(result.cut).toEqual(['On-Theme Wildcard']);
    expect(FREE_INTERACTION_BOOST).toBe(100);
  });
});
