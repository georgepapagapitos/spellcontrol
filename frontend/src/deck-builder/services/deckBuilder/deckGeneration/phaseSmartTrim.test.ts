import { describe, it, expect, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: () => null,
  validateCardRole: () => null,
  isProtectionPiece: () => false,
  isFreeInteraction: () => false,
}));

import { computeTrimResistance, smartTrimPhase } from './phaseSmartTrim';
import type { GenerationState } from './state';

function card(name: string, isMustInclude = false): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 1,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    isMustInclude,
  } as ScryfallCard;
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  return {
    context: {
      commander: card('Test Commander'),
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

describe('smartTrimPhase', () => {
  it('is a no-op when the deck is at or under the target size', () => {
    const state = makeState();
    state.categories.creatures = [card('A'), card('B')];
    smartTrimPhase(state, { targetDeckSize: 2, landTarget: 0, roleTargets: null });
    expect(allCards(state)).toHaveLength(2);
  });

  it('trims the weakest (earliest-position) cards first down to target size', () => {
    const state = makeState();
    // Position-based resistance: later index = lower priority = cut first.
    state.categories.creatures = [card('Best'), card('Middle'), card('Weakest')];
    smartTrimPhase(state, { targetDeckSize: 2, landTarget: 0, roleTargets: null });
    const names = allCards(state).map((c) => c.name);
    expect(names).toEqual(['Best', 'Middle']);
  });

  it('never trims a must-include card even when it is the last-position filler', () => {
    const state = makeState();
    state.categories.creatures = [card('Best'), card('Locked', true)];
    smartTrimPhase(state, { targetDeckSize: 1, landTarget: 0, roleTargets: null });
    const names = allCards(state).map((c) => c.name);
    expect(names).toEqual(['Locked']);
  });

  it('keeps a staple rock the type passes picked, with no isStapleRock flag', () => {
    // E510's panels: once a ranking change let Sol Ring arrive as an ordinary
    // pick, the flag was never set and the trim cut it from Atraxa and Sythis.
    // Every other phase protects STAPLE_ROCK_NAMES by name; so does this one.
    const state = makeState();
    state.categories.ramp = [card('Sol Ring')];
    state.categories.creatures = [card('Best'), card('Middle')];
    smartTrimPhase(state, { targetDeckSize: 2, landTarget: 0, roleTargets: null });
    const names = allCards(state).map((c) => c.name);
    expect(names).toContain('Sol Ring');
    expect(names).toHaveLength(2);
  });

  it('cuts filler before a staple at the tail of its category (E532 gate)', () => {
    // Meren of Clan Nel Toth's page. The type passes seated Skullclamp past
    // the card-draw cap, so it sat last in its category and was cut, silently.
    const state = makeState();
    state.categories.cardDraw = [
      card('Satyr Wayfinder'),
      card('Morbid Opportunist'),
      card('Skullclamp'),
    ];
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          { name: 'Satyr Wayfinder', inclusion: 30.3 },
          { name: 'Morbid Opportunist', inclusion: 27.5 },
          { name: 'Skullclamp', inclusion: 59.6 },
        ],
        lands: [],
      },
    } as unknown as GenerationState['edhrecData'];
    smartTrimPhase(state, { targetDeckSize: 2, landTarget: 0, roleTargets: null });
    expect(allCards(state).map((c) => c.name)).toEqual(['Satyr Wayfinder', 'Skullclamp']);
  });

  it('protects a staple rock by name exactly as much as by the flag', () => {
    const flagged = { ...card('Arcane Signet'), isStapleRock: true } as ScryfallCard;
    const byName = card('Arcane Signet');
    const plain = card('Mind Stone');
    const r = (c: ScryfallCard) =>
      computeTrimResistance(c, 0, 1, 'ramp', new Set(), null, {} as Record<RoleKey, number>);
    expect(r(byName)).toBe(r(flagged));
    expect(r(byName)).toBeGreaterThan(r(plain));
  });

  it('respects the land-trim budget — never cuts a non-must-include land below the target', () => {
    const state = makeState();
    state.categories.lands = [card('Land1'), card('Land2')];
    state.categories.creatures = [card('Spell')];
    // 3 cards, target 2 — land target is 2, so the excess card must come from
    // creatures (position-based resistance ties are irrelevant here; the
    // land-trim budget of 0 means neither land is eligible).
    smartTrimPhase(state, { targetDeckSize: 2, landTarget: 2, roleTargets: null });
    expect(state.categories.lands).toHaveLength(2);
    expect(allCards(state)).toHaveLength(2);
  });
});
