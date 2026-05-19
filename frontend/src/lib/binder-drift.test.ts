import { describe, it, expect } from 'vitest';
import { captureBinderSnapshot, computeDrift, formatDriftReason, hasDrift } from './binder-drift';
import { materializeBinders } from './materialize';
import { printingFinishKey } from './collection-mutations';
import type {
  BinderDef,
  BinderFilter,
  BinderFilterGroup,
  EnrichedCard,
  MaterializedBinder,
} from '../types';

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

type BinderOverrides = Omit<Partial<BinderDef>, 'filterGroups'> & {
  filter?: BinderFilter;
  filterGroups?: BinderFilterGroup[];
};

function makeBinder(overrides: BinderOverrides = {}): BinderDef {
  const { filter, filterGroups, ...rest } = overrides;
  const groups: BinderFilterGroup[] =
    filterGroups ?? (filter !== undefined ? [{ filter }] : [{ filter: {} }]);
  return {
    id: `binder-${Math.random()}`,
    name: 'Test Binder',
    position: 0,
    filterGroups: groups,
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...rest,
  };
}

function materializeOne(cards: EnrichedCard[], def: BinderDef): MaterializedBinder {
  const { binders } = materializeBinders(cards, [def], {
    globalPocketSize: 9,
    search: '',
  });
  return binders[0];
}

describe('captureBinderSnapshot', () => {
  it('records every printingFinishKey currently in the binder', () => {
    const a = makeCard({ scryfallId: 'a', name: 'Alpha', purchasePrice: 6 });
    const b = makeCard({ scryfallId: 'b', name: 'Bravo', purchasePrice: 12 });
    const binder = makeBinder({ filter: { priceMin: 5 } });
    const mat = materializeOne([a, b], binder);

    const snap = captureBinderSnapshot(mat);
    expect(new Set(snap.keys)).toEqual(new Set([printingFinishKey(a), printingFinishKey(b)]));
    expect(snap.cardSnapshots[printingFinishKey(a)]).toEqual({ price: 6 });
    expect(snap.cardSnapshots[printingFinishKey(b)]).toEqual({ price: 12 });
  });

  it('dedupes by printingFinishKey when multiple copies share a printing', () => {
    const c1 = makeCard({ scryfallId: 'x', purchasePrice: 6 });
    const c2 = makeCard({ scryfallId: 'x', purchasePrice: 6 });
    const binder = makeBinder({ filter: { priceMin: 5 } });
    const mat = materializeOne([c1, c2], binder);

    const snap = captureBinderSnapshot(mat);
    expect(snap.keys).toHaveLength(1);
  });

  it('snapshots edhrecRank when present', () => {
    const c = makeCard({ scryfallId: 'e', edhrecRank: 42, purchasePrice: 1 });
    const binder = makeBinder({ filter: { edhrecRankMax: 100 } });
    const mat = materializeOne([c], binder);

    const snap = captureBinderSnapshot(mat);
    expect(snap.cardSnapshots[printingFinishKey(c)]).toEqual({
      price: 1,
      edhrecRank: 42,
    });
  });
});

describe('computeDrift', () => {
  it('reports neverReviewed when no snapshot exists', () => {
    const c = makeCard();
    const binder = makeBinder();
    const mat = materializeOne([c], binder);

    const result = computeDrift(mat, [c]);
    expect(result.neverReviewed).toBe(true);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('flags a card that just qualified due to a price increase', () => {
    const card = makeCard({ scryfallId: 'p', name: 'Pricey', purchasePrice: 8 });
    const binder = makeBinder({
      filter: { priceMin: 5 },
      lastReviewedSnapshot: {
        at: Date.now() - 86_400_000,
        keys: [], // empty snapshot = card wasn't in the binder before
        cardSnapshots: {
          // We had observed the card at $3 before — under the $5 threshold.
          [printingFinishKey(card)]: { price: 3 },
        },
      },
    });
    const mat = materializeOne([card], binder);
    const result = computeDrift(mat, [card]);

    expect(result.added).toHaveLength(1);
    expect(result.added[0].reason.kind).toBe('price');
    expect(result.added[0].reason.detail).toEqual({ priceBefore: 3, priceAfter: 8 });
    expect(result.removed).toEqual([]);
  });

  it('flags a card that fell out due to a price drop', () => {
    const card = makeCard({ scryfallId: 'd', name: 'Dropped', purchasePrice: 2 });
    const binder = makeBinder({
      filter: { priceMin: 5 },
      lastReviewedSnapshot: {
        at: Date.now() - 86_400_000,
        keys: [printingFinishKey(card)],
        cardSnapshots: { [printingFinishKey(card)]: { price: 7 } },
      },
    });
    const mat = materializeOne([card], binder);
    const result = computeDrift(mat, [card]);

    expect(result.added).toEqual([]);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].reason.kind).toBe('price');
    expect(result.removed[0].reason.detail).toEqual({ priceBefore: 7, priceAfter: 2 });
  });

  it('reports "collection" for cards removed entirely from the collection', () => {
    const ghostKey = 'gone:nonfoil';
    const binder = makeBinder({
      filter: { priceMin: 5 },
      lastReviewedSnapshot: {
        at: Date.now() - 86_400_000,
        keys: [ghostKey],
        cardSnapshots: { [ghostKey]: { price: 7 } },
      },
    });
    const mat = materializeOne([], binder);
    const result = computeDrift(mat, []);

    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].reason.kind).toBe('collection');
  });

  it('falls back to "other" when volatile values are unchanged', () => {
    const card = makeCard({ scryfallId: 'r', name: 'Rule', purchasePrice: 1 });
    const binder = makeBinder({
      filter: { priceMin: 5 }, // card doesn't currently match
      lastReviewedSnapshot: {
        at: Date.now() - 86_400_000,
        keys: [printingFinishKey(card)],
        cardSnapshots: { [printingFinishKey(card)]: { price: 1 } },
      },
    });
    const mat = materializeOne([card], binder);
    const result = computeDrift(mat, [card]);

    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].reason.kind).toBe('other');
  });

  it('flags an EDHREC rank improvement', () => {
    const card = makeCard({
      scryfallId: 'e',
      name: 'Edhrec',
      purchasePrice: 1,
      edhrecRank: 50,
    });
    const binder = makeBinder({
      filter: { edhrecRankMax: 100 },
      lastReviewedSnapshot: {
        at: Date.now(),
        keys: [],
        cardSnapshots: {
          [printingFinishKey(card)]: { price: 1, edhrecRank: 150 },
        },
      },
    });
    const mat = materializeOne([card], binder);
    const result = computeDrift(mat, [card]);

    expect(result.added).toHaveLength(1);
    expect(result.added[0].reason.kind).toBe('edhrec');
    expect(result.added[0].reason.detail).toEqual({ edhrecBefore: 150, edhrecAfter: 50 });
  });

  it('ignores sub-cent price flicker (epsilon)', () => {
    const card = makeCard({ scryfallId: 'f', name: 'Flick', purchasePrice: 5.001 });
    const binder = makeBinder({
      filter: { priceMin: 5 },
      lastReviewedSnapshot: {
        at: Date.now(),
        keys: [printingFinishKey(card)],
        cardSnapshots: { [printingFinishKey(card)]: { price: 5.0 } },
      },
    });
    const mat = materializeOne([card], binder);
    const result = computeDrift(mat, [card]);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('attributes a newly-imported card to its import when newer than snapshot', () => {
    const snapshotAt = Date.now() - 86_400_000;
    const card = makeCard({
      scryfallId: 'i',
      name: 'Imported',
      purchasePrice: 8,
      importId: 'imp-1',
    });
    const binder = makeBinder({
      filter: { priceMin: 5 },
      lastReviewedSnapshot: {
        at: snapshotAt,
        keys: [], // card wasn't in the binder at snapshot time
        cardSnapshots: {}, // and we hadn't observed it
      },
    });
    const mat = materializeOne([card], binder);
    const history = [
      {
        id: 'imp-1',
        name: 'manabox.csv',
        count: 1,
        format: 'manabox',
        addedAt: snapshotAt + 3_600_000,
      },
    ];
    const result = computeDrift(mat, [card], history);

    expect(result.added).toHaveLength(1);
    expect(result.added[0].reason.kind).toBe('imported');
    expect(result.added[0].reason.detail?.importName).toBe('manabox.csv');
  });

  it('ignores imports older than the snapshot', () => {
    const snapshotAt = Date.now();
    const card = makeCard({
      scryfallId: 'i2',
      name: 'OldImport',
      purchasePrice: 8,
      importId: 'imp-old',
    });
    const binder = makeBinder({
      filter: { priceMin: 5 },
      lastReviewedSnapshot: {
        at: snapshotAt,
        keys: [],
        cardSnapshots: {},
      },
    });
    const mat = materializeOne([card], binder);
    const history = [
      {
        id: 'imp-old',
        name: 'old.csv',
        count: 1,
        format: 'manabox',
        addedAt: snapshotAt - 86_400_000,
      },
    ];
    const result = computeDrift(mat, [card], history);

    expect(result.added).toHaveLength(1);
    expect(result.added[0].reason.kind).toBe('other');
  });

  it('prefers price reason over import attribution when both apply', () => {
    const snapshotAt = Date.now() - 86_400_000;
    const card = makeCard({
      scryfallId: 'p2',
      name: 'Both',
      purchasePrice: 8,
      importId: 'imp-1',
    });
    const binder = makeBinder({
      filter: { priceMin: 5 },
      lastReviewedSnapshot: {
        at: snapshotAt,
        keys: [],
        cardSnapshots: {
          [printingFinishKey(card)]: { price: 2 },
        },
      },
    });
    const mat = materializeOne([card], binder);
    const history = [
      {
        id: 'imp-1',
        name: 'manabox.csv',
        count: 1,
        format: 'manabox',
        addedAt: snapshotAt + 3_600_000,
      },
    ];
    const result = computeDrift(mat, [card], history);

    expect(result.added[0].reason.kind).toBe('price');
  });

  it('returns empty added/removed when membership is unchanged', () => {
    const card = makeCard({ scryfallId: 's', name: 'Stable', purchasePrice: 10 });
    const binder = makeBinder({
      filter: { priceMin: 5 },
      lastReviewedSnapshot: {
        at: Date.now(),
        keys: [printingFinishKey(card)],
        cardSnapshots: { [printingFinishKey(card)]: { price: 10 } },
      },
    });
    const mat = materializeOne([card], binder);
    const result = computeDrift(mat, [card]);

    expect(hasDrift(result)).toBe(false);
  });
});

describe('formatDriftReason', () => {
  it('formats a price drop', () => {
    expect(
      formatDriftReason({
        kind: 'price',
        detail: { priceBefore: 6.2, priceAfter: 4.8 },
      })
    ).toBe('price $6.20 → $4.80');
  });

  it('formats an edhrec rank change', () => {
    expect(
      formatDriftReason({
        kind: 'edhrec',
        detail: { edhrecBefore: 95, edhrecAfter: 112 },
      })
    ).toBe('EDHREC rank 95 → 112');
  });

  it('formats a collection removal', () => {
    expect(formatDriftReason({ kind: 'collection' })).toBe('no longer in collection');
  });

  it('formats an other change', () => {
    expect(formatDriftReason({ kind: 'other' })).toBe('rule or other change');
  });

  it('formats an imported reason with the source label', () => {
    expect(
      formatDriftReason({
        kind: 'imported',
        detail: { importName: 'manabox.csv', importedAt: Date.now() },
      })
    ).toBe('newly imported from manabox.csv');
  });

  it('falls back when imported reason has no source label', () => {
    expect(formatDriftReason({ kind: 'imported' })).toBe('newly imported');
  });
});
