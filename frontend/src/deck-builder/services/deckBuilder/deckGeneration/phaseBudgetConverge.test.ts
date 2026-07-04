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
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
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
  // Same math as deckGenerator.ts:~4062-4066's finalTotal recompute (sum
  // getCardPrice over nonlands + lands, commander excluded since it never
  // lives in `categories`) — using the real getCardPrice, not a hand-rolled
  // `.prices.usd` read, so this is a genuine parity check, not a tautology.
  let sum = 0;
  for (const card of Object.values(state.categories).flat()) {
    const p = getCardPrice(card, 'USD');
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

  // ── Round 3 fixes (E79) ──────────────────────────────────────────────────

  // Root-cause repro for the live-eval bug (atraxa-budget75: 0 swaps even
  // though 22 of the deck's 30 priciest cards were entirely unprotected).
  // Atraxa's ramp/removal roles were both already over their cap-with-
  // tolerance (a generator-allowed escape-hatch overshoot) — the role-cap
  // gate was wrongly applied to same-role candidates too, blocking every
  // same-role swap for those roles.
  it('exempts a same-role swap from the role-cap gate even when that role is already over cap', () => {
    vi.mocked(getCardRole).mockImplementation((name: string) =>
      name === 'Pricey Card' || name === 'Cheap Alt A' ? 'removal' : null
    );
    const state = makeState();
    // Removal already over cap (10 >= 7+tolerance(2)=9) BEFORE any cut —
    // mirrors Atraxa's live roleCounts.removal=10 vs roleTargets.removal=7.
    state.currentRoleCounts = { ramp: 0, removal: 10, boardwipe: 0, cardDraw: 0 };
    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 40, roleTargets: { ramp: 0, removal: 7, boardwipe: 0, cardDraw: 0 } })
    );
    // Pricey Card (removal, $30) → Cheap Alt A (removal, $2): same role, so
    // it must NOT be blocked just because removal is already over cap.
    expect(state.usedNames.has('Pricey Card')).toBe(false);
    expect(state.usedNames.has('Cheap Alt A')).toBe(true);
    expect(result.applied).toBeGreaterThanOrEqual(1);
    vi.mocked(getCardRole).mockReturnValue(null);
  });

  it('shortlists candidates within the priority band, then picks the cheapest of that shortlist', () => {
    vi.mocked(getCardRole).mockImplementation((name: string) =>
      ['Pricey Card', 'High Prio', 'Mid Prio', 'Low Prio'].includes(name) ? 'removal' : null
    );
    const state = makeState();
    const map = new Map<string, ScryfallCard>();
    map.set('High Prio', scryfallCard('High Prio', '25')); // priority 90, saves only $5
    map.set('Mid Prio', scryfallCard('Mid Prio', '5')); // priority 75 (>= 90*0.8=72, in band), saves $25
    map.set('Low Prio', scryfallCard('Low Prio', '1')); // priority 50 (< 72, out of band), saves $29
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('High Prio', 90),
          edhrecCard('Mid Prio', 75),
          edhrecCard('Low Prio', 50),
        ],
      },
    } as unknown as GenerationState['edhrecData'];

    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40, scryfallCardMap: map }));

    // Not the highest-priority (barely cheaper) and not the outright
    // cheapest (too far outside the quality band) — the cheapest WITHIN the
    // priority band of the best candidate.
    expect(state.usedNames.has('Mid Prio')).toBe(true);
    expect(state.usedNames.has('High Prio')).toBe(false);
    expect(state.usedNames.has('Low Prio')).toBe(false);
    expect(result.applied).toBeGreaterThanOrEqual(1);
    vi.mocked(getCardRole).mockReturnValue(null);
  });

  it('declines a swap when the best candidate does not clear the minimum-savings threshold', () => {
    const state = makeState();
    const map = new Map<string, ScryfallCard>();
    // Saves $0.10 on a $30 cut — below MIN_SAVINGS (max($0.50, 1% of $40) = $0.50).
    map.set('Barely Cheaper', scryfallCard('Barely Cheaper', '29.90'));
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Barely Cheaper', 80)] },
    } as unknown as GenerationState['edhrecData'];

    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40, scryfallCardMap: map }));

    expect(state.usedNames.has('Pricey Card')).toBe(true);
    expect(state.usedNames.has('Barely Cheaper')).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.residualReason).toBeDefined();
  });

  // Explicit E79 round-3 ask: a role-bearing card must never be replaced by a
  // different-role/null-role candidate while ANY same-role gate-passing
  // cheaper candidate exists — even one with much bigger raw savings/priority
  // (the coordinator's Fyndhorn Elves→Reclamation Sage / Chain Reaction→
  // Goblin War Party role-degrading trades were exactly this crossing).
  it('never replaces a role-bearing card with a different-role candidate when a same-role cheaper candidate exists', () => {
    vi.mocked(getCardRole).mockImplementation((name: string) => {
      if (name === 'Pricey Card') return 'ramp';
      if (name === 'Same Role Cheap') return 'ramp';
      if (name === 'Cross Role Cheaper') return 'removal';
      return null;
    });
    const state = makeState();
    const map = new Map<string, ScryfallCard>();
    map.set('Same Role Cheap', scryfallCard('Same Role Cheap', '10')); // ramp, saves $20
    // Deliberately a "better" pick by raw priority AND price — must still lose to the same-role option.
    map.set('Cross Role Cheaper', scryfallCard('Cross Role Cheaper', '1')); // removal, saves $29
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('Same Role Cheap', 50), edhrecCard('Cross Role Cheaper', 99)],
      },
    } as unknown as GenerationState['edhrecData'];

    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40, scryfallCardMap: map }));

    expect(state.usedNames.has('Same Role Cheap')).toBe(true);
    expect(state.usedNames.has('Cross Role Cheaper')).toBe(false);
    expect(result.applied).toBeGreaterThanOrEqual(1);
    vi.mocked(getCardRole).mockReturnValue(null);
  });

  // Root-cause repro for the live-eval bug (krenko-budget50: 0 swaps on a $71
  // mono-red deck with a $50 budget, next to a false "no cheaper alternatives"
  // note). Once a deck is over budget, BudgetTracker.remainingBudget is
  // negative — getEffectiveCap floors its dynamic cap at Math.max(0, ...),
  // i.e. exactly $0, so gating on it flunks every candidate unconditionally.
  // This phase must NOT read the tracker for gating.
  it('converges even when the BudgetTracker is exhausted/negative (krenko-shaped repro)', () => {
    const state = makeState();
    const tracker = new BudgetTracker(-50, 5, 'USD'); // already deep in the red
    expect(tracker.getEffectiveCap(null)).toBe(0); // confirms the trap is live

    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 40, budgetTracker: tracker })
    );

    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(result.finalTotal).toBeLessThanOrEqual(40);
    expect(state.usedNames.has('Pricey Card')).toBe(false);
  });

  it('does not gate a replacement on the static maxCardPrice either — only strictly-cheaper matters', () => {
    // maxCardPrice is no longer part of BudgetConvergeContext at all (the
    // whole per-card cap concept is out of scope for a convergence swap —
    // see the phase's header comment); this just pins that a pricier-than-cap
    // but still cheaper-than-cut candidate is not rejected on some other path.
    const state = makeState();
    const map = poolScryfallMap();
    map.set('Cheap Alt A', scryfallCard('Cheap Alt A', '25')); // still < $30 cut price
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40, scryfallCardMap: map }));
    expect(result.applied).toBeGreaterThanOrEqual(1);
  });

  it('credits the tracker back for the cut card, not just deducting the replacement', () => {
    const state = makeState();
    const tracker = new BudgetTracker(1000, 5, 'USD');
    const cardsBefore = tracker.cardsRemaining;

    applyBudgetConvergence(state, baseCtx({ deckBudget: 40, budgetTracker: tracker }));

    // Pricey Card ($30) cut, Cheap Alt A ($2) added: -2 (deduct on add) + 30
    // (credit on cut) = net +28 — the tracker must not just drift ever-more
    // negative across swaps.
    expect(tracker.remainingBudget).toBeCloseTo(1028, 2);
    // A swap is a lateral 1-for-1 — cardsRemaining nets to zero change.
    expect(tracker.cardsRemaining).toBe(cardsBefore);
  });

  it('reports a finalTotal matching an independent recomputation over the final deck (parity with deckGenerator.ts)', () => {
    const state = makeState();
    const result = applyBudgetConvergence(state, baseCtx({ deckBudget: 40 }));
    expect(result.finalTotal).toBe(totalOf(state));
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
      'every remaining card is a must-include, combo piece, or otherwise protected, with no cheaper equivalent'
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
      'no cheaper legal alternative could be found for the remaining cards'
    );
  });

  it('does not word the residual reason as if partial progress happened, even at 0 swaps', () => {
    // The exact bug from the live eval: "the rest is..." implies something
    // already converged. With 0 swaps the wording must not say "the rest".
    const state = makeState();
    const result = applyBudgetConvergence(
      state,
      baseCtx({ deckBudget: 1, cardAllowed: () => false })
    );
    expect(result.applied).toBe(0);
    expect(result.residualReason).not.toMatch(/\bthe rest\b/i);
  });
});
