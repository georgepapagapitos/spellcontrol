import { describe, it, expect } from 'vitest';
import {
  anyBinderUsesSpareCopies,
  availableCountsByName,
  collectAllocatedCopyIds,
  computeSpareCopyIds,
  decorateWithSpareCopies,
  isBasicLandName,
} from './surplus.js';
import { materializeBinders } from './materialize.js';
import type { BinderDef, EnrichedCard } from './types.js';

let n = 0;
function card(name: string, over: Partial<EnrichedCard> = {}): EnrichedCard {
  n += 1;
  return {
    copyId: `c${String(n).padStart(3, '0')}`,
    name,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: String(n),
    rarity: 'common',
    scryfallId: `s${n}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...over,
  };
}

describe('computeSpareCopyIds', () => {
  it('a single copy is never spare', () => {
    expect(computeSpareCopyIds([card('Sol Ring')], new Set())).toEqual(new Set());
  });

  it('keeps one copy per name and spares the rest', () => {
    const cards = [card('Sol Ring'), card('Sol Ring'), card('Sol Ring')];
    const spare = computeSpareCopyIds(cards, new Set());
    expect(spare.size).toBe(2);
    // Lowest copyId is the kept one when nothing else separates them.
    expect(spare.has(cards[0].copyId)).toBe(false);
  });

  it('keeps a foil or etched copy over a nonfoil one', () => {
    const plain = card('Sol Ring');
    const foil = card('Sol Ring', { finish: 'foil', foil: true });
    const etched = card('Arcane Signet', { finish: 'etched' });
    const plain2 = card('Arcane Signet');
    const spare = computeSpareCopyIds([plain, foil, plain2, etched], new Set());
    expect(spare).toEqual(new Set([plain.copyId, plain2.copyId]));
  });

  it('never counts a proxy: not spare, and not the copy kept either', () => {
    const proxy = card('Sol Ring', { proxy: true, finish: 'foil', foil: true });
    const real = card('Sol Ring');
    expect(computeSpareCopyIds([proxy, real], new Set())).toEqual(new Set());
    // Two real copies beside a proxy: one spare, and it is never the proxy.
    const real2 = card('Sol Ring');
    expect(computeSpareCopyIds([proxy, real, real2], new Set())).toEqual(new Set([real2.copyId]));
  });

  it('a claimed copy of any kind is not available, so it is never spare', () => {
    const a = card('Sol Ring');
    const b = card('Sol Ring');
    const c = card('Sol Ring');
    expect(computeSpareCopyIds([a, b, c], new Set([b.copyId]))).toEqual(new Set([c.copyId]));
  });

  it('never reads price, so a price refresh cannot change which copy is kept', () => {
    const a = card('Sol Ring', { purchasePrice: 1 });
    const b = card('Sol Ring', { purchasePrice: 50 });
    const before = computeSpareCopyIds([a, b], new Set());
    const after = computeSpareCopyIds(
      [
        { ...a, purchasePrice: 80 },
        { ...b, purchasePrice: 2 },
      ],
      new Set()
    );
    expect(after).toEqual(before);
  });

  it('gives the same answer whatever the collection order', () => {
    const cards = [card('Sol Ring'), card('Sol Ring'), card('Sol Ring', { finish: 'foil' })];
    const forward = computeSpareCopyIds(cards, new Set());
    const reversed = computeSpareCopyIds([...cards].reverse(), new Set());
    expect(reversed).toEqual(forward);
  });

  it('an allocated copy is never spare and does not use up the kept slot', () => {
    const inDeck = card('Sol Ring', { finish: 'foil' });
    const loose1 = card('Sol Ring');
    const loose2 = card('Sol Ring');
    const spare = computeSpareCopyIds([inDeck, loose1, loose2], new Set([inDeck.copyId]));
    // Two loose copies: one kept, one spare. The deck copy is neither.
    expect(spare).toEqual(new Set([loose2.copyId]));
  });

  it('basic lands are never spare, however many copies', () => {
    const forests = [card('Forest'), card('Forest'), card('Forest')];
    expect(computeSpareCopyIds(forests, new Set())).toEqual(new Set());
    expect(isBasicLandName('Forest')).toBe(true);
  });

  it('keepCopies is configurable', () => {
    const cards = [card('Sol Ring'), card('Sol Ring'), card('Sol Ring')];
    expect(computeSpareCopyIds(cards, new Set(), 2)).toEqual(new Set([cards[2].copyId]));
  });
});

describe('decorateWithSpareCopies', () => {
  it('stamps every card true/false, never leaving it undefined', () => {
    const kept = card('Sol Ring');
    const extra = card('Sol Ring');
    const only = card('Arcane Signet');
    const decorated = decorateWithSpareCopies([kept, extra, only], new Set());
    const byId = new Map(decorated.map((c) => [c.copyId, c.spareCopy]));
    expect(byId.get(kept.copyId)).toBe(false);
    expect(byId.get(extra.copyId)).toBe(true);
    expect(byId.get(only.copyId)).toBe(false);
  });

  it('a Spare copies binder routes exactly the spare copies', () => {
    const cards = [card('Sol Ring'), card('Sol Ring'), card('Arcane Signet')];
    const now = Date.now();
    const trade: BinderDef = {
      id: 'trade',
      name: 'Trade',
      position: 0,
      filterGroups: [{ filter: { spareCopies: true } }],
      sorts: [],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      color: '#000',
      createdAt: now,
      updatedAt: now,
    };
    const { binders, uncategorized } = materializeBinders(
      decorateWithSpareCopies(cards, new Set()),
      [trade],
      { search: '' }
    );
    expect(binders[0].totalCards).toBe(1);
    expect(uncategorized.totalCards).toBe(2);
  });
});

describe('anyBinderUsesSpareCopies', () => {
  it('finds the field in any group, IS or IS NOT', () => {
    expect(anyBinderUsesSpareCopies([{ filterGroups: [{ filter: { spareCopies: false } }] }])).toBe(
      true
    );
    expect(anyBinderUsesSpareCopies([{ filterGroups: [{ filter: { priceMin: 1 } }] }])).toBe(false);
  });

  it('tolerates malformed JSONB', () => {
    expect(anyBinderUsesSpareCopies(null)).toBe(false);
    expect(anyBinderUsesSpareCopies([null, 'x', { filterGroups: 'nope' }])).toBe(false);
  });
});

describe('collectAllocatedCopyIds', () => {
  it('reads every deck zone and physical cube picks only', () => {
    const decks = [
      {
        commander: { name: 'Atraxa' },
        commanderAllocatedCopyId: 'cmd',
        partnerCommander: { name: 'Tymna' },
        partnerCommanderAllocatedCopyId: 'partner',
        cards: [{ allocatedCopyId: 'main' }, { allocatedCopyId: null }],
        sideboard: [{ allocatedCopyId: 'side' }],
        considering: [{ allocatedCopyId: 'maybe' }],
        extras: [{ allocatedCopyId: 'box' }],
      },
      // A stale commander copy id with no commander set is not a claim.
      { commander: null, commanderAllocatedCopyId: 'stale', cards: [] },
    ];
    const cubes = [
      { isPhysical: true, picks: [{ allocatedCopyId: 'cube' }] },
      { isPhysical: false, picks: [{ allocatedCopyId: 'virtual' }] },
    ];
    expect(collectAllocatedCopyIds(decks, cubes)).toEqual(
      new Set(['cmd', 'partner', 'main', 'side', 'maybe', 'box', 'cube'])
    );
  });

  it('tolerates malformed JSONB', () => {
    expect(collectAllocatedCopyIds(null, undefined)).toEqual(new Set());
    expect(collectAllocatedCopyIds([null, 3, { cards: 'x' }], [{ picks: null }])).toEqual(
      new Set()
    );
  });
});

describe('availableCountsByName', () => {
  it('counts copies no deck or cube claims, basics and proxies included', () => {
    const a = card('Sol Ring');
    const b = card('Sol Ring', { proxy: true });
    const c = card('Sol Ring');
    const f = card('Forest');
    const counts = availableCountsByName([a, b, c, f], new Set([c.copyId]));
    expect(counts.get('Sol Ring')).toBe(2);
    expect(counts.get('Forest')).toBe(1);
  });

  it('omits a name whose every copy is claimed', () => {
    const a = card('Sol Ring');
    expect(availableCountsByName([a], new Set([a.copyId])).has('Sol Ring')).toBe(false);
  });
});
