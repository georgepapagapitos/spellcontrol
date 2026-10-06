import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

const roleMap: Record<string, string | null> = {};

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardDrawSubtype: () => null,
  getCardRole: (name: string) => roleMap[name] ?? null,
  readsAsProtection: vi.fn(() => false),
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
import { readsAsProtection, isFreeInteraction } from '@/deck-builder/services/tagger/client';

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

  // E-arena-leak: the role-deficit backfill (5a) had NO price/rarity/CMC/
  // Arena/legality gate at all — LIVE-CONFIRMED shipping Massacre Wurm past
  // an explicit maxCardPrice and Ninja of the Deep Hours (cmc 4) past
  // tinyLeaders' CMC cap. The top-priority candidate must be skipped when it
  // violates a user cap, falling through to a clean one.
  it('skips a role-deficit candidate that violates the user caps, falling through to a clean one', () => {
    const state = makeState();
    state.cfg.maxCardPrice = 1;
    const filler = scryfallCard('Filler');
    const overpriced = scryfallCard('Massacre Wurm', { cmc: 6, prices: { usd: '1.70' } });
    const cheap = scryfallCard('Cheap Wipe', { cmc: 4, prices: { usd: '0.50' } });
    roleMap['Massacre Wurm'] = 'boardwipe';
    roleMap['Cheap Wipe'] = 'boardwipe';
    state.categories.creatures = [filler];
    state.usedNames = new Set(['Filler']);
    state.currentRoleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          { name: 'Massacre Wurm', inclusion: 90 },
          { name: 'Cheap Wipe', inclusion: 60 },
        ],
      },
    } as unknown as GenerationState['edhrecData'];

    const result = postGenFixupPhase(state, {
      roleTargets: { ramp: 0, removal: 0, boardwipe: 4, cardDraw: 0 },
      swapCandidates: undefined,
      scryfallCardMap: new Map([
        ['Massacre Wurm', overpriced],
        ['Cheap Wipe', cheap],
      ]),
      repairAddedNames: new Set(),
    });

    expect(result.fixupSwaps).toBe(1);
    expect(state.usedNames.has('Massacre Wurm')).toBe(false);
    expect(state.usedNames.has('Cheap Wipe')).toBe(true);
  });

  it('never fires a role-deficit swap when every candidate violates the user caps', () => {
    const state = makeState();
    state.cfg.maxCmc = 3; // tinyLeaders-style cap
    const filler = scryfallCard('Filler');
    const overCmc = scryfallCard('Ninja of the Deep Hours', { cmc: 4 });
    roleMap['Ninja of the Deep Hours'] = 'cardDraw';
    state.categories.creatures = [filler];
    state.usedNames = new Set(['Filler']);
    state.currentRoleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    state.edhrecData = {
      cardlists: { allNonLand: [{ name: 'Ninja of the Deep Hours', inclusion: 90 }] },
    } as unknown as GenerationState['edhrecData'];

    const result = postGenFixupPhase(state, {
      roleTargets: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 4 },
      swapCandidates: undefined,
      scryfallCardMap: new Map([['Ninja of the Deep Hours', overCmc]]),
      repairAddedNames: new Set(),
    });

    expect(result.fixupSwaps).toBe(0);
    expect(state.usedNames.has('Ninja of the Deep Hours')).toBe(false);
    expect(state.usedNames.has('Filler')).toBe(true);
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
        reason: 'Swapped Filler for Rampant Growth to close a ramp gap.',
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
      reason: 'Swapped Overfull Filler for Swords to Plowshares to fill your 1-mana curve.',
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

    /** Sets the page pool: [name, inclusion] pairs. */
    function pagePool(state: GenerationState, rows: Array<[string, number]>) {
      state.edhrecData = {
        cardlists: { allNonLand: rows.map(([name, inclusion]) => ({ name, inclusion })) },
      } as unknown as GenerationState['edhrecData'];
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

    it('protects a card flagged readsAsProtection', () => {
      const { state, rampReplacement } = makeProtectionState('Protected Piece', 'Unprotected D');
      vi.mocked(readsAsProtection).mockImplementation((c) => c.name === 'Protected Piece');
      try {
        expectProtectedCardSurvives(state, rampReplacement, 'Protected Piece', 'Unprotected D');
      } finally {
        vi.mocked(readsAsProtection).mockReturnValue(false);
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

    // E563: Lathril coll-prefer. The coherence repair seated Umbral Mantle, so
    // Leyline of Abundance, the engine of the deck's one infinite line (with
    // Llanowar Tribe and Umbral Mantle), was a combo piece only now; the fixup
    // cut it "to close a board wipe gap".
    it('protects a piece of a combo line the deck can now assemble', () => {
      const { state, rampReplacement } = makeProtectionState(
        'Leyline of Abundance',
        'Unprotected H'
      );
      const tribe = scryfallCard('Llanowar Tribe');
      const mantle = scryfallCard('Umbral Mantle');
      state.categories.synergy = [tribe, mantle];
      state.usedNames.add('Llanowar Tribe');
      state.usedNames.add('Umbral Mantle');
      state.combos = [
        {
          comboId: 'leyline-line',
          cards: [
            { name: 'Leyline of Abundance', id: 'a' },
            { name: 'Llanowar Tribe', id: 'b' },
            { name: 'Umbral Mantle', id: 'c' },
          ],
        },
      ] as unknown as GenerationState['combos'];
      // The incoming Rampant Growth is played less (10%) than Leyline (30%): a downgrade.
      pagePool(state, [
        ['Rampant Growth', 10],
        ['Leyline of Abundance', 30],
        ['Llanowar Tribe', 30],
        ['Umbral Mantle', 30],
      ]);
      expectProtectedCardSurvives(state, rampReplacement, 'Leyline of Abundance', 'Unprotected H');
    });

    // E563: Atraxa partial50. Counterspell (37.7%) is the deck's only stack answer.
    it('protects the last answer of a class the deck holds', () => {
      const { state, rampReplacement } = makeProtectionState('Counterspell', 'Unprotected I');
      state.categories.creatures = state.categories.creatures.map((c) =>
        c.name === 'Counterspell' ? { ...c, oracle_text: 'Counter target spell.' } : c
      );
      pagePool(state, [
        ['Rampant Growth', 10],
        ['Counterspell', 30],
      ]);
      expectProtectedCardSurvives(state, rampReplacement, 'Counterspell', 'Unprotected I');
    });

    // E563 (Lathril coll-partial50): an unkept 0% card stays the first victim while
    // kept staples are skipped, exactly as before the keeper existed.
    it('cuts the unkept 0% card for a removal gap, never the kept staple beside it', () => {
      const state = makeState();
      const staple = scryfallCard('Poison-Tip Archer');
      const glacial = scryfallCard('Glacial Revelation');
      const beastWithin = scryfallCard('Beast Within', { cmc: 3 });
      roleMap['Beast Within'] = 'removal';
      // the staple is LAST in its category, so position alone would cut it
      state.categories.creatures = [glacial, staple];
      state.usedNames = new Set(['Glacial Revelation', 'Poison-Tip Archer']);
      state.currentRoleCounts = { ramp: 0, removal: 3, boardwipe: 0, cardDraw: 0 };
      pagePool(state, [
        ['Poison-Tip Archer', 49.8],
        ['Glacial Revelation', 0],
        ['Beast Within', 38.3],
      ]);
      const result = postGenFixupPhase(state, {
        roleTargets: { ramp: 0, removal: 8, boardwipe: 0, cardDraw: 0 },
        swapCandidates: undefined,
        scryfallCardMap: new Map([['Beast Within', beastWithin]]),
        repairAddedNames: new Set(),
      });
      expect(result.fixupRepairs[0]).toMatchObject({
        cut: 'Glacial Revelation',
        added: 'Beast Within',
      });
      expect(state.usedNames.has('Poison-Tip Archer')).toBe(true);
    });

    it('protects a must-include card', () => {
      const { state, rampReplacement } = makeProtectionState('Must Include Card', 'Unprotected G');
      state.context.customization.mustIncludeCards = ['Must Include Card'];
      expectProtectedCardSurvives(state, rampReplacement, 'Must Include Card', 'Unprotected G');
    });
  });

  // E563: a role below target takes a filler's slot (5a2), whatever the deficit.
  describe('filler upgrade for a role below target (5a2)', () => {
    function lathril(opts: { filler?: number; cardDraw?: number; beast?: number } = {}) {
      const state = makeState();
      const archer = scryfallCard('Poison-Tip Archer');
      const glacial = scryfallCard('Glacial Revelation');
      const beastWithin = scryfallCard('Beast Within', { cmc: 3 });
      roleMap['Beast Within'] = 'removal';
      roleMap['Glacial Revelation'] = 'cardDraw';
      roleMap['Poison-Tip Archer'] = null;
      state.categories.creatures = [archer];
      state.categories.cardDraw = [glacial];
      state.usedNames = new Set(['Glacial Revelation', 'Poison-Tip Archer']);
      state.currentRoleCounts = {
        ramp: 0,
        removal: 5,
        boardwipe: 0,
        cardDraw: opts.cardDraw ?? 12,
      };
      state.edhrecData = {
        cardlists: {
          allNonLand: [
            { name: 'Poison-Tip Archer', inclusion: 49.8 },
            { name: 'Glacial Revelation', inclusion: opts.filler ?? 0 },
            { name: 'Beast Within', inclusion: opts.beast ?? 38.3 },
          ],
        },
      } as unknown as GenerationState['edhrecData'];
      const result = postGenFixupPhase(state, {
        roleTargets: { ramp: 0, removal: 8, boardwipe: 0, cardDraw: 12 },
        swapCandidates: undefined,
        scryfallCardMap: new Map([['Beast Within', beastWithin]]),
        repairAddedNames: new Set(),
      });
      return { result, state };
    }

    it('swaps a 0% filler for the best missing removal at 5 of 8 (Lathril coll-partial50)', () => {
      const { result, state } = lathril();
      expect(result.fixupRepairs).toEqual([
        {
          cut: 'Glacial Revelation',
          added: 'Beast Within',
          reason: 'Swapped Glacial Revelation for Beast Within to close a removal gap.',
        },
      ]);
      expect(state.usedNames.has('Poison-Tip Archer')).toBe(true);
    });

    it('makes no swap when no card is on 5% or less (every card a real pick)', () => {
      expect(lathril({ filler: 30 }).result.fixupSwaps).toBe(0);
    });

    it('makes no swap when the incoming card is not played 20 points more', () => {
      expect(lathril({ beast: 15 }).result.fixupSwaps).toBe(0);
    });

    it('does not take a filler that is the last card of its own role at target', () => {
      expect(lathril({ cardDraw: 1 }).result.fixupSwaps).toBe(0);
    });
  });
});
