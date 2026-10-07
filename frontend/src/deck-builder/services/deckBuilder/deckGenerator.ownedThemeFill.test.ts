// E576: an owned-only build seats every owned card on the commander's page
// before any owned card from outside it. The user's Rin and Seri Cats+Dogs
// build ('available') seated Welcoming Vampire and Lightning Bolt, on no Rin
// and Seri page, while their Bolt Hound (Dogs page, 20%) sat out: the shortage
// fill fetched only the top shortage × 3 page rows, all unowned, and never saw
// the owned ones further down. The page is a synthetic universe shaped like
// that case (many unowned rows above the owned leftovers); the commander, Bolt
// Hound and the two off-page cards are REAL Scryfall cards.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Customization,
  EDHRECCard,
  EDHRECCommanderData,
  ScryfallCard,
} from '@/deck-builder/types';
import type { SubstituteCandidate } from './substituteFinder';
import fixture from './__fixtures__/owned-theme-fill.fixture.json';

const REAL = new Map<string, ScryfallCard>(
  fixture.cards.map((raw) => [
    raw.name,
    { ...(raw as unknown as ScryfallCard), id: `id-${raw.name}`, set_name: 'Test Set' },
  ])
);
const RIN_AND_SERI = REAL.get('Rin and Seri, Inseparable')!;

function mkSC(name: string, typeLine: string, cmc: number, edhrecRank?: number): ScryfallCard {
  return {
    id: `id-${name}`,
    oracle_id: `oracle-${name}`,
    name,
    mana_cost: `{${cmc}}{W}`,
    cmc,
    type_line: typeLine,
    oracle_text: '',
    colors: ['W'],
    color_identity: ['W'],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    prices: { usd: '0.50' },
    legalities: { commander: 'legal' },
    ...(edhrecRank != null ? { edhrec_rank: edhrecRank } : {}),
  };
}

const SC = new Map<string, ScryfallCard>(REAL);
const ec = (name: string, type: string, inclusion: number): EDHRECCard => ({
  name,
  sanitized: name,
  primary_type: type,
  inclusion,
  num_decks: 1000,
});

// 300 unowned page rows, 95% down to 50%: far more than any fetch window.
const TYPES = ['Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Creature'] as const;
const unowned = Array.from({ length: 300 }, (_, i) => {
  const type = TYPES[i % TYPES.length];
  const name = `Unowned ${type} ${i + 1}`;
  SC.set(name, mkSC(name, type, (i % 5) + 1));
  return ec(name, type, 95 - i * 0.15);
});
// 40 owned page creatures, 45% down to 25.5%, then the owned Bolt Hound at 20%.
const ownedOnPage = Array.from({ length: 40 }, (_, i) => {
  const name = `Owned Cat ${i + 1}`;
  SC.set(name, mkSC(name, 'Creature — Cat', (i % 5) + 1));
  return ec(name, 'Creature', 45 - i * 0.5);
});
const boltHound = ec('Bolt Hound', 'Creature', 19.7);
// The collection names Ajani in full; the Cats page names its front face (47.6%).
const AJANI = 'Ajani, Nacatl Pariah // Ajani, Nacatl Avenger';
const ajani = ec('Ajani, Nacatl Pariah', 'Creature', 47.6);
SC.set(ajani.name, REAL.get(AJANI)!);
// An owned Game Changer on the page, below the fetch window like Bolt Hound.
const manaVault = ec('Mana Vault', 'Artifact', 19.5);
// Owned cards on no page for this commander, ranked well across Commander.
const OFF_PAGE = [
  'Welcoming Vampire',
  'Lightning Bolt',
  ...Array.from({ length: 40 }, (_, i) => {
    const name = `Off-page Card ${i + 1}`;
    SC.set(name, mkSC(name, 'Creature — Human', (i % 5) + 1, 500 + i));
    return name;
  }),
];
const lands = Array.from({ length: 20 }, (_, i) => {
  const name = `Utility Land ${i + 1}`;
  SC.set(name, { ...mkSC(name, 'Land', 0), mana_cost: '', colors: [], color_identity: [] });
  return ec(name, 'Land', 70 - i);
});

const byType = (t: string) =>
  [...unowned, ajani, ...ownedOnPage, boltHound, manaVault].filter((c) => c.primary_type === t);

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
      creatures: byType('Creature'),
      instants: byType('Instant'),
      sorceries: byType('Sorcery'),
      artifacts: byType('Artifact'),
      enchantments: byType('Enchantment'),
      planeswalkers: [],
      lands: [...lands],
      allNonLand: [...unowned, ajani, ...ownedOnPage, boltHound, manaVault],
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
  return {
    ...actual,
    searchCards: vi.fn(async () => ({ data: [] })),
    getCardByName: vi.fn(async (name: string) => SC.get(name) ?? basic(name)),
    getCardsByNames: vi.fn(async (names: string[]) => {
      const m = new Map<string, ScryfallCard>();
      for (const n of names) {
        const c = SC.get(n);
        if (c) m.set(n, c);
      }
      return m;
    }),
    getCardsByIds: vi.fn(async () => new Map()),
    prefetchBasicLands: vi.fn(async () => {}),
    getCachedCard: vi.fn((name: string) =>
      ['Plains', 'Mountain', 'Forest'].includes(name) ? basic(name) : undefined
    ),
    getGameChangerNames: vi.fn(async () => new Set<string>(['Mana Vault'])),
    upgradeCardPrintings: vi.fn(async () => {}),
    fetchMultiCopyCardNames: vi.fn(async () => new Map()),
  };
});

vi.mock('@/deck-builder/services/tagger/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/tagger/client')>()),
  loadTaggerData: vi.fn(async () => {}),
  hasTaggerData: vi.fn(() => false),
  // Welcoming Vampire stood in for an unowned card-draw staple (Spirited
  // Companion, 71%) in the user's report; Unowned Creature 5 plays that staple.
  getCardRole: vi.fn((name: string) =>
    name === 'Welcoming Vampire' || name === 'Unowned Creature 5' ? 'cardDraw' : null
  ),
  getCardSubtype: vi.fn(() => null),
  isTapland: vi.fn(() => false),
}));

import { generateDeck, clearGenerationCache } from './deckGenerator';

const OWNED = [AJANI, ...ownedOnPage.map((c) => c.name), 'Bolt Hound', 'Mana Vault', ...OFF_PAGE];

function context(
  strategy: 'full' | 'available',
  targetBracket: number | 'all' = 'all',
  owned: string[] = OWNED
) {
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
    collectionStrategy: strategy,
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
    const c = SC.get(name)!;
    return { name, colorIdentity: c.color_identity, cmc: c.cmc, typeLine: c.type_line };
  });
  return {
    commander: RIN_AND_SERI,
    partnerCommander: null,
    colorIdentity: ['R', 'G', 'W'],
    customization,
    selectedThemes: [],
    collectionNames: new Set(owned),
    collectionPool: pool,
  };
}

beforeEach(() => clearGenerationCache());

describe('generateDeck: an owned-only build seats owned page cards before off-page ones', () => {
  it.each(['available', 'full'] as const)(
    '%s: Bolt Hound and every other owned page card seat before Welcoming Vampire',
    async (strategy) => {
      const deck = await generateDeck(context(strategy));
      const cards = Object.values(deck.categories).flat();
      expect(cards).toHaveLength(99);
      const all = new Set(cards.map((c) => c.name));
      expect(all).toContain('Bolt Hound');
      expect(all).toContain(AJANI);
      // An off-page card fills only what no owned page card can: every owned
      // page card is in before any off-page one.
      expect(ownedOnPage.filter((c) => !all.has(c.name)).map((c) => c.name)).toEqual([]);
      // No unowned card in an owned-only build.
      expect([...all].filter((n) => n.startsWith('Unowned'))).toEqual([]);
    }
  );

  // The shortage fill applies the bracket and Game Changer ceilings: once it
  // reached owned rows, a bracket-2 Atraxa build seated Mana Vault. With no
  // owned card to swap in, bracket convergence couldn't take it back out.
  it('a bracket-2 build leaves an owned Game Changer out', async () => {
    const names = (deck: Awaited<ReturnType<typeof generateDeck>>) =>
      new Set(
        Object.values(deck.categories)
          .flat()
          .map((c) => c.name)
      );
    const pageOnly = OWNED.filter((n) => !OFF_PAGE.includes(n));
    expect(names(await generateDeck(context('full', 'all', pageOnly)))).toContain('Mana Vault');
    clearGenerationCache();
    const bracket2 = names(await generateDeck(context('full', 2, pageOnly)));
    expect(bracket2).not.toContain('Mana Vault');
    expect(bracket2).toContain('Bolt Hound');
  });
});
