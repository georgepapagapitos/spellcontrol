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
    deckBudget: null,
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

  it('never evicts a must-include or combo piece', () => {
    const state = makeState();
    const cards = addRampCards(state, 8);
    cards[0].isMustInclude = true;
    state.comboCardNames.add(cards[1].name);
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Payoff A', 90)] },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    expect(result.conversions).toHaveLength(1);
    const cutName = result.conversions[0].cut;
    expect([cards[0].name, cards[1].name]).not.toContain(cutName);
    expect(state.usedNames.has(cards[0].name)).toBe(true);
    expect(state.usedNames.has(cards[1].name)).toBe(true);
  });

  it('never evicts a staple rock flagged isStapleRock', () => {
    const state = makeState();
    const cards = addRampCards(state, 8);
    cards[2].isStapleRock = true;
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Payoff A', 90)] },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    expect(result.conversions).toHaveLength(1);
    expect(result.conversions[0].cut).not.toBe(cards[2].name);
    expect(state.usedNames.has(cards[2].name)).toBe(true);
  });

  // Defect 1 regression (live-eval gate): Sythis lost Sol Ring + Arcane Signet
  // to conversions because `card.isStapleRock` is only ever set on a copy
  // stapleManaRocksPhase itself adds — a staple already in the deck via
  // normal EDHREC-pool picking (the common case, 28/30 decks) arrives here
  // flagless, so the old flag-only check didn't protect it.
  it('never evicts a staple picked from the EDHREC pool (no isStapleRock flag)', () => {
    const state = makeState();
    const solRing = scryfallCard('Sol Ring'); // no isStapleRock, no EDHREC pool entry -> priority 0
    ROLE_OF.set(solRing.name, 'ramp');
    state.usedNames.add(solRing.name);
    state.categories.synergy.push(solRing);
    // Fillers WITH a positive pool entry — Sol Ring would rank as the worst
    // (lowest survival score) if name-based staple protection weren't applied.
    const fillers = addRampCards(state, 7, 'Filler');
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          ...fillers.map((c, i) => edhrecCard(c.name, 10 + i)),
          edhrecCard('Payoff A', 95),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    expect(result.conversions.length).toBeGreaterThan(0);
    expect(result.conversions.some((c) => c.cut === 'Sol Ring')).toBe(false);
    expect(state.usedNames.has('Sol Ring')).toBe(true);
  });

  it('evicts a nonbo-flagged card before a higher-survival non-flagged one', () => {
    const state = makeState();
    const cards = addRampCards(state, 8);
    // cards[0] has BETTER inclusion than its untagged siblings (survival 20
    // vs their 0) but is nonbo-flagged — it must still evict first. Kept
    // modest (not the deck's best) so the replacement can still clear the
    // margin against it.
    NONBO_FLAGGED.add(cards[0].name);
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard(cards[0].name, 20), edhrecCard('Payoff A', 50)],
      },
    } as unknown as GenerationState['edhrecData'];
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    expect(result.conversions).toHaveLength(1);
    expect(result.conversions[0].cut).toBe(cards[0].name);
    expect(result.conversions[0].reason).toMatch(/nonbo/);
  });

  it('rejects a salt-blocked candidate and falls through to a legal one', () => {
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

  it('never pushes a DIFFERENT role over ITS OWN cap (cross-role destination check)', () => {
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
    // it's a DIFFERENT role than the evicted ramp card, and removal is
    // already at its own cap (4).
    expect(result.conversions[0].added).toBe('Generic Payoff');
  });

  it('allows a same-role replacement even though that role is over its own cap (net-zero swap)', () => {
    const state = makeState();
    const cards = addRampCards(state, 8); // ramp target 5, cap 7 -> 1 over
    state.edhrecData = {
      cardlists: {
        // Incumbents get their OWN low pool entries — with no entry at all,
        // their survival score would fall back to the role's average pool
        // inclusion (defect 7 fix), which in a fixture with only ONE 'ramp'
        // pool entry would equal the candidate's own score and never clear
        // the improvement margin against it.
        allNonLand: [...cards.map((c) => edhrecCard(c.name, 5)), edhrecCard('Ramp Payoff', 90)],
      },
    } as unknown as GenerationState['edhrecData'];
    ROLE_OF.set('Ramp Payoff', 'ramp'); // same role as every evictable candidate
    const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    // A same-role swap removes one ramp card and adds one back — the count
    // never increases, so it must not be blocked by ramp's own cap.
    expect(result.conversions).toHaveLength(1);
    expect(result.conversions[0].added).toBe('Ramp Payoff');
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

  // ── Defect 2 regressions (live-eval gate) ──────────────────────────────────
  describe('eviction ordering on realistic inclusion spreads', () => {
    it('evicts the lowest-inclusion ramp card, never a high-inclusion one (Kozilek repro)', () => {
      const state = makeState();
      const names = [
        'Thran Dynamo',
        'Rise of the Eldrazi',
        'Mox Diamond',
        'Manakin',
        'Hedron Crawler',
      ];
      const cards = names.map((n) => scryfallCard(n));
      for (const c of cards) {
        ROLE_OF.set(c.name, 'ramp');
        state.usedNames.add(c.name);
      }
      state.categories.synergy.push(...cards);
      // Pad to real surplus (target 5, cap 7 -> need 8) with fillers scored
      // ABOVE Mox Diamond's 6% so Mox Diamond stays the unambiguous worst —
      // an unscored filler would default to survival 0, below Mox Diamond,
      // and mask the very ordering bug this test exists to catch.
      const fillers = addRampCards(state, 3, 'Filler');

      state.edhrecData = {
        cardlists: {
          allNonLand: [
            edhrecCard('Thran Dynamo', 90.2),
            edhrecCard('Rise of the Eldrazi', 49),
            edhrecCard('Mox Diamond', 6),
            edhrecCard('Manakin', 12.1),
            edhrecCard('Hedron Crawler', 23.4),
            ...fillers.map((c, i) => edhrecCard(c.name, 15 + i)),
            edhrecCard('Payoff A', 40), // clears the margin over Mox Diamond (6) only
          ],
        },
      } as unknown as GenerationState['edhrecData'];
      const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
      const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

      expect(result.conversions).toHaveLength(1);
      expect(result.conversions[0].cut).toBe('Mox Diamond');
      expect(state.usedNames.has('Thran Dynamo')).toBe(true);
      expect(state.usedNames.has('Rise of the Eldrazi')).toBe(true);
    });

    it('protects a lift-connected card even when its regex role reads reactive (Warstorm Surge repro)', () => {
      const state = makeState();
      const payoff = scryfallCard('Warstorm Surge'); // regex-tagged 'removal' but a live token payoff
      const filler = scryfallCard('Weak Removal Filler');
      ROLE_OF.set(payoff.name, 'removal');
      ROLE_OF.set(filler.name, 'removal');
      state.usedNames.add(payoff.name);
      state.usedNames.add(filler.name);
      state.categories.synergy.push(payoff, filler);
      // 3 more removal fillers to build surplus (target 2, cap 4 -> need 5).
      const extra = Array.from({ length: 3 }, (_, i) => scryfallCard(`Removal_${i + 1}`));
      for (const c of extra) {
        ROLE_OF.set(c.name, 'removal');
        state.usedNames.add(c.name);
      }
      state.categories.synergy.push(...extra);

      state.edhrecData = {
        cardlists: { allNonLand: [edhrecCard('Payoff A', 40)] },
      } as unknown as GenerationState['edhrecData'];
      const roleTargets = { ramp: 0, removal: 2, boardwipe: 0, cardDraw: 0 };
      // Neither `payoff` nor `filler` has an EDHREC pool entry (priority 0) —
      // only the lift signal distinguishes them.
      const ctx = makeCtx(state, {
        roleTargets,
        liftScoreOf: (name) => (name === 'Warstorm Surge' ? 5000 : 0),
      });
      const result = applyRoleSurplusRebalance(state, ctx);

      expect(result.conversions.length).toBeGreaterThan(0);
      expect(result.conversions.some((c) => c.cut === 'Warstorm Surge')).toBe(false);
    });
  });

  // ── Defect 3 regressions (live-eval gate) ──────────────────────────────────
  describe('total-deck budget headroom', () => {
    it('rejects a swap whose price delta would push the deck over the budget ask', () => {
      const state = makeState();
      const cheap = scryfallCard('Lightning Bolt', { prices: { usd: '0.83' } });
      ROLE_OF.set(cheap.name, 'removal');
      state.usedNames.add(cheap.name);
      state.categories.synergy.push(cheap);
      const extra = Array.from({ length: 4 }, (_, i) =>
        scryfallCard(`Removal_${i + 1}`, { prices: { usd: '1.00' } })
      );
      for (const c of extra) {
        ROLE_OF.set(c.name, 'removal');
        state.usedNames.add(c.name);
      }
      state.categories.synergy.push(...extra);
      // Deck total = 0.83 + 4*1.00 = 4.83; ask is exactly 4.83 (zero headroom).
      state.edhrecData = {
        cardlists: {
          allNonLand: [edhrecCard('Brightstone Ritual', 90)], // priced ABOVE the cut -> breaches
        },
      } as unknown as GenerationState['edhrecData'];
      const ctx = makeCtx(state, {
        roleTargets: { ramp: 0, removal: 2, boardwipe: 0, cardDraw: 0 },
        deckBudget: 4.83,
        scryfallCardMap: new Map([
          ['Brightstone Ritual', scryfallCard('Brightstone Ritual', { prices: { usd: '2.58' } })],
        ]),
      });
      const result = applyRoleSurplusRebalance(state, ctx);

      expect(result.conversions).toEqual([]);
      expect(state.usedNames.has('Lightning Bolt')).toBe(true);
    });

    it('accepts a swap that fits the remaining budget headroom', () => {
      const state = makeState();
      const cheap = scryfallCard('Lightning Bolt', { prices: { usd: '0.83' } });
      ROLE_OF.set(cheap.name, 'removal');
      state.usedNames.add(cheap.name);
      state.categories.synergy.push(cheap);
      const extra = Array.from({ length: 4 }, (_, i) =>
        scryfallCard(`Removal_${i + 1}`, { prices: { usd: '1.00' } })
      );
      for (const c of extra) {
        ROLE_OF.set(c.name, 'removal');
        state.usedNames.add(c.name);
      }
      state.categories.synergy.push(...extra);
      // Deck total = 4.83; ask 10 -> plenty of headroom for a $2.58 candidate.
      state.edhrecData = {
        cardlists: { allNonLand: [edhrecCard('Brightstone Ritual', 90)] },
      } as unknown as GenerationState['edhrecData'];
      const ctx = makeCtx(state, {
        roleTargets: { ramp: 0, removal: 2, boardwipe: 0, cardDraw: 0 },
        deckBudget: 10,
        scryfallCardMap: new Map([
          ['Brightstone Ritual', scryfallCard('Brightstone Ritual', { prices: { usd: '2.58' } })],
        ]),
      });
      const result = applyRoleSurplusRebalance(state, ctx);

      expect(result.conversions).toHaveLength(1);
      expect(result.conversions[0].added).toBe('Brightstone Ritual');
    });

    it('requires a strictly cheaper card once the deck is already over the ask', () => {
      const state = makeState();
      const pricey = scryfallCard('Pricey Removal', { prices: { usd: '5.00' } });
      ROLE_OF.set(pricey.name, 'removal');
      state.usedNames.add(pricey.name);
      state.categories.synergy.push(pricey);
      const extra = Array.from({ length: 4 }, (_, i) =>
        scryfallCard(`Removal_${i + 1}`, { prices: { usd: '1.00' } })
      );
      for (const c of extra) {
        ROLE_OF.set(c.name, 'removal');
        state.usedNames.add(c.name);
      }
      state.categories.synergy.push(...extra);
      // Deck total = 5 + 4 = 9, already over the $5 ask.
      state.edhrecData = {
        cardlists: {
          allNonLand: [edhrecCard('Same Price Payoff', 90), edhrecCard('Cheaper Payoff', 85)],
        },
      } as unknown as GenerationState['edhrecData'];
      const ctx = makeCtx(state, {
        roleTargets: { ramp: 0, removal: 2, boardwipe: 0, cardDraw: 0 },
        deckBudget: 5,
        scryfallCardMap: new Map([
          ['Same Price Payoff', scryfallCard('Same Price Payoff', { prices: { usd: '5.00' } })],
          ['Cheaper Payoff', scryfallCard('Cheaper Payoff', { prices: { usd: '4.00' } })],
        ]),
      });
      const result = applyRoleSurplusRebalance(state, ctx);

      expect(result.conversions).toHaveLength(1);
      // Same-price-as-cut (delta 0) is rejected while already over ask;
      // strictly cheaper (delta -1) is accepted.
      expect(result.conversions[0].added).toBe('Cheaper Payoff');
    });
  });

  // ── Defect 4 regression (live-eval gate) ───────────────────────────────────
  // A same-role replacement is a net-zero swap for that role's count (see the
  // 'net-zero swap' test above) — this reproduces the FULL under-firing bug:
  // when the global-worst surplus card's only real candidate is cross-role
  // and blocked, the pass must move on to the next-worst surplus card
  // instead of giving up entirely (this silently zeroed out Talrand/
  // meren-budget100/the-ur-dragon/atraxa-bracket2 and cut Isshin off after 1
  // of ~4 expected conversions).
  it('does not stall the whole pass when the global-worst card has no legal replacement', () => {
    const state = makeState();
    // Global worst (lowest survival, tried first): a removal card with no
    // pool entry at all (priority 0).
    const removalWorst = scryfallCard('Removal Worst');
    ROLE_OF.set(removalWorst.name, 'removal');
    state.usedNames.add(removalWorst.name);
    state.categories.synergy.push(removalWorst);
    const removalPad = Array.from({ length: 4 }, (_, i) => scryfallCard(`Removal_${i + 1}`));
    for (const c of removalPad) {
      ROLE_OF.set(c.name, 'removal');
      state.usedNames.add(c.name);
      c.prices = { usd: '1.00' };
    }
    state.categories.synergy.push(...removalPad); // removal: 5 total, target 2 -> cap 4, 1 over

    // Ramp is ALSO over cap, and its incumbents have a slightly better
    // (but still weak) survival score than Removal Worst, so they're tried
    // SECOND, not first.
    const rampCards = addRampCards(state, 8); // target 5 -> cap 7, 1 over

    state.edhrecData = {
      cardlists: {
        allNonLand: [
          // Clears the margin for both the removal and ramp incumbents on
          // raw priority, but its role is 'ramp' — which is ALSO over cap,
          // so it can only ever legally replace a RAMP incumbent (net-zero),
          // never the removal one (a real role-count increase).
          edhrecCard('Ramp Payoff', 30),
          ...rampCards.map((c, i) => edhrecCard(c.name, 5 + i)), // slightly > 0, so tried 2nd
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    ROLE_OF.set('Ramp Payoff', 'ramp');

    const roleTargets = { ramp: 5, removal: 2, boardwipe: 0, cardDraw: 0 };
    const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

    // Removal Worst (tried first) has no legal replacement — Ramp Payoff is
    // cross-role and removal is already at cap. The pass must move on and
    // still convert the ramp surplus instead of giving up entirely.
    expect(result.conversions.length).toBeGreaterThan(0);
    expect(result.conversions.every((c) => c.cut !== 'Removal Worst')).toBe(true);
    expect(state.usedNames.has('Removal Worst')).toBe(true); // untouched — never found a legal swap
  });

  // ── Defect 5 regressions (round-2 live-eval gate) ──────────────────────────
  describe('price sanity on incoming candidates', () => {
    it('rejects a wildly-pricier candidate and disclose the price of the one it accepts instead', () => {
      const state = makeState();
      const cheapEviction = scryfallCard('Ornithopter of Paradise', { prices: { usd: '0.77' } });
      ROLE_OF.set(cheapEviction.name, 'ramp');
      state.usedNames.add(cheapEviction.name);
      state.categories.synergy.push(cheapEviction);
      // Fillers with a decent score so Ornithopter (inclusion 0) stays the
      // clear worst and is tried first.
      const fillers = Array.from({ length: 7 }, (_, i) => scryfallCard(`Filler_${i + 1}`));
      for (const c of fillers) {
        ROLE_OF.set(c.name, 'ramp');
        state.usedNames.add(c.name);
      }
      state.categories.synergy.push(...fillers);

      state.edhrecData = {
        cardlists: {
          allNonLand: [
            edhrecCard('Ornithopter of Paradise', 0),
            ...fillers.map((c) => edhrecCard(c.name, 20)),
            edhrecCard('Mishras Workshop', 90), // clears margin on priority, but 20x+ pricier
            edhrecCard('Near Equivalent', 50), // clears margin, modestly pricier
          ],
        },
      } as unknown as GenerationState['edhrecData'];
      const ctx = makeCtx(state, {
        roleTargets: { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 },
        scryfallCardMap: new Map([
          ['Mishras Workshop', scryfallCard('Mishras Workshop', { prices: { usd: '3000.97' } })],
          ['Near Equivalent', scryfallCard('Near Equivalent', { prices: { usd: '5.00' } })],
        ]),
      });
      const result = applyRoleSurplusRebalance(state, ctx);

      expect(result.conversions).toHaveLength(1);
      expect(result.conversions[0].cut).toBe('Ornithopter of Paradise');
      expect(result.conversions[0].added).toBe('Near Equivalent');
      expect(state.usedNames.has('Mishras Workshop')).toBe(false);
      // A large price delta must appear in the disclosure text.
      expect(result.conversions[0].reason).toMatch(/\+\$4\.23/);
    });

    it('exempts a combo piece from the price-sanity ceiling', () => {
      const state = makeState();
      const cheap = scryfallCard('Cheap Ramp', { prices: { usd: '1.00' } });
      ROLE_OF.set(cheap.name, 'ramp');
      state.usedNames.add(cheap.name);
      state.categories.synergy.push(cheap);
      const fillers = Array.from({ length: 7 }, (_, i) => scryfallCard(`Filler_${i + 1}`));
      for (const c of fillers) {
        ROLE_OF.set(c.name, 'ramp');
        state.usedNames.add(c.name);
      }
      state.categories.synergy.push(...fillers);

      state.edhrecData = {
        cardlists: {
          allNonLand: [
            edhrecCard('Cheap Ramp', 5),
            ...fillers.map((c) => edhrecCard(c.name, 20)),
            edhrecCard('Combo Piece', 90),
          ],
        },
      } as unknown as GenerationState['edhrecData'];
      const ctx = makeCtx(state, {
        roleTargets: { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 },
        scryfallCardMap: new Map([
          ['Combo Piece', scryfallCard('Combo Piece', { prices: { usd: '3000.00' } })],
        ]),
      });
      state.comboCardNames.add('Combo Piece'); // live combo-assembly signal
      const result = applyRoleSurplusRebalance(state, ctx);

      expect(result.conversions).toHaveLength(1);
      expect(result.conversions[0].added).toBe('Combo Piece');
    });
  });

  // ── Defect 6 regressions (round-2 live-eval gate) ──────────────────────────
  describe('role-exit priority over same-role churn', () => {
    it('picks a true role-exit conversion over a higher-priority same-role candidate', () => {
      const state = makeState();
      const removalWorst = scryfallCard('Removal Worst');
      ROLE_OF.set(removalWorst.name, 'removal');
      state.usedNames.add(removalWorst.name);
      state.categories.synergy.push(removalWorst);
      const pad = Array.from({ length: 4 }, (_, i) => scryfallCard(`Removal_${i + 1}`));
      for (const c of pad) {
        ROLE_OF.set(c.name, 'removal');
        state.usedNames.add(c.name);
      }
      state.categories.synergy.push(...pad); // removal: 5 total, target 2 -> cap 4, 1 over

      state.edhrecData = {
        cardlists: {
          allNonLand: [
            // Incumbents get their own LOW pool entries — otherwise, with no
            // entry at all, they'd fall back to the role average (defect 7
            // fix), which with only 'Removal Payoff' in the pool as a
            // 'removal'-tagged entry would equal ITS score and never clear
            // the improvement margin against it.
            edhrecCard('Removal Worst', 5),
            ...pad.map((c) => edhrecCard(c.name, 5)),
            edhrecCard('Removal Payoff', 90), // higher priority, but SAME role — must lose to the role-exit
            edhrecCard('Payoff', 50), // lower priority, but role-null -> a genuine role-exit
          ],
        },
      } as unknown as GenerationState['edhrecData'];
      ROLE_OF.set('Removal Payoff', 'removal');
      const roleTargets = { ramp: 0, removal: 2, boardwipe: 0, cardDraw: 0 };
      const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

      expect(result.conversions).toHaveLength(1);
      expect(result.conversions[0].added).toBe('Payoff');
      expect(result.conversions[0].reason).toMatch(/over cap/);
      expect(result.conversions[0].reason).not.toMatch(/doesn't reduce the count/);
    });

    it('labels a same-role swap as an upgrade, never as fixing the overage', () => {
      const state = makeState();
      const cards = addRampCards(state, 8); // no cross-role candidate exists at all
      state.edhrecData = {
        cardlists: {
          allNonLand: [...cards.map((c) => edhrecCard(c.name, 5)), edhrecCard('Ramp Payoff', 90)],
        },
      } as unknown as GenerationState['edhrecData'];
      ROLE_OF.set('Ramp Payoff', 'ramp');
      const roleTargets = { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 };
      const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

      expect(result.conversions).toHaveLength(1);
      expect(result.conversions[0].added).toBe('Ramp Payoff');
      expect(result.conversions[0].reason).toMatch(/Upgraded to Ramp Payoff/);
      expect(result.conversions[0].reason).toMatch(/doesn't reduce the count/);
    });

    it('caps same-role upgrades at MAX_SAME_ROLE_UPGRADES even with plenty of surplus left', () => {
      const state = makeState();
      const cards = addRampCards(state, 20); // target 3 -> cap 5; 15 over, no cross-role candidate exists
      state.edhrecData = {
        cardlists: {
          allNonLand: [
            ...cards.map((c) => edhrecCard(c.name, 5)),
            ...Array.from({ length: 10 }, (_, i) => edhrecCard(`Ramp Payoff_${i + 1}`, 90 - i)),
          ],
        },
      } as unknown as GenerationState['edhrecData'];
      for (let i = 1; i <= 10; i++) ROLE_OF.set(`Ramp Payoff_${i}`, 'ramp');
      const roleTargets = { ramp: 3, removal: 0, boardwipe: 0, cardDraw: 0 };
      const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

      // Every candidate is same-role — the pass must NOT spend its whole
      // 6-swap budget on churn that never reduces the ramp overage.
      expect(result.conversions.length).toBeLessThanOrEqual(2);
      expect(result.conversions.length).toBeGreaterThan(0);
    });
  });

  // ── Defect 7 regression (round-2 live-eval gate) ───────────────────────────
  describe('eviction ordering with pool-absent incumbents', () => {
    it('never evicts a pool-absent premium card ahead of a genuinely weak, pool-listed one (atraxa-bracket2 repro)', () => {
      const state = makeState();
      // "Path to Exile": absent from THIS generation's (bracket-restricted)
      // pool entirely — before the fix this defaulted to survival 0,
      // guaranteeing it looked like the worst card in its role.
      const premium = scryfallCard('Path to Exile');
      ROLE_OF.set(premium.name, 'removal');
      state.usedNames.add(premium.name);
      state.categories.synergy.push(premium);

      const weak = scryfallCard('Whisper of the Dross');
      ROLE_OF.set(weak.name, 'removal');
      state.usedNames.add(weak.name);
      state.categories.synergy.push(weak);

      // Establishes a role average (35) comfortably above the weak card's
      // real inclusion (5) but with no bearing on the premium card at all
      // (which has no entry and falls back to this average).
      const decent = [
        scryfallCard('Decent Removal 1'),
        scryfallCard('Decent Removal 2'),
        scryfallCard('Decent Removal 3'),
      ];
      for (const c of decent) {
        ROLE_OF.set(c.name, 'removal');
        state.usedNames.add(c.name);
      }
      state.categories.synergy.push(...decent);

      state.edhrecData = {
        cardlists: {
          allNonLand: [
            edhrecCard('Whisper of the Dross', 5),
            edhrecCard('Decent Removal 1', 40),
            edhrecCard('Decent Removal 2', 45),
            edhrecCard('Decent Removal 3', 50),
            edhrecCard('Payoff', 25), // clears the margin over Whisper (5) only
          ],
        },
      } as unknown as GenerationState['edhrecData'];
      const roleTargets = { ramp: 0, removal: 2, boardwipe: 0, cardDraw: 0 };
      const result = applyRoleSurplusRebalance(state, makeCtx(state, { roleTargets }));

      expect(result.conversions).toHaveLength(1);
      expect(result.conversions[0].cut).toBe('Whisper of the Dross');
      expect(state.usedNames.has('Path to Exile')).toBe(true);
    });
  });
});
