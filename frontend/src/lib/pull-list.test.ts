import { describe, it, expect } from 'vitest';
import { buildPullList, isPullableKind } from './pull-list';
import type { AllocationInfo } from './allocations';
import type { Deck, DeckCard } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import type { BinderDef, BinderFilter, EnrichedCard } from '../types';

function makeCopy(overrides: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'sf-test',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  } as EnrichedCard;
}

function makeBinder(
  overrides: Partial<Omit<BinderDef, 'filterGroups'>> & { filter?: BinderFilter } = {}
): BinderDef {
  const { filter, ...rest } = overrides;
  return {
    id: `binder-${Math.random()}`,
    name: 'Test Binder',
    position: 0,
    filterGroups: [{ filter: filter ?? {} }],
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: 0,
    updatedAt: 0,
    ...rest,
  };
}

function makeScry(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-test',
    oracle_id: 'oid-test',
    name: 'Test Card',
    type_line: 'Artifact',
    rarity: 'common',
    set: 'tst',
    collector_number: '1',
    layout: 'normal',
    ...overrides,
  } as ScryfallCard;
}

let slotCounter = 0;
function slot(card: ScryfallCard, allocatedCopyId: string | null = null): DeckCard {
  return { slotId: `slot-${slotCounter++}`, card, allocatedCopyId };
}

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'My Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

function claim(ownerId: string, ownerName: string, cardName: string): AllocationInfo {
  return {
    ownerKind: 'deck',
    ownerId,
    ownerName,
    ownerColor: '',
    deckId: ownerId,
    deckName: ownerName,
    deckColor: '',
    cardName,
  };
}

const noAlloc = new Map<string, AllocationInfo>();

describe('buildPullList', () => {
  it('groups allocated copies by binder in position order', () => {
    const sol = makeCopy({ copyId: 'c1', name: 'Sol Ring', rarity: 'rare', scryfallId: 'sf-sol' });
    const bolt = makeCopy({ copyId: 'c2', name: 'Lightning Bolt', scryfallId: 'sf-bolt' });
    const rares = makeBinder({
      id: 'rares',
      name: 'Rares',
      position: 1,
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    const everything = makeBinder({ id: 'all', name: 'Everything', position: 0, filter: {} });
    // "Everything" (position 0) claims both cards first-match-wins.
    const deck = makeDeck({
      cards: [
        slot(makeScry({ name: 'Sol Ring', id: 'sf-sol' }), 'c1'),
        slot(makeScry({ name: 'Lightning Bolt', id: 'sf-bolt' }), 'c2'),
      ],
    });
    const groups = buildPullList(deck, [sol, bolt], [everything, rares], noAlloc);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'binder:all', kind: 'binder', label: 'Everything' });
    // Name-sorted binder → Lightning Bolt before Sol Ring, same as the binder view.
    expect(groups[0].rows.map((r) => r.name)).toEqual(['Lightning Bolt', 'Sol Ring']);
    expect(groups[0].rows[0].pageStart).toBe(1);
  });

  it('orders binder groups by position and rows by the binder’s own sort', () => {
    const a = makeCopy({ copyId: 'a', name: 'Aaa', scryfallId: 'sf-a' });
    const z = makeCopy({ copyId: 'z', name: 'Zzz', rarity: 'rare', scryfallId: 'sf-z' });
    const rares = makeBinder({
      id: 'rares',
      name: 'Rares',
      position: 0,
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    const rest = makeBinder({ id: 'rest', name: 'Rest', position: 1, filter: {} });
    const deck = makeDeck({
      cards: [
        slot(makeScry({ name: 'Aaa', id: 'sf-a' }), 'a'),
        slot(makeScry({ name: 'Zzz', id: 'sf-z' }), 'z'),
      ],
    });
    const groups = buildPullList(deck, [a, z], [rares, rest], noAlloc);
    expect(groups.map((g) => g.label)).toEqual(['Rares', 'Rest']);
  });

  it('rolls up identical printing+finish copies into one row with all copyIds', () => {
    const c1 = makeCopy({ copyId: 'c1', name: 'Forest', scryfallId: 'sf-forest' });
    const c2 = makeCopy({ copyId: 'c2', name: 'Forest', scryfallId: 'sf-forest' });
    const binder = makeBinder({ id: 'b', name: 'B', filter: {} });
    const deck = makeDeck({
      cards: [
        slot(makeScry({ name: 'Forest', id: 'sf-forest' }), 'c1'),
        slot(makeScry({ name: 'Forest', id: 'sf-forest' }), 'c2'),
      ],
    });
    const groups = buildPullList(deck, [c1, c2], [binder], noAlloc);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].qty).toBe(2);
    expect(groups[0].rows[0].copyIds.sort()).toEqual(['c1', 'c2']);
  });

  it('reports the physical page range when a pile spans pages', () => {
    // 10 copies, 9-pocket pages → the pile spans pages 1–2.
    const copies = Array.from({ length: 10 }, (_, i) =>
      makeCopy({ copyId: `c${i}`, name: 'Forest', scryfallId: 'sf-forest' })
    );
    const binder = makeBinder({ id: 'b', name: 'B', filter: {} });
    const deck = makeDeck({
      cards: copies.map((c) => slot(makeScry({ name: 'Forest', id: 'sf-forest' }), c.copyId)),
    });
    const groups = buildPullList(deck, copies, [binder], noAlloc);
    expect(groups[0].rows[0]).toMatchObject({ qty: 10, pageStart: 1, pageEnd: 2 });
  });

  it('files copies matching no binder under Uncategorized, after binders', () => {
    const rare = makeCopy({ copyId: 'r', name: 'Rare Card', rarity: 'rare', scryfallId: 'sf-r' });
    const common = makeCopy({ copyId: 'c', name: 'Common Card', scryfallId: 'sf-c' });
    const rares = makeBinder({
      id: 'rares',
      name: 'Rares',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    const deck = makeDeck({
      cards: [
        slot(makeScry({ name: 'Rare Card', id: 'sf-r' }), 'r'),
        slot(makeScry({ name: 'Common Card', id: 'sf-c' }), 'c'),
      ],
    });
    const groups = buildPullList(deck, [rare, common], [rares], noAlloc);
    expect(groups.map((g) => g.kind)).toEqual(['binder', 'uncategorized']);
    expect(groups[1].rows[0].name).toBe('Common Card');
    expect(groups[1].rows[0].pageStart).toBeUndefined();
  });

  it('borrows a free copy for an unbound slot, preferring the slot’s printing', () => {
    const plain = makeCopy({ copyId: 'plain', name: 'Sol Ring', scryfallId: 'sf-plain' });
    const promo = makeCopy({ copyId: 'promo', name: 'Sol Ring', scryfallId: 'sf-promo' });
    const binder = makeBinder({ id: 'b', name: 'B', filter: {} });
    const deck = makeDeck({ cards: [slot(makeScry({ name: 'Sol Ring', id: 'sf-promo' }))] });
    const groups = buildPullList(deck, [plain, promo], [binder], noAlloc);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].copyIds).toEqual(['promo']);
  });

  it('borrows distinct free copies for multiple unbound slots of the same name', () => {
    const c1 = makeCopy({ copyId: 'c1', name: 'Forest', scryfallId: 'sf-forest' });
    const c2 = makeCopy({ copyId: 'c2', name: 'Forest', scryfallId: 'sf-forest' });
    const binder = makeBinder({ id: 'b', name: 'B', filter: {} });
    const forest = makeScry({ name: 'Forest', id: 'sf-forest' });
    const deck = makeDeck({ cards: [slot(forest), slot(forest)] });
    const groups = buildPullList(deck, [c1, c2], [binder], noAlloc);
    expect(groups[0].rows[0].qty).toBe(2);
    expect(groups[0].rows[0].copyIds.sort()).toEqual(['c1', 'c2']);
  });

  it('lists cards whose only copies are in other decks under Allocated elsewhere', () => {
    const copy = makeCopy({ copyId: 'c1', name: 'Sol Ring', scryfallId: 'sf-sol' });
    const alloc = new Map([['c1', claim('deck-2', 'Gruul Aggro', 'Sol Ring')]]);
    const deck = makeDeck({ cards: [slot(makeScry({ name: 'Sol Ring', id: 'sf-sol' }))] });
    const groups = buildPullList(deck, [copy], [makeBinder({ filter: {} })], alloc);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'elsewhere', label: 'Allocated elsewhere' });
    expect(groups[0].rows[0]).toMatchObject({ name: 'Sol Ring', qty: 1, owners: ['Gruul Aggro'] });
  });

  it('lists unowned cards under Not owned', () => {
    const deck = makeDeck({ cards: [slot(makeScry({ name: 'Black Lotus', id: 'sf-lotus' }))] });
    const groups = buildPullList(deck, [], [makeBinder({ filter: {} })], noAlloc);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'unowned', label: 'Not owned' });
    expect(groups[0].rows[0]).toMatchObject({ name: 'Black Lotus', qty: 1, copyIds: [] });
  });

  it('does not count this deck’s own claims as "elsewhere" — shortfall reads Not owned', () => {
    // Deck wants 2 Forests, owns 1 (already bound to the first slot).
    const c1 = makeCopy({ copyId: 'c1', name: 'Forest', scryfallId: 'sf-forest' });
    const alloc = new Map([['c1', claim('deck-1', 'My Deck', 'Forest')]]);
    const forest = makeScry({ name: 'Forest', id: 'sf-forest' });
    const deck = makeDeck({ cards: [slot(forest, 'c1'), slot(forest)] });
    const groups = buildPullList(deck, [c1], [makeBinder({ filter: {} })], alloc);
    expect(groups.map((g) => g.kind)).toEqual(['binder', 'unowned']);
    expect(groups[1].rows[0].qty).toBe(1);
  });

  it('treats an orphaned allocatedCopyId as unbound and falls back to a free copy', () => {
    const free = makeCopy({ copyId: 'free', name: 'Sol Ring', scryfallId: 'sf-sol' });
    const deck = makeDeck({
      cards: [slot(makeScry({ name: 'Sol Ring', id: 'sf-sol' }), 'deleted-copy')],
    });
    const groups = buildPullList(deck, [free], [makeBinder({ filter: {} })], noAlloc);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('binder');
    expect(groups[0].rows[0].copyIds).toEqual(['free']);
  });

  it('includes commander and sideboard slots', () => {
    const cmd = makeCopy({ copyId: 'cmd', name: 'Atraxa', scryfallId: 'sf-atraxa' });
    const side = makeCopy({ copyId: 'side', name: 'Sideboard Card', scryfallId: 'sf-side' });
    const deck = makeDeck({
      commander: makeScry({ name: 'Atraxa', id: 'sf-atraxa' }),
      commanderAllocatedCopyId: 'cmd',
      sideboard: [slot(makeScry({ name: 'Sideboard Card', id: 'sf-side' }), 'side')],
    });
    const groups = buildPullList(deck, [cmd, side], [makeBinder({ filter: {} })], noAlloc);
    expect(groups[0].rows.map((r) => r.name).sort()).toEqual(['Atraxa', 'Sideboard Card']);
  });

  it('returns no groups for an empty deck', () => {
    expect(buildPullList(makeDeck(), [], [makeBinder()], noAlloc)).toEqual([]);
  });
});

describe('isPullableKind', () => {
  it('marks binder and uncategorized pullable, the rest informational', () => {
    expect(isPullableKind('binder')).toBe(true);
    expect(isPullableKind('uncategorized')).toBe(true);
    expect(isPullableKind('elsewhere')).toBe(false);
    expect(isPullableKind('unowned')).toBe(false);
  });
});
