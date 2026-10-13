// E1003: the player's filters (owned-only, price cap) ran AFTER the candidate
// cut. addPoolNames kept ~3x each type's target from the top of EDHREC's page
// before the owned filter, so owned cards past it were never fetched; the
// shortage fill sliced shortage x 3 rows before the price gate, so under a tight
// cap the whole window failed it and the cheap cards past it were never seen.
// Creatures are the recorded owned-collection fixture's real cards.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Customization,
  EDHRECCard,
  EDHRECCommanderData,
  ScryfallCard,
} from '@/deck-builder/types';
import type { SubstituteCandidate } from './substituteFinder';
import ownedFixture from './__fixtures__/owned-collection.fixture.json';
import resolutionFixture from './__fixtures__/owned-resolution.fixture.json';

const ENTRIES = (ownedFixture.pool as SubstituteCandidate[]).filter((e) =>
  e.typeLine?.includes('Creature')
);
const EXPENSIVE_UNTIL = 400; // creatures ranked above this index cost $40, the rest $0.25
const priceOf = (rank: number) => (rank < EXPENSIVE_UNTIL ? '40.00' : '0.25');

const SC = new Map<string, ScryfallCard>(
  ENTRIES.map((e, rank) => [
    e.name,
    {
      id: `id-${e.name}`,
      oracle_id: `oracle-${e.name}`,
      name: e.name,
      mana_cost: '{2}',
      cmc: e.cmc ?? 2,
      type_line: e.typeLine!,
      oracle_text: '',
      colors: e.colorIdentity,
      color_identity: e.colorIdentity,
      keywords: [],
      rarity: 'common',
      set: 'tst',
      set_name: 'Test Set',
      prices: { usd: priceOf(rank) },
      legalities: { commander: 'legal' },
    } as ScryfallCard,
  ])
);
const ec = (name: string, type: string, inclusion: number): EDHRECCard => ({
  name,
  sanitized: name,
  primary_type: type,
  inclusion,
  num_decks: 1000,
});
const CREATURES = ENTRIES.map((e, i) => ec(e.name, 'Creature', Math.max(2, 95 - i * 0.2)));
const LANDS = Array.from({ length: 20 }, (_, i) => {
  const name = `Utility Land ${i + 1}`;
  SC.set(name, {
    ...SC.get(ENTRIES[0].name)!,
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    type_line: 'Land',
    cmc: 0,
    mana_cost: '',
    color_identity: [],
    colors: [],
    prices: { usd: '0.10' },
  });
  return ec(name, 'Land', 70 - i);
});

let creatureTypeShare = 30;
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
        creature: creatureTypeShare,
        instant: 0,
        sorcery: 0,
        artifact: 0,
        enchantment: 0,
        land: 37,
        planeswalker: 0,
        battle: 0,
      },
      landDistribution: { basic: 25, nonbasic: 12, total: 37 },
    },
    cardlists: {
      creatures: [...CREATURES],
      instants: [],
      sorceries: [],
      artifacts: [],
      enchantments: [],
      planeswalkers: [],
      lands: [...LANDS],
      allNonLand: [...CREATURES],
    },
  } as EDHRECCommanderData;
}

const basic = (name: string): ScryfallCard => ({
  ...SC.get(ENTRIES[0].name)!,
  id: `id-${name}`,
  oracle_id: `oracle-${name}`,
  name,
  type_line: `Basic Land — ${name}`,
  cmc: 0,
  mana_cost: '',
  color_identity: [],
  colors: [],
  prices: { usd: '0.05' },
});

const fetchedBatches: string[][] = [];

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

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => {
  const actual = await orig<typeof import('@/deck-builder/services/scryfall/client')>();
  return {
    ...actual,
    searchCards: vi.fn(async () => ({ data: [] })),
    getCardByName: vi.fn(async (name: string) => SC.get(name) ?? basic(name)),
    getCardsByNames: vi.fn(async (names: string[]) => {
      fetchedBatches.push(names);
      const m = new Map<string, ScryfallCard>();
      for (const n of names) {
        const c = SC.get(n);
        if (c) m.set(n, c);
      }
      return m;
    }),
    getCardsByIds: vi.fn(async () => new Map()),
    prefetchBasicLands: vi.fn(async () => {}),
    getCachedCard: vi.fn((name: string) => (name === 'Island' ? basic(name) : undefined)),
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
  cardMatchesRole: vi.fn(() => false),
  getCardSubtype: vi.fn(() => null),
  isTapland: vi.fn(() => false),
}));

import { generateDeck, clearGenerationCache } from './deckGenerator';

const COMMANDER = (resolutionFixture.cards as unknown as ScryfallCard[]).find(
  (c) => c.name === 'Talrand, Sky Summoner'
)!;

function context(owned: string[] | null, overrides: Partial<Customization> = {}) {
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
    collectionMode: owned !== null,
    collectionStrategy: owned ? 'full' : 'prefer',
    collectionOwnedPercent: 100,
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
    ...overrides,
  } as unknown as Customization;
  return {
    commander: COMMANDER,
    partnerCommander: null,
    // Five colors so all 520 creatures fit the identity.
    colorIdentity: ['W', 'U', 'B', 'R', 'G'],
    customization,
    selectedThemes: [],
    ...(owned
      ? {
          collectionNames: new Set(owned),
          collectionPool: owned.map((name) => ({ ...ENTRIES.find((x) => x.name === name)! })),
        }
      : {}),
  };
}

beforeEach(() => {
  clearGenerationCache();
  fetchedBatches.length = 0;
  creatureTypeShare = 30;
});

describe('E1003: filters run before the candidate cut', () => {
  it('owned-only: the type batch fetch holds the owned creatures ranked past the 3x cut', async () => {
    creatureTypeShare = 10; // cut = max(10 * 3 + 15, 35) = 45 rows from the top of the page
    const owned = ENTRIES.slice(-20).map((e) => e.name);
    await generateDeck(context(owned));
    // Whole-pool evidence fetches (roleTargets) run first; the type batch is the small one.
    const typeBatch = fetchedBatches.find(
      (b) => b.length < 300 && b.some((n) => SC.get(n)?.type_line.includes('Creature'))
    );
    expect(typeBatch).toBeDefined();
    expect(owned.every((n) => typeBatch!.includes(n))).toBe(true);
    // Nothing unowned took a place in the cut.
    expect(typeBatch!.filter((n) => SC.get(n)?.type_line.includes('Creature'))).toHaveLength(20);
  });

  it('a $1 price cap: the shortage fill walks past the window the cap wipes out', async () => {
    const deck = await generateDeck(context(null, { maxCardPrice: 1 }));
    const creatures = Object.values(deck.categories)
      .flat()
      .filter((c) => c.type_line.includes('Creature'));
    // The top 400 rows cost $40; every seated creature is one of the cheap rows past them.
    expect(creatures.length).toBeGreaterThanOrEqual(20);
    for (const c of creatures) expect(Number(c.prices?.usd)).toBeLessThanOrEqual(1);
  });
});
