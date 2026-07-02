import { describe, it, expect } from 'vitest';
import {
  buildAllocationMap,
  dedupeDeckAllocations,
  pickCollectionCopy,
  classifyAllocation,
  classifyPrintingAvailability,
  findSuboptimalPrintings,
  findStealableCopy,
  planCardAdd,
  listContestedCards,
  makeDeckAllocationInfo,
  computeSurplusByName,
  type AllocationInfo,
} from './allocations';
import type { SavedCube, CubePickSlot } from '../store/cube';
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
    claimed.set('a', makeDeckAllocationInfo('d1', 'X', '#000', 'Sol Ring'));
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
    claimed.set('a', makeDeckAllocationInfo('d1', 'X', '#000', 'Sol Ring'));
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

  it('claims the exact printing for basic lands — special-art basics are not fungible', () => {
    // A Secret Lair foil Mountain the deck wants, plus a plain one. The deck
    // slot must claim the SL copy, not the cheaper plain Mountain.
    const sl = card({
      copyId: 'sl',
      name: 'Mountain',
      scryfallId: 'sf-SLD',
      foil: true,
      finish: 'foil',
      purchasePrice: 11,
    });
    const plain = card({
      copyId: 'plain',
      name: 'Mountain',
      scryfallId: 'sf-M20',
      foil: false,
      purchasePrice: 0.1,
    });
    expect(pickCollectionCopy('Mountain', [plain, sl], allocated, 'sf-SLD')?.copyId).toBe('sl');
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

  it('flags basic lands bound to the wrong printing — special-art basics are a real choice', () => {
    const d = deck({
      id: 'd1',
      name: 'A',
      cards: [slot('Plains', 'sf-pref', 'wrong-copy')],
    });
    const collection: EnrichedCard[] = [
      card({ copyId: 'wrong-copy', name: 'Plains', scryfallId: 'sf-other', setCode: 'M20' }),
      card({ copyId: 'right-copy', name: 'Plains', scryfallId: 'sf-pref', setCode: 'ECL' }),
    ];
    const out = findSuboptimalPrintings([d], collection);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cardName: 'Plains', preferredScryfallId: 'sf-pref' });
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

describe('findStealableCopy', () => {
  function dc(slotId: string, name: string, allocatedCopyId: string | null): DeckCard {
    return { slotId, card: { name } as ScryfallCard, allocatedCopyId };
  }

  it('returns null when the user owns no copies', () => {
    const decks = [deck({ id: 'd1' })];
    expect(findStealableCopy('Sol Ring', [], decks, 'd1')).toBeNull();
  });

  it('returns null when a free copy exists (no steal needed)', () => {
    const decks = [deck({ id: 'd2', name: 'B', cards: [dc('s1', 'Sol Ring', 'claimed')] })];
    const collection = [
      card({ copyId: 'claimed', name: 'Sol Ring' }),
      card({ copyId: 'free', name: 'Sol Ring' }),
    ];
    expect(findStealableCopy('Sol Ring', collection, decks, 'd1')).toBeNull();
  });

  it('returns null when every owned copy is already in the current deck', () => {
    const decks = [deck({ id: 'd1', name: 'Current', cards: [dc('s1', 'Sol Ring', 'mine')] })];
    const collection = [card({ copyId: 'mine', name: 'Sol Ring' })];
    expect(findStealableCopy('Sol Ring', collection, decks, 'd1')).toBeNull();
  });

  it('returns the donor location when a copy is held by another deck', () => {
    const decks = [
      deck({ id: 'd1', name: 'Current' }),
      deck({
        id: 'd2',
        name: 'Donor',
        color: '#abc',
        cards: [dc('slot-x', 'Sol Ring', 'shared')],
      }),
    ];
    const collection = [card({ copyId: 'shared', name: 'Sol Ring' })];
    const res = findStealableCopy('Sol Ring', collection, decks, 'd1');
    expect(res).toMatchObject({
      copyId: 'shared',
      donorDeckId: 'd2',
      donorDeckName: 'Donor',
      donorDeckColor: '#abc',
      donorZone: 'main',
      donorSlotId: 'slot-x',
    });
    expect(res?.donorKind).toBe('deck');
    expect(res?.donorCard?.name).toBe('Sol Ring');
  });

  it('locates a copy held as another deck commander', () => {
    const decks = [
      deck({ id: 'd1', name: 'Current' }),
      deck({
        id: 'd2',
        name: 'Donor',
        commander: { name: 'Sol Ring' } as never,
        commanderAllocatedCopyId: 'cmd-copy',
      }),
    ];
    const collection = [card({ copyId: 'cmd-copy', name: 'Sol Ring' })];
    const res = findStealableCopy('Sol Ring', collection, decks, 'd1');
    expect(res).toMatchObject({ donorZone: 'commander', donorSlotId: null, donorDeckId: 'd2' });
  });

  it('locates a copy held in another deck sideboard', () => {
    const decks = [
      deck({ id: 'd1', name: 'Current' }),
      deck({ id: 'd2', name: 'Donor', sideboard: [dc('sb-1', 'Sol Ring', 'sb-copy')] }),
    ];
    const collection = [card({ copyId: 'sb-copy', name: 'Sol Ring' })];
    const res = findStealableCopy('Sol Ring', collection, decks, 'd1');
    expect(res).toMatchObject({ donorZone: 'sideboard', donorSlotId: 'sb-1' });
  });

  it('prefers a non-foil stealable copy over a foil one', () => {
    const decks = [
      deck({ id: 'd1', name: 'Current' }),
      deck({
        id: 'd2',
        name: 'Donor',
        cards: [dc('s-foil', 'Sol Ring', 'foil'), dc('s-plain', 'Sol Ring', 'plain')],
      }),
    ];
    const collection = [
      card({ copyId: 'foil', name: 'Sol Ring', foil: true, finish: 'foil' }),
      card({ copyId: 'plain', name: 'Sol Ring', foil: false, finish: 'nonfoil' }),
    ];
    expect(findStealableCopy('Sol Ring', collection, decks, 'd1')?.copyId).toBe('plain');
  });

  it('ignores copies in the current deck when picking a donor', () => {
    const decks = [
      deck({ id: 'd1', name: 'Current', cards: [dc('mine', 'Sol Ring', 'in-current')] }),
      deck({ id: 'd2', name: 'Donor', cards: [dc('theirs', 'Sol Ring', 'in-donor')] }),
    ];
    const collection = [
      card({ copyId: 'in-current', name: 'Sol Ring' }),
      card({ copyId: 'in-donor', name: 'Sol Ring' }),
    ];
    const res = findStealableCopy('Sol Ring', collection, decks, 'd1');
    expect(res?.copyId).toBe('in-donor');
    expect(res?.donorDeckId).toBe('d2');
  });
});

describe('planCardAdd', () => {
  function dc(slotId: string, name: string, allocatedCopyId: string | null): DeckCard {
    return { slotId, card: { name } as ScryfallCard, allocatedCopyId };
  }

  it('binds a free owned copy when one is available', () => {
    const decks = [deck({ id: 'd1' })];
    const collection = [card({ copyId: 'free', name: 'Sol Ring' })];
    expect(planCardAdd('Sol Ring', undefined, collection, decks)).toEqual({
      kind: 'bind',
      copyId: 'free',
    });
  });

  it('lists (no move) when the card is not owned', () => {
    expect(planCardAdd('Sol Ring', undefined, [], [deck({ id: 'd1' })])).toEqual({ kind: 'list' });
  });

  it('lists, never moves, when the only copy is in another deck mainboard', () => {
    const decks = [
      deck({ id: 'd1', name: 'Current' }),
      deck({ id: 'd2', name: 'Donor', cards: [dc('s-x', 'Sol Ring', 'shared')] }),
    ];
    const collection = [card({ copyId: 'shared', name: 'Sol Ring' })];
    // Owned but elsewhere → just list it; the copy is NOT pulled out of d2.
    expect(planCardAdd('Sol Ring', undefined, collection, decks)).toEqual({ kind: 'list' });
  });

  it('lists, never moves, when the only copy is another deck commander', () => {
    const decks = [
      deck({ id: 'd1', name: 'Current' }),
      deck({
        id: 'd2',
        name: 'Donor',
        commander: { name: 'Sol Ring' } as never,
        commanderAllocatedCopyId: 'cmd',
      }),
    ];
    const collection = [card({ copyId: 'cmd', name: 'Sol Ring' })];
    expect(planCardAdd('Sol Ring', undefined, collection, decks)).toEqual({ kind: 'list' });
  });

  it('prefers binding a free copy over listing', () => {
    const decks = [
      deck({ id: 'd1', name: 'Current' }),
      deck({ id: 'd2', name: 'Donor', cards: [dc('s-x', 'Sol Ring', 'in-donor')] }),
    ];
    const collection = [
      card({ copyId: 'in-donor', name: 'Sol Ring' }),
      card({ copyId: 'free', name: 'Sol Ring' }),
    ];
    expect(planCardAdd('Sol Ring', undefined, collection, decks)).toEqual({
      kind: 'bind',
      copyId: 'free',
    });
  });
});

describe('listContestedCards', () => {
  function dc(slotId: string, name: string, allocatedCopyId: string | null): DeckCard {
    return { slotId, card: { name, id: `sf-${name}` } as ScryfallCard, allocatedCopyId };
  }

  it('lists an owned-but-elsewhere mainboard card with its donor + owned count', () => {
    const current = deck({ id: 'd1', name: 'Current', cards: [dc('s1', 'Sol Ring', null)] });
    const donor = deck({
      id: 'd2',
      name: 'Morcant',
      color: '#abc',
      cards: [dc('ds1', 'Sol Ring', 'shared')],
    });
    const collection = [card({ copyId: 'shared', name: 'Sol Ring' })];
    expect(listContestedCards(current, collection, [current, donor])).toEqual([
      {
        slotId: 's1',
        cardName: 'Sol Ring',
        donorKind: 'deck',
        donorDeckName: 'Morcant',
        donorDeckColor: '#abc',
        owned: 1,
      },
    ]);
  });

  it('includes a card whose copy is another deck commander (resolved consciously, not skipped)', () => {
    const current = deck({ id: 'd1', name: 'Current', cards: [dc('s1', 'Sol Ring', null)] });
    const donor = deck({
      id: 'd2',
      name: 'Morcant',
      commander: { name: 'Sol Ring' } as never,
      commanderAllocatedCopyId: 'cmd',
    });
    const collection = [card({ copyId: 'cmd', name: 'Sol Ring' })];
    expect(
      listContestedCards(current, collection, [current, donor]).map((c) => c.cardName)
    ).toEqual(['Sol Ring']);
  });

  it('reports the true owned count for the shortage line', () => {
    const current = deck({ id: 'd1', name: 'Current', cards: [dc('s1', 'Sol Ring', null)] });
    const donor = deck({
      id: 'd2',
      name: 'Morcant',
      cards: [dc('ds1', 'Sol Ring', 'c1'), dc('ds2', 'Sol Ring', 'c2')],
    });
    const collection = [
      card({ copyId: 'c1', name: 'Sol Ring' }),
      card({ copyId: 'c2', name: 'Sol Ring' }),
    ];
    expect(listContestedCards(current, collection, [current, donor])[0].owned).toBe(2);
  });

  it('excludes a card you do not own', () => {
    const current = deck({ id: 'd1', cards: [dc('s1', 'Foo', null)] });
    expect(listContestedCards(current, [], [current])).toEqual([]);
  });

  it('excludes a card with a free copy available (not contested)', () => {
    const current = deck({ id: 'd1', name: 'Current', cards: [dc('s1', 'Sol Ring', null)] });
    const donor = deck({ id: 'd2', name: 'Morcant', cards: [dc('ds1', 'Sol Ring', 'used')] });
    const collection = [
      card({ copyId: 'used', name: 'Sol Ring' }),
      card({ copyId: 'free', name: 'Sol Ring' }),
    ];
    expect(listContestedCards(current, collection, [current, donor])).toEqual([]);
  });

  it('excludes a slot already bound to a copy', () => {
    const current = deck({ id: 'd1', name: 'Current', cards: [dc('s1', 'Sol Ring', 'mine')] });
    const collection = [card({ copyId: 'mine', name: 'Sol Ring' })];
    expect(listContestedCards(current, collection, [current])).toEqual([]);
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

describe('buildAllocationMap with physical cubes', () => {
  function cubeSlot(name: string, copyId: string | null): CubePickSlot {
    return {
      slotId: name,
      card: { name } as never,
      allocatedCopyId: copyId,
      printingFinishKey: null,
    };
  }
  function savedCube(overrides: Partial<SavedCube> = {}): SavedCube {
    return {
      id: 'cube-1',
      name: 'My Cube',
      size: 540,
      cube: { picks: [] } as never,
      picks: [],
      isPhysical: true,
      savedAt: 0,
      ...overrides,
    };
  }

  it("folds a physical cube's picks into the map as cube claims", () => {
    const map = buildAllocationMap([], [savedCube({ picks: [cubeSlot('Sol Ring', 'copy-x')] })]);
    const info = map.get('copy-x');
    expect(info?.ownerKind).toBe('cube');
    expect(info?.ownerName).toBe('My Cube');
    expect(info?.cardName).toBe('Sol Ring');
    // Legacy aliases: deckId is '' so "is it in THIS deck" checks treat it as elsewhere.
    expect(info?.deckId).toBe('');
    expect(info?.deckName).toBe('My Cube');
  });

  it('ignores cubes not flagged physical', () => {
    const map = buildAllocationMap(
      [],
      [savedCube({ isPhysical: false, picks: [cubeSlot('Sol Ring', 'copy-x')] })]
    );
    expect(map.size).toBe(0);
  });

  it('ignores cube slots with no bound copy', () => {
    const map = buildAllocationMap([], [savedCube({ picks: [cubeSlot('Sol Ring', null)] })]);
    expect(map.size).toBe(0);
  });

  it('stays deck-only when no cubes are passed (back-compat)', () => {
    const d = deck({
      cards: [{ slotId: 's1', card: { name: 'Sol Ring' } as never, allocatedCopyId: 'c1' }],
    });
    expect(buildAllocationMap([d]).size).toBe(1);
    expect(buildAllocationMap([d]).get('c1')?.ownerKind).toBe('deck');
  });

  it('lets a deck steal a copy held by a physical cube (leave-gap cube donor)', () => {
    const collection = [card({ copyId: 'copy-x', name: 'Sol Ring' })];
    const cube = savedCube({ picks: [cubeSlot('Sol Ring', 'copy-x')] });
    // The only copy is committed to a cube → no free copy, but a cube copy is now
    // consciously pullable as a leave-gap (released by copyId, no slot).
    const res = findStealableCopy('Sol Ring', collection, [], 'd-target', undefined, [cube]);
    expect(res).toMatchObject({
      copyId: 'copy-x',
      donorKind: 'cube',
      donorId: 'cube-1',
      donorDeckId: '', // legacy alias '' → "is it in THIS deck" checks treat it elsewhere
      donorDeckName: 'My Cube',
      donorZone: 'cube',
      donorSlotId: null,
    });
    expect(res?.donorCard).toBeUndefined(); // cube donor carries no card payload
  });

  it('prefers a free copy over pulling from a physical cube', () => {
    const collection = [
      card({ copyId: 'in-cube', name: 'Sol Ring' }),
      card({ copyId: 'free', name: 'Sol Ring' }),
    ];
    const cube = savedCube({ picks: [cubeSlot('Sol Ring', 'in-cube')] });
    // A free copy exists → no steal needed at all.
    expect(findStealableCopy('Sol Ring', collection, [], 'd-target', undefined, [cube])).toBeNull();
  });

  it('ignores a non-physical cube as a donor', () => {
    const collection = [card({ copyId: 'copy-x', name: 'Sol Ring' })];
    const cube = savedCube({ isPhysical: false, picks: [cubeSlot('Sol Ring', 'copy-x')] });
    // A draft (non-physical) cube claims nothing → the copy reads as free → no steal.
    expect(findStealableCopy('Sol Ring', collection, [], 'd-target', undefined, [cube])).toBeNull();
  });

  it('lists a cube-committed card as contested with a cube donor', () => {
    const collection = [card({ copyId: 'copy-x', name: 'Sol Ring' })];
    const cube = savedCube({ picks: [cubeSlot('Sol Ring', 'copy-x')] });
    const current = deck({
      id: 'd1',
      cards: [
        { slotId: 's1', card: { name: 'Sol Ring', id: 'sf-1' } as never, allocatedCopyId: null },
      ],
    });
    const contested = listContestedCards(current, collection, [current], [cube]);
    expect(contested).toMatchObject([
      { slotId: 's1', cardName: 'Sol Ring', donorKind: 'cube', donorDeckName: 'My Cube', owned: 1 },
    ]);
  });

  it('planCardAdd lists (not binds) when the only copy is in a physical cube', () => {
    const collection = [card({ copyId: 'copy-x', name: 'Sol Ring' })];
    const cube = savedCube({ picks: [cubeSlot('Sol Ring', 'copy-x')] });
    // An add never steals — it only binds free copies; a cube-only card stays listed.
    expect(planCardAdd('Sol Ring', undefined, collection, [], [cube]).kind).toBe('list');
  });
});

describe('classifyPrintingAvailability', () => {
  it('returns unowned when no copy of the printing exists', () => {
    const collection = [card({ copyId: 'a', scryfallId: 'sf-other' })];
    const map = buildAllocationMap([]);
    expect(classifyPrintingAvailability('sf-target', collection, map)).toBe('unowned');
  });

  it('returns owned when a free copy of the printing exists', () => {
    const collection = [card({ copyId: 'a', scryfallId: 'sf-target' })];
    const map = buildAllocationMap([]);
    expect(classifyPrintingAvailability('sf-target', collection, map)).toBe('owned');
  });

  it('returns in-other-deck when every copy of the printing is in another deck', () => {
    const collection = [card({ copyId: 'a', name: 'Sol Ring', scryfallId: 'sf-target' })];
    const other = deck({
      id: 'other',
      cards: [
        {
          slotId: 's1',
          card: { name: 'Sol Ring', id: 'sf-target' } as ScryfallCard,
          allocatedCopyId: 'a',
        },
      ],
    });
    const map = buildAllocationMap([other]);
    expect(classifyPrintingAvailability('sf-target', collection, map, 'current')).toBe(
      'in-other-deck'
    );
  });

  it('counts a copy allocated to the current deck as free (owned)', () => {
    const collection = [card({ copyId: 'a', name: 'Sol Ring', scryfallId: 'sf-target' })];
    const current = deck({
      id: 'current',
      cards: [
        {
          slotId: 's1',
          card: { name: 'Sol Ring', id: 'sf-target' } as ScryfallCard,
          allocatedCopyId: 'a',
        },
      ],
    });
    const map = buildAllocationMap([current]);
    expect(classifyPrintingAvailability('sf-target', collection, map, 'current')).toBe('owned');
  });

  it('returns owned when some copies are claimed but at least one is free', () => {
    const collection = [
      card({ copyId: 'a', name: 'Sol Ring', scryfallId: 'sf-target' }),
      card({ copyId: 'b', name: 'Sol Ring', scryfallId: 'sf-target' }),
    ];
    const other = deck({
      id: 'other',
      cards: [
        {
          slotId: 's1',
          card: { name: 'Sol Ring', id: 'sf-target' } as ScryfallCard,
          allocatedCopyId: 'a',
        },
      ],
    });
    const map = buildAllocationMap([other]);
    expect(classifyPrintingAvailability('sf-target', collection, map, 'current')).toBe('owned');
  });

  it('returns in-cube when every copy is committed to a physical cube', () => {
    const collection = [card({ copyId: 'a', name: 'Sol Ring', scryfallId: 'sf-target' })];
    const cube: SavedCube = {
      id: 'cube-1',
      name: 'My Cube',
      size: 540,
      cube: { picks: [] } as never,
      picks: [
        {
          slotId: 'Sol Ring',
          card: { name: 'Sol Ring' } as never,
          allocatedCopyId: 'a',
          printingFinishKey: null,
        },
      ],
      isPhysical: true,
      savedAt: 0,
    };
    const map = buildAllocationMap([], [cube]);
    expect(classifyPrintingAvailability('sf-target', collection, map, 'current')).toBe('in-cube');
  });
});

describe('computeSurplusByName', () => {
  it('flags a card with unallocated copies beyond the first kept copy', () => {
    const cards = [
      card({ copyId: 'a', name: 'Sol Ring' }),
      card({ copyId: 'b', name: 'Sol Ring' }),
      card({ copyId: 'c', name: 'Sol Ring' }),
    ];
    const surplus = computeSurplusByName(cards, new Map());
    // 3 unallocated - 1 kept = 2 tradeable.
    expect(surplus.get('Sol Ring')).toBe(2);
  });

  it('does not flag a card with exactly one unallocated copy', () => {
    const cards = [card({ copyId: 'a', name: 'Sol Ring' })];
    const surplus = computeSurplusByName(cards, new Map());
    expect(surplus.has('Sol Ring')).toBe(false);
  });

  it('does not flag a fully allocated card', () => {
    const d = deck({
      cards: [{ slotId: 's1', card: { name: 'Sol Ring' } as never, allocatedCopyId: 'a' }],
    });
    const cards = [card({ copyId: 'a', name: 'Sol Ring' })];
    const allocations = buildAllocationMap([d]);
    const surplus = computeSurplusByName(cards, allocations);
    expect(surplus.has('Sol Ring')).toBe(false);
  });

  it('subtracts only the allocated copies, leaving the rest as surplus', () => {
    const d = deck({
      cards: [{ slotId: 's1', card: { name: 'Sol Ring' } as never, allocatedCopyId: 'a' }],
    });
    const cards = [
      card({ copyId: 'a', name: 'Sol Ring' }),
      card({ copyId: 'b', name: 'Sol Ring' }),
      card({ copyId: 'c', name: 'Sol Ring' }),
    ];
    const allocations = buildAllocationMap([d]);
    // 1 allocated, 2 unallocated - 1 kept = 1 tradeable.
    const surplus = computeSurplusByName(cards, allocations);
    expect(surplus.get('Sol Ring')).toBe(1);
  });

  it('excludes basic lands even with many unallocated copies', () => {
    const cards = [
      card({ copyId: 'a', name: 'Forest', scryfallId: 'sf-forest-1' }),
      card({ copyId: 'b', name: 'Forest', scryfallId: 'sf-forest-1' }),
      card({ copyId: 'c', name: 'Forest', scryfallId: 'sf-forest-1' }),
      card({ copyId: 'd', name: 'Snow-Covered Forest', scryfallId: 'sf-forest-2' }),
      card({ copyId: 'e', name: 'Snow-Covered Forest', scryfallId: 'sf-forest-2' }),
    ];
    const surplus = computeSurplusByName(cards, new Map());
    expect(surplus.size).toBe(0);
  });

  it('combines copies of a card across multiple printings by name', () => {
    const cards = [
      card({ copyId: 'a', name: 'Sol Ring', scryfallId: 'sf-1', setCode: 'CMR' }),
      card({ copyId: 'b', name: 'Sol Ring', scryfallId: 'sf-2', setCode: 'C21' }),
      card({ copyId: 'c', name: 'Sol Ring', scryfallId: 'sf-3', setCode: 'LTC' }),
    ];
    const surplus = computeSurplusByName(cards, new Map());
    expect(surplus.get('Sol Ring')).toBe(2);
  });
});
