// E1002: a deck generated with an EDHREC theme picked reads the commander's base page for the
// Voltron veto. A theme page carries no themes, so the generator's profile used to be text-only
// and Gisela, Emrakul and the rest read as voltron (golden.md R11). Real Oracle text and real
// theme counts come from the vetoed-commanders fixture; the card pool is synthetic.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Customization,
  EDHRECCard,
  EDHRECCommanderData,
  ScryfallCard,
  ThemeResult,
} from '@/deck-builder/types';
import { VETOED_COMMANDERS, vetoedCard, vetoedPage } from './__fixtures__/vetoed-commanders';

const profiles: { name: string; themes: unknown; voltron: boolean }[] = [];
vi.mock('./commanderProfile', async (orig) => {
  const actual = await orig<typeof import('./commanderProfile')>();
  return {
    ...actual,
    buildCommanderProfile: (
      ...args: Parameters<typeof actual.buildCommanderProfile>
    ): ReturnType<typeof actual.buildCommanderProfile> => {
      const profile = actual.buildCommanderProfile(...args);
      profiles.push({
        name: args[0].name,
        themes: args[2]?.edhrecThemes,
        voltron: profile.abilities.some((a) => a.keyword === 'voltron'),
      });
      return profile;
    },
  };
});

const mk = (name: string, typeLine: string, cmc: number): ScryfallCard =>
  ({
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
  }) as unknown as ScryfallCard;
const SC = new Map<string, ScryfallCard>();
const ec = (name: string, type: string, inclusion: number): EDHRECCard => ({
  name,
  sanitized: name,
  primary_type: type,
  inclusion,
  num_decks: 1000,
});
const TYPES = ['Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Creature'] as const;
const spells = Array.from({ length: 120 }, (_, i) => {
  const type = TYPES[i % TYPES.length];
  const name = `Pool ${type} ${i + 1}`;
  SC.set(name, mk(name, type, (i % 5) + 1));
  return ec(name, type, 80 - i * 0.4);
});
const lands = Array.from({ length: 20 }, (_, i) => {
  const name = `Utility Land ${i + 1}`;
  SC.set(name, { ...mk(name, 'Land', 0), mana_cost: '', colors: [], color_identity: [] });
  return ec(name, 'Land', 70 - i);
});
function poolPage(): EDHRECCommanderData {
  const by = (t: string) => spells.filter((c) => c.primary_type === t);
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
      creatures: by('Creature'),
      instants: by('Instant'),
      sorceries: by('Sorcery'),
      artifacts: by('Artifact'),
      enchantments: by('Enchantment'),
      planeswalkers: [],
      lands: [...lands],
      allNonLand: [...spells],
    },
  } as EDHRECCommanderData;
}
const basic = (name: string) => ({ ...mk(name, `Basic Land — ${name}`, 0), color_identity: [] });

let baseAvailable = true;
const baseFetches = vi.fn();
vi.mock('@/deck-builder/services/edhrec/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/edhrec/client')>()),
  // The base page: the pool and the commander's real themes. A theme page: the pool, no themes.
  fetchCommanderData: vi.fn(async (name: string) => {
    baseFetches(name);
    if (!baseAvailable) throw new Error('offline');
    return { ...poolPage(), themes: vetoedPage(name).themes };
  }),
  fetchCommanderThemeData: vi.fn(async () => poolPage()),
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

const THEME: ThemeResult = { name: 'Angels', source: 'edhrec', slug: 'angels', isSelected: true };

const legal = (name: string): ScryfallCard => ({
  ...vetoedCard(name),
  legalities: { commander: 'legal' },
});

function context(commander: ScryfallCard, selectedThemes: ThemeResult[]) {
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
    collectionMode: false,
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
  return {
    commander,
    partnerCommander: null,
    colorIdentity: commander.color_identity,
    customization,
    selectedThemes,
  };
}

beforeEach(() => {
  clearGenerationCache();
  profiles.length = 0;
  baseFetches.mockClear();
  baseAvailable = true;
});

describe('generateDeck with a theme picked: the Voltron veto reads the base page', () => {
  it.each(VETOED_COMMANDERS)('%s is not described as voltron', async (name) => {
    await generateDeck(context(legal(name), [THEME]));
    expect(profiles[0].name).toBe(name);
    expect(profiles[0].voltron).toBe(false);
  });

  it('with no theme picked, the page already carries its themes and nothing extra is fetched', async () => {
    const name = VETOED_COMMANDERS[0];
    await generateDeck(context(legal(name), []));
    expect(profiles[0].voltron).toBe(false);
    expect(baseFetches).toHaveBeenCalledTimes(1);
  });

  it('falls back to the text reading, and still builds, when the base page is unavailable', async () => {
    const name = VETOED_COMMANDERS[0];
    baseAvailable = false;
    const deck = await generateDeck(context(legal(name), [THEME]));
    expect(profiles[0].themes).toBeUndefined();
    expect(profiles[0].voltron).toBe(true);
    expect(Object.values(deck.categories).flat().length).toBeGreaterThan(0);
  });
});
