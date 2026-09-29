// Shared kit for the deck-invariant tests (deckInvariants.test.ts and
// deckInvariants.commander.test.ts): real Scryfall cards from the pinned
// fixtures, the pinned tagger snapshot, and a clean Tatyova deck whose report
// fields are computed the way the generator computes them, so each test
// breaks exactly one thing.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import type {
  Customization,
  DeckCategory,
  GeneratedDeck,
  ScryfallCard,
} from '@/deck-builder/types';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { computeRoleCounts } from '../commanderDeckAnalysis';
import { calculateStats } from '../deckStats';
import type { InvariantCheck, InvariantContext, InvariantViolation } from '../deckInvariants';

const here = dirname(fileURLToPath(import.meta.url));

/** Load the pinned tagger snapshot (roles and subtypes) through a stubbed
 *  fetch. Call from beforeAll; unstub globals in afterAll. */
export async function loadTaggerSnapshot(): Promise<void> {
  const data = JSON.parse(readFileSync(resolve(here, 'tagger-tags.fixture.json'), 'utf8'));
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => data }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
}

export const CARDS = new Map<string, ScryfallCard>(
  (
    JSON.parse(readFileSync(resolve(here, 'invariant-cards.fixture.json'), 'utf8')) as {
      cards: ScryfallCard[];
    }
  ).cards.map((c) => [c.name, c])
);

/** A fresh copy of a real card (checks never mutate, but tests do). */
export function card(name: string, patch: Partial<ScryfallCard> = {}): ScryfallCard {
  const c = CARDS.get(name);
  if (!c) throw new Error(`no fixture card named ${name}`);
  return { ...structuredClone(c), ...patch };
}

// Commanders and odd printings the live stress panel resolved (E524, E527,
// E530), from the same recorded Scryfall answers.
export const COMMANDER_CARDS = new Map<string, ScryfallCard>(
  (
    JSON.parse(readFileSync(resolve(here, 'commander-cards.fixture.json'), 'utf8')) as {
      cards: ScryfallCard[];
    }
  ).cards.map((c) => [c.name, c])
);
export function commanderCard(name: string): ScryfallCard {
  const c = COMMANDER_CARDS.get(name);
  if (!c) throw new Error(`no commander fixture card named ${name}`);
  return structuredClone(c);
}

// ---- A clean Tatyova (UG) deck -------------------------------------------------

export const COMMANDER = 'Tatyova, Benthic Druid';

export const SPELLS = [
  'Brainstorm',
  'Counterspell',
  'Cultivate',
  'Llanowar Elves',
  'Beast Within',
  'Elvish Mystic',
  'Ponder',
  'Preordain',
  'Rampant Growth',
  'Harmonize',
  'Evolution Sage',
  "Tamiyo's Safekeeping",
  "Kodama's Reach",
  'Aetherize',
  'Mystic Snake',
  'Growth Spiral',
  "Nature's Lore",
  'Three Visits',
  'Farseek',
  'Explore',
  'Exploration',
  'Oracle of Mul Daya',
  'Tireless Provisioner',
  'Frantic Search',
  'Mulldrifter',
  'Hullbreaker Horror',
  'Evacuation',
  'Pongify',
  'Rapid Hybridization',
  'Negate',
  'Arcane Denial',
  'Sol Ring',
  'Arcane Signet',
  'Mana Reflection',
  'Plasm Capture',
];

export const NONBASIC_LANDS = ['Command Tower', "Karn's Bastion", 'Eldrazi Temple'];

export function customization(overrides: Partial<Customization> = {}): Customization {
  return {
    deckFormat: 99,
    landCount: 64,
    nonBasicLandCount: 3,
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

export function emptyCategories(): Record<DeckCategory, ScryfallCard[]> {
  return {
    lands: [],
    ramp: [],
    cardDraw: [],
    singleRemoval: [],
    boardWipes: [],
    creatures: [],
    synergy: [],
    utility: [],
  };
}

/**
 * Assemble a GeneratedDeck whose report fields (stats, roleCounts) are
 * computed the way the generator computes them, so a clean deck is clean and
 * each test breaks exactly one thing.
 */
export function assemble(
  categories: Record<DeckCategory, ScryfallCard[]>,
  extra: Partial<GeneratedDeck> = {}
): GeneratedDeck {
  const nonLand = (Object.entries(categories) as [DeckCategory, ScryfallCard[]][])
    .filter(([cat]) => cat !== 'lands')
    .flatMap(([, cards]) => cards);
  const recount = computeRoleCounts(nonLand);
  return {
    commander: card(COMMANDER),
    partnerCommander: null,
    categories,
    stats: calculateStats(categories),
    composition: {
      lands: categories.lands.length,
      ramp: 0,
      cardDraw: 0,
      singleRemoval: 0,
      boardWipes: 0,
      creatures: 0,
      synergy: 0,
      utility: 0,
    },
    // Targets equal to the counts: a clean deck is on target in every role.
    roleTargets: { ...recount.roleCounts },
    roleCounts: { ...recount.roleCounts },
    gameChangerNames: ['Cyclonic Rift', 'Rhystic Study', "Thassa's Oracle"],
    ...extra,
  };
}

export function cleanCategories(): Record<DeckCategory, ScryfallCard[]> {
  const cats = emptyCategories();
  for (const name of SPELLS) {
    const c = card(name);
    (/\bCreature\b/.test(c.type_line) ? cats.creatures : cats.synergy).push(c);
  }
  for (const name of NONBASIC_LANDS) cats.lands.push(card(name));
  // 99 - 35 spells - 3 nonbasics = 61 basics.
  for (let i = 0; i < 31; i++) cats.lands.push(card('Forest'));
  for (let i = 0; i < 30; i++) cats.lands.push(card('Island'));
  return cats;
}

export function context(overrides: Partial<InvariantContext> = {}): InvariantContext {
  return {
    commander: card(COMMANDER),
    partnerCommander: null,
    colorIdentity: ['G', 'U'],
    customization: customization(),
    ...overrides,
  };
}

export function checks(v: InvariantViolation[], level?: 'HARD' | 'SOFT'): InvariantCheck[] {
  return v.filter((x) => !level || x.level === level).map((x) => x.check);
}

/** Replace the first seated card named `name` with `replacement`. */
export function swap(
  cats: Record<DeckCategory, ScryfallCard[]>,
  name: string,
  replacement: ScryfallCard,
  into?: DeckCategory
): void {
  for (const list of Object.values(cats)) {
    const i = list.findIndex((c) => c.name === name);
    if (i >= 0) {
      list.splice(i, 1);
      (into ? cats[into] : list).push(replacement);
      return;
    }
  }
  throw new Error(`${name} is not seated`);
}
