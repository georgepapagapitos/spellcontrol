import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

// Deterministic role signals — same pattern as phaseLandSqueezeReconcile.test.ts.
const ROLE_OF = new Map<string, RoleKey>();
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: vi.fn((name: string) => ROLE_OF.get(name) ?? null),
  validateCardRole: vi.fn((card: { name: string }) => ROLE_OF.get(card.name) ?? null),
  isProtectionPiece: vi.fn(() => false),
  isFreeInteraction: vi.fn(() => false),
}));

// stampRoleSubtypes reads bundled tagger JSON for subtype badges — irrelevant
// here (no-op), same precedent as phaseCoherenceRepair.test.ts. routeCardByType
// keeps its real land-then-role-then-synergy routing.
vi.mock('../categorize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../categorize')>();
  return {
    ...actual,
    stampRoleSubtypes: () => {},
  };
});

import {
  applyFlagshipSeating,
  FLAGSHIP_SEAT_MAX,
  FLAGSHIP_INCLUSION_FLOOR,
  type FlagshipSeatingContext,
} from './phaseFlagshipSeating';
import type { GenerationState } from './state';
import type { BracketGuard } from '../bracketGuard';
import { isProtectionPiece, isFreeInteraction } from '@/deck-builder/services/tagger/client';

// ── helpers (mirrors phaseLandSqueezeReconcile.test.ts) ──

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
      mtgFormat: 'commander',
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
      brewLevel: 0.5,
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

function makeCtx(overrides: Partial<FlagshipSeatingContext> = {}): FlagshipSeatingContext {
  return {
    gateFires: true,
    isFlagshipCandidate: () => false,
    themeLabel: 'extra combats',
    scryfallCardMap: new Map(),
    colorIdentity: [],
    liftScoreOf: () => 0,
    roleTargets: null,
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
    ownedOnly: false,
    ...overrides,
  };
}

beforeEach(() => {
  ROLE_OF.clear();
  vi.mocked(isProtectionPiece).mockReturnValue(false);
  vi.mocked(isFreeInteraction).mockReturnValue(false);
});

describe('applyFlagshipSeating', () => {
  it('seats the top gated candidate, displacing the lowest-survival incumbent', () => {
    const state = makeState();
    const weakFiller = scryfallCard('Weak Filler');
    const strongStaple = scryfallCard('Strong Staple');
    state.categories.synergy.push(weakFiller, strongStaple);
    state.usedNames.add('Weak Filler');
    state.usedNames.add('Strong Staple');
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Helm of the Host', 17.9),
          edhrecCard('Weak Filler', 5),
          edhrecCard('Strong Staple', 90),
        ],
      },
    } as unknown as GenerationState['edhrecData'];

    const helm = scryfallCard('Helm of the Host', { type_line: 'Legendary Artifact — Equipment' });
    const result = applyFlagshipSeating(
      state,
      makeCtx({
        isFlagshipCandidate: (c) => c.name === 'Helm of the Host',
        scryfallCardMap: new Map([['Helm of the Host', helm]]),
      })
    );

    expect(result.seated).toEqual([
      {
        cut: 'Weak Filler',
        added: 'Helm of the Host',
        reason: expect.stringContaining('Helm of the Host'),
      },
    ]);
    expect(state.categories.synergy.map((c) => c.name)).toContain('Helm of the Host');
    expect(state.categories.synergy.map((c) => c.name)).not.toContain('Weak Filler');
    expect(state.categories.synergy.map((c) => c.name)).toContain('Strong Staple');
    expect(state.usedNames.has('Helm of the Host')).toBe(true);
    expect(state.usedNames.has('Weak Filler')).toBe(false);
  });

  it('is an exact no-op — state.categories untouched — when the gate never fires', () => {
    const state = makeState();
    state.categories.creatures.push(scryfallCard('Filler_1'), scryfallCard('Filler_2'));
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Helm of the Host', 90)] },
    } as unknown as GenerationState['edhrecData'];
    const before = JSON.stringify(state.categories);

    const result = applyFlagshipSeating(
      state,
      makeCtx({
        gateFires: false,
        isFlagshipCandidate: (c) => c.name === 'Helm of the Host',
        scryfallCardMap: new Map([['Helm of the Host', scryfallCard('Helm of the Host')]]),
      })
    );

    expect(result.seated).toEqual([]);
    expect(JSON.stringify(state.categories)).toBe(before);
  });

  it('displaces the genuinely weakest incumbent by survival score, not deck position', () => {
    const state = makeState();
    // Positioned first (would be "weakest by position" under a position-based
    // scorer) but protected — must survive. The actual lowest-survival card
    // (lowest inclusion, no protections) sits LAST.
    const protectedFirst = scryfallCard('Protected First', { isMustInclude: true });
    const trueWeakest = scryfallCard('True Weakest');
    const midStrength = scryfallCard('Mid Strength');
    state.categories.synergy.push(protectedFirst, midStrength, trueWeakest);
    state.usedNames.add('Protected First');
    state.usedNames.add('Mid Strength');
    state.usedNames.add('True Weakest');
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Aggravated Assault', 10.5),
          edhrecCard('Protected First', 1),
          edhrecCard('Mid Strength', 40),
          edhrecCard('True Weakest', 2),
        ],
      },
    } as unknown as GenerationState['edhrecData'];

    const flagship = scryfallCard('Aggravated Assault');
    const result = applyFlagshipSeating(
      state,
      makeCtx({
        isFlagshipCandidate: (c) => c.name === 'Aggravated Assault',
        scryfallCardMap: new Map([['Aggravated Assault', flagship]]),
      })
    );

    expect(result.seated[0]?.cut).toBe('True Weakest');
    expect(state.categories.synergy.map((c) => c.name)).toContain('Protected First');
    expect(state.categories.synergy.map((c) => c.name)).toContain('Mid Strength');
  });

  it('vetoes the seat when the only candidate fails a hard gate (color identity)', () => {
    const state = makeState();
    state.categories.synergy.push(scryfallCard('Weak Filler'));
    state.usedNames.add('Weak Filler');
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('Off-Color Flagship', 50), edhrecCard('Weak Filler', 5)],
      },
    } as unknown as GenerationState['edhrecData'];
    // Candidate is black, deck's color identity is mono-white — fitsColorIdentity fails.
    const offColor = scryfallCard('Off-Color Flagship', { color_identity: ['B'] });

    const result = applyFlagshipSeating(
      state,
      makeCtx({
        isFlagshipCandidate: (c) => c.name === 'Off-Color Flagship',
        scryfallCardMap: new Map([['Off-Color Flagship', offColor]]),
        colorIdentity: ['W'],
      })
    );

    expect(result.seated).toEqual([]);
    expect(state.categories.synergy.map((c) => c.name)).toEqual(['Weak Filler']);
  });

  it('vetoes the seat when it would exceed the bracket ceiling', () => {
    const state = makeState();
    state.categories.synergy.push(scryfallCard('Weak Filler'));
    state.usedNames.add('Weak Filler');
    state.edhrecData = {
      cardlists: { allNonLand: [edhrecCard('Capped Flagship', 50), edhrecCard('Weak Filler', 5)] },
    } as unknown as GenerationState['edhrecData'];
    const capped = scryfallCard('Capped Flagship');
    const bracketGuard = {
      exceedsCeiling: () => true,
      record: vi.fn(),
    } as unknown as BracketGuard;

    const result = applyFlagshipSeating(
      state,
      makeCtx({
        isFlagshipCandidate: (c) => c.name === 'Capped Flagship',
        scryfallCardMap: new Map([['Capped Flagship', capped]]),
        bracketGuard,
      })
    );

    expect(result.seated).toEqual([]);
    expect(bracketGuard.record).not.toHaveBeenCalled();
  });

  it('vetoes the seat when the candidate exceeds the price cap', () => {
    const state = makeState();
    state.categories.synergy.push(scryfallCard('Weak Filler'));
    state.usedNames.add('Weak Filler');
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('Pricey Flagship', 50), edhrecCard('Weak Filler', 5)],
      },
    } as unknown as GenerationState['edhrecData'];
    const pricey = scryfallCard('Pricey Flagship', { prices: { usd: '25.00' } });

    const result = applyFlagshipSeating(
      state,
      makeCtx({
        isFlagshipCandidate: (c) => c.name === 'Pricey Flagship',
        scryfallCardMap: new Map([['Pricey Flagship', pricey]]),
        maxCardPrice: 5,
      })
    );

    expect(result.seated).toEqual([]);
    expect(state.categories.synergy.map((c) => c.name)).toEqual(['Weak Filler']);
  });

  it('ignores candidates below the inclusion floor (no jank seats)', () => {
    const state = makeState();
    state.categories.synergy.push(scryfallCard('Weak Filler'));
    state.usedNames.add('Weak Filler');
    state.edhrecData = {
      cardlists: {
        allNonLand: [
          edhrecCard('Jank Card', FLAGSHIP_INCLUSION_FLOOR - 1),
          edhrecCard('Weak Filler', 5),
        ],
      },
    } as unknown as GenerationState['edhrecData'];

    const result = applyFlagshipSeating(
      state,
      makeCtx({
        isFlagshipCandidate: (c) => c.name === 'Jank Card',
        scryfallCardMap: new Map([['Jank Card', scryfallCard('Jank Card')]]),
      })
    );

    expect(result.seated).toEqual([]);
  });

  it('caps seats at FLAGSHIP_SEAT_MAX even when more candidates clear every gate', () => {
    const state = makeState();
    for (let i = 0; i < 5; i++) {
      const filler = scryfallCard(`Filler_${i}`);
      state.categories.synergy.push(filler);
      state.usedNames.add(filler.name);
    }
    const candidateNames = ['Cand_A', 'Cand_B', 'Cand_C'];
    const allNonLand: EDHRECCard[] = [
      ...candidateNames.map((n) => edhrecCard(n, 50)),
      ...Array.from({ length: 5 }, (_, i) => edhrecCard(`Filler_${i}`, 5)),
    ];
    state.edhrecData = { cardlists: { allNonLand } } as unknown as GenerationState['edhrecData'];
    const scryfallCardMap = new Map(candidateNames.map((n) => [n, scryfallCard(n)]));

    const result = applyFlagshipSeating(
      state,
      makeCtx({
        isFlagshipCandidate: (c) => candidateNames.includes(c.name),
        scryfallCardMap,
      })
    );

    expect(result.seated).toHaveLength(FLAGSHIP_SEAT_MAX);
  });
});

// ── Injected off-pool candidates (E238 lift seating) ──
//
// The lift-seating caller supplies candidates that are NOT in this commander's
// EDHREC cardlist — that absence is the entire point of the mechanism — so pool
// derivation, the inclusion floor, and the calculateCardPriority ranking all
// have to be bypassed while every gate stays enforced.
describe('applyFlagshipSeating — injected candidates', () => {
  function stateWithIncumbents() {
    const state = makeState();
    state.categories.synergy.push(scryfallCard('Weak Filler'), scryfallCard('Strong Staple'));
    state.usedNames.add('Weak Filler');
    state.usedNames.add('Strong Staple');
    state.edhrecData = {
      cardlists: {
        allNonLand: [edhrecCard('Weak Filler', 5), edhrecCard('Strong Staple', 60)],
      },
    } as unknown as GenerationState['edhrecData'];
    return state;
  }

  it('seats an off-pool candidate — no pool entry, no inclusion floor', () => {
    const state = stateWithIncumbents();

    const result = applyFlagshipSeating(
      state,
      makeCtx({
        candidates: [scryfallCard('Off Pool Card')],
        // Would reject everything on the pool path — proves it is not consulted.
        isFlagshipCandidate: () => false,
      })
    );

    expect(result.seated).toHaveLength(1);
    expect(result.seated[0].added).toBe('Off Pool Card');
    // Displaced the weaker incumbent, not the staple.
    expect(result.seated[0].cut).toBe('Weak Filler');
    expect(state.usedNames.has('Off Pool Card')).toBe(true);
    expect(state.usedNames.has('Weak Filler')).toBe(false);
  });

  it('uses reasonFor for the disclosure when supplied', () => {
    const result = applyFlagshipSeating(
      stateWithIncumbents(),
      makeCtx({
        candidates: [scryfallCard('Off Pool Card')],
        reasonFor: (card) => `${card.name} was co-played`,
      })
    );
    expect(result.seated[0].reason).toBe('Off Pool Card was co-played');
  });

  it('still enforces the gates on injected candidates', () => {
    const state = stateWithIncumbents();
    const result = applyFlagshipSeating(
      state,
      makeCtx({
        candidates: [scryfallCard('Off Color', { color_identity: ['U'] })],
        colorIdentity: [],
      })
    );
    expect(result.seated).toEqual([]);
    expect(state.usedNames.has('Off Color')).toBe(false);
  });

  it('skips injected candidates already in the deck or banned', () => {
    const state = stateWithIncumbents();
    state.bannedCards.add('Banned Card');
    const result = applyFlagshipSeating(
      state,
      makeCtx({
        candidates: [scryfallCard('Strong Staple'), scryfallCard('Banned Card')],
      })
    );
    expect(result.seated).toEqual([]);
  });

  it('respects the seat cap on the injected path too', () => {
    const state = makeState();
    for (let i = 0; i < 6; i++) {
      const filler = scryfallCard(`Filler_${i}`);
      state.categories.synergy.push(filler);
      state.usedNames.add(filler.name);
    }
    state.edhrecData = {
      cardlists: { allNonLand: Array.from({ length: 6 }, (_, i) => edhrecCard(`Filler_${i}`, 5)) },
    } as unknown as GenerationState['edhrecData'];

    const result = applyFlagshipSeating(
      state,
      makeCtx({ candidates: Array.from({ length: 5 }, (_, i) => scryfallCard(`Lift_${i}`)) })
    );
    expect(result.seated).toHaveLength(FLAGSHIP_SEAT_MAX);
  });

  it('is inert when the gate does not fire', () => {
    const state = stateWithIncumbents();
    const result = applyFlagshipSeating(state, makeCtx({ gateFires: false, candidates: [] }));
    expect(result.seated).toEqual([]);
    expect(state.usedNames.has('Weak Filler')).toBe(true);
  });
});
