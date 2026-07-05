// GOLDEN-MASTER / CHARACTERIZATION harness for generateDeck().
//
// generateDeck() is a ~2900-line procedural orchestrator with shared mutable
// locals and no other test coverage. This file pins its *current* observable
// output for fixed inputs so the upcoming phase-by-phase decomposition can be
// proven behavior-preserving: any change to the produced deck fails here.
//
// Determinism: the generation path has no Math.random / Date / crypto, sorts
// are by priority/rank, and Map/Set iteration is insertion-ordered — so with
// deterministic I/O mocks + a cache reset per test, output is stable.
//
// Only the 3 client module boundaries are mocked; vi.mock propagates to the
// already-extracted helper modules automatically. Pure helpers (getCardPrice,
// getFrontFaceTypeLine, isMdfcLand, isChannelLand, parseSetFromQuery,
// CHANNEL_LANDS) are kept real via importActual.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  ScryfallCard,
  EDHRECCard,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  Customization,
} from '@/deck-builder/types';

// ---- Fixture universe -----------------------------------------------------

function mkSC(name: string, typeLine: string, cmc: number): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    mana_cost: cmc > 0 ? `{${cmc}}{G}` : '',
    cmc,
    type_line: typeLine,
    oracle_text: '',
    colors: typeLine.includes('Land') ? [] : ['G'],
    color_identity: ['G'],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    legalities: { commander: 'legal' },
  };
}

function mkEC(name: string, primaryType: string, inclusion: number): EDHRECCard {
  return { name, sanitized: name, primary_type: primaryType, inclusion, num_decks: 1000 };
}

// Build a pool large enough to fill a 99-card mono-G commander deck.
function buildPool() {
  const scMap = new Map<string, ScryfallCard>();
  const add = (n: string, t: string, c: number) => {
    scMap.set(n, mkSC(n, t, c));
    return n;
  };
  const gen = (prefix: string, type: string, count: number, cmcOf: (i: number) => number) =>
    Array.from({ length: count }, (_, i) => {
      const n = `${prefix}_${i + 1}`;
      add(n, type, cmcOf(i));
      return mkEC(n, prefix, 90 - i);
    });

  const creatures = gen('Creature', 'Creature', 40, (i) => (i % 6) + 1);
  const instants = gen('Instant', 'Instant', 15, (i) => (i % 4) + 1);
  const sorceries = gen('Sorcery', 'Sorcery', 15, (i) => (i % 4) + 2);
  const artifacts = gen('Artifact', 'Artifact', 15, (i) => (i % 3) + 1);
  const enchantments = gen('Enchantment', 'Enchantment', 15, (i) => (i % 4) + 2);
  const planeswalkers = gen('Planeswalker', 'Planeswalker', 4, (i) => i + 3);
  const lands = Array.from({ length: 30 }, (_, i) => {
    const n = `Utility Land ${i + 1}`;
    add(n, 'Land', 0);
    return mkEC(n, 'Land', 70 - i);
  });
  const allNonLand = [
    ...creatures,
    ...instants,
    ...sorceries,
    ...artifacts,
    ...enchantments,
    ...planeswalkers,
  ];
  return {
    scMap,
    cardlists: {
      creatures,
      instants,
      sorceries,
      artifacts,
      enchantments,
      planeswalkers,
      lands,
      allNonLand,
    },
  };
}

const POOL = buildPool();

const STATS: EDHRECCommanderStats = {
  avgPrice: 100,
  numDecks: 5000,
  deckSize: 99,
  manaCurve: { 1: 8, 2: 14, 3: 14, 4: 10, 5: 7, 6: 5 },
  typeDistribution: {
    creature: 30,
    instant: 8,
    sorcery: 7,
    artifact: 8,
    enchantment: 6,
    land: 37,
    planeswalker: 2,
    battle: 0,
  },
  landDistribution: { basic: 12, nonbasic: 25, total: 37 },
};

function edhrecData(): EDHRECCommanderData {
  return {
    themes: [],
    stats: STATS,
    cardlists: POOL.cardlists,
    similarCommanders: [],
  };
}

const COMMANDER = mkSC('Test Commander', 'Legendary Creature — Elf', 4);
const FOREST = mkSC('Forest', 'Basic Land — Forest', 0);

// ---- Module mocks ---------------------------------------------------------

vi.mock('@/deck-builder/services/edhrec/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCommanderData: vi.fn(async () => edhrecData()),
  fetchCommanderThemeData: vi.fn(async () => edhrecData()),
  fetchPartnerCommanderData: vi.fn(async () => edhrecData()),
  fetchPartnerThemeData: vi.fn(async () => edhrecData()),
  fetchCommanderCombos: vi.fn(async () => []),
  fetchSaltIndex: vi.fn(async () => new Map()),
  fetchAverageDeckMultiCopies: vi.fn(async () => null),
  // Lift-picks phase (E71): no card-page data in this fixture universe, so
  // every seed lookup comes back empty — same as the real client's soft-fail.
  fetchCardLiftPool: vi.fn(async () => []),
}));

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => {
  const actual = await orig<typeof import('@/deck-builder/services/scryfall/client')>();
  return {
    ...actual,
    searchCards: vi.fn(async () => ({ data: [] })),
    getCardByName: vi.fn(async (name: string) => POOL.scMap.get(name) ?? FOREST),
    getCardsByNames: vi.fn(async (names: string[]) => {
      const m = new Map<string, ScryfallCard>();
      for (const n of names) {
        const c = POOL.scMap.get(n);
        if (c) m.set(n, c);
      }
      return m;
    }),
    prefetchBasicLands: vi.fn(async () => {}),
    getCachedCard: vi.fn((name: string) => (name === 'Forest' ? FOREST : undefined)),
    getGameChangerNames: vi.fn(async () => new Set<string>()),
    upgradeCardPrintings: vi.fn(async () => {}),
    fetchMultiCopyCardNames: vi.fn(async () => new Map()),
  };
});

vi.mock('@/deck-builder/services/tagger/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/tagger/client')>()),
  loadTaggerData: vi.fn(async () => {}),
  hasTaggerData: vi.fn(() => false),
  getCardRole: vi.fn(() => null),
  getCardSubtype: vi.fn(() => null),
  isTapland: vi.fn(() => false),
  // E87-new Slice A: isProtectionPiece is a pure oracle-text regex, NOT
  // routed through getCardRole — mocking getCardRole above has zero effect
  // on it, so it needs its own inert-by-default mock (this fixture universe's
  // cards all have oracle_text: '', which already reads false, but stubbing
  // it explicitly keeps goldens inert by construction rather than by luck).
  isProtectionPiece: vi.fn(() => false),
  // E89 (iter-7 Slice E): isUntapProducer is the same shape — a pure
  // oracle-text regex, not tag-routed — so it needs the same explicit
  // inert-by-construction stub (this fixture universe's oracle_text: ''
  // already reads false, but don't rely on that by luck).
  isUntapProducer: vi.fn(() => false),
}));

// Wraps the real generateLands so a single test can force it to underdeliver
// (simulating landGenerator.ts's basic-fetch-failure edge case) without
// touching every other test's land count.
vi.mock('./landGenerator', async (orig) => {
  const actual = await orig<typeof import('./landGenerator')>();
  return { ...actual, generateLands: vi.fn(actual.generateLands) };
});

// Wraps the real computeAutoLandCount (E88) so a single test can force the
// auto-tune to raise land count above the 37-land baseline (exercising the
// land-squeeze reconciliation pass) without touching every other test's
// land count — every other test's real archetype/ramp/CMC inputs still flow
// through the actual implementation via mockImplementation(actual...).
vi.mock('./targetCounts', async (orig) => {
  const actual = await orig<typeof import('./targetCounts')>();
  return { ...actual, computeAutoLandCount: vi.fn(actual.computeAutoLandCount) };
});

import { generateDeck, clearGenerationCache } from './deckGenerator';
import { searchCards, getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { fetchCommanderData, fetchCommanderCombos } from '@/deck-builder/services/edhrec/client';
import { generateLands } from './landGenerator';
import { computeAutoLandCount } from './targetCounts';
import { isProtectionPiece } from '@/deck-builder/services/tagger/client';

// ---- Customization factory (static, no localStorage) ----------------------

function customization(overrides: Partial<Customization> = {}): Customization {
  return {
    deckFormat: 99,
    landCount: 37,
    nonBasicLandCount: 25,
    bannedCards: [],
    banLists: [],
    mustIncludeCards: [],
    tempBannedCards: [],
    tempMustIncludeCards: [],
    maxCardPrice: null,
    deckBudget: null,
    budgetOption: 'any',
    gameChangerLimit: 'unlimited',
    targetBracket: 'all',
    maxRarity: null,
    tinyLeaders: false,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    collectionMode: false,
    collectionStrategy: 'full',
    collectionOwnedPercent: 75,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 1,
    hyperFocus: false,
    balancedRoles: true,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    advancedTargets: {
      curvePercentages: null,
      typePercentages: null,
      roleTargets: null,
      edhrecBlendWeight: null,
      edhrecInclusionThreshold: null,
    },
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    saltTolerance: 2,
    generationMode: 'edhrec',
    artThemeTag: '',
    historicalYear: 2005,
    permanentsOnly: false,
    ...overrides,
  };
}

const baseContext = () => ({
  commander: COMMANDER,
  partnerCommander: null,
  colorIdentity: ['G'],
  customization: customization(),
  selectedThemes: [],
});

// Stable projection of a deck for snapshotting / comparison.
function project(deck: Awaited<ReturnType<typeof generateDeck>>) {
  const cats: Record<string, string[]> = {};
  for (const [k, cards] of Object.entries(deck.categories)) {
    cats[k] = cards.map((c) => c.name).sort();
  }
  return {
    commander: deck.commander?.name ?? null,
    totalCards: deck.stats.totalCards,
    dataSource: deck.dataSource,
    categories: cats,
    typeDistribution: deck.stats.typeDistribution,
    manaCurve: deck.stats.manaCurve,
  };
}

beforeEach(() => {
  clearGenerationCache();
});

describe('generateDeck — golden master', () => {
  it('produces a stable deck for the base (no-theme) mono-G context', async () => {
    const deck = await generateDeck(baseContext());
    expect(project(deck)).toMatchSnapshot();
  });

  // E79 round 4: phaseBudgetConverge only runs (and only fetches the EDHREC
  // "budget" pool via ctx.fetchBudgetPool) when `deckBudget !== null`. The
  // golden fixture never sets a budget, so no extra network call should ever
  // fire — pins that the round-4 merge is fully inert on this path.
  it('never fetches an EDHREC budget pool when deckBudget is null', async () => {
    vi.mocked(fetchCommanderData).mockClear();
    await generateDeck(baseContext());
    const budgetCalls = vi
      .mocked(fetchCommanderData)
      .mock.calls.filter(([, budgetOption]) => budgetOption === 'budget');
    expect(budgetCalls).toHaveLength(0);
  });

  it('is deterministic across repeated runs (the decomposition guarantee)', async () => {
    const a = await generateDeck(baseContext());
    clearGenerationCache();
    const b = await generateDeck(baseContext());
    expect(project(b)).toEqual(project(a));
  });

  it('honors a forced must-include card', async () => {
    const ctx = baseContext();
    ctx.customization = customization({ mustIncludeCards: ['Creature_7'] });
    const deck = await generateDeck(ctx);
    const all = Object.values(deck.categories)
      .flat()
      .map((c) => c.name);
    expect(all).toContain('Creature_7');
  });

  it('snapshots a Tiny-Leaders (CMC<=3, 49-card) variant', async () => {
    const ctx = baseContext();
    ctx.customization = customization({ deckFormat: 99, tinyLeaders: true });
    const deck = await generateDeck(ctx);
    expect(project(deck)).toMatchSnapshot();
  });
});

describe('generateDeck — invariants', () => {
  it('keeps the commander out of the 99 and preserves it on the deck', async () => {
    const deck = await generateDeck(baseContext());
    expect(deck.commander?.name).toBe('Test Commander');
    const all = Object.values(deck.categories).flat();
    expect(all.every((c) => c.name !== 'Test Commander')).toBe(true);
  });

  it('every non-basic card respects the commander color identity', async () => {
    const deck = await generateDeck(baseContext());
    const offColor = Object.values(deck.categories)
      .flat()
      .filter((c) => c.name !== 'Forest')
      .filter((c) => (c.color_identity ?? []).some((x) => !['G'].includes(x)));
    expect(offColor.map((c) => c.name)).toEqual([]);
  });

  it('builds a full 99-card deck (98 + commander accounted in stats)', async () => {
    const deck = await generateDeck(baseContext());
    const total = Object.values(deck.categories).flat().length;
    expect(total).toBe(99);
  });
});

describe('generateDeck — land top-up ordering (Fix 1, iter-6 Slice B)', () => {
  it('tops up a land shortfall BEFORE the nonland fill, so lands still hit target instead of getting backfilled with spells', async () => {
    // Simulate generateLands() silently underdelivering (e.g. a basic-fetch
    // throw dropping a color's whole allocation) — 17 lands instead of the
    // requested 37. Gated on total count and running AFTER the nonland fill,
    // the old code would let the nonland fill close the total-count gap with
    // spells, permanently shorting the land count. Reordered + re-gated on
    // the land-specific deficit, the top-up runs first and restores it.
    vi.mocked(generateLands).mockImplementationOnce(async () =>
      Array.from({ length: 17 }, () => ({ ...FOREST }))
    );
    try {
      const deck = await generateDeck(baseContext());
      expect(deck.categories.lands.length).toBe(37); // land target still met
      const total = Object.values(deck.categories).flat().length;
      expect(total).toBe(99); // total deck size still met
    } finally {
      clearGenerationCache();
    }
  });
});

describe('generateDeck — Combo Integrity Audit color-identity gate (defect A1/A2, iter-6 Slice B follow-up)', () => {
  // A card the batch combo-card fetch resolves (so scryfallCardMap.has() is
  // true) but that's off the mono-G fixture's color identity — mirroring how
  // EDHREC's per-commander combo payload includes every combo's cards
  // regardless of legality, purely to detect near-misses.
  const OFF_COLOR: ScryfallCard = {
    ...mkSC('Off-Color Bomb', 'Enchantment', 5),
    colors: ['U'],
    color_identity: ['U'],
  };

  it('never adds a color-identity-illegal combo enabler, and discloses every combo-audit swap that DOES fire', async () => {
    // Two near-miss combos share the same off-color missing piece — each has
    // exactly 1 missing card (Creature_1 / Creature_2, both near-certain to
    // already be in the generated deck as top-inclusion creatures), so the
    // shared missing card qualifies as a "multi-combo enabler" (completes
    // 2+ combos) — the Phase-1 path that the Kozilek/Omniscience defect hit.
    vi.mocked(fetchCommanderCombos).mockResolvedValueOnce([
      {
        comboId: 'test-combo-a',
        cards: [
          { name: 'Creature_1', id: 'c1' },
          { name: 'Off-Color Bomb', id: 'ocb' },
        ],
        results: ['Test combo A result'],
        deckCount: 500,
        rank: 1,
        bracket: null,
        bracketTag: null,
        prereqCount: 0,
        cardCount: 2,
        href: null,
      },
      {
        comboId: 'test-combo-b',
        cards: [
          { name: 'Creature_2', id: 'c2' },
          { name: 'Off-Color Bomb', id: 'ocb' },
        ],
        results: ['Test combo B result'],
        deckCount: 400,
        rank: 2,
        bracket: null,
        bracketTag: null,
        prereqCount: 0,
        cardCount: 2,
        href: null,
      },
    ]);
    const mockedFetch = vi.mocked(getCardsByNames);
    const realFetch = mockedFetch.getMockImplementation()!;
    mockedFetch.mockImplementation(async (names: string[], ...rest) => {
      const m = await realFetch(names, ...rest);
      if (names.includes('Off-Color Bomb')) m.set('Off-Color Bomb', OFF_COLOR);
      return m;
    });
    try {
      // comboCount: 3 (max) drops the priority-boost's avgInclusion floor to
      // 0 (see comboInclusionFloor) — needed because that floor is checked
      // before state.edhrecData is populated on a fresh (uncached) run, so
      // at comboCount: 1/2 every combo scores avgInclusion=0 and never makes
      // it into the batch card-name fetch, regardless of this test's fixture.
      // detectCombosPhase (what the audit itself runs on) reads state.combos
      // directly and isn't affected by this floor either way.
      const ctx = baseContext();
      ctx.customization = customization({ comboCount: 3 });
      const deck = await generateDeck(ctx);
      const names = Object.values(deck.categories)
        .flat()
        .map((c) => c.name);
      // The illegal enabler never entered the deck...
      expect(names).not.toContain('Off-Color Bomb');
      // ...and nothing was evicted-then-stranded to make room for it: deck
      // size is exactly on target, same invariant every golden test checks.
      expect(names.length).toBe(99);
      // Every off-color candidate is entirely absent from disclosure too —
      // an audit that fires (real swaps for OTHER combos, if any) would
      // show up here, but never a swap that added the illegal card.
      const addedNames = (deck.coherenceRepairs ?? []).map((r) => r.added);
      expect(addedNames).not.toContain('Off-Color Bomb');
    } finally {
      mockedFetch.mockImplementation(realFetch);
      clearGenerationCache();
    }
  });

  it('discloses a legal combo-audit swap via coherenceRepairs instead of leaving it logger.debug-only', async () => {
    // Same shape as above, but the enabler is IN the mono-G fixture's
    // identity — this swap should actually fire and must be disclosed
    // (T37 ethos), unlike before this fix where combo-audit swaps were
    // silent (the Thran Dynamo -> Ornithopter of Paradise defect).
    vi.mocked(fetchCommanderCombos).mockResolvedValueOnce([
      {
        comboId: 'test-combo-c',
        cards: [
          { name: 'Creature_1', id: 'c1' },
          { name: 'On-Color Enabler', id: 'oce' },
        ],
        results: ['Test combo C result'],
        deckCount: 500,
        rank: 1,
        bracket: null,
        bracketTag: null,
        prereqCount: 0,
        cardCount: 2,
        href: null,
      },
      {
        comboId: 'test-combo-d',
        cards: [
          { name: 'Creature_2', id: 'c2' },
          { name: 'On-Color Enabler', id: 'oce' },
        ],
        results: ['Test combo D result'],
        deckCount: 400,
        rank: 2,
        bracket: null,
        bracketTag: null,
        prereqCount: 0,
        cardCount: 2,
        href: null,
      },
    ]);
    const ON_COLOR: ScryfallCard = mkSC('On-Color Enabler', 'Enchantment', 5); // color_identity ['G']
    const mockedFetch = vi.mocked(getCardsByNames);
    const realFetch = mockedFetch.getMockImplementation()!;
    mockedFetch.mockImplementation(async (names: string[], ...rest) => {
      const m = await realFetch(names, ...rest);
      if (names.includes('On-Color Enabler')) m.set('On-Color Enabler', ON_COLOR);
      return m;
    });
    try {
      const ctx = baseContext();
      // tinyLeaders caps normal picking at cmc<=3 (state.ts: maxCmc = 3) —
      // the enabler's cmc:5 is rejected there (exceedsCmcCap, unconditional,
      // no high-synergy bypass), so it can ONLY enter via the Combo
      // Integrity Audit, which doesn't gate on cmc. Without this, the
      // enabler's huge combo-priority boost gets it auto-picked during
      // normal Enchantment picking and the audit never needs to fire.
      ctx.customization = customization({ comboCount: 3, tinyLeaders: true });
      const deck = await generateDeck(ctx);
      const names = Object.values(deck.categories)
        .flat()
        .map((c) => c.name);
      expect(names).toContain('On-Color Enabler'); // the legal enabler DID get added
      const repair = (deck.coherenceRepairs ?? []).find((r) => r.added === 'On-Color Enabler');
      expect(repair).toBeDefined();
      expect(repair!.reason).toMatch(/completes 2 near-miss combos/);
    } finally {
      mockedFetch.mockImplementation(realFetch);
      clearGenerationCache();
    }
  });

  it('never evicts anything via auditWeakest when every candidate reads as a protection piece (E87-new Slice A)', async () => {
    // Same shape as the "discloses a legal combo-audit swap" case above, but
    // with isProtectionPiece forced true for every card — auditWeakest's skip
    // condition means it can never find an evictable candidate, so the
    // near-miss combo can't complete even though its enabler is legal and
    // resolvable. Proves the wiring (auditWeakest → isProtectionPiece) without
    // needing to know which specific card the real fill would pick as weakest.
    vi.mocked(fetchCommanderCombos).mockResolvedValueOnce([
      {
        comboId: 'test-combo-e',
        cards: [
          { name: 'Creature_1', id: 'c1' },
          { name: 'On-Color Enabler 2', id: 'oce2' },
        ],
        results: ['Test combo E result'],
        deckCount: 500,
        rank: 1,
        bracket: null,
        bracketTag: null,
        prereqCount: 0,
        cardCount: 2,
        href: null,
      },
      {
        comboId: 'test-combo-f',
        cards: [
          { name: 'Creature_2', id: 'c2' },
          { name: 'On-Color Enabler 2', id: 'oce2' },
        ],
        results: ['Test combo F result'],
        deckCount: 400,
        rank: 2,
        bracket: null,
        bracketTag: null,
        prereqCount: 0,
        cardCount: 2,
        href: null,
      },
    ]);
    const ON_COLOR2: ScryfallCard = mkSC('On-Color Enabler 2', 'Enchantment', 5); // color_identity ['G']
    const mockedFetch = vi.mocked(getCardsByNames);
    const realFetch = mockedFetch.getMockImplementation()!;
    mockedFetch.mockImplementation(async (names: string[], ...rest) => {
      const m = await realFetch(names, ...rest);
      if (names.includes('On-Color Enabler 2')) m.set('On-Color Enabler 2', ON_COLOR2);
      return m;
    });
    vi.mocked(isProtectionPiece).mockReturnValue(true);
    try {
      const ctx = baseContext();
      // tinyLeaders caps cmc<=3 so the enabler (cmc:5) can ONLY enter via the
      // audit, matching the "discloses a legal combo-audit swap" test above.
      ctx.customization = customization({ comboCount: 3, tinyLeaders: true });
      const deck = await generateDeck(ctx);
      const names = Object.values(deck.categories)
        .flat()
        .map((c) => c.name);
      expect(names).not.toContain('On-Color Enabler 2');
      const repair = (deck.coherenceRepairs ?? []).find((r) => r.added === 'On-Color Enabler 2');
      expect(repair).toBeUndefined();
    } finally {
      mockedFetch.mockImplementation(realFetch);
      vi.mocked(isProtectionPiece).mockReturnValue(false);
      clearGenerationCache();
    }
  });
});

describe('generateDeck — collection relaxation (T43 PR-3)', () => {
  it('fills an owned-only deck from the collection (no outside cards) when owned cards suffice', async () => {
    // Owned-only ('full') with a collection large enough to complete the deck.
    const ctx = baseContext();
    ctx.customization = customization({ collectionMode: true, collectionStrategy: 'full' });
    const ownedNames = [
      'Test Commander',
      ...Array.from({ length: 60 }, (_, i) => `Owned_${i + 1}`),
    ];
    (ctx as { collectionNames?: Set<string> }).collectionNames = new Set(ownedNames);

    // Scryfall returns OWNED cards — the owned-gated backfill (Tier 2) keeps them,
    // so the gap closes from the collection and the outside-reach tier never runs.
    const ownedCards = Array.from({ length: 60 }, (_, i) =>
      mkSC(`Owned_${i + 1}`, 'Creature', (i % 5) + 1)
    );
    const mocked = vi.mocked(searchCards);
    mocked.mockResolvedValue({ data: ownedCards } as unknown as Awaited<
      ReturnType<typeof searchCards>
    >);
    clearGenerationCache();
    try {
      const deck = await generateDeck(ctx);
      const names = Object.values(deck.categories)
        .flat()
        .map((c) => c.name);
      // Nothing was pulled from outside the collection…
      expect(deck.collectionRelaxedCount ?? 0).toBe(0);
      // …and the deck is built from the owned pool.
      expect(names.some((n) => n.startsWith('Owned_'))).toBe(true);
      expect(names.every((n) => n.startsWith('Owned_') || n === 'Forest')).toBe(true);
    } finally {
      mocked.mockResolvedValue({ data: [] } as unknown as Awaited<ReturnType<typeof searchCards>>);
      clearGenerationCache();
    }
  });

  it('pulls cards from OUTSIDE an exhausted owned-only collection before padding basics', async () => {
    // Owned-only ('full') with a tiny collection that cannot fill the deck.
    const ctx = baseContext();
    ctx.customization = customization({ collectionMode: true, collectionStrategy: 'full' });
    (ctx as { collectionNames?: Set<string> }).collectionNames = new Set([
      'Test Commander',
      'Creature_1',
      'Creature_2',
      'Instant_1',
      'Sorcery_1',
    ]);

    // Scryfall returns UNOWNED cards. The collection-gated fill steps skip them;
    // only the relaxation step ('prefer') keeps them.
    const relaxed = Array.from({ length: 16 }, (_, i) =>
      mkSC(`Relaxed_${i + 1}`, 'Creature', (i % 5) + 1)
    );
    const mocked = vi.mocked(searchCards);
    mocked.mockResolvedValue({ data: relaxed } as unknown as Awaited<
      ReturnType<typeof searchCards>
    >);
    clearGenerationCache();
    try {
      const deck = await generateDeck(ctx);
      const names = Object.values(deck.categories)
        .flat()
        .map((c) => c.name);
      // The deck is still complete, and the gap was filled with real unowned
      // cards (surfaced) rather than entirely with basic lands.
      expect(deck.collectionRelaxedCount ?? 0).toBeGreaterThan(0);
      expect(names).toContain('Relaxed_1');
    } finally {
      mocked.mockResolvedValue({ data: [] } as unknown as Awaited<ReturnType<typeof searchCards>>);
      clearGenerationCache();
    }
  });
});

describe('generateDeck — land-squeeze reconciliation (E88, iter-7 Slice B)', () => {
  it('reconciles a forced auto-tune land-count raise: correct deck size, note populated, a protected piece survives while low-inclusion filler is cut', async () => {
    // Force the auto-tune to raise land count to 39 (past the 37-land
    // baseline) regardless of this fixture's real archetype/CMC — the
    // mechanism under test is the RECONCILIATION, not archetype detection.
    // nonBasicLandCount must be the store default (15) for isDefaultLandCount
    // to gate the auto-tune branch on at all (this file's customization()
    // factory otherwise sets 25).
    vi.mocked(computeAutoLandCount).mockImplementationOnce(() => 39);
    // The single worst-scoring nonland pick (Creature_31, the tail of the
    // creature type pass) is seeded as a protection piece — it should survive
    // the squeeze even though it would otherwise be the first cut.
    vi.mocked(isProtectionPiece).mockImplementation((c) => c.name === 'Creature_31');

    const ctx = baseContext();
    ctx.customization = customization({ nonBasicLandCount: 15 });
    try {
      const deck = await generateDeck(ctx);
      const names = Object.values(deck.categories)
        .flat()
        .map((c) => c.name);

      // Deck still lands exactly on the 99-card target — the whole point of
      // reconciliation. (This fixture's absolute final land count also
      // reflects pre-existing, E88-unrelated land-generation rounding that
      // varies per scenario across this whole file — see the other golden
      // cases' snapshots — so this test doesn't assert an exact land number,
      // only the guarantees E88 itself makes.)
      expect(names.length).toBe(99);
      expect(deck.landSqueezeTrimNote).toBeDefined();
      expect(deck.landSqueezeTrimNote).toMatch(/^Auto-tuned land count to \d+/);
      // The protected piece survived...
      expect(names).toContain('Creature_31');
      // ...while the next-worst, unprotected filler was cut instead.
      expect(names).not.toContain('Creature_30');
    } finally {
      vi.mocked(isProtectionPiece).mockReturnValue(false);
      clearGenerationCache();
    }
  });

  it('is inert on the plain golden fixture (nonBasicLandCount default 25 never satisfies isDefaultLandCount)', async () => {
    const deck = await generateDeck(baseContext());
    expect(deck.landSqueezeTrimNote).toBeUndefined();
  });
});
