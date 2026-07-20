import { describe, it, expect } from 'vitest';
import {
  buildReviewQueue,
  formatDestinationLabel,
  formatExcludeDestination,
  formatSourceLabel,
  sourceKey,
} from './binder-review-queue';
import { captureBinderSnapshot, computeDrift } from './binder-drift';
import { materializeBinders } from './materialize';
import { printingFinishKey } from './collection-mutations';
import type { BinderDef, BinderFilter, BinderFilterGroup, EnrichedCard } from '../types';

function makeCard(overrides: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
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
    ...overrides,
  } as EnrichedCard;
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

describe('buildReviewQueue', () => {
  it('groups a removed card by its live destination binder', () => {
    const rare = makeCard({ copyId: 'c1', name: 'Sol Ring', rarity: 'rare' });
    const rares = makeBinder({
      id: 'rares',
      position: 0,
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    const everything = makeBinder({ id: 'everything', position: 1, filter: {} });

    // Baseline: only `rares` exists, and it holds the card.
    const { binders: baselineBinders } = materializeBinders([rare], [rares], {
      globalPocketSize: 9,
      search: '',
    });
    const snapshot = captureBinderSnapshot(baselineBinders[0]);
    const reviewedRares = { ...rares, lastReviewedSnapshot: snapshot };

    // Now: the card became common (no longer matches `rares`), and a catch-all
    // binder was added — the card now lives there instead.
    const commonNow = { ...rare, rarity: 'common' };
    const { binders: liveBinders } = materializeBinders([commonNow], [reviewedRares, everything], {
      globalPocketSize: 9,
      search: '',
    });
    const raresLive = liveBinders.find((b) => b.def.id === 'rares')!;

    const drift = computeDrift(raresLive, [commonNow], []);
    expect(drift.removed).toHaveLength(1);

    const queue = buildReviewQueue(drift, raresLive, [commonNow], [reviewedRares, everything]);
    expect(queue.removedGroups).toHaveLength(1);
    expect(queue.removedGroups[0].destination).toEqual({
      kind: 'binder',
      binderId: 'everything',
      binderName: 'Test Binder',
    });
    expect(queue.removedGroups[0].rows[0].copyIds).toEqual(['c1']);
  });

  it('groups a removed card with no other match as uncategorized', () => {
    const rare = makeCard({ copyId: 'c1', name: 'Sol Ring', rarity: 'rare' });
    const rares = makeBinder({
      id: 'rares',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    const { binders: baselineBinders } = materializeBinders([rare], [rares], {
      globalPocketSize: 9,
      search: '',
    });
    const reviewedRares = {
      ...rares,
      lastReviewedSnapshot: captureBinderSnapshot(baselineBinders[0]),
    };

    const commonNow = { ...rare, rarity: 'common' };
    const { binders: liveBinders } = materializeBinders([commonNow], [reviewedRares], {
      globalPocketSize: 9,
      search: '',
    });
    const drift = computeDrift(liveBinders[0], [commonNow], []);

    const queue = buildReviewQueue(drift, liveBinders[0], [commonNow], [reviewedRares]);
    expect(queue.removedGroups[0].destination).toEqual({ kind: 'uncategorized' });
  });

  it('groups a removed card that left the collection entirely as not-owned', () => {
    const rare = makeCard({ copyId: 'c1', name: 'Sol Ring', rarity: 'rare' });
    const rares = makeBinder({
      id: 'rares',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    const { binders: baselineBinders } = materializeBinders([rare], [rares], {
      globalPocketSize: 9,
      search: '',
    });
    const reviewedRares = {
      ...rares,
      lastReviewedSnapshot: captureBinderSnapshot(baselineBinders[0]),
    };

    // Card is entirely gone now.
    const { binders: liveBinders } = materializeBinders([], [reviewedRares], {
      globalPocketSize: 9,
      search: '',
    });
    const drift = computeDrift(liveBinders[0], [], []);

    const queue = buildReviewQueue(drift, liveBinders[0], [], [reviewedRares]);
    expect(queue.removedGroups[0].destination).toEqual({ kind: 'not-owned' });
    expect(queue.removedGroups[0].rows[0].copyIds).toEqual([]);
  });

  it('rolls up multiple owned copies of the same printing into one row with all copyIds', () => {
    const rare1 = makeCard({ copyId: 'c1', scryfallId: 'sf1', name: 'Sol Ring', rarity: 'rare' });
    const rare2 = makeCard({ copyId: 'c2', scryfallId: 'sf1', name: 'Sol Ring', rarity: 'rare' });
    const rares = makeBinder({
      id: 'rares',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    const { binders: baselineBinders } = materializeBinders([rare1, rare2], [rares], {
      globalPocketSize: 9,
      search: '',
    });
    const reviewedRares = {
      ...rares,
      lastReviewedSnapshot: captureBinderSnapshot(baselineBinders[0]),
    };

    const commonNow1 = { ...rare1, rarity: 'common' };
    const commonNow2 = { ...rare2, rarity: 'common' };
    const { binders: liveBinders } = materializeBinders([commonNow1, commonNow2], [reviewedRares], {
      globalPocketSize: 9,
      search: '',
    });
    const drift = computeDrift(liveBinders[0], [commonNow1, commonNow2], []);

    // computeDrift already dedupes by key — one DriftCard row for both copies.
    expect(drift.removed).toHaveLength(1);

    const queue = buildReviewQueue(
      drift,
      liveBinders[0],
      [commonNow1, commonNow2],
      [reviewedRares]
    );
    expect(queue.removedGroups[0].rows[0].copyIds.sort()).toEqual(['c1', 'c2']);
  });

  it('builds added rows from copies currently routed to this binder, sourced from Uncategorized when no snapshot holds them', () => {
    const card = makeCard({ copyId: 'c1', name: 'Sol Ring', rarity: 'rare' });
    const rares = makeBinder({
      id: 'rares',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      lastReviewedSnapshot: { at: 1, keys: [], cardSnapshots: {} }, // reviewed, empty baseline
    });
    const { binders } = materializeBinders([card], [rares], { globalPocketSize: 9, search: '' });
    const drift = computeDrift(binders[0], [card], []);
    expect(drift.added).toHaveLength(1);

    const queue = buildReviewQueue(drift, binders[0], [card], [rares]);
    expect(queue.addedGroups).toHaveLength(1);
    expect(queue.addedGroups[0].source).toEqual({ kind: 'uncategorized' });
    expect(queue.addedGroups[0].rows).toHaveLength(1);
    expect(queue.addedGroups[0].rows[0].copyIds).toEqual(['c1']);
  });

  it('groups an added card by the binder whose snapshot still holds it — its physical source', () => {
    const rare = makeCard({ copyId: 'c1', name: 'Sol Ring', rarity: 'rare' });
    // Baseline world: only catch-all `bulk` exists and the card was reviewed there.
    const bulk = makeBinder({ id: 'bulk', name: 'Bulk', position: 1, filter: {} });
    const { binders: baseline } = materializeBinders([rare], [bulk], {
      globalPocketSize: 9,
      search: '',
    });
    const reviewedBulk = { ...bulk, lastReviewedSnapshot: captureBinderSnapshot(baseline[0]) };

    // Now: a rares binder appears ahead of bulk and claims the card.
    const rares = makeBinder({
      id: 'rares',
      name: 'Rares',
      position: 0,
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      lastReviewedSnapshot: { at: 1, keys: [], cardSnapshots: {} },
    });
    const { binders: live } = materializeBinders([rare], [rares, reviewedBulk], {
      globalPocketSize: 9,
      search: '',
    });
    const raresLive = live.find((b) => b.def.id === 'rares')!;
    const drift = computeDrift(raresLive, [rare], []);
    expect(drift.added).toHaveLength(1);

    const queue = buildReviewQueue(drift, raresLive, [rare], [rares, reviewedBulk]);
    expect(queue.addedGroups).toHaveLength(1);
    expect(queue.addedGroups[0].source).toEqual({
      kind: 'binder',
      binderId: 'bulk',
      binderName: 'Bulk',
    });
  });

  it('orders added groups by source binder position, uncategorized last', () => {
    const a = makeCard({ copyId: 'a', scryfallId: 'sfa', name: 'A', rarity: 'rare' });
    const b = makeCard({ copyId: 'b', scryfallId: 'sfb', name: 'B', rarity: 'rare' });
    const c = makeCard({ copyId: 'c', scryfallId: 'sfc', name: 'C', rarity: 'rare' });
    const rares = makeBinder({
      id: 'rares',
      name: 'Rares',
      position: 0,
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      lastReviewedSnapshot: { at: 1, keys: [], cardSnapshots: {} },
    });
    // Two holders whose snapshots still list one card each (their rules no
    // longer match anything — only the stale snapshot ties them to the card);
    // `c` is in nobody's snapshot → Uncategorized source.
    const holder5 = makeBinder({
      id: 'h5',
      name: 'H5',
      position: 5,
      filter: { nameContains: 'zzz' },
      lastReviewedSnapshot: { at: 1, keys: [printingFinishKey(a)], cardSnapshots: {} },
    });
    const holder2 = makeBinder({
      id: 'h2',
      name: 'H2',
      position: 2,
      filter: { nameContains: 'zzz' },
      lastReviewedSnapshot: { at: 1, keys: [printingFinishKey(b)], cardSnapshots: {} },
    });
    const { binders: live } = materializeBinders([a, b, c], [rares, holder2, holder5], {
      globalPocketSize: 9,
      search: '',
    });
    const raresLive = live.find((x) => x.def.id === 'rares')!;
    const drift = computeDrift(raresLive, [a, b, c], []);
    expect(drift.added).toHaveLength(3);

    const queue = buildReviewQueue(drift, raresLive, [a, b, c], [rares, holder2, holder5]);
    expect(queue.addedGroups.map((g) => sourceKey(g.source))).toEqual([
      'binder:h2',
      'binder:h5',
      'uncategorized',
    ]);
  });

  it('never treats the viewed binder itself as an incoming source', () => {
    // The viewed binder's own snapshot holding a key can't produce an added
    // row (added = not in own snapshot), but the source scan must still skip
    // it — a stale self-reference would render the nonsense route "here → here".
    const rare = makeCard({ copyId: 'c1', name: 'Sol Ring', rarity: 'rare' });
    const key = printingFinishKey(rare);
    const rares = makeBinder({
      id: 'rares',
      name: 'Rares',
      position: 0,
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
      lastReviewedSnapshot: { at: 1, keys: [], cardSnapshots: {} },
    });
    // A same-position twin whose id matches the viewed binder — only a
    // *different* binder's snapshot may claim to be the source.
    const self = { ...rares, lastReviewedSnapshot: { at: 1, keys: [key], cardSnapshots: {} } };
    const { binders: live } = materializeBinders([rare], [rares], {
      globalPocketSize: 9,
      search: '',
    });
    const drift = computeDrift(live[0], [rare], []);

    const queue = buildReviewQueue(drift, live[0], [rare], [self]);
    expect(queue.addedGroups[0].source).toEqual({ kind: 'uncategorized' });
  });

  it('orders removed groups by destination binder position, uncategorized then not-owned last', () => {
    const a = makeCard({ copyId: 'a', scryfallId: 'sfa', name: 'A', rarity: 'rare' });
    const b = makeCard({ copyId: 'b', scryfallId: 'sfb', name: 'B', rarity: 'rare' });
    const c = makeCard({ copyId: 'c', scryfallId: 'sfc', name: 'C', rarity: 'rare' });
    const rares = makeBinder({
      id: 'rares',
      position: 0,
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    const { binders: baselineBinders } = materializeBinders([a, b, c], [rares], {
      globalPocketSize: 9,
      search: '',
    });
    const reviewedRares = {
      ...rares,
      lastReviewedSnapshot: captureBinderSnapshot(baselineBinders[0]),
    };

    // `a` re-routes to a late-position binder; `b` has nowhere to go
    // (uncategorized); `c` leaves the collection entirely.
    const late = makeBinder({ id: 'late', position: 5, filter: { nameContains: 'A' } });
    const aCommon = { ...a, rarity: 'common' };
    const bCommon = { ...b, rarity: 'common' };
    const { binders: liveBinders } = materializeBinders([aCommon, bCommon], [reviewedRares, late], {
      globalPocketSize: 9,
      search: '',
    });
    const raresLive = liveBinders.find((bd) => bd.def.id === 'rares')!;
    const drift = computeDrift(raresLive, [aCommon, bCommon], []);
    expect(drift.removed).toHaveLength(3); // a, b, and c (gone)

    const queue = buildReviewQueue(drift, raresLive, [aCommon, bCommon], [reviewedRares, late]);
    const kinds = queue.removedGroups.map((g) => g.destination.kind);
    expect(kinds).toEqual(['binder', 'uncategorized', 'not-owned']);
  });
});

describe('formatDestinationLabel / formatSourceLabel', () => {
  it('formats route phrases for each endpoint kind', () => {
    expect(formatDestinationLabel({ kind: 'binder', binderId: 'x', binderName: 'Rares' })).toBe(
      'to Rares'
    );
    expect(formatDestinationLabel({ kind: 'uncategorized' })).toBe('to Uncategorized');
    expect(formatDestinationLabel({ kind: 'not-owned' })).toBe('no longer owned');
    expect(formatSourceLabel({ kind: 'binder', binderId: 'x', binderName: 'Bulk' })).toBe(
      'from Bulk'
    );
    expect(formatSourceLabel({ kind: 'uncategorized' })).toBe('from Uncategorized');
  });
});

describe('formatExcludeDestination', () => {
  it('names the binder the card would fall through to', () => {
    const card = makeCard({ copyId: 'c1', rarity: 'rare' });
    const first = makeBinder({ id: 'first', position: 0, name: 'First', filter: {} });
    const second = makeBinder({
      id: 'second',
      position: 1,
      name: 'Second',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    expect(formatExcludeDestination(card, 'first', [first, second])).toBe(
      'Excluded — files to Second'
    );
  });

  it('falls back to Uncategorized when nothing else matches', () => {
    const card = makeCard({ copyId: 'c1', rarity: 'common' });
    const only = makeBinder({
      id: 'only',
      filter: { rarities: { chips: [{ value: 'rare', negate: false }], joiners: [] } },
    });
    expect(formatExcludeDestination(card, 'only', [only])).toBe(
      'Excluded — files to Uncategorized'
    );
  });
});
