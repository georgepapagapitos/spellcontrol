import { describe, it, expect, vi } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';

// Tagger reads bundled JSON keyed by card name — mock for determinism (roles
// come back null, so category placement falls through to `synergy`).
vi.mock('@/deck-builder/services/tagger/client', () => ({
  hasTag: vi.fn(() => false),
  isMassLandDenial: vi.fn(() => false),
  isExtraTurn: vi.fn(() => false),
  getCardRole: vi.fn(() => null),
  // routeCardByType (real module, imported below) now consults the
  // validated form when bucketing a newly-added card — mirror the
  // getCardRole default so behavior is unchanged for this test file.
  validateCardRole: vi.fn(() => null),
  // E87-new Slice A: isProtected now also checks isProtectionPiece — default
  // false, overridden per-test via mockReturnValueOnce where protection
  // behavior itself is under test.
  isProtectionPiece: vi.fn(() => false),
  // iter-10 Slice A: isProtected now also checks isFreeInteraction — same
  // default-false, per-test override shape.
  isFreeInteraction: vi.fn(() => false),
}));

// stampRoleSubtypes is a no-op in tests; routeCardByType keeps its real
// land-then-role-then-synergy routing (no tagger dependency, safe to import
// for real — getCardRole is mocked to null above, matching prod behavior
// when a candidate has no tagger role).
vi.mock('../categorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../categorize')>();
  return {
    ...actual,
    stampRoleSubtypes: () => {},
  };
});

import { applyCoherenceRepair, MAX_COHERENCE_SWAPS } from './phaseCoherenceRepair';
import type { CoherenceRepairContext } from './phaseCoherenceRepair';
import type { GenerationState } from './state';
import { auditDeckCoherence } from '../coherenceAudit';
import { isProtectionPiece, isFreeInteraction } from '@/deck-builder/services/tagger/client';

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

  // E87: a card this pass cuts is about to be disclosed via coherenceRepairs
  // as "cut: Junk Card" — a later mutating phase (bracket/budget convergence,
  // role-surplus rebalance) re-adding it would leave that disclosure stale
  // against the shipped deck. removeCard() must veto the name so nothing
  // downstream can re-pick it (every downstream add site already gates on
  // state.bannedCards — see phaseRoleSurplusRebalance's own veto test).
  it('bans the cut card name so no downstream phase can re-add it', async () => {
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card'));

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));

    expect(repairs).toHaveLength(1);
    expect(repairs[0].cut).toBe('Junk Card');
    expect(state.bannedCards.has('Junk Card')).toBe(true);
  });

  // E111: findCandidate() is a marginal repair-pick path — it must not seat a
  // qualified ETB/death payoff (Ayara-style) the deck can't feed when an
  // unqualified equivalent is already available, even though the payoff
  // otherwise outranks everything else by EDHREC inclusion.
  it('skips a qualified-mismatched top candidate for the next-best alternative (E111)', async () => {
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card')); // not in pool → unjustified-slot
    addToDeck(
      state,
      scryfallCard('Colorless Producer', { type_line: 'Artifact Creature — Robot', colors: [] })
    );
    // Real oracle text (verified against Scryfall) — an unqualified drain
    // already doing the same job as the mismatched candidate below.
    addToDeck(
      state,
      scryfallCard('Reckless Fireweaver', {
        type_line: 'Creature — Goblin Shaman',
        colors: ['R'],
        oracle_text:
          'Whenever an artifact you control enters, this creature deals 1 damage to each opponent.',
      })
    );

    const ctx = makeCtx(state);
    // Safe Filler A (inclusion 80, ranks first) is a qualified black payoff
    // this all-colorless deck can't feed — real Ayara oracle text.
    ctx.scryfallCardMap.set(
      'Safe Filler A',
      scryfallCard('Safe Filler A', {
        type_line: 'Legendary Creature — Elf Noble',
        colors: ['B'],
        oracle_text:
          'Whenever Safe Filler A or another black creature you control enters, each opponent loses 1 life and you gain 1 life.',
      })
    );

    const { repairs } = await applyCoherenceRepair(state, ctx);

    expect(repairs).toHaveLength(1);
    expect(repairs[0].cut).toBe('Junk Card');
    expect(repairs[0].added).toBe('Safe Filler B'); // A skipped — qualified mismatch
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

  it('never cuts a protection-class card (E87-new Slice A)', async () => {
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card'));
    vi.mocked(isProtectionPiece).mockReturnValue(true);
    try {
      const { repairs } = await applyCoherenceRepair(state, makeCtx(state));
      expect(repairs).toHaveLength(0);
      expect(deckNames(state)).toContain('Junk Card');
    } finally {
      vi.mocked(isProtectionPiece).mockReturnValue(false);
    }
  });

  it('never cuts a free-interaction-class card (iter-10 Slice A)', async () => {
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card'));
    vi.mocked(isFreeInteraction).mockReturnValue(true);
    try {
      const { repairs } = await applyCoherenceRepair(state, makeCtx(state));
      expect(repairs).toHaveLength(0);
      expect(deckNames(state)).toContain('Junk Card');
    } finally {
      vi.mocked(isFreeInteraction).mockReturnValue(false);
    }
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

  it('never proposes a cut for a card that was not actually in the pre-repair deck (C3)', async () => {
    // Combine a land-sanity finding (dead fetch) with a spell finding
    // (unjustified slot) so both repair branches fire in one pass, then
    // assert every `repairs[].cut` name traces back to a card that was
    // genuinely in the deck before repair ran — never a name pulled from a
    // pool/candidate list that was never actually part of the 99.
    const state = makeState();
    addToDeck(state, scryfallCard('Junk Card')); // not in pool → unjustified-slot
    state.categories.lands = [
      scryfallCard('Flooded Strand', {
        type_line: 'Land',
        oracle_text:
          '{T}, Pay 1 life, Sacrifice Flooded Strand: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.',
      }),
    ];
    const preRepairNames = new Set(deckNames(state));

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state));

    expect(repairs.length).toBeGreaterThan(0);
    for (const r of repairs) {
      expect(preRepairNames.has(r.cut)).toBe(true);
    }
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

  // ── Answer-coverage holes (E79) ──
  // Real oracle texts on purpose: classifyAnswer works on positive evidence
  // only, so a textless map entry must never satisfy the predicate.

  const deckAnswer = () =>
    scryfallCard('Utter Answer', {
      type_line: 'Instant',
      oracle_text: 'Destroy target artifact, creature, or planeswalker.',
    });
  const gripAnswer = () =>
    scryfallCard('Grip', {
      type_line: 'Instant',
      oracle_text: 'Destroy target artifact or enchantment.',
    });

  function reAudit(state: GenerationState, colorIdentity: string[]) {
    const nonLandCards = (Object.entries(state.categories) as [string, ScryfallCard[]][])
      .filter(([cat]) => cat !== 'lands')
      .flatMap(([, cards]) => cards);
    const inclusionMap: Record<string, number> = {};
    for (const c of state.edhrecData?.cardlists.allNonLand ?? [])
      inclusionMap[c.name] = c.inclusion ?? 0;
    return auditDeckCoherence({
      nonLandCards,
      commanders: [state.context.commander],
      cardInclusionMap: inclusionMap,
      lands: state.categories.lands,
      colorIdentity,
    });
  }

  it('fills a zero-coverage answer hole with a card that actually answers the class', async () => {
    const state = makeState();
    state.context.colorIdentity = ['W', 'G'];
    // Covers creature/artifact/planeswalker — enchantment is the fillable hole.
    addToDeck(state, deckAnswer());
    state.edhrecData!.cardlists.allNonLand.push(
      edhrecCard('Utter Answer', 40),
      edhrecCard('Grip', 20)
    );
    const map = defaultScryfallMap(state);
    map.set('Utter Answer', deckAnswer());
    map.set('Grip', gripAnswer());

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state, { scryfallCardMap: map }));

    // Safe Filler A/B rank higher but are textless — the predicate skips them.
    expect(repairs).toHaveLength(1);
    expect(repairs[0].added).toBe('Grip');
    expect(repairs[0].reason).toContain('enchantment');
    expect(DECK_SPELLS).toContain(repairs[0].cut); // weakest unprotected made room
    expect(deckNames(state)).toContain('Utter Answer'); // the existing answer survives
    const after = reAudit(state, ['W', 'G']);
    expect(after.some((f) => f.kind === 'answer-coverage' && f.severity === 'warn')).toBe(false);
  });

  it('leaves the hole reported when no pool candidate positively classifies', async () => {
    const state = makeState();
    state.context.colorIdentity = ['W', 'G'];
    addToDeck(state, deckAnswer());
    state.edhrecData!.cardlists.allNonLand.push(edhrecCard('Utter Answer', 40));
    const map = defaultScryfallMap(state); // every pool entry is textless
    map.set('Utter Answer', deckAnswer());
    const before = JSON.stringify(state.categories);

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state, { scryfallCardMap: map }));

    expect(repairs).toHaveLength(0);
    expect(JSON.stringify(state.categories)).toBe(before);
    const after = reAudit(state, ['W', 'G']);
    expect(
      after.some(
        (f) =>
          f.kind === 'answer-coverage' && f.severity === 'warn' && f.answerClass === 'enchantment'
      )
    ).toBe(true); // survives to the final report
  });

  it('leaves info coverage findings (thin/fragile) report-only', async () => {
    const state = makeState();
    state.context.colorIdentity = ['W', 'G'];
    // One any-permanent answer covers every class thinly → info findings only.
    addToDeck(
      state,
      scryfallCard('Omni Answer', {
        type_line: 'Sorcery',
        oracle_text: 'Destroy target permanent.',
      })
    );
    state.edhrecData!.cardlists.allNonLand.push(
      edhrecCard('Omni Answer', 40),
      edhrecCard('Grip', 20)
    );
    const map = defaultScryfallMap(state);
    map.set('Grip', gripAnswer());
    const before = JSON.stringify(state.categories);

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state, { scryfallCardMap: map }));

    expect(repairs).toHaveLength(0);
    expect(JSON.stringify(state.categories)).toBe(before);
  });

  it('per-card warns outrank coverage holes for the shared budget', async () => {
    const state = makeState();
    state.context.colorIdentity = ['W', 'G'];
    addToDeck(state, deckAnswer());
    for (let i = 0; i < 3; i++) addToDeck(state, scryfallCard(`Junk ${i}`));
    state.edhrecData!.cardlists.allNonLand.push(
      edhrecCard('Utter Answer', 40),
      edhrecCard('Grip', 20),
      edhrecCard('Filler C', 60),
      edhrecCard('Filler D', 50)
    );
    const map = defaultScryfallMap(state);
    map.set('Utter Answer', deckAnswer());
    map.set('Grip', gripAnswer());

    const { repairs } = await applyCoherenceRepair(state, makeCtx(state, { scryfallCardMap: map }));

    expect(repairs).toHaveLength(MAX_COHERENCE_SWAPS);
    // The dead cards in the deck claimed the whole budget; the missing
    // insurance slot waits for the final report.
    expect(repairs.every((r) => r.cut.startsWith('Junk'))).toBe(true);
    expect(deckNames(state)).not.toContain('Grip');
  });
});
