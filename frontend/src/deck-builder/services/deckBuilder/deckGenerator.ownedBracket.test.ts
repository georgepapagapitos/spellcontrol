// An owned-only build honors the target bracket's ceilings on every seating
// path (E565). The owned-substitute tier ("Wanted X, used your Y") seated a
// REAL Mana Vault and Mox Diamond, both Game Changers, into a bracket-2 deck:
// it was the one fill that never went through the pick-time gates.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Customization,
  EDHRECCard,
  EDHRECCommanderData,
  ScryfallCard,
} from '@/deck-builder/types';
import type { SubstituteCandidate } from './substituteFinder';
import fixture from './__fixtures__/owned-resolution.fixture.json';
import bracketFixture from './__fixtures__/owned-bracket.fixture.json';

const REAL = new Map<string, ScryfallCard>(
  [...fixture.cards, ...bracketFixture.cards].map((raw) => {
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
const GAME_CHANGERS = new Set(['Mana Vault', 'Mox Diamond']);

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
      return ec(name, prefix, Math.max(5, 90 - 2 * i));
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

vi.mock('@/deck-builder/services/scryfall/client', async (orig) => {
  const actual = await orig<typeof import('@/deck-builder/services/scryfall/client')>();
  const lookup = (name: string) => POOL.scMap.get(name) ?? REAL.get(name);
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
    getGameChangerNames: vi.fn(async () => GAME_CHANGERS),
    upgradeCardPrintings: vi.fn(async () => {}),
    fetchMultiCopyCardNames: vi.fn(async () => new Map()),
  };
});

vi.mock('@/deck-builder/services/tagger/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/tagger/client')>()),
  loadTaggerData: vi.fn(async () => {}),
  hasTaggerData: vi.fn(() => false),
  // The synthetic Artifact_* staples are ramp the collection doesn't own; the
  // two real owned rocks are the only cards that can stand in for them.
  getCardRole: vi.fn((name: string) => (name.startsWith('Artifact_') ? 'ramp' : null)),
  cardMatchesRole: vi.fn(
    (name: string, role: string) => role === 'ramp' && GAME_CHANGERS.has(name)
  ),
  getCardSubtype: vi.fn(() => null),
  isTapland: vi.fn(() => false),
}));

import { generateDeck, clearGenerationCache } from './deckGenerator';

function context(owned: string[], targetBracket: Customization['targetBracket']) {
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
    targetBracket,
    maxRarity: null,
    tinyLeaders: false,
    ignoreOwnedBudget: false,
    ignoreOwnedRarity: false,
    collectionMode: true,
    collectionStrategy: 'full',
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

describe('generateDeck: owned-only fills honor the target bracket', () => {
  it('bracket 2 never seats an owned Mana Vault or Mox Diamond as a substitute', async () => {
    const deck = await generateDeck(context(['Mana Vault', 'Mox Diamond'], 2));
    const all = names(deck);
    expect(all).not.toContain('Mana Vault');
    expect(all).not.toContain('Mox Diamond');
    expect(all).toHaveLength(99);
  });

  it('with no bracket target the same collection still seats them (the gate is the bracket)', async () => {
    const deck = await generateDeck(context(['Mana Vault', 'Mox Diamond'], 'all'));
    const all = names(deck);
    expect(all).toContain('Mana Vault');
    expect(all).toContain('Mox Diamond');
  });
});
