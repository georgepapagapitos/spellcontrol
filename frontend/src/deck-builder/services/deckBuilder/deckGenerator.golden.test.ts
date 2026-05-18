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
}));

import { generateDeck, clearGenerationCache } from './deckGenerator';

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
    bracketLevel: 'all',
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
