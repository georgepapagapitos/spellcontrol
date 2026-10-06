import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('keeps the rock hold when the spells empty the budget, so a $10 four-colour build still seats Sol Ring (E566)', async () => {
    const { getCardByName } = await import('@/deck-builder/services/scryfall/client');
    const original = vi.mocked(getCardByName).getMockImplementation()!;
    // Real prices: Sol Ring $1.60, Arcane Signet $1.20.
    vi.mocked(getCardByName).mockImplementation(async (name: string) =>
      name === 'Sol Ring' ? card('Sol Ring', '1.60') : card('Arcane Signet', '1.20')
    );
    const state = makeState();
    state.context.colorIdentity = ['W', 'U', 'B', 'G'];
    const tracker = new BudgetTracker(10, 99, 'USD');
    tracker.reserveForRocks(2.8);
    tracker.remainingBudget = -0.5; // an uncapped spend ran the spells through the budget
    tracker.getEffectiveCap(null); // the next spell pick: it used to hand the rock money back
    expect(tracker.rockReserve).toBe(2.8);
    await stapleManaRocksPhase(state, tracker);
    expect(allCards(state).map((c) => c.name)).toEqual(
      expect.arrayContaining(['Sol Ring', 'Arcane Signet'])
    );
    vi.mocked(getCardByName).mockImplementation(original);
  });

  it('seats the rocks the budget held money for, though the dynamic cap alone would refuse them (E561: no Sol Ring at $10)', async () => {
    const state = makeState();
    const tracker = new BudgetTracker(50, 3, 'USD');
    tracker.remainingBudget = 0.3; // the spells ran through the budget
    tracker.reserveForRocks(45); // what landBudgetReserve held for Sol Ring + Signet
    await stapleManaRocksPhase(state, tracker);
    expect(allCards(state).map((c) => c.name)).toEqual(
      expect.arrayContaining(['Sol Ring', 'Arcane Signet'])
    );
    expect(tracker.rockReserve).toBe(0);
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

  // E-arena-leak: tinyLeaders (maxCmc) had no gate on the staple path.
  it('tinyLeaders: skips a staple that exceeds the CMC cap', async () => {
    const state = makeState();
    state.cfg.maxCmc = 0; // both fixtures resolve at cmc 1
    await stapleManaRocksPhase(state, null);
    expect(allCards(state)).toEqual([]);
  });

  // E-arena-leak: format legality was PDH-only — a brawl build (not_legal in
  // brawl for either staple's mocked legalities) must skip both too.
  it('brawl: skips a staple not legal in the active format', async () => {
    const state = makeState();
    state.cfg.mtgFormat = 'brawl';
    await stapleManaRocksPhase(state, null);
    expect(allCards(state)).toEqual([]);
  });
});

// E566 (8ef8eda3 seated the rocks before the type passes): the rocks took ~$2.70 and
// two slots off the tracker before the first spell pick, which shifted every
// pacing cap and priced Howlsquad Heavy ($3.68 against a $3.55 cap, a piece of
// Krenko's Skirk Prospector combo) out of the Krenko $50 deck. The rocks seat once,
// after the lands, as they always did; the gate, not the order, guarantees Sol Ring.
describe('stapleManaRocksPhase call site', () => {
  it('runs once, after generateLands', () => {
    const src = readFileSync(resolve(__dirname, '../deckGenerator.ts'), 'utf8');
    const calls = [...src.matchAll(/await stapleManaRocksPhase\(/g)].map((m) => m.index!);
    expect(calls).toHaveLength(1);
    const lastLands = src.lastIndexOf('await generateLands(');
    expect(lastLands).toBeGreaterThan(0);
    expect(calls[0]).toBeGreaterThan(lastLands);
  });
});
