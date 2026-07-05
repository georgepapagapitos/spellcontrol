import { describe, it, expect } from 'vitest';
import { computeBinderMoves, diffMembershipByDefs, formatBinderMoveMessage } from './binder-moves';
import type { BinderDef, BinderFilter, EnrichedCard } from '../types';

function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'Test Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `id-${Math.random()}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    cmc: 2,
    typeLine: 'Instant',
    colorIdentity: ['R'],
    ...overrides,
  };
}

function makeBinder(name: string, filter: BinderFilter, position = 0): BinderDef {
  return {
    id: `binder-${name}`,
    name,
    position,
    filterGroups: [{ filter }],
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('computeBinderMoves', () => {
  it('emits a price move when a card crosses a binder threshold (into a binder)', () => {
    // "High Value" binder = price >= 50. The card starts at $40 (Uncategorized),
    // then a refresh prices it at $60 → it auto-enters High Value.
    const binder = makeBinder('High Value', { priceMin: 50 });
    const before = makeCard({ copyId: 'c1', name: 'Sol Ring', purchasePrice: 40 });
    const after = { ...before, purchasePrice: 60 };

    const moves = computeBinderMoves([before], [after], [binder]);

    expect(moves).toHaveLength(1);
    const m = moves[0];
    expect(m.copyId).toBe('c1');
    expect(m.fromBinder).toBeNull(); // was Uncategorized
    expect(m.toBinder).toEqual({ id: 'binder-High Value', name: 'High Value' });
    expect(m.reason).toEqual({
      kind: 'price',
      detail: { priceBefore: 40, priceAfter: 60 },
    });
  });

  it('emits a move OUT to Uncategorized when a price drops below threshold', () => {
    const binder = makeBinder('High Value', { priceMin: 50 });
    const before = makeCard({ copyId: 'c1', name: 'Sol Ring', purchasePrice: 60 });
    const after = { ...before, purchasePrice: 40 };

    const moves = computeBinderMoves([before], [after], [binder]);

    expect(moves).toHaveLength(1);
    expect(moves[0].fromBinder).toEqual({ id: 'binder-High Value', name: 'High Value' });
    expect(moves[0].toBinder).toBeNull();
    expect(moves[0].reason.detail).toEqual({ priceBefore: 60, priceAfter: 40 });
  });

  it('emits a binder→binder move when a price crosses between two thresholds', () => {
    // Position order matters: a card joins the FIRST matching binder. Budget
    // (<25) sits before High (>=50); a $10→$80 jump moves Budget → High.
    const budget = makeBinder('Budget', { priceMax: 25 }, 0);
    const high = makeBinder('High', { priceMin: 50 }, 1);
    const before = makeCard({ copyId: 'c1', name: 'Mana Crypt', purchasePrice: 10 });
    const after = { ...before, purchasePrice: 80 };

    const moves = computeBinderMoves([before], [after], [budget, high]);

    expect(moves).toHaveLength(1);
    expect(moves[0].fromBinder?.name).toBe('Budget');
    expect(moves[0].toBinder?.name).toBe('High');
  });

  it('does not emit a move when membership is unchanged despite a price change', () => {
    const binder = makeBinder('High Value', { priceMin: 50 });
    const before = makeCard({ copyId: 'c1', purchasePrice: 60 });
    const after = { ...before, purchasePrice: 70 }; // still >= 50

    expect(computeBinderMoves([before], [after], [binder])).toEqual([]);
  });

  it('ignores deck-allocated copies for binders that hide them', () => {
    const binder = { ...makeBinder('High Value', { priceMin: 50 }), hideDeckAllocated: false };
    const before = makeCard({ copyId: 'c1', purchasePrice: 40 });
    const after = { ...before, purchasePrice: 60 };

    const moves = computeBinderMoves([before], [after], [binder], {
      allocatedCopyIds: new Set(['c1']),
    });
    expect(moves).toEqual([]);
  });

  it('still reports an allocated copy when the binder does not hide allocations', () => {
    // Default binders keep deck-allocated copies visible, so a price-driven
    // move of one is a real, user-visible event worth surfacing.
    const binder = makeBinder('High Value', { priceMin: 50 });
    const before = makeCard({ copyId: 'c1', purchasePrice: 40 });
    const after = { ...before, purchasePrice: 60 };

    const moves = computeBinderMoves([before], [after], [binder], {
      allocatedCopyIds: new Set(['c1']),
    });
    expect(moves).toHaveLength(1);
  });

  it('returns [] when there are no binders', () => {
    const before = makeCard({ purchasePrice: 40 });
    const after = { ...before, purchasePrice: 60 };
    expect(computeBinderMoves([before], [after], [])).toEqual([]);
  });

  it('sorts moves by card name', () => {
    const binder = makeBinder('High Value', { priceMin: 50 });
    const zed = makeCard({ copyId: 'z', name: 'Zed', purchasePrice: 40 });
    const ace = makeCard({ copyId: 'a', name: 'Ace', purchasePrice: 40 });
    const moves = computeBinderMoves(
      [zed, ace],
      [
        { ...zed, purchasePrice: 60 },
        { ...ace, purchasePrice: 60 },
      ],
      [binder]
    );
    expect(moves.map((m) => m.card.name)).toEqual(['Ace', 'Zed']);
  });
});

describe('diffMembershipByDefs', () => {
  it('counts cards whose binder changes when reordering swaps priority', () => {
    // Budget (<=25) before High (>=50); a $10 card sits in Budget either way,
    // but reordering to put High first doesn't change a $10 card's home.
    const budget = makeBinder('Budget', { priceMax: 25 }, 0);
    const high = makeBinder('High', { priceMin: 50 }, 1);
    const cheap = makeCard({ copyId: 'c1', purchasePrice: 10 });
    const dual = makeCard({ copyId: 'c2', purchasePrice: 10 }); // also matches only Budget

    const oldDefs = [budget, high];
    const newDefs = [
      { ...high, position: 0 },
      { ...budget, position: 1 },
    ];

    expect(diffMembershipByDefs([cheap, dual], oldDefs, newDefs)).toBe(0);
  });

  it('counts a card that moves to a different binder after reordering', () => {
    // A $60 card matches both a broad binder (price>=0) and High (price>=50).
    // Swapping which one comes first changes where it lands.
    const broad = makeBinder('Broad', { priceMin: 0 }, 0);
    const high = makeBinder('High', { priceMin: 50 }, 1);
    const card = makeCard({ copyId: 'c1', purchasePrice: 60 });

    const oldDefs = [broad, high];
    const newDefs = [
      { ...high, position: 0 },
      { ...broad, position: 1 },
    ];

    expect(diffMembershipByDefs([card], oldDefs, newDefs)).toBe(1);
  });

  it('returns 0 when the defs are unchanged', () => {
    const binder = makeBinder('High', { priceMin: 50 });
    const card = makeCard({ purchasePrice: 60 });
    expect(diffMembershipByDefs([card], [binder], [binder])).toBe(0);
  });

  it('counts Uncategorized as its own bucket', () => {
    // Removing the only binder sends the card to Uncategorized — a real change.
    const binder = makeBinder('High', { priceMin: 50 });
    const card = makeCard({ purchasePrice: 60 });
    expect(diffMembershipByDefs([card], [binder], [])).toBe(1);
  });
});

describe('formatBinderMoveMessage', () => {
  it('renders an into-binder move with an up arrow', () => {
    const msg = formatBinderMoveMessage({
      copyId: 'c1',
      card: makeCard({ name: 'Sol Ring' }),
      fromBinder: null,
      toBinder: { id: 'b', name: 'High Value' },
      reason: { kind: 'price', detail: { priceBefore: 40, priceAfter: 60 } },
    });
    expect(msg).toBe('Sol Ring moved to High Value (price ↑)');
  });

  it('renders a left-binder move with a down arrow', () => {
    const msg = formatBinderMoveMessage({
      copyId: 'c1',
      card: makeCard({ name: 'Sol Ring' }),
      fromBinder: { id: 'b', name: 'High Value' },
      toBinder: null,
      reason: { kind: 'price', detail: { priceBefore: 60, priceAfter: 40 } },
    });
    expect(msg).toBe('Sol Ring left High Value (price ↓)');
  });
});
