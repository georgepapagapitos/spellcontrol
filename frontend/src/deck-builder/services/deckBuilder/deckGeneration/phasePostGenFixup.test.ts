import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

const roleMap: Record<string, string | null> = {};

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: (name: string) => roleMap[name] ?? null,
  isProtectionPiece: vi.fn(() => false),
  isFreeInteraction: vi.fn(() => false),
}));

vi.mock('../categorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../categorize')>();
  return {
    ...actual,
    stampRoleSubtypes: () => {},
  };
});

import { postGenFixupPhase, type PostGenFixupContext } from './phasePostGenFixup';
import type { GenerationState } from './state';
import { isProtectionPiece, isFreeInteraction } from '@/deck-builder/services/tagger/client';

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
      repairAddedNames: new Set(),
    });
    expect(result.fixupSwaps).toBe(0);
    expect(result.fixupRepairs).toEqual([]);
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
      repairAddedNames: new Set(),
    });
    expect(result.fixupSwaps).toBe(0);
    expect(result.fixupRepairs).toEqual([]);
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
      repairAddedNames: new Set(),
    });

    expect(result.fixupSwaps).toBe(1);
    expect(state.usedNames.has('Filler')).toBe(false);
    expect(state.usedNames.has('Rampant Growth')).toBe(true);
    expect(state.currentRoleCounts.ramp).toBe(1);
    expect(swapCandidates['type:creature']).toEqual([filler]);
  });

  // Contract B: 5a's disclosure — was logger.debug-only (invisible to the
  // build report / cardProvenance) before E167.
  it('discloses a 5a swap with the role-gap reason (Contract B)', () => {
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

    const result = postGenFixupPhase(state, {
      roleTargets: { ramp: 4, removal: 0, boardwipe: 0, cardDraw: 0 },
      swapCandidates: undefined,
      scryfallCardMap: new Map([['Rampant Growth', rampCard]]),
      repairAddedNames: new Set(),
    });

    expect(result.fixupRepairs).toEqual([
      {
        cut: 'Filler',
        added: 'Rampant Growth',
        reason:
          'Critical role gap: Ramp was running 0 vs its 4-card target after earlier swaps — swapped Filler for Rampant Growth.',
      },
    ]);
    expect(state.categories.creatures.some((c) => c.name === 'Filler')).toBe(false);
  });

  // Contract C: the flat `Math.min(2, ...)` fired 2 swaps for a 1-card
  // deficit even when the pool had 2+ candidates to support it —
  // phaseRoleSurplusRebalance then had to trim the resulting overage back
  // down (the live-instrumented overshoot this ticket exists to close).
  it('bounds 5a swaps to the actual deficit, not a flat 2 (Contract C)', () => {
    const state = makeState();
    const fillerA = scryfallCard('Filler A');
    const fillerB = scryfallCard('Filler B');
    const rampA = scryfallCard('Rampant Growth', { cmc: 2 });
    const rampB = scryfallCard('Cultivate', { cmc: 3 });
    roleMap['Rampant Growth'] = 'ramp';
    roleMap['Cultivate'] = 'ramp';
    state.categories.creatures = [fillerA, fillerB];
    state.usedNames = new Set(['Filler A', 'Filler B']);
    state.currentRoleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          { name: 'Rampant Growth', inclusion: 60 },
          { name: 'Cultivate', inclusion: 55 },
        ],
      },
    } as unknown as GenerationState['edhrecData'];

    // target 1 / current 0 -> deficit is exactly 1, even though both a
    // second filler and a second EDHREC candidate exist to support 2.
    const result = postGenFixupPhase(state, {
      roleTargets: { ramp: 1, removal: 0, boardwipe: 0, cardDraw: 0 },
      swapCandidates: undefined,
      scryfallCardMap: new Map([
        ['Rampant Growth', rampA],
        ['Cultivate', rampB],
      ]),
      repairAddedNames: new Set(),
    });

    expect(result.fixupSwaps).toBe(1);
    expect(result.fixupRepairs).toHaveLength(1);
  });

  // Contract B: 5b's disclosure.
  it('discloses a 5b swap with the curve-slot reason (Contract B)', () => {
    const state = makeState();
    const filler = scryfallCard('Overfull Filler', { cmc: 2 });
    const cmc1Replacement = scryfallCard('Swords to Plowshares', { cmc: 1 });
    state.categories.creatures = [filler];
    state.usedNames = new Set(['Overfull Filler']);
    state.edhrecData = {
      cardlists: { allNonLand: [{ name: 'Swords to Plowshares', inclusion: 70 }] },
    } as unknown as GenerationState['edhrecData'];

    const result = postGenFixupPhase(state, {
      roleTargets: null,
      swapCandidates: undefined,
      scryfallCardMap: new Map([['Swords to Plowshares', cmc1Replacement]]),
      repairAddedNames: new Set(),
    });

    expect(result.fixupSwaps).toBe(1);
    expect(result.fixupRepairs).toContainEqual({
      cut: 'Overfull Filler',
      added: 'Swords to Plowshares',
      reason:
        'Dead curve slot: no cards at 1 mana — swapped Overfull Filler for Swords to Plowshares.',
    });
  });

  // Contract A: findWeakestCard's protection set. Each case places the
  // protected card LAST in its category array — position-based weakness
  // means that's the card that would normally be picked (priority 1, the
  // lowest) — and asserts the next-weakest unprotected card is cut instead.
  describe('findWeakestCard protection set (Contract A)', () => {
    function makeProtectionState(protectedName: string, unprotectedName: string) {
      const state = makeState();
      const rampReplacement = scryfallCard('Rampant Growth', { cmc: 2 });
      roleMap['Rampant Growth'] = 'ramp';
      const unprotected = scryfallCard(unprotectedName);
      const protectedCard = scryfallCard(protectedName);
      // protectedCard is LAST -> priority 1 -> would be weakest.
      state.categories.creatures = [unprotected, protectedCard];
      state.usedNames = new Set([unprotectedName, protectedName]);
      state.currentRoleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
      state.edhrecData = {
        cardlists: { allNonLand: [{ name: 'Rampant Growth', inclusion: 60 }] },
      } as unknown as GenerationState['edhrecData'];
      return { state, rampReplacement, protectedCard, unprotected };
    }

    function expectProtectedCardSurvives(
      state: GenerationState,
      rampReplacement: ScryfallCard,
      protectedName: string,
      unprotectedName: string,
      ctxOverrides: Partial<PostGenFixupContext> = {}
    ) {
      const result = postGenFixupPhase(state, {
        roleTargets: { ramp: 4, removal: 0, boardwipe: 0, cardDraw: 0 },
        swapCandidates: undefined,
        scryfallCardMap: new Map([['Rampant Growth', rampReplacement]]),
        repairAddedNames: new Set(),
        ...ctxOverrides,
      });
      expect(result.fixupSwaps).toBe(1);
      expect(state.usedNames.has(protectedName)).toBe(true);
      expect(state.usedNames.has(unprotectedName)).toBe(false);
    }

    it('protects a repairAddedNames member (Contract D wiring)', () => {
      const { state, rampReplacement } = makeProtectionState('Repair Added Card', 'Unprotected A');
      expectProtectedCardSurvives(state, rampReplacement, 'Repair Added Card', 'Unprotected A', {
        repairAddedNames: new Set(['Repair Added Card']),
      });
    });

    it('protects a staple by NAME even with no isStapleRock flag', () => {
      const { state, rampReplacement } = makeProtectionState('Arcane Signet', 'Unprotected B');
      expectProtectedCardSurvives(state, rampReplacement, 'Arcane Signet', 'Unprotected B');
    });

    it('protects a card flagged isStapleRock', () => {
      const { state, rampReplacement, protectedCard } = makeProtectionState(
        'Some Other Rock',
        'Unprotected C'
      );
      protectedCard.isStapleRock = true;
      expectProtectedCardSurvives(state, rampReplacement, 'Some Other Rock', 'Unprotected C');
    });

    it('protects a card flagged isProtectionPiece', () => {
      const { state, rampReplacement } = makeProtectionState('Protected Piece', 'Unprotected D');
      vi.mocked(isProtectionPiece).mockImplementation((c) => c.name === 'Protected Piece');
      try {
        expectProtectedCardSurvives(state, rampReplacement, 'Protected Piece', 'Unprotected D');
      } finally {
        vi.mocked(isProtectionPiece).mockReturnValue(false);
      }
    });

    it('protects a card flagged isFreeInteraction', () => {
      const { state, rampReplacement } = makeProtectionState(
        'Free Interaction Piece',
        'Unprotected E'
      );
      vi.mocked(isFreeInteraction).mockImplementation((c) => c.name === 'Free Interaction Piece');
      try {
        expectProtectedCardSurvives(
          state,
          rampReplacement,
          'Free Interaction Piece',
          'Unprotected E'
        );
      } finally {
        vi.mocked(isFreeInteraction).mockReturnValue(false);
      }
    });

    it('protects a comboCardNames member', () => {
      const { state, rampReplacement } = makeProtectionState('Combo Piece', 'Unprotected F');
      state.comboCardNames = new Set(['Combo Piece']);
      expectProtectedCardSurvives(state, rampReplacement, 'Combo Piece', 'Unprotected F');
    });

    it('protects a must-include card', () => {
      const { state, rampReplacement } = makeProtectionState('Must Include Card', 'Unprotected G');
      state.context.customization.mustIncludeCards = ['Must Include Card'];
      expectProtectedCardSurvives(state, rampReplacement, 'Must Include Card', 'Unprotected G');
    });
  });
});
