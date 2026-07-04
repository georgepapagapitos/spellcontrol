import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard, EDHRECCombo } from '@/deck-builder/types';

// Stub tagger — tests don't need real role lookups
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: () => null,
  isExtraTurn: () => false,
}));

// Stub categorize — stampRoleSubtypes is a no-op in tests
vi.mock('../categorize', () => ({
  stampRoleSubtypes: () => {},
}));

import { applyComboFloor, bracketAllowsCombos } from './phaseApplyComboFloor';
import { BudgetTracker } from '../budgetTracker';
import type { GenerationState } from './state';

// ── helpers ──────────────────────────────────────────────────────────────────

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

function edhrec2CardCombo(id: string, cardNames: [string, string], deckCount = 500): EDHRECCombo {
  return {
    comboId: id,
    cards: [
      { name: cardNames[0], id: cardNames[0] },
      { name: cardNames[1], id: cardNames[1] },
    ],
    results: ['Win the game'],
    deckCount,
    rank: 1,
    bracket: 3,
    bracketTag: 'S',
    prereqCount: 0,
    cardCount: 2,
    href: null,
  };
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = scryfallCard('Ur-Dragon');
  return {
    context: {
      commander,
      partnerCommander: null,
      colorIdentity: ['W', 'U', 'B', 'R', 'G'],
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
      collectionStrategy: 'partial',
      collectionOwnedPercent: 75,
      comboCountSetting: 0,
      selectedThemesWithSlugs: [],
    },
    usedNames: new Set<string>(['Ur-Dragon']),
    bannedCards: new Set<string>(),
    categories: {
      lands: [],
      ramp: [scryfallCard('Sol Ring'), scryfallCard('Arcane Signet')],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: [scryfallCard('Filler Creature A'), scryfallCard('Filler Creature B')],
      synergy: [],
      utility: [],
    },
    currentCurveCounts: {},
    currentRoleCounts: { ramp: 2, removal: 0, boardwipe: 0, cardDraw: 0 },
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
    gameChangerNames: new Set(),
    combos: [],
    edhrecData: null,
    dataSource: 'scryfall',
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

// ── bracketAllowsCombos ───────────────────────────────────────────────────────

describe('bracketAllowsCombos', () => {
  it('allows combos when no bracket is set', () => {
    expect(bracketAllowsCombos(undefined)).toBe(true);
    expect(bracketAllowsCombos('all')).toBe(true);
  });

  it('blocks combos at brackets 1 and 2', () => {
    expect(bracketAllowsCombos(1)).toBe(false);
    expect(bracketAllowsCombos(2)).toBe(false);
  });

  it('allows combos at bracket 3 and above', () => {
    expect(bracketAllowsCombos(3)).toBe(true);
    expect(bracketAllowsCombos(4)).toBe(true);
    expect(bracketAllowsCombos(5)).toBe(true);
  });
});

// ── applyComboFloor ───────────────────────────────────────────────────────────

describe('applyComboFloor', () => {
  it('does nothing when comboCountSetting > 0 (user requested combos — audit handles it)', () => {
    const state = makeState({
      combos: [edhrec2CardCombo('c1', ['Gravecrawler', 'Phyrexian Altar'])],
    });
    state.cfg.comboCountSetting = 1;
    const missingCard = scryfallCard('Gravecrawler');
    // Phyrexian Altar is already "in deck" via usedNames
    state.usedNames.add('Phyrexian Altar');
    state.categories.creatures.push(scryfallCard('Phyrexian Altar'));

    const result = applyComboFloor(state, {
      detectedCombos: undefined,
      scryfallCardMap: new Map([['Gravecrawler', missingCard]]),
      mustIncludeNames: new Set(),
      targetBracket: undefined,
    });

    expect(result.seeded).toBe(false);
  });

  it('does nothing when target bracket is 1 or 2', () => {
    const state = makeState({
      combos: [edhrec2CardCombo('c1', ['Gravecrawler', 'Phyrexian Altar'])],
    });
    state.usedNames.add('Phyrexian Altar');
    state.categories.creatures.push(scryfallCard('Phyrexian Altar'));

    for (const bracket of [1, 2] as const) {
      const result = applyComboFloor(state, {
        detectedCombos: undefined,
        scryfallCardMap: new Map([['Gravecrawler', scryfallCard('Gravecrawler')]]),
        mustIncludeNames: new Set(),
        targetBracket: bracket,
      });
      expect(result.seeded).toBe(false);
    }
  });

  it('does nothing when the deck already has a complete 2-card combo', () => {
    const state = makeState();
    const alreadyComplete = {
      comboId: 'existing',
      cards: ['Ur-Dragon', 'Sol Ring'],
      results: ['Win'],
      isComplete: true,
      missingCards: [],
      deckCount: 100,
      bracket: 3,
      bracketTag: 'S',
      cardCount: 2,
    };

    const result = applyComboFloor(state, {
      detectedCombos: [alreadyComplete],
      scryfallCardMap: new Map(),
      mustIncludeNames: new Set(),
      targetBracket: undefined,
    });

    expect(result.seeded).toBe(false);
    expect(result.detectedCombos).toEqual([alreadyComplete]);
  });

  it('seeds the missing piece of the best available 2-card combo', () => {
    const missingCard = scryfallCard('Gravecrawler');
    const state = makeState({
      combos: [edhrec2CardCombo('c1', ['Gravecrawler', 'Phyrexian Altar'], 900)],
    });
    // One piece is already in the deck
    state.usedNames.add('Phyrexian Altar');
    state.categories.creatures.push(scryfallCard('Phyrexian Altar'));

    const totalCardsBefore = Object.values(state.categories).flat().length;

    const result = applyComboFloor(state, {
      detectedCombos: undefined,
      scryfallCardMap: new Map([['Gravecrawler', missingCard]]),
      mustIncludeNames: new Set(),
      targetBracket: undefined,
    });

    expect(result.seeded).toBe(true);
    // Missing piece was added
    expect(state.usedNames.has('Gravecrawler')).toBe(true);
    // One filler was evicted — total card count stays the same (1-for-1 swap)
    expect(Object.values(state.categories).flat().length).toBe(totalCardsBefore);
    // The combo's EXISTING partner piece must never be the card we evict —
    // doing so would defeat the very combo we're seeding.
    expect(state.usedNames.has('Phyrexian Altar')).toBe(true);
    expect(state.categories.creatures.some((c) => c.name === 'Phyrexian Altar')).toBe(true);
    // A filler creature was the one evicted, not the combo piece.
    expect(state.categories.creatures.some((c) => c.name === 'Filler Creature B')).toBe(false);
    // Detected combos updated with the seeded entry
    const seeded = result.detectedCombos?.find((dc) => dc.comboId === 'c1');
    expect(seeded?.isComplete).toBe(true);
    expect(seeded?.missingCards).toHaveLength(0);
  });

  it('prefers the combo with the highest deckCount when multiple qualify', () => {
    const popularCombo = edhrec2CardCombo('popular', ['Altar', 'Gravecrawler'], 1000);
    const rareCombo = edhrec2CardCombo('rare', ['Niche Card', 'Gravecrawler'], 50);
    const state = makeState({ combos: [rareCombo, popularCombo] }); // rare listed first
    // Gravecrawler in deck; both combos need their other piece
    state.usedNames.add('Gravecrawler');
    state.categories.creatures.push(scryfallCard('Gravecrawler'));

    const result = applyComboFloor(state, {
      detectedCombos: undefined,
      scryfallCardMap: new Map([
        ['Altar', scryfallCard('Altar')],
        ['Niche Card', scryfallCard('Niche Card')],
      ]),
      mustIncludeNames: new Set(),
      targetBracket: undefined,
    });

    expect(result.seeded).toBe(true);
    // The popular combo's missing piece (Altar) should be added
    expect(state.usedNames.has('Altar')).toBe(true);
    expect(state.usedNames.has('Niche Card')).toBe(false);
  });

  it('does nothing when the missing card is not in scryfallCardMap', () => {
    const state = makeState({
      combos: [edhrec2CardCombo('c1', ['Gravecrawler', 'Phyrexian Altar'])],
    });
    state.usedNames.add('Phyrexian Altar');
    state.categories.creatures.push(scryfallCard('Phyrexian Altar'));

    const result = applyComboFloor(state, {
      detectedCombos: undefined,
      scryfallCardMap: new Map(), // Gravecrawler not in map
      mustIncludeNames: new Set(),
      targetBracket: undefined,
    });

    expect(result.seeded).toBe(false);
  });

  it('skips combos where the missing card is banned', () => {
    const state = makeState({
      combos: [edhrec2CardCombo('c1', ['Gravecrawler', 'Phyrexian Altar'])],
    });
    state.usedNames.add('Phyrexian Altar');
    state.categories.creatures.push(scryfallCard('Phyrexian Altar'));
    state.bannedCards.add('Gravecrawler');

    const result = applyComboFloor(state, {
      detectedCombos: undefined,
      scryfallCardMap: new Map([['Gravecrawler', scryfallCard('Gravecrawler')]]),
      mustIncludeNames: new Set(),
      targetBracket: undefined,
    });

    expect(result.seeded).toBe(false);
  });

  it('does nothing when there are no evictable cards', () => {
    const missingCard = scryfallCard('Gravecrawler');
    const state = makeState({
      combos: [edhrec2CardCombo('c1', ['Gravecrawler', 'Phyrexian Altar'])],
    });
    state.usedNames.add('Phyrexian Altar');
    state.categories.creatures.push(scryfallCard('Phyrexian Altar'));
    // Protect everything
    state.categories.ramp = [];
    state.categories.creatures = state.categories.creatures.map((c) => {
      state.comboCardNames.add(c.name);
      return c;
    });
    const mustIncludeNames = new Set(['filler creature a', 'filler creature b', 'phyrexian altar']);

    const result = applyComboFloor(state, {
      detectedCombos: undefined,
      scryfallCardMap: new Map([['Gravecrawler', missingCard]]),
      mustIncludeNames,
      targetBracket: undefined,
    });

    expect(result.seeded).toBe(false);
  });

  // ── budget gate (Cluster D) ──────────────────────────────────────────────
  it('does not exceed the budget: no-budget run stays unchanged', () => {
    const missingCard = scryfallCard('Gravecrawler', { prices: { usd: '9999.00' } });
    const state = makeState({
      combos: [edhrec2CardCombo('c1', ['Gravecrawler', 'Phyrexian Altar'], 900)],
    });
    state.usedNames.add('Phyrexian Altar');
    state.categories.creatures.push(scryfallCard('Phyrexian Altar'));

    const result = applyComboFloor(state, {
      detectedCombos: undefined,
      scryfallCardMap: new Map([['Gravecrawler', missingCard]]),
      mustIncludeNames: new Set(),
      targetBracket: undefined,
      // no budgetTracker / maxCardPrice passed — same as every test above
    });

    expect(result.seeded).toBe(true);
    expect(result.budgetSkipped).toBe(0);
  });

  it('skips a combo piece that would exceed the budget cap and seeds the cheaper alternative instead', () => {
    const expensivePiece = scryfallCard('Phyrexian Altar', { prices: { usd: '50.00' } });
    const cheapPiece = scryfallCard('Niche Card', { prices: { usd: '1.00' } });
    // Higher deckCount (more popular) but unaffordable — must be skipped in favor
    // of the lower-deckCount but affordable combo.
    const expensiveCombo = edhrec2CardCombo('expensive', ['Gravecrawler', 'Phyrexian Altar'], 900);
    const cheapCombo = edhrec2CardCombo('cheap', ['Gravecrawler', 'Niche Card'], 50);
    const state = makeState({ combos: [expensiveCombo, cheapCombo] });
    state.usedNames.add('Gravecrawler');
    state.categories.creatures.push(scryfallCard('Gravecrawler'));

    // avg = 100/100 = 1, avg*8 = 8, 15% of 100 = 15 -> effective cap = 8
    const budgetTracker = new BudgetTracker(100, 100);

    const result = applyComboFloor(state, {
      detectedCombos: undefined,
      scryfallCardMap: new Map([
        ['Phyrexian Altar', expensivePiece],
        ['Niche Card', cheapPiece],
      ]),
      mustIncludeNames: new Set(),
      targetBracket: undefined,
      budgetTracker,
      maxCardPrice: null,
      currency: 'USD',
      ignoreOwnedBudget: false,
    });

    expect(result.seeded).toBe(true);
    expect(result.budgetSkipped).toBe(1);
    expect(state.usedNames.has('Niche Card')).toBe(true);
    expect(state.usedNames.has('Phyrexian Altar')).toBe(false);
  });

  it('owned cards are exempt from the budget cap even when over price', () => {
    const ownedExpensive = scryfallCard('Phyrexian Altar', { prices: { usd: '50.00' } });
    const state = makeState({
      combos: [edhrec2CardCombo('c1', ['Gravecrawler', 'Phyrexian Altar'], 900)],
      context: {
        commander: scryfallCard('Ur-Dragon'),
        partnerCommander: null,
        colorIdentity: ['W', 'U', 'B', 'R', 'G'],
        customization: {} as GenerationState['context']['customization'],
        collectionNames: new Set(['Phyrexian Altar']),
      },
    });
    state.usedNames.add('Gravecrawler');
    state.categories.creatures.push(scryfallCard('Gravecrawler'));

    const budgetTracker = new BudgetTracker(1, 1); // effective cap far below $50

    const result = applyComboFloor(state, {
      detectedCombos: undefined,
      scryfallCardMap: new Map([['Phyrexian Altar', ownedExpensive]]),
      mustIncludeNames: new Set(),
      targetBracket: undefined,
      budgetTracker,
      maxCardPrice: null,
      currency: 'USD',
      ignoreOwnedBudget: true,
    });

    expect(result.seeded).toBe(true);
    expect(result.budgetSkipped).toBe(0);
    expect(state.usedNames.has('Phyrexian Altar')).toBe(true);
  });
});
