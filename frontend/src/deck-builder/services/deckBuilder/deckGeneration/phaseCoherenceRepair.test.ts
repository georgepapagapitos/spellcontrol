import { describe, it, expect, vi } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';

// Tagger reads bundled JSON keyed by card name — mock for determinism (roles
// come back null, so category placement falls through to `synergy`).
vi.mock('@/deck-builder/services/tagger/client', () => ({
  hasTag: vi.fn(() => false),
  isMassLandDenial: vi.fn(() => false),
  isExtraTurn: vi.fn(() => false),
  getCardRole: vi.fn(() => null),
}));

// stampRoleSubtypes is a no-op in tests.
vi.mock('../categorize', () => ({
  stampRoleSubtypes: () => {},
}));

import { applyCoherenceRepair, MAX_COHERENCE_SWAPS } from './phaseCoherenceRepair';
import type { CoherenceRepairContext } from './phaseCoherenceRepair';
import type { GenerationState } from './state';

// ── helpers ──────────────────────────────────────────────────────────────────

function scryfallCard(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
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
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function edhrecCard(name: string, inclusion: number): EDHRECCard {
  return { name, sanitized: name, primary_type: 'Artifact', inclusion, num_decks: 100 };
}

const lifegainPayoff = (name: string) =>
  scryfallCard(name, {
    type_line: 'Creature — Cat Soldier',
    oracle_text: `Whenever you gain life, put a +1/+1 counter on ${name}.`,
  });
const lifegainProducer = (name: string) =>
  scryfallCard(name, {
    type_line: 'Enchantment',
    oracle_text: 'At the beginning of your upkeep, you gain 1 life.',
  });

// Deck spells that are justified by pool inclusion (audit stays quiet on them).
const DECK_SPELLS = ['Spell A', 'Spell B', 'Spell C', 'Spell D'];

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
    usedNames: new Set<string>(DECK_SPELLS),
    bannedCards: new Set<string>(),
    categories: {
      lands: [scryfallCard('Island', { type_line: 'Basic Land — Island', cmc: 0 })],
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: [],
      synergy: DECK_SPELLS.map((n) => scryfallCard(n)),
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
      cardlists: {
        allNonLand: [
          ...DECK_SPELLS.map((n) => edhrecCard(n, 30)),
          edhrecCard('Safe Filler A', 80),
          edhrecCard('Safe Filler B', 70),
        ],
      },
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

function defaultScryfallMap(state: GenerationState): Map<string, ScryfallCard> {
  const m = new Map<string, ScryfallCard>();
  for (const c of state.edhrecData?.cardlists.allNonLand ?? []) m.set(c.name, scryfallCard(c.name));
  return m;
}

function makeCtx(
  state: GenerationState,
  overrides: Partial<CoherenceRepairContext> = {}
): CoherenceRepairContext {
  return {
    scryfallCardMap: defaultScryfallMap(state),
    detectedCombos: undefined,
    mustIncludeNames: new Set<string>(),
    liftedByOf: () => undefined,
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
    getBasicLand: async (name) => scryfallCard(name, { type_line: `Basic Land — ${name}`, cmc: 0 }),
    ...overrides,
  };
}

function addToDeck(state: GenerationState, card: ScryfallCard) {
  state.categories.synergy.push(card);
  state.usedNames.add(card.name);
}

function deckNames(state: GenerationState): string[] {
  return Object.values(state.categories)
    .flat()
    .map((c) => c.name);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('applyCoherenceRepair', () => {
  it('leaves a deck with no findings untouched — asserted on the categories object', async () => {
    const state = makeState();
    const before = JSON.stringify(state.categories);
    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));
    expect(repairs).toHaveLength(0);
    expect(JSON.stringify(state.categories)).toBe(before);
  });

  it('no-ops without an EDHREC pool (offline / Scryfall-only modes)', async () => {
    const state = makeState({ edhrecData: null });
    addToDeck(state, scryfallCard('Junk Card'));
    const before = JSON.stringify(state.categories);
    const { repairs } = await applyCoherenceRepair(
      state,
      makeCtx(state, { scryfallCardMap: new Map() })
    );
    expect(repairs).toHaveLength(0);
    expect(JSON.stringify(state.categories)).toBe(before);
  });

  it('cuts an unjustified card and adds the best gated pool candidate', async () => {
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card')); // not in pool → no justification
    const sizeBefore = deckNames(state).length;

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));

    expect(repairs).toHaveLength(1);
    expect(repairs[0].cut).toBe('Junk Card');
    expect(repairs[0].added).toBe('Safe Filler A');
    expect(deckNames(state)).not.toContain('Junk Card');
    expect(deckNames(state)).toContain('Safe Filler A');
    expect(deckNames(state)).toHaveLength(sizeBefore); // 1-for-1
    expect(state.usedNames.has('Safe Filler A')).toBe(true);
    expect(state.usedNames.has('Junk Card')).toBe(false);
  });

  it(`caps repairs at MAX_COHERENCE_SWAPS (${MAX_COHERENCE_SWAPS})`, async () => {
    const state = makeState();
    for (let i = 0; i < 5; i++) addToDeck(state, scryfallCard(`Junk ${i}`));
    // Enough pool candidates for 5 swaps if the cap didn't hold.
    state.edhrecData!.cardlists.allNonLand.push(
      edhrecCard('Filler C', 60),
      edhrecCard('Filler D', 50),
      edhrecCard('Filler E', 40)
    );

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));

    expect(repairs).toHaveLength(MAX_COHERENCE_SWAPS);
    const junkLeft = deckNames(state).filter((n) => n.startsWith('Junk')).length;
    expect(junkLeft).toBe(5 - MAX_COHERENCE_SWAPS);
  });

  it.each([
    ['a combo piece', (s: GenerationState) => s.comboCardNames.add('Junk Card')],
    ['a game changer', (s: GenerationState) => s.gameChangerNames.add('Junk Card')],
  ])('never cuts %s', async (_label, protect) => {
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card'));
    protect(state);
    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));
    expect(repairs).toHaveLength(0);
    expect(deckNames(state)).toContain('Junk Card');
  });

  it('treats lift connectivity (≥2 seeds) as protection end-to-end', async () => {
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card'));
    const { repairs } = await applyCoherenceRepair(
      state,
      makeCtx(state, {
        liftedByOf: (n) => (n === 'junk card' ? ['Seed A', 'Seed B'] : undefined),
      })
    );
    expect(repairs).toHaveLength(0);
    expect(deckNames(state)).toContain('Junk Card');
  });

  it('never touches a must-include card', async () => {
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card', { isMustInclude: true }));
    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));
    expect(repairs).toHaveLength(0);
    expect(deckNames(state)).toContain('Junk Card');
  });

  it('feeds an under-fed invested engine instead of cutting its payoffs', async () => {
    const state = makeState();
    // 4 payoffs + 1 producer: lifegain is invested (total ≥ 5, both halves)
    // but under-fed (support below the dependency threshold).
    for (let i = 0; i < 4; i++) addToDeck(state, lifegainPayoff(`Payoff ${i}`));
    addToDeck(state, lifegainProducer('Lone Producer'));
    addToDeck(state, scryfallCard('Weak Vanilla'));
    state.edhrecData!.cardlists.allNonLand.push(
      ...['Payoff 0', 'Payoff 1', 'Payoff 2', 'Payoff 3', 'Lone Producer'].map((n) =>
        edhrecCard(n, 20)
      ),
      edhrecCard('Weak Vanilla', 2),
      edhrecCard('Soul Warden', 45)
    );
    const map = defaultScryfallMap(state);
    map.set('Soul Warden', lifegainProducer('Soul Warden'));
    for (let i = 0; i < 4; i++) map.set(`Payoff ${i}`, lifegainPayoff(`Payoff ${i}`));
    map.set('Lone Producer', lifegainProducer('Lone Producer'));

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state, { scryfallCardMap: map }));

    expect(repairs.length).toBeGreaterThanOrEqual(1);
    expect(repairs[0].added).toBe('Soul Warden');
    expect(repairs[0].reason).toContain('Fed the engine');
    // The weakest unprotected card made room; every payoff survived.
    expect(deckNames(state)).not.toContain('Weak Vanilla');
    for (let i = 0; i < 4; i++) expect(deckNames(state)).toContain(`Payoff ${i}`);
  });

  it('keeps owned-only replacements owned', async () => {
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card'));
    state.context.collectionNames = new Set([...DECK_SPELLS, 'Junk Card', 'Owned Filler']);
    state.edhrecData!.cardlists.allNonLand.push(edhrecCard('Owned Filler', 10));
    // 'Safe Filler A/B' rank higher but are unowned — must be skipped.
    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));
    expect(repairs).toHaveLength(1);
    expect(repairs[0].added).toBe('Owned Filler');
  });

  it('swaps a dead typed fetch for a basic of a demanded color', async () => {
    const state = makeState();
    state.context.colorIdentity = ['W', 'U'];
    // Demand white so the manabase summary has a W line to repair toward.
    state.categories.synergy.push(
      scryfallCard('White Spell', { mana_cost: '{W}{W}', color_identity: ['W'] })
    );
    state.usedNames.add('White Spell');
    state.edhrecData!.cardlists.allNonLand.push(edhrecCard('White Spell', 25));
    state.categories.lands = [
      scryfallCard('Flooded Strand', {
        type_line: 'Land',
        oracle_text:
          '{T}, Pay 1 life, Sacrifice Flooded Strand: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.',
      }),
    ];

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));

    expect(repairs).toHaveLength(1);
    expect(repairs[0].cut).toBe('Flooded Strand');
    expect(['Plains', 'Island']).toContain(repairs[0].added);
    expect(state.categories.lands).toHaveLength(1);
    expect(state.categories.lands[0].name).toBe(repairs[0].added);
    expect(state.usedNames.has('Flooded Strand')).toBe(false);
  });

  it('reports typal land findings without repairing them', async () => {
    const state = makeState();
    state.categories.lands.push(
      scryfallCard('Path of Ancestry', {
        type_line: 'Land',
        oracle_text:
          "{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.",
        produced_mana: ['W', 'U', 'B', 'R', 'G'],
      })
    );
    const before = JSON.stringify(state.categories);
    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));
    expect(repairs).toHaveLength(0);
    expect(JSON.stringify(state.categories)).toBe(before);
  });

  // ── Win-condition floor (E77) ──
  // makeState's deck (vanilla artifacts, no combos, <15 creatures) has no win
  // path by construction, so the wincon floor is live in every test above —
  // its pools just never offer a finisher. These give it one.

  const finisher = () =>
    scryfallCard('Grand Finale', {
      type_line: 'Enchantment',
      oracle_text:
        'At the beginning of your upkeep, if you control ten permanents, you win the game.',
    });

  it('adds a finisher when the deck cannot win, cutting the weakest card', async () => {
    const state = makeState();
    state.edhrecData!.cardlists.allNonLand.push(edhrecCard('Grand Finale', 15));
    const map = defaultScryfallMap(state);
    map.set('Grand Finale', finisher());
    const sizeBefore = deckNames(state).length;

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state, { scryfallCardMap: map }));

    expect(repairs).toHaveLength(1);
    expect(repairs[0].added).toBe('Grand Finale');
    expect(repairs[0].reason).toContain('No clear way to win');
    expect(deckNames(state)).toContain('Grand Finale');
    expect(deckNames(state)).toHaveLength(sizeBefore); // 1-for-1
  });

  it('wincon fix takes first claim on the shared swap budget', async () => {
    const state = makeState();
    for (let i = 0; i < 4; i++) addToDeck(state, scryfallCard(`Junk ${i}`));
    state.edhrecData!.cardlists.allNonLand.push(
      edhrecCard('Grand Finale', 15),
      edhrecCard('Filler C', 60),
      edhrecCard('Filler D', 50)
    );
    const map = defaultScryfallMap(state);
    map.set('Grand Finale', finisher());

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state, { scryfallCardMap: map }));

    expect(repairs).toHaveLength(MAX_COHERENCE_SWAPS);
    expect(repairs[0].added).toBe('Grand Finale'); // wincon first
    // remaining budget went to unjustified-slot swaps
    expect(repairs.slice(1).every((r) => r.cut.startsWith('Junk'))).toBe(true);
  });

  it('leaves the deck alone when no gated finisher exists (report-only)', async () => {
    const state = makeState(); // pool has no alt-win card
    const before = JSON.stringify(state.categories);
    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));
    expect(repairs).toHaveLength(0);
    expect(JSON.stringify(state.categories)).toBe(before);
  });
});
