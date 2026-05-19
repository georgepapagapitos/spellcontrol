import { describe, it, expect } from 'vitest';
import {
  buildAllocationMap,
  dedupeDeckAllocations,
  pickCollectionCopy,
  classifyAllocation,
  findSuboptimalPrintings,
  type AllocationInfo,
} from './allocations';
import type { EnrichedCard } from '../types';
import type { Deck, DeckCard } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-1',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-1',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    format: 'commander',
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('buildAllocationMap', () => {
  it('maps commander, partner, and slot allocations', () => {
    const d = deck({
      id: 'd1',
      name: 'Atraxa',
      commander: { name: "Atraxa, Praetors' Voice" } as never,
      commanderAllocatedCopyId: 'copy-cmd',
      partnerCommander: { name: 'Partner' } as never,
      partnerCommanderAllocatedCopyId: 'copy-partner',
      cards: [
        { slotId: 's1', card: { name: 'Sol Ring' } as never, allocatedCopyId: 'copy-sr' },
        { slotId: 's2', card: { name: 'Mana Crypt' } as never, allocatedCopyId: null },
      ],
    });
    const map = buildAllocationMap([d]);
    expect(map.size).toBe(3);
    expect(map.get('copy-cmd')?.cardName).toBe("Atraxa, Praetors' Voice");
    expect(map.get('copy-partner')?.deckName).toBe('Atraxa');
    expect(map.get('copy-sr')?.cardName).toBe('Sol Ring');
  });

  it('skips commander entries with no allocation', () => {
    const d = deck({
      commander: { name: 'X' } as never,
      commanderAllocatedCopyId: null,
    });
    expect(buildAllocationMap([d]).size).toBe(0);
  });
});

describe('dedupeDeckAllocations', () => {
  function dc(slotId: string, name: string, allocatedCopyId: string | null): DeckCard {
    return { slotId, card: { name } as ScryfallCard, allocatedCopyId };
  }

  it('returns the same array reference when nothing is double-claimed', () => {
    const decks = [
      deck({ id: 'd1', cards: [dc('s1', 'Sol Ring', 'c1')] }),
      deck({ id: 'd2', cards: [dc('s2', 'Mana Crypt', 'c2')] }),
    ];
    const res = dedupeDeckAllocations(decks);
    expect(res.changed).toBe(false);
    expect(res.decks).toBe(decks);
    expect(res.decks[0]).toBe(decks[0]);
    expect(res.decks[1]).toBe(decks[1]);
  });

  it('first-claim-wins across decks in array order; later deck slot is cleared', () => {
    const decks = [
      deck({ id: 'd1', name: 'A', cards: [dc('s1', 'Sol Ring', 'shared')] }),
      deck({ id: 'd2', name: 'B', cards: [dc('s2', 'Sol Ring', 'shared')] }),
    ];
    const res = dedupeDeckAllocations(decks);
    expect(res.changed).toBe(true);
    expect(res.decks[0].cards[0].allocatedCopyId).toBe('shared');
    expect(res.decks[1].cards[0].allocatedCopyId).toBeNull();
    // Untouched deck keeps its reference; only the contested one is rebuilt.
    expect(res.decks[0]).toBe(decks[0]);
    expect(res.decks[1]).not.toBe(decks[1]);
  });

  it('clears a duplicate within a single deck (first slot keeps it)', () => {
    const decks = [
      deck({
        id: 'd1',
        cards: [dc('s1', 'Sol Ring', 'dup'), dc('s2', 'Sol Ring', 'dup')],
      }),
    ];
    const res = dedupeDeckAllocations(decks);
    expect(res.changed).toBe(true);
    expect(res.decks[0].cards[0].allocatedCopyId).toBe('dup');
    expect(res.decks[0].cards[1].allocatedCopyId).toBeNull();
  });

  it('resolves slots in order commander → partner → cards → sideboard', () => {
    const decks = [
      deck({
        id: 'd1',
        commander: { name: 'Atraxa' } as never,
        commanderAllocatedCopyId: 'x',
        partnerCommander: { name: 'Partner' } as never,
        partnerCommanderAllocatedCopyId: 'x',
        cards: [dc('s1', 'Sol Ring', 'x')],
        sideboard: [dc('s2', 'Mana Crypt', 'x')],
      }),
    ];
    const res = dedupeDeckAllocations(decks);
    expect(res.changed).toBe(true);
    const d = res.decks[0];
    expect(d.commanderAllocatedCopyId).toBe('x');
    expect(d.partnerCommanderAllocatedCopyId).toBeNull();
    expect(d.cards[0].allocatedCopyId).toBeNull();
    expect(d.sideboard[0].allocatedCopyId).toBeNull();
  });

  it('leaves null allocations and unrelated copies untouched', () => {
    const decks = [
      deck({
        id: 'd1',
        cards: [dc('s1', 'Sol Ring', null), dc('s2', 'Mana Crypt', 'c2')],
        sideboard: [dc('s3', 'Bolt', null)],
      }),
    ];
    const res = dedupeDeckAllocations(decks);
    expect(res.changed).toBe(false);
    expect(res.decks).toBe(decks);
  });

  it('preserves deck contents — only the impossible copyId is nulled', () => {
    const decks = [
      deck({ id: 'd1', cards: [dc('s1', 'Sol Ring', 'shared')] }),
      deck({
        id: 'd2',
        cards: [dc('s2', 'Sol Ring', 'shared'), dc('s3', 'Mana Crypt', 'c9')],
      }),
    ];
    const res = dedupeDeckAllocations(decks);
    const d2 = res.decks[1];
    expect(d2.cards).toHaveLength(2);
    expect(d2.cards[0].card.name).toBe('Sol Ring');
    expect(d2.cards[0].allocatedCopyId).toBeNull();
    expect(d2.cards[1].allocatedCopyId).toBe('c9');
  });

  it('does not bump updatedAt on a self-heal', () => {
    const decks = [
      deck({ id: 'd1', updatedAt: 111, cards: [dc('s1', 'Sol Ring', 'shared')] }),
      deck({ id: 'd2', updatedAt: 222, cards: [dc('s2', 'Sol Ring', 'shared')] }),
    ];
    const res = dedupeDeckAllocations(decks);
    expect(res.decks[1].updatedAt).toBe(222);
  });

  it('is idempotent', () => {
    const decks = [
      deck({ id: 'd1', cards: [dc('s1', 'Sol Ring', 'shared')] }),
      deck({ id: 'd2', cards: [dc('s2', 'Sol Ring', 'shared')] }),
    ];
    const once = dedupeDeckAllocations(decks).decks;
    const twice = dedupeDeckAllocations(once);
    expect(twice.changed).toBe(false);
    expect(twice.decks).toBe(once);
  });

  it('output is free of cross-slot double-claims (the core invariant)', () => {
    const decks = [
      deck({
        id: 'd1',
        commanderAllocatedCopyId: 'a',
        cards: [dc('s1', 'X', 'a'), dc('s2', 'Y', 'b')],
      }),
      deck({
        id: 'd2',
        cards: [dc('s3', 'X', 'b'), dc('s4', 'Z', 'a')],
        sideboard: [dc('s5', 'W', 'c')],
      }),
    ];
    const { decks: out } = dedupeDeckAllocations(decks);
    const seen = new Set<string>();
    for (const d of out) {
      for (const id of [d.commanderAllocatedCopyId, d.partnerCommanderAllocatedCopyId])
        if (id) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
      for (const c of [...d.cards, ...d.sideboard])
        if (c.allocatedCopyId) {
          expect(seen.has(c.allocatedCopyId)).toBe(false);
          seen.add(c.allocatedCopyId);
        }
    }
  });
});

describe('pickCollectionCopy', () => {
  const allocated = new Map<string, AllocationInfo>();

  it('returns null when no candidates match', () => {
    expect(pickCollectionCopy('Sol Ring', [], allocated)).toBeNull();
    expect(pickCollectionCopy('Sol Ring', [card({ name: 'Other' })], allocated)).toBeNull();
  });

  it('prefers non-foil over foil', () => {
    const foil = card({ copyId: 'a', foil: true, finish: 'foil', purchasePrice: 1 });
    const nonFoil = card({ copyId: 'b', foil: false, finish: 'nonfoil', purchasePrice: 5 });
    expect(pickCollectionCopy('Sol Ring', [foil, nonFoil], allocated)?.copyId).toBe('b');
  });

  it('prefers cheaper copy when foil status matches', () => {
    const cheap = card({ copyId: 'a', purchasePrice: 1 });
    const pricey = card({ copyId: 'b', purchasePrice: 50 });
    expect(pickCollectionCopy('Sol Ring', [pricey, cheap], allocated)?.copyId).toBe('a');
  });

  it('skips copies that are already allocated', () => {
    const claimed = new Map<string, AllocationInfo>();
    claimed.set('a', { deckId: 'd1', deckName: 'X', deckColor: '#000', cardName: 'Sol Ring' });
    const a = card({ copyId: 'a', purchasePrice: 1 });
    const b = card({ copyId: 'b', purchasePrice: 5 });
    expect(pickCollectionCopy('Sol Ring', [a, b], claimed)?.copyId).toBe('b');
  });
});

describe('pickCollectionCopy with preferredScryfallId', () => {
  const allocated = new Map<string, AllocationInfo>();

  it('prefers exact printing even when a cheaper alternative exists', () => {
    const cheap = card({ copyId: 'a', scryfallId: 'sf-CMR', purchasePrice: 1 });
    const pricey = card({ copyId: 'b', scryfallId: 'sf-ONE', purchasePrice: 50 });
    expect(pickCollectionCopy('Sol Ring', [cheap, pricey], allocated, 'sf-ONE')?.copyId).toBe('b');
  });

  it('falls back to foil/price tiebreak when preferred printing is not owned', () => {
    const nonFoil = card({ copyId: 'a', scryfallId: 'sf-CMR', foil: false, purchasePrice: 1 });
    const foilCopy = card({
      copyId: 'b',
      scryfallId: 'sf-NEO',
      foil: true,
      finish: 'foil',
      purchasePrice: 0.5,
    });
    // preferred printing 'sf-XYZ' is not owned; fallback: non-foil wins
    expect(pickCollectionCopy('Sol Ring', [nonFoil, foilCopy], allocated, 'sf-XYZ')?.copyId).toBe(
      'a'
    );
  });

  it('returns null when all candidates are allocated even with a preference', () => {
    const claimed = new Map<string, AllocationInfo>();
    claimed.set('a', { deckId: 'd1', deckName: 'X', deckColor: '#000', cardName: 'Sol Ring' });
    const a = card({ copyId: 'a', scryfallId: 'sf-ONE' });
    expect(pickCollectionCopy('Sol Ring', [a], claimed, 'sf-ONE')).toBeNull();
  });

  it('prefers exact-printing foil over non-preferred non-foil', () => {
    const nonFoilCheap = card({ copyId: 'a', scryfallId: 'sf-CMR', foil: false, purchasePrice: 1 });
    const foilPref = card({
      copyId: 'b',
      scryfallId: 'sf-ONE',
      foil: true,
      finish: 'foil',
      purchasePrice: 2,
    });
    expect(
      pickCollectionCopy('Sol Ring', [nonFoilCheap, foilPref], allocated, 'sf-ONE')?.copyId
    ).toBe('b');
  });

  it('passes through to original behavior when preferredScryfallId is undefined', () => {
    const foil = card({
      copyId: 'a',
      scryfallId: 'sf-ONE',
      foil: true,
      finish: 'foil',
      purchasePrice: 1,
    });
    const nonFoil = card({ copyId: 'b', scryfallId: 'sf-NEO', foil: false, purchasePrice: 5 });
    expect(pickCollectionCopy('Sol Ring', [foil, nonFoil], allocated)?.copyId).toBe('b');
  });
});

describe('findSuboptimalPrintings', () => {
  function slot(name: string, scryfallId: string, allocatedCopyId: string | null): DeckCard {
    return {
      slotId: `s-${Math.random()}`,
      card: { name, id: scryfallId } as ScryfallCard,
      allocatedCopyId,
    };
  }

  it('reports a slot bound to a wrong-printing copy when preferred printing is owned', () => {
    const d = deck({
      id: 'd1',
      name: 'A',
      cards: [slot('Sol Ring', 'sf-pref', 'wrong-copy')],
    });
    const collection: EnrichedCard[] = [
      card({ copyId: 'wrong-copy', name: 'Sol Ring', scryfallId: 'sf-other', setCode: 'C20' }),
      card({ copyId: 'right-copy', name: 'Sol Ring', scryfallId: 'sf-pref', setCode: 'CMR' }),
    ];
    const out = findSuboptimalPrintings([d], collection);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      deckName: 'A',
      cardName: 'Sol Ring',
      preferredScryfallId: 'sf-pref',
      allocatedCopyId: 'wrong-copy',
      allocatedSet: 'C20',
    });
  });

  it('ignores basic lands — their printing is fungible', () => {
    const d = deck({
      id: 'd1',
      name: 'A',
      cards: [slot('Plains', 'sf-pref', 'wrong-copy')],
    });
    const collection: EnrichedCard[] = [
      card({ copyId: 'wrong-copy', name: 'Plains', scryfallId: 'sf-other', setCode: 'M20' }),
      card({ copyId: 'right-copy', name: 'Plains', scryfallId: 'sf-pref', setCode: 'ECL' }),
    ];
    expect(findSuboptimalPrintings([d], collection)).toHaveLength(0);
  });

  it('marks preferredFree=true when a free copy of the preferred printing exists', () => {
    const d = deck({
      id: 'd1',
      name: 'A',
      cards: [slot('Sol Ring', 'sf-pref', 'wrong-copy')],
    });
    const collection: EnrichedCard[] = [
      card({ copyId: 'wrong-copy', name: 'Sol Ring', scryfallId: 'sf-other', setCode: 'C20' }),
      card({ copyId: 'free-pref', name: 'Sol Ring', scryfallId: 'sf-pref', setCode: 'CMR' }),
    ];
    const out = findSuboptimalPrintings([d], collection);
    expect(out).toHaveLength(1);
    expect(out[0].preferredFree).toBe(true);
  });

  it('marks preferredFree=false when the preferred copy is claimed by another deck', () => {
    const d1 = deck({
      id: 'd1',
      name: 'A',
      cards: [slot('Sol Ring', 'sf-pref', 'wrong-copy')],
    });
    // Another deck already holds the only preferred-printing copy.
    const d2 = deck({
      id: 'd2',
      name: 'B',
      cards: [slot('Sol Ring', 'sf-pref', 'pref-copy')],
    });
    const collection: EnrichedCard[] = [
      card({ copyId: 'wrong-copy', name: 'Sol Ring', scryfallId: 'sf-other', setCode: 'C20' }),
      card({ copyId: 'pref-copy', name: 'Sol Ring', scryfallId: 'sf-pref', setCode: 'CMR' }),
    ];
    const out = findSuboptimalPrintings([d1, d2], collection);
    const d1Row = out.find((r) => r.deckId === 'd1');
    expect(d1Row).toBeDefined();
    expect(d1Row!.preferredFree).toBe(false);
  });

  it('does not report when the slot is already on the preferred printing', () => {
    const d = deck({
      id: 'd1',
      cards: [slot('Plains', 'sf-pref', 'right-copy')],
    });
    const collection = [card({ copyId: 'right-copy', name: 'Plains', scryfallId: 'sf-pref' })];
    expect(findSuboptimalPrintings([d], collection)).toHaveLength(0);
  });

  it('does not report when the preferred printing is not owned at all', () => {
    // No upgrade possible; the slot is doing the best it can.
    const d = deck({
      id: 'd1',
      cards: [slot('Plains', 'sf-pref', 'only-copy')],
    });
    const collection = [card({ copyId: 'only-copy', name: 'Plains', scryfallId: 'sf-other' })];
    expect(findSuboptimalPrintings([d], collection)).toHaveLength(0);
  });

  it('does not report unallocated slots', () => {
    const d = deck({
      id: 'd1',
      cards: [slot('Plains', 'sf-pref', null)],
    });
    const collection = [card({ copyId: 'c', name: 'Plains', scryfallId: 'sf-pref' })];
    expect(findSuboptimalPrintings([d], collection)).toHaveLength(0);
  });

  it('checks commander, partner, and sideboard alongside the main deck', () => {
    const d = deck({
      id: 'd1',
      name: 'X',
      commander: { name: 'Atraxa', id: 'sf-atraxa-pref' } as ScryfallCard,
      commanderAllocatedCopyId: 'cmdr-wrong',
      partnerCommander: { name: 'Thrasios', id: 'sf-thra-pref' } as ScryfallCard,
      partnerCommanderAllocatedCopyId: 'part-wrong',
      sideboard: [slot('Bolt', 'sf-bolt-pref', 'side-wrong')],
    });
    const collection = [
      card({ copyId: 'cmdr-wrong', name: 'Atraxa', scryfallId: 'sf-atraxa-other' }),
      card({ copyId: 'cmdr-right', name: 'Atraxa', scryfallId: 'sf-atraxa-pref' }),
      card({ copyId: 'part-wrong', name: 'Thrasios', scryfallId: 'sf-thra-other' }),
      card({ copyId: 'part-right', name: 'Thrasios', scryfallId: 'sf-thra-pref' }),
      card({ copyId: 'side-wrong', name: 'Bolt', scryfallId: 'sf-bolt-other' }),
      card({ copyId: 'side-right', name: 'Bolt', scryfallId: 'sf-bolt-pref' }),
    ];
    const out = findSuboptimalPrintings([d], collection);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.cardName).sort()).toEqual(['Atraxa', 'Bolt', 'Thrasios']);
  });
});

describe('classifyAllocation', () => {
  it('returns unowned when no copy is allocated', () => {
    expect(classifyAllocation(null, new Map())).toBe('unowned');
  });

  it('returns allocated while collection is hydrating', () => {
    expect(classifyAllocation('copy-1', undefined)).toBe('allocated');
  });

  it('returns allocated when the copy still exists', () => {
    const m = new Map<string, EnrichedCard>([['copy-1', card()]]);
    expect(classifyAllocation('copy-1', m)).toBe('allocated');
  });

  it('returns orphan when the copy is gone', () => {
    expect(classifyAllocation('missing', new Map())).toBe('orphan');
  });
});
