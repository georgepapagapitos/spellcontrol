import { describe, expect, it } from 'vitest';
import {
  availableCountsByName,
  collectAllocatedCopyIds,
  computeSpareCopyIds,
} from '@spellcontrol/binder-routing';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import type { SavedCube } from '@/store/cube';
import type { EnrichedCard } from '@/types/index';
import { buildAllocationMap, computeSurplusByName } from './allocations';
import { buildAvailableCollection } from './collection-availability';
import { computeSparesSummary } from './collection-insights';
import { DEFAULT_POOL_FILTERS, filterPool } from '@/lib/cube/pool-filters';

// E542: one definition of "available" and "spare". Each surface below must give
// the answer the shared functions give for the SAME collection, decks and cube.
// The server's friend spare and the AI's uncommitted list are pinned against the
// same fixture shape in backend/src/friends/card-use.test.ts and
// backend/src/routes/ai.test.ts.

const copy = (copyId: string, name: string, over: Partial<EnrichedCard> = {}): EnrichedCard =>
  ({
    copyId,
    name,
    rarity: 'rare',
    purchasePrice: 1,
    finish: 'nonfoil',
    foil: false,
    ...over,
  }) as EnrichedCard;

const slot = (slotId: string, name: string, allocatedCopyId: string): DeckCard => ({
  slotId,
  card: { name } as ScryfallCard,
  allocatedCopyId,
});

const deck = (over: Partial<Deck>): Deck =>
  ({
    id: 'd',
    name: 'Deck',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    considering: [],
    color: '#fff',
    ...over,
  }) as unknown as Deck;

const collection = [
  // Sol Ring: main, considering, then two loose (a foil and a plain one).
  copy('ring-main', 'Sol Ring'),
  copy('ring-maybe', 'Sol Ring'),
  copy('ring-plain', 'Sol Ring', { purchasePrice: 4 }),
  copy('ring-foil', 'Sol Ring', { finish: 'foil', foil: true, purchasePrice: 2 }),
  // Arcane Signet: one in a physical cube, one loose, so none spare.
  copy('signet-cube', 'Arcane Signet'),
  copy('signet-loose', 'Arcane Signet'),
  // Mana Crypt: two real loose copies and a proxy: one spare, never the proxy.
  copy('crypt-1', 'Mana Crypt', { purchasePrice: 30 }),
  copy('crypt-2', 'Mana Crypt', { purchasePrice: 30 }),
  copy('crypt-proxy', 'Mana Crypt', { proxy: true, purchasePrice: 0 }),
  // Rhystic Study: one in a sideboard, one loose: none spare.
  copy('study-side', 'Rhystic Study'),
  copy('study-loose', 'Rhystic Study'),
  copy('forest-1', 'Forest'),
  copy('forest-2', 'Forest'),
];
const decks = [
  deck({ id: 'a', cards: [slot('s1', 'Sol Ring', 'ring-main')] }),
  deck({
    id: 'b',
    considering: [slot('c1', 'Sol Ring', 'ring-maybe')],
    sideboard: [slot('sb1', 'Rhystic Study', 'study-side')],
  }),
];
const cubes = [
  {
    id: 'cube',
    name: 'Cube',
    isPhysical: true,
    picks: [{ slotId: 'p1', card: { name: 'Arcane Signet' }, allocatedCopyId: 'signet-cube' }],
  } as unknown as SavedCube,
];

describe('available and spare across the client surfaces', () => {
  const allocations = buildAllocationMap(decks, cubes);
  const claimed = new Set(allocations.keys());
  const spareIds = computeSpareCopyIds(collection, claimed);

  it('the shared spare set is the loose Sol Ring and one real Mana Crypt', () => {
    // Keep the foil Sol Ring; of two equal Crypts keep the lowest copyId.
    expect([...spareIds].sort()).toEqual(['crypt-2', 'ring-plain']);
  });

  it('the allocation map claims the same copies the raw-row helper does', () => {
    const raw = collectAllocatedCopyIds(decks, cubes);
    expect([...raw].sort()).toEqual([...claimed].sort());
  });

  it('the collection spare filter and chip tally the shared set', () => {
    expect(Object.fromEntries(computeSurplusByName(collection, allocations))).toEqual({
      'Sol Ring': 1,
      'Mana Crypt': 1,
    });
  });

  it('the spare summary counts and prices exactly the shared set', () => {
    expect(computeSparesSummary(collection, allocations)).toEqual({ count: 2, value: 34 });
  });

  it('the cube pool: Available is the shared available count, Spares only is the shared spare', () => {
    const available = buildAvailableCollection(collection, decks, cubes);
    expect(Object.fromEntries(available.counts)).toEqual(
      Object.fromEntries(availableCountsByName(collection, claimed))
    );
    // Every Rhystic Study and Arcane Signet still has one loose copy.
    expect(available.names.has('Arcane Signet')).toBe(true);
    const spareNames = new Set(computeSurplusByName(collection, allocations).keys());
    const { names, hidden } = filterPool(
      collection,
      available.names,
      { ...DEFAULT_POOL_FILTERS, source: 'spares' },
      () => [],
      spareNames
    );
    expect(names.sort()).toEqual(['Mana Crypt', 'Sol Ring']);
    // Two owned Signets and Studies are not spares once a deck or cube holds one.
    expect(hidden.singles).toBe(2);
  });
});
