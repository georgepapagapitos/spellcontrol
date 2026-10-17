import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

// E1033: a land that does what the deck does with its lands outranks one that
// only adds color, in every land-synergy deck, and a deck with no land synergy
// gets the lands it gets today. Real Scryfall oracle text (land-synergy.fixture).

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  CHANNEL_LANDS: {},
  getCardsByNames: vi.fn(async () => new Map()),
  upgradeCardPrintings: vi.fn(async () => {}),
  isChannelLand: vi.fn(() => false),
  isMdfcLand: vi.fn(() => false),
  getCardByName: vi.fn(async () => null),
  getCachedCard: vi.fn(() => null),
  getCardPrice: vi.fn(() => null),
  getFrontFaceTypeLine: vi.fn((c: ScryfallCard) => c.card_faces?.[0]?.type_line ?? c.type_line),
  searchCards: vi.fn(async () => ({ data: [] })),
  commanderSearchIdentity: vi.fn((identity: string[]) => identity),
}));

vi.mock('@/deck-builder/services/tagger/client', () => ({
  isTapland: vi.fn(() => false),
  getCardTags: vi.fn(() => []),
}));

import { generateLands } from './landGenerator';
import { readDeckLandPlan } from './landPlan';
import { getCardByName, getCardsByNames } from '@/deck-builder/services/scryfall/client';

interface SynergyDeck {
  commander: string;
  spells: string[];
  planLands: string[];
  genericLands: string[];
}
const fx = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'land-synergy.fixture.json'),
    'utf8'
  )
) as { decks: Record<string, SynergyDeck>; cards: ScryfallCard[] };
const card = (name: string) => structuredClone(fx.cards.find((c) => c.name === name)!);

/** The deck's one nonbasic slot, between one plan land and one generic land at the same page rate. */
async function seat(deck: SynergyDeck, spells: ScryfallCard[], planLand: string, generic: string) {
  const candidates = [planLand, generic];
  vi.mocked(getCardsByNames)
    .mockReset()
    .mockImplementation(async () => new Map())
    .mockResolvedValueOnce(new Map(candidates.map((n) => [n, card(n)])));
  vi.mocked(getCardByName).mockImplementation(async (n: string) => card(n) ?? null);
  const identity = card(deck.commander).color_identity;
  const lands = await generateLands(
    candidates.map((name) => ({
      name,
      sanitized: name.toLowerCase(),
      primary_type: 'Land',
      inclusion: 20,
      num_decks: 1000,
    })),
    identity,
    2,
    new Set(),
    1,
    99,
    spells,
    undefined,
    new Set(),
    null
  );
  return lands.map((c) => c.name).filter((n) => candidates.includes(n));
}

const CASES: [string, string, string][] = [
  // Two colors: the plan lands that fix (a typed fetch, a karoo) win the slot.
  ['landfall', 'Wooded Foothills', 'Rootbound Crag'],
  ['landfall', 'Wooded Foothills', 'Cinder Glade'],
  // One color (Titania): any plan land does. Three colors: a Guildgate fixes.
  ['recursion', 'Strip Mine', 'Pendelhaven'],
  ['recursion', 'Tranquil Thicket', 'Pendelhaven'],
  ['gates', 'Azorius Guildgate', 'Command Tower'],
  ['gates', 'Boros Guildgate', 'Exotic Orchard'],
];

describe('a land that serves the deck plan takes the slot (E1033)', () => {
  it.each(CASES)('%s: %s over %s', async (name, planLand, generic) => {
    const deck = fx.decks[name];
    const spells = [card(deck.commander), ...deck.spells.map(card)];
    expect(await seat(deck, spells, planLand, generic)).toEqual([planLand]);
  });

  it.each(CASES)(
    '%s without its plan spells keeps today’s pick over %s',
    async (name, planLand, generic) => {
      const deck = fx.decks[name];
      const control = deck.spells.map(card).filter((c) => readDeckLandPlan([], [c]).size === 0);
      expect([...readDeckLandPlan(control)]).toEqual([]);
      expect(await seat(deck, control, planLand, generic)).toEqual([generic]);
    }
  );

  // The gate's regression: boosting basic-only fetchers cost a landfall Tatyova
  // seven Simic duals. In two colors a plan land that makes no deck color keeps
  // its page rank, so the dual stays.
  it.each([
    ['landfall', 'Evolving Wilds', 'Rootbound Crag'],
    ['landfall', 'Myriad Landscape', 'Cinder Glade'],
    ['gates', "Maze's End", 'Exotic Orchard'],
  ])(
    '%s in two or more colors: fixing first, %s does not take %s’s slot',
    async (name, planLand, generic) => {
      const deck = fx.decks[name];
      const spells = [card(deck.commander), ...deck.spells.map(card)];
      expect(card(deck.commander).color_identity.length).toBeGreaterThan(1);
      expect(await seat(deck, spells, planLand, generic)).toEqual([generic]);
    }
  );
});
