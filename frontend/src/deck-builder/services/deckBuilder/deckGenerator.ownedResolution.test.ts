// An owned card reaches the deck as the card the collection names, never a
// look-alike (E509 salvage). The EDHREC page is a small synthetic universe
// (the golden harness's shape); the owned card and its impostor are REAL
// Scryfall cards (owned-resolution.fixture.json).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Customization,
  EDHRECCard,
  EDHRECCommanderData,
  ScryfallCard,
} from '@/deck-builder/types';
import type { SubstituteCandidate } from './substituteFinder';
import fixture from './__fixtures__/owned-resolution.fixture.json';

const REAL = new Map<string, ScryfallCard>(
  fixture.cards.map((raw) => {
    const c = raw as unknown as Partial<ScryfallCard>;
    return [
      raw.name,
      {
        ...c,
        id: `id-${raw.name}`,
        set: c.set ?? 'tst',
        set_name: 'Test Set',
        prices: c.prices ?? { usd: '1.00' },
      } as ScryfallCard,
    ];
  })
);
const TALRAND = REAL.get('Talrand, Sky Summoner')!;
const IMPOSTOR = REAL.get('Harmonized Trio // Brainstorm')!;

function mkSC(name: string, typeLine: string, cmc: number): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    mana_cost: cmc > 0 ? `{${cmc}}{U}` : '',
    cmc,
    type_line: typeLine,
    oracle_text: '',
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test Set',
    prices: { usd: '1.00' },
    legalities: { commander: 'legal' },
  };
}

function buildPool() {
  const scMap = new Map<string, ScryfallCard>();
  const ec = (name: string, type: string, inclusion: number): EDHRECCard => ({
    name,
    sanitized: name,
    primary_type: type,
    inclusion,
    num_decks: 1000,
  });
  const gen = (prefix: string, type: string, count: number, cmcOf: (i: number) => number) =>
    Array.from({ length: count }, (_, i) => {
      const name = `${prefix}_${i + 1}`;
      scMap.set(name, mkSC(name, type, cmcOf(i)));
      return ec(name, prefix, 90 - i);
    });
  const creatures = gen('Creature', 'Creature', 40, (i) => (i % 6) + 1);
  const instants = gen('Instant', 'Instant', 15, (i) => (i % 4) + 1);
  const sorceries = gen('Sorcery', 'Sorcery', 15, (i) => (i % 4) + 2);
  const artifacts = gen('Artifact', 'Artifact', 15, (i) => (i % 3) + 1);
  const enchantments = gen('Enchantment', 'Enchantment', 15, (i) => (i % 4) + 2);
  const lands = Array.from({ length: 20 }, (_, i) => {
    const name = `Utility Land ${i + 1}`;
    scMap.set(name, mkSC(name, 'Land', 0));
    return ec(name, 'Land', 70 - i);
  });
  return {
    scMap,
    cardlists: {
      creatures,
      instants,
      sorceries,
      artifacts,
      enchantments,
      planeswalkers: [],
      lands,
      allNonLand: [...creatures, ...instants, ...sorceries, ...artifacts, ...enchantments],
    },
  };
}
const POOL = buildPool();

function page(): EDHRECCommanderData {
  return {
    themes: [],
    similarCommanders: [],
    stats: {
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
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 25, nonbasic: 12, total: 37 },
    },
    cardlists: {
      creatures: [...POOL.cardlists.creatures],
      instants: [...POOL.cardlists.instants],
      sorceries: [...POOL.cardlists.sorceries],
      artifacts: [...POOL.cardlists.artifacts],
      enchantments: [...POOL.cardlists.enchantments],
      planeswalkers: [],
      lands: [...POOL.cardlists.lands],
      allNonLand: [...POOL.cardlists.allNonLand],
    },
  } as EDHRECCommanderData;
}

const basic = (name: string) => ({ ...mkSC(name, `Basic Land — ${name}`, 0), color_identity: [] });

vi.mock('@/deck-builder/services/edhrec/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/edhrec/client')>()),
  fetchCommanderData: vi.fn(async () => page()),
  fetchCommanderThemeData: vi.fn(async () => page()),
  fetchPartnerCommanderData: vi.fn(async () => page()),
  fetchPartnerThemeData: vi.fn(async () => page()),
  fetchCommanderCombos: vi.fn(async () => []),
  fetchCommanderCombosRaw: vi.fn(async () => []),
  fetchSaltIndex: vi.fn(async () => new Map()),
  fetchAverageDeckMultiCopies: vi.fn(async () => null),
  fetchCardLiftPool: vi.fn(async () => []),
}));

// Scryfall's name search can answer "Brainstorm" with Harmonized Trio //
// Brainstorm, whose back face carries the name (#2157).
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => {
  const actual = await orig<typeof import('@/deck-builder/services/scryfall/client')>();
  const lookup = (name: string) =>
    name === 'Brainstorm' ? IMPOSTOR : (POOL.scMap.get(name) ?? REAL.get(name));
  return {
    ...actual,
    searchCards: vi.fn(async () => ({ data: [] })),
    getCardByName: vi.fn(async (name: string) => lookup(name) ?? basic(name)),
    getCardsByNames: vi.fn(async (names: string[]) => {
      const m = new Map<string, ScryfallCard>();
      for (const n of names) {
        const c = lookup(n);
        if (c) m.set(n, c);
      }
      return m;
    }),
    getCardsByIds: vi.fn(async () => new Map()),
    prefetchBasicLands: vi.fn(async () => {}),
    getCachedCard: vi.fn((name: string) => (['Island'].includes(name) ? basic(name) : undefined)),
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

function context(strategy: Customization['collectionStrategy'], owned: string[]) {
  const customization = {
    deckFormat: 99,
    landCount: 37,
    nonBasicLandCount: 12,
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
    collectionMode: true,
    collectionStrategy: strategy,
    collectionOwnedPercent: 50,
    arenaOnly: false,
    scryfallQuery: '',
    comboCount: 0,
    balancedRoles: true,
    currency: 'USD',
    appliedExcludeLists: [],
    appliedIncludeLists: [],
    tempoAutoDetect: true,
    tempoPacing: 'balanced',
    saltTolerance: 2,
    generationMode: 'edhrec',
    artThemeTag: '',
    historicalYear: 2005,
    permanentsOnly: false,
    brewLevel: 0.5,
  } as unknown as Customization;
  const pool: SubstituteCandidate[] = owned.map((name) => {
    const c = REAL.get(name)!;
    return { name, colorIdentity: c.color_identity, cmc: c.cmc, typeLine: c.type_line };
  });
  return {
    commander: TALRAND,
    partnerCommander: null,
    colorIdentity: ['U'],
    customization,
    selectedThemes: [],
    collectionNames: new Set(owned),
    collectionPool: pool,
  };
}

const names = (deck: Awaited<ReturnType<typeof generateDeck>>) =>
  Object.values(deck.categories)
    .flat()
    .map((c) => c.name);

beforeEach(() => clearGenerationCache());

describe('generateDeck: owned cards resolve to the card the collection names', () => {
  it('"Owned share" never seats a look-alike for an owned Brainstorm', async () => {
    const deck = await generateDeck(context('partial', ['Brainstorm']));
    const all = names(deck);
    // Harmonized Trio // Brainstorm is a different card the player doesn't
    // own. Seated as "owned", a later coherence repair happened to cut it
    // again; it must never enter at all.
    expect(all).not.toContain('Harmonized Trio // Brainstorm');
    const touched = (deck.coherenceRepairs ?? []).flatMap((r) => [r.cut, r.added]);
    expect(touched).not.toContain('Harmonized Trio // Brainstorm');
    expect(all).toHaveLength(99);
  });
});
