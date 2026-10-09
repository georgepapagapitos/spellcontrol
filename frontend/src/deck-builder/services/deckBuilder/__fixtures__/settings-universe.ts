// The offline fixture universe the settings matrix
// (deckGenerator.settings.test-matrix.ts) builds decks from: a mono-green commander,
// an EDHREC page of generated cards with deterministic rarity, price, Arena
// and PDH legality, and the real cards (pinned Scryfall fixtures) the E524
// case seats on that page. Types only from the app, so a test's vi.mock
// factories can read it without importing a mocked module.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ScryfallCard,
  EDHRECCard,
  EDHRECCommanderData,
  EDHRECCommanderStats,
  Customization,
} from '@/deck-builder/types';
import type { GenerationContext } from '../deckGeneration/state';

// ---- Fixture universe -----------------------------------------------------

interface Enrich {
  rarity: string;
  usd: string | null;
  games: string[];
  legalities: { commander: string; paupercommander: string; brawl: string };
}

// Deterministic per-index rarity/price/arena/PDH-legality so settings have real, varied material to filter against.
export function enrich(i: number): Enrich {
  const rarity = (['common', 'uncommon', 'rare', 'mythic'] as const)[i % 4];
  const priceByRarity: Record<string, number> = {
    common: 0.1 + (i % 6) * 0.3,
    uncommon: 1 + (i % 6) * 0.5,
    rare: 4 + (i % 6) * 1.5,
    mythic: 20 + (i % 6) * 6,
  };
  const usd = i % 11 === 0 ? null : priceByRarity[rarity].toFixed(2);
  const games = i % 5 === 0 ? ['paper'] : ['paper', 'arena'];
  // Scryfall stamps paupercommander at ORACLE level ("ever printed at
  // common") — model that as common/uncommon being PDH-legal, same rule
  // deckFilters.ts's notPauperCommanderLegal relies on.
  const paupercommander = rarity === 'common' || rarity === 'uncommon' ? 'legal' : 'not_legal';
  // Brawl is Standard-only, so it is independent of rarity. The generated
  // cards are not real printings; model a mostly-legal pool with a quarter
  // that fail the gate, so the brawl case seats from a legal pool and still
  // has illegal cards to refuse. The real pinned cards below keep their
  // true Scryfall brawl values.
  const brawl = i % 4 === 3 ? 'not_legal' : 'legal';
  return { rarity, usd, games, legalities: { commander: 'legal', paupercommander, brawl } };
}

export function mkSC(name: string, typeLine: string, cmc: number, i = 0): ScryfallCard {
  const e = enrich(i);
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
    rarity: e.rarity,
    set: 'tst',
    set_name: 'Test Set',
    games: e.games,
    prices: { usd: e.usd },
    legalities: e.legalities,
  };
}

export function mkEC(name: string, primaryType: string, inclusion: number): EDHRECCard {
  return { name, sanitized: name, primary_type: primaryType, inclusion, num_decks: 1000 };
}

export function buildPool() {
  const scMap = new Map<string, ScryfallCard>();
  const add = (n: string, t: string, c: number, i: number) => {
    scMap.set(n, mkSC(n, t, c, i));
    return n;
  };
  const gen = (prefix: string, type: string, count: number, cmcOf: (i: number) => number) =>
    Array.from({ length: count }, (_, i) => {
      const n = `${prefix}_${i + 1}`;
      add(n, type, cmcOf(i), i);
      return mkEC(n, prefix, 90 - i);
    });

  const creatures = gen('Creature', 'Creature', 40, (i) => (i % 7) + 1); // reaches cmc 7 for high-CMC coverage
  const instants = gen('Instant', 'Instant', 15, (i) => (i % 4) + 1);
  const sorceries = gen('Sorcery', 'Sorcery', 15, (i) => (i % 4) + 2);
  const artifacts = gen('Artifact', 'Artifact', 15, (i) => (i % 3) + 1);
  const enchantments = gen('Enchantment', 'Enchantment', 15, (i) => (i % 4) + 2);
  const planeswalkers = gen('Planeswalker', 'Planeswalker', 4, (i) => i + 3);
  const lands = Array.from({ length: 30 }, (_, i) => {
    const n = `Utility Land ${i + 1}`;
    add(n, 'Land', 0, i);
    return mkEC(n, 'Land', 70 - i);
  });

  // Legality-in-name-only card the EDHREC mock still recommends — probes
  // whether the generator independently rechecks commander legality.
  scMap.get('Creature_2')!.legalities.commander = 'banned';

  // Off-color card, reachable ONLY via mustIncludeCards (never EDHREC-recommended for mono-G).
  scMap.set('Offcolor Bolt', {
    ...mkSC('Offcolor Bolt', 'Instant', 1, 0),
    colors: ['U'],
    color_identity: ['U'],
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

export const POOL = buildPool();
export const onColor = (c: ScryfallCard) => c.color_identity.every((ci) => ci === 'G');
// PDH-legal on-color pool for the alt-generator sourcing path (buildOraclePool);
// the searchCards mock returns raw arrays regardless of query, so it must
// pre-filter color identity itself (real Scryfall search does this server-side).
export const PDH_POOL = [...POOL.scMap.values()].filter(
  (c) => c.legalities.paupercommander === 'legal' && onColor(c)
);
// On-color non-instant/sorcery pool for the oracle-role permanents-only facets.
export const PERMANENT_POOL = [...POOL.scMap.values()].filter(
  (c) => !/instant|sorcery/i.test(c.type_line) && !c.type_line.includes('Land') && onColor(c)
);
// High-inclusion, on-color, legal cards — near-certain top picks, so forcing
// them into getGameChangerNames gives the bracket/GC ceilings something to cap.
export const GC_NAMES = new Set(['Creature_1', 'Creature_3', 'Creature_5']);

export const STATS: EDHRECCommanderStats = {
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

export function edhrecData(): EDHRECCommanderData {
  return { themes: [], stats: STATS, cardlists: POOL.cardlists, similarCommanders: [] };
}

export const COMMANDER = mkSC('Test Commander', 'Legendary Creature — Elf', 4, 2); // rare, priced, legal
export const PARTNER = {
  ...mkSC('Test Partner', 'Legendary Creature — Elf', 3, 6),
  color_identity: ['U'],
};
export const FOREST = mkSC('Forest', 'Basic Land — Forest', 0, 0);
export const withPartner = (card: ScryfallCard): ScryfallCard => ({
  ...card,
  keywords: [...card.keywords, 'Partner'],
  oracle_text: 'Partner (You can have two commanders if both have partner.)',
});

// ---- Customization / context factories (copied from the golden harness) ---

export function customization(overrides: Partial<Customization> = {}): Customization {
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
  };
}

export function baseContext(): GenerationContext {
  return {
    commander: COMMANDER,
    partnerCommander: null,
    colorIdentity: ['G'],
    customization: customization(),
    selectedThemes: [],
  };
}

// E524: the two real reducers The Prismatic Piper (chosen green) shipped on
// the live stress panel, from the pinned Scryfall fixtures. They top this
// EDHREC page the way they sit on the Piper's, which mixes every color its
// players chose. Neither may be seated in a mono-green deck.
export const REAL_CARDS = new Map<string, ScryfallCard>();
for (const file of ['invariant-cards.fixture.json', 'commander-cards.fixture.json']) {
  const { cards } = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), file), 'utf8')
  ) as { cards: ScryfallCard[] };
  for (const c of cards) REAL_CARDS.set(c.name, c);
}
export function realCard(name: string): ScryfallCard {
  const c = REAL_CARDS.get(name);
  if (!c) throw new Error(`no fixture card named ${name}`);
  return structuredClone(c);
}
export const DEAD_REDUCERS = ['Ruby Medallion', "Hazoret's Monument"].map(realCard);
for (const c of DEAD_REDUCERS) POOL.scMap.set(c.name, c);
export function deadReducerData(): EDHRECCommanderData {
  const base = edhrecData();
  const reducers = DEAD_REDUCERS.map((c) => mkEC(c.name, 'Artifact', 99));
  return {
    ...base,
    cardlists: {
      ...base.cardlists,
      artifacts: [...reducers, ...base.cardlists.artifacts],
      allNonLand: [...reducers, ...base.cardlists.allNonLand],
    },
  };
}
