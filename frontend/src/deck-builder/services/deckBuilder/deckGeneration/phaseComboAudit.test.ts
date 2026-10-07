import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard, DetectedCombo, EDHRECCard } from '@/deck-builder/types';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardDrawSubtype: () => null,
  getCardRole: vi.fn(() => null),
  validateCardRole: () => null,
  readsAsProtection: () => false,
  isFreeInteraction: () => false,
}));

vi.mock('../categorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../categorize')>();
  return {
    ...actual,
    stampRoleSubtypes: () => {},
  };
});

import { comboIntegrityAuditPhase } from './phaseComboAudit';
import { BudgetTracker } from '../budgetTracker';
import type { GenerationState } from './state';
import { getCardRole } from '@/deck-builder/services/tagger/client';

const mockGetCardRole = vi.mocked(getCardRole);

function scryfallCard(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Creature — Human',
    color_identity: ['U'],
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
  return { name, id: name, inclusion } as unknown as EDHRECCard;
}

function combo(id: string, cards: string[], missingCards: string[]): DetectedCombo {
  return {
    comboId: id,
    cards,
    results: ['Win the game'],
    isComplete: missingCards.length === 0,
    missingCards,
    deckCount: 500,
    bracket: 3,
    bracketTag: null,
    cardCount: cards.length,
  };
}

function makeState(overrides: Partial<GenerationState> = {}): GenerationState {
  const commander = scryfallCard('Commander');
  return {
    context: {
      commander,
      partnerCommander: null,
      colorIdentity: ['U'],
      customization: {
        mustIncludeCards: [],
        tempMustIncludeCards: [],
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
      comboCountSetting: 1,
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

describe('comboIntegrityAuditPhase', () => {
  beforeEach(() => {
    mockGetCardRole.mockReset();
    mockGetCardRole.mockReturnValue(null);
  });

  // E540 S8: Commander Spellbook 864-2596-4050 loops mana and blinks and never
  // ends the game, so the audit never completes it. Its low-played in-deck
  // piece is an orphan all the same and gives its slot up (as Mana Vault did
  // to Sol Ring on the 100%-owned Yuriko build).
  it('does not complete a loop that only makes mana, but still replaces its orphan', () => {
    const state = makeState();
    const piece = scryfallCard('Eternal Witness');
    state.categories.creatures = [piece, scryfallCard('Filler')];
    state.usedNames = new Set(['Eternal Witness', 'Filler']);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Eternal Witness', 1),
          edhrecCard('Filler', 1),
          edhrecCard('Spell Fill', 50),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const loop: DetectedCombo = {
      ...combo('864-2596-4050', ['Eternal Witness', 'Phyrexian Altar'], ['Phyrexian Altar']),
      results: ['Infinite blinking', 'Infinite colored mana', 'Infinite creature ETB'],
    };
    const result = comboIntegrityAuditPhase(state, {
      detectedCombos: [loop],
      scryfallCardMap: new Map([
        ['Eternal Witness', piece],
        ['Phyrexian Altar', scryfallCard('Phyrexian Altar')],
        ['Spell Fill', scryfallCard('Spell Fill')],
      ]),
      budgetTracker: null,
      bracketGuard: undefined,
    });
    expect(result.repairs).toEqual([
      expect.objectContaining({ cut: 'Eternal Witness', added: 'Spell Fill' }),
    ]);
    expect(state.usedNames.has('Phyrexian Altar')).toBe(false);
  });

  // Obeka wheels (niche panel): Underworld Breach + Wheel of Fortune + Jeska's
  // Will loops draw triggers and never ends the game. Jeska's Will, a Game
  // Changer, was cut as its orphan for an Izzet Signet.
  it('keeps a Game Changer that is a piece of a line that does not end the game', () => {
    const state = makeState();
    const will = scryfallCard("Jeska's Will", { color_identity: ['U'] });
    state.categories.ramp = [will, scryfallCard('Filler')];
    state.usedNames = new Set(["Jeska's Will", 'Filler']);
    state.gameChangerNames = new Set(["Jeska's Will"]);
    state.cfg.isGameChanger = (n) => state.gameChangerNames.has(n);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard("Jeska's Will", 14),
          edhrecCard('Filler', 1),
          edhrecCard('Izzet Signet', 57),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const loop: DetectedCombo = {
      ...combo('1368-1878-2706', ["Jeska's Will", 'Wheel of Fortune'], ['Wheel of Fortune']),
      results: ['Infinite draw triggers for all players', 'Infinite looting for all players'],
    };
    const result = comboIntegrityAuditPhase(state, {
      detectedCombos: [loop],
      scryfallCardMap: new Map([
        ["Jeska's Will", will],
        ['Izzet Signet', scryfallCard('Izzet Signet')],
      ]),
      budgetTracker: null,
      bracketGuard: undefined,
    });
    expect(result.repairs).toEqual([]);
    expect(state.categories.ramp.map((c) => c.name)).toContain("Jeska's Will");
  });

  // Krenko, Mob Boss at 100% owned: the orphan swap seated an unowned Sol Ring.
  it('seats only owned replacements at a 100% owned share', () => {
    const state = makeState();
    const orphan = scryfallCard('Goblin Welder');
    state.categories.creatures = [orphan];
    state.usedNames = new Set(['Goblin Welder']);
    state.cfg.collectionStrategy = 'partial';
    state.cfg.collectionOwnedPercent = 100;
    state.context.collectionNames = new Set(['Goblin Welder', 'Owned Fill']);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Goblin Welder', 1),
          edhrecCard('Sol Ring', 85),
          edhrecCard('Owned Fill', 20),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const result = comboIntegrityAuditPhase(state, {
      detectedCombos: [combo('c1', ['Goblin Welder', 'Missing X'], ['Missing X'])],
      scryfallCardMap: new Map([
        ['Goblin Welder', orphan],
        ['Sol Ring', scryfallCard('Sol Ring')],
        ['Owned Fill', scryfallCard('Owned Fill')],
      ]),
      budgetTracker: null,
      bracketGuard: undefined,
    });
    expect(result.repairs).toEqual([
      expect.objectContaining({ cut: 'Goblin Welder', added: 'Owned Fill' }),
    ]);
  });

  it('never replaces an orphaned combo piece with a land (E485)', () => {
    // allNonLand carries utility lands; atraxa-bracket2 swapped its orphaned
    // Ajani for Karn's Bastion here and shipped a land over its tuned count.
    const state = makeState();
    const orphan = scryfallCard('Orphan A');
    state.categories.synergy.push(orphan);
    state.usedNames.add(orphan.name);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Orphan A', 1),
          edhrecCard('Utility Land', 99),
          edhrecCard('Spell Fill', 50),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const scryfallCardMap = new Map<string, ScryfallCard>([
      ['Orphan A', orphan],
      ['Utility Land', scryfallCard('Utility Land', { type_line: 'Land', color_identity: [] })],
      ['Spell Fill', scryfallCard('Spell Fill')],
    ]);
    const { repairs } = comboIntegrityAuditPhase(state, {
      // Missing X isn't resolvable, so the combo can't complete and the
      // orphaned low-inclusion piece is evicted.
      detectedCombos: [combo('c1', ['Orphan A', 'Missing X'], ['Missing X'])],
      scryfallCardMap,
      budgetTracker: null,
      bracketGuard: undefined,
    });

    expect(repairs).toEqual([expect.objectContaining({ cut: 'Orphan A', added: 'Spell Fill' })]);
  });

  it('no-ops when combos were never requested (comboCountSetting <= 0)', () => {
    const state = makeState();
    state.cfg.comboCountSetting = 0;
    state.edhrecData = {
      cardlists: { allNonLand: [] },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [combo('c1', ['A', 'B'], ['B'])];
    const result = comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map(),
      budgetTracker: null,
      bracketGuard: undefined,
    });
    expect(result).toEqual({
      detectedCombos,
      repairs: [],
      budgetSkipped: 0,
      bracketBlocked: 0,
    });
  });

  it('swaps in a multi-combo enabler, evicting the weakest filler, and completes both near-misses', () => {
    const state = makeState();
    const filler = scryfallCard('Filler');
    const pieceA = scryfallCard('PieceA');
    const pieceB = scryfallCard('PieceB');
    const enabler = scryfallCard('Enabler');
    state.categories.creatures = [pieceA, pieceB, filler];
    state.usedNames = new Set(['PieceA', 'PieceB', 'Filler']);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Filler', 1),
          edhrecCard('PieceA', 50),
          edhrecCard('PieceB', 50),
          edhrecCard('Enabler', 80),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [
      combo('c1', ['PieceA', 'Enabler'], ['Enabler']),
      combo('c2', ['PieceB', 'Enabler'], ['Enabler']),
    ];

    const result = comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map([['Enabler', enabler]]),
      budgetTracker: null,
      bracketGuard: undefined,
    });

    expect(state.categories.creatures.map((c) => c.name).sort()).toEqual([
      'Enabler',
      'PieceA',
      'PieceB',
    ]);
    expect(state.usedNames.has('Filler')).toBe(false);
    expect(state.usedNames.has('Enabler')).toBe(true);
    expect(state.bannedCards.has('Filler')).toBe(true);
    expect(result.repairs).toEqual([expect.objectContaining({ cut: 'Filler', added: 'Enabler' })]);
    expect(result.detectedCombos?.every((dc) => dc.isComplete)).toBe(true);
    expect(result.budgetSkipped).toBe(0);
    expect(result.bracketBlocked).toBe(0);
  });

  it('skips an enabler that exceeds the budget cap and applies no swap', () => {
    const state = makeState();
    const filler = scryfallCard('Filler');
    const pieceA = scryfallCard('PieceA');
    const pieceB = scryfallCard('PieceB');
    const enabler = scryfallCard('Enabler', { prices: { usd: '40.00' } });
    state.categories.creatures = [pieceA, pieceB, filler];
    state.usedNames = new Set(['PieceA', 'PieceB', 'Filler']);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Filler', 1),
          edhrecCard('PieceA', 50),
          edhrecCard('PieceB', 50),
          edhrecCard('Enabler', 80),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [
      combo('c1', ['PieceA', 'Enabler'], ['Enabler']),
      combo('c2', ['PieceB', 'Enabler'], ['Enabler']),
    ];
    const tracker = new BudgetTracker(6, 3, 'USD'); // near-exhausted effective cap

    const result = comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map([['Enabler', enabler]]),
      budgetTracker: tracker,
      bracketGuard: undefined,
    });

    expect(state.categories.creatures.map((c) => c.name).sort()).toEqual([
      'Filler',
      'PieceA',
      'PieceB',
    ]);
    expect(result.repairs).toEqual([]);
    expect(result.budgetSkipped).toBeGreaterThan(0);
    // No swap applied, so the returned list is the same reference (no rebuild).
    expect(result.detectedCombos).toBe(detectedCombos);
  });

  // E-arena-leak: combo candidates come from the EDHREC combo dataset, not
  // cardPicking.ts's pre-filtered pool — the user's rarity/CMC/Arena caps
  // need an explicit gate here too, or a capped build can swap in an
  // over-cap piece. Tiny Leaders' CMC cap is a FORMAT rule, not a soft
  // preference — a combo piece gets no exemption from it.
  it('skips an enabler that exceeds the user rarity/CMC/Arena caps and applies no swap', () => {
    const cases: [keyof GenerationState['cfg'], unknown, Partial<ScryfallCard>][] = [
      ['maxRarity', 'common', { rarity: 'rare' }],
      ['maxCmc', 3, { cmc: 4 }],
      ['arenaOnly', true, { games: ['paper'] }],
    ];
    for (const [capKey, capValue, cardOverrides] of cases) {
      const state = makeState();
      (state.cfg as unknown as Record<string, unknown>)[capKey] = capValue;
      const filler = scryfallCard('Filler');
      const pieceA = scryfallCard('PieceA');
      const pieceB = scryfallCard('PieceB');
      const enabler = scryfallCard('Enabler', cardOverrides);
      state.categories.creatures = [pieceA, pieceB, filler];
      state.usedNames = new Set(['PieceA', 'PieceB', 'Filler']);
      state.edhrecData = {
        cardlists: {
          allNonLand: [
            edhrecCard('Filler', 1),
            edhrecCard('PieceA', 50),
            edhrecCard('PieceB', 50),
            edhrecCard('Enabler', 80),
          ],
        },
      } as unknown as GenerationState['edhrecData'];
      const detectedCombos = [
        combo('c1', ['PieceA', 'Enabler'], ['Enabler']),
        combo('c2', ['PieceB', 'Enabler'], ['Enabler']),
      ];

      const result = comboIntegrityAuditPhase(state, {
        detectedCombos,
        scryfallCardMap: new Map([['Enabler', enabler]]),
        budgetTracker: null,
        bracketGuard: undefined,
      });

      expect(state.categories.creatures.map((c) => c.name).sort()).toEqual([
        'Filler',
        'PieceA',
        'PieceB',
      ]);
      expect(result.repairs).toEqual([]);
    }
  });

  it('E119: keeps currentRoleCounts in sync on audit swaps (increment on add, decrement on remove)', () => {
    const state = makeState();
    const filler = scryfallCard('Filler');
    const pieceA = scryfallCard('PieceA');
    const pieceB = scryfallCard('PieceB');
    const enabler = scryfallCard('Enabler');
    state.categories.creatures = [pieceA, pieceB, filler];
    state.usedNames = new Set(['PieceA', 'PieceB', 'Filler']);
    // Filler (evicted) reads as 'removal'; Enabler (added) reads as 'ramp' —
    // distinct roles so increment/decrement aren't just cancelling each other.
    mockGetCardRole.mockImplementation((name: string) =>
      name === 'Filler' ? 'removal' : name === 'Enabler' ? 'ramp' : null
    );
    state.currentRoleCounts = { ramp: 0, removal: 1, boardwipe: 0, cardDraw: 0 };
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Filler', 1),
          edhrecCard('PieceA', 50),
          edhrecCard('PieceB', 50),
          edhrecCard('Enabler', 80),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [
      combo('c1', ['PieceA', 'Enabler'], ['Enabler']),
      combo('c2', ['PieceB', 'Enabler'], ['Enabler']),
    ];

    comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map([['Enabler', enabler]]),
      budgetTracker: null,
      bracketGuard: undefined,
    });

    // Filler evicted (removal: 1 -> 0), Enabler added (ramp: 0 -> 1).
    expect(state.currentRoleCounts.removal).toBe(0);
    expect(state.currentRoleCounts.ramp).toBe(1);
  });

  it('E119: auditRemove floors currentRoleCounts at 0 rather than going negative', () => {
    const state = makeState();
    const filler = scryfallCard('Filler');
    const pieceA = scryfallCard('PieceA');
    const pieceB = scryfallCard('PieceB');
    const enabler = scryfallCard('Enabler');
    state.categories.creatures = [pieceA, pieceB, filler];
    state.usedNames = new Set(['PieceA', 'PieceB', 'Filler']);
    mockGetCardRole.mockImplementation((name: string) => (name === 'Filler' ? 'removal' : null));
    // Already-stale-zero count (e.g. from an earlier unbookkept phase) — the
    // guard must not decrement past 0.
    state.currentRoleCounts = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Filler', 1),
          edhrecCard('PieceA', 50),
          edhrecCard('PieceB', 50),
          edhrecCard('Enabler', 80),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [
      combo('c1', ['PieceA', 'Enabler'], ['Enabler']),
      combo('c2', ['PieceB', 'Enabler'], ['Enabler']),
    ];

    comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map([['Enabler', enabler]]),
      budgetTracker: null,
      bracketGuard: undefined,
    });

    expect(state.currentRoleCounts.removal).toBe(0);
  });
});

// E532 gate: the audit cut a piece of the very combo it was completing and
// reported the combo complete. Real cards; inclusion from the E532 panel's
// Atraxa, Praetors' Voice Planeswalkers and Sivitri, Dragon Master pages.
describe('comboIntegrityAuditPhase never evicts a piece of the combo it completes', () => {
  beforeEach(() => {
    mockGetCardRole.mockReset();
    mockGetCardRole.mockReturnValue(null);
  });

  it('completing a near-miss keeps the in-deck piece (Prologue to Phyresis)', () => {
    const state = makeState();
    const prologue = scryfallCard('Prologue to Phyresis', { type_line: 'Sorcery' });
    const wanderer = scryfallCard('The Wanderer', { type_line: 'Legendary Planeswalker' });
    const algorithm = scryfallCard('Expansion Algorithm', { type_line: 'Instant' });
    state.categories.synergy = [prologue, wanderer];
    state.usedNames = new Set([prologue.name, wanderer.name]);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Prologue to Phyresis', 12.9),
          edhrecCard('The Wanderer', 15.3),
          edhrecCard('Expansion Algorithm', 12.5),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [
      combo('1131-7873', ['Prologue to Phyresis', 'Expansion Algorithm'], ['Expansion Algorithm']),
    ];

    const { repairs, detectedCombos: after } = comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map([[algorithm.name, algorithm]]),
      budgetTracker: null,
      bracketGuard: undefined,
    });

    expect(repairs).toEqual([
      expect.objectContaining({ cut: 'The Wanderer', added: 'Expansion Algorithm' }),
    ]);
    expect(state.usedNames.has('Prologue to Phyresis')).toBe(true);
    expect(after?.[0]).toEqual(expect.objectContaining({ isComplete: true, missingCards: [] }));
  });

  it('completing a near-miss never cuts a staple rock, however unplayed it reads (E537)', () => {
    const state = makeState();
    const prologue = scryfallCard('Prologue to Phyresis', { type_line: 'Sorcery' });
    const wanderer = scryfallCard('The Wanderer', { type_line: 'Legendary Planeswalker' });
    const signet = scryfallCard('Arcane Signet', { type_line: 'Artifact' });
    const algorithm = scryfallCard('Expansion Algorithm', { type_line: 'Instant' });
    state.categories.synergy = [prologue, wanderer];
    state.categories.ramp = [signet];
    state.usedNames = new Set([prologue.name, wanderer.name, signet.name]);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Prologue to Phyresis', 12.9),
          edhrecCard('The Wanderer', 15.3),
          edhrecCard('Arcane Signet', 1),
          edhrecCard('Expansion Algorithm', 12.5),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const { repairs } = comboIntegrityAuditPhase(state, {
      detectedCombos: [
        combo(
          '1131-7873',
          ['Prologue to Phyresis', 'Expansion Algorithm'],
          ['Expansion Algorithm']
        ),
      ],
      scryfallCardMap: new Map([[algorithm.name, algorithm]]),
      budgetTracker: null,
      bracketGuard: undefined,
    });
    expect(repairs).toEqual([expect.objectContaining({ cut: 'The Wanderer' })]);
    expect(state.usedNames.has('Arcane Signet')).toBe(true);
  });

  it('a multi-combo enabler keeps the partners it completes (Hullbreaker Horror + Mox Amber)', () => {
    const state = makeState();
    const moxAmber = scryfallCard('Mox Amber', { type_line: 'Legendary Artifact' });
    const solRing = scryfallCard('Sol Ring', { type_line: 'Artifact' });
    const frostkite = scryfallCard('Deceptive Frostkite');
    const hullbreaker = scryfallCard('Hullbreaker Horror');
    state.categories.ramp = [moxAmber, solRing];
    state.categories.creatures = [frostkite];
    state.usedNames = new Set([moxAmber.name, solRing.name, frostkite.name]);
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Mox Amber', 5.5),
          edhrecCard('Sol Ring', 93.2),
          edhrecCard('Deceptive Frostkite', 33.3),
          edhrecCard('Hullbreaker Horror', 8.2),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const detectedCombos = [
      combo('hb-amber', ['Hullbreaker Horror', 'Mox Amber'], ['Hullbreaker Horror']),
      combo('hb-sol', ['Hullbreaker Horror', 'Sol Ring'], ['Hullbreaker Horror']),
    ];

    const { repairs } = comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map([[hullbreaker.name, hullbreaker]]),
      budgetTracker: null,
      bracketGuard: undefined,
    });

    expect(repairs).toEqual([
      expect.objectContaining({ cut: 'Deceptive Frostkite', added: 'Hullbreaker Horror' }),
    ]);
    expect(state.usedNames.has('Mox Amber')).toBe(true);
  });

  it('keeps the pieces a later enabler needs (Kozilek: Karn stays for Mycosynth Lattice)', () => {
    const state = makeState();
    const art = (name: string) => scryfallCard(name, { type_line: 'Artifact' });
    const deck = [
      art('Foundry Inspector'),
      art('Echoes of Eternity'),
      art('Mystic Forge'),
      scryfallCard('Karn, the Great Creator', { type_line: 'Legendary Planeswalker' }),
      art('Darksteel Forge'),
      art("Nevinyrral's Disk"),
      art('Unwinding Clock'),
      art('Ornithopter of Paradise'),
      art('Hedron Crawler'),
    ];
    state.categories.synergy = deck;
    state.usedNames = new Set(deck.map((c) => c.name));
    // Kozilek, the Great Distortion's page.
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Foundry Inspector', 31.3),
          edhrecCard('Echoes of Eternity', 57.6),
          edhrecCard('Mystic Forge', 75.7),
          edhrecCard('Karn, the Great Creator', 18.6),
          edhrecCard('Darksteel Forge', 15.1),
          edhrecCard("Nevinyrral's Disk", 19.9),
          edhrecCard('Unwinding Clock', 34.6),
          edhrecCard('Ornithopter of Paradise', 20.1),
          edhrecCard('Hedron Crawler', 23.3),
          edhrecCard("Sensei's Divining Top", 30.9),
          edhrecCard('Mycosynth Lattice', 7.3),
        ],
      },
    } as unknown as GenerationState['edhrecData'];
    const top = "Sensei's Divining Top";
    const lattice = 'Mycosynth Lattice';
    const detectedCombos = [
      combo('top-echoes', ['Echoes of Eternity', 'Foundry Inspector', top], [top]),
      combo('top-forge', ['Foundry Inspector', 'Mystic Forge', top], [top]),
      combo('karn-lattice', ['Karn, the Great Creator', lattice], [lattice]),
      combo(
        'disk-lock',
        ['Darksteel Forge', lattice, "Nevinyrral's Disk", 'Unwinding Clock'],
        [lattice]
      ),
    ];

    const { repairs, detectedCombos: after } = comboIntegrityAuditPhase(state, {
      detectedCombos,
      scryfallCardMap: new Map([
        [top, art(top)],
        [lattice, art(lattice)],
      ]),
      budgetTracker: null,
      bracketGuard: undefined,
    });

    expect(repairs.map((r) => r.cut).sort()).toEqual(['Hedron Crawler', 'Ornithopter of Paradise']);
    expect(
      after
        ?.filter((dc) => dc.isComplete)
        .map((dc) => dc.comboId)
        .sort()
    ).toEqual(['disk-lock', 'karn-lattice', 'top-echoes', 'top-forge']);
  });
});
