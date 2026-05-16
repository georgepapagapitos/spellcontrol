import { describe, it, expect } from 'vitest';
import { reconcileBinderRefs, keysForIds, printingFinishKey } from './binder-refs';
import type { BinderDef, EnrichedCard } from '../types';

function card(
  copyId: string,
  scryfallId: string,
  finish: 'nonfoil' | 'foil' = 'nonfoil'
): EnrichedCard {
  return { copyId, scryfallId, finish, name: scryfallId, foil: finish === 'foil' } as EnrichedCard;
}

function binder(over: Partial<BinderDef>): BinderDef {
  return {
    id: 'b1',
    name: 'B',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as BinderDef;
}

describe('printingFinishKey', () => {
  it('keys by scryfallId + finish', () => {
    expect(printingFinishKey(card('x', 'sf1', 'foil'))).toBe('sf1:foil');
    expect(printingFinishKey(card('x', 'sf1'))).toBe('sf1:nonfoil');
  });
});

describe('reconcileBinderRefs — re-import recovery (the headline fix)', () => {
  it('re-binds a pin to the equivalent new copy after copyIds are regenerated', () => {
    const b = binder({ pinnedCopyIds: ['old-1'], pinnedKeys: ['sf1:nonfoil'] });
    // Re-upload: same card, brand-new copyId. No prev collection (cache lost).
    const newCards = [card('new-1', 'sf1', 'nonfoil')];

    const { binders, changed } = reconcileBinderRefs([b], newCards, []);

    expect(changed).toBe(true);
    expect(binders[0].pinnedCopyIds).toEqual(['new-1']);
    expect(binders[0].pinnedKeys).toEqual(['sf1:nonfoil']);
  });

  it('preserves multiplicity: 2 pinned of 3 owned re-resolve to 2 distinct copies', () => {
    const b = binder({
      pinnedCopyIds: ['o1', 'o2'],
      pinnedKeys: ['sf1:nonfoil', 'sf1:nonfoil'],
    });
    const newCards = [
      card('n1', 'sf1', 'nonfoil'),
      card('n2', 'sf1', 'nonfoil'),
      card('n3', 'sf1', 'nonfoil'),
    ];

    const { binders } = reconcileBinderRefs([b], newCards, []);

    expect(binders[0].pinnedCopyIds).toHaveLength(2);
    expect(new Set(binders[0].pinnedCopyIds)).toEqual(new Set(['n1', 'n2']));
  });

  it('retains a key with no owned copy so a later re-import can restore it', () => {
    const b = binder({ pinnedCopyIds: ['old'], pinnedKeys: ['sfMissing:nonfoil'] });

    const first = reconcileBinderRefs([b], [card('n', 'sfOther')], []);
    expect(first.binders[0].pinnedCopyIds).toEqual([]); // not owned now
    expect(first.binders[0].pinnedKeys).toEqual(['sfMissing:nonfoil']); // intent kept

    // The printing comes back in a later import — pin must reattach.
    const second = reconcileBinderRefs(
      [first.binders[0]],
      [card('back', 'sfMissing', 'nonfoil')],
      []
    );
    expect(second.binders[0].pinnedCopyIds).toEqual(['back']);
  });
});

describe('reconcileBinderRefs — stability & no-op behavior', () => {
  it('is a no-op (same reference) when ids still resolve and keys already set', () => {
    const b = binder({ pinnedCopyIds: ['c1'], pinnedKeys: ['sf1:nonfoil'] });
    const cards = [card('c1', 'sf1', 'nonfoil')];

    const { binders, changed } = reconcileBinderRefs([b], cards, cards);

    expect(changed).toBe(false);
    expect(binders[0]).toBe(b); // referential identity preserved (no phantom push)
  });

  it('leaves binders without pins or exclusions untouched', () => {
    const b = binder({});
    const { binders, changed } = reconcileBinderRefs([b], [card('c', 'sf')], []);
    expect(changed).toBe(false);
    expect(binders[0]).toBe(b);
  });
});

describe('reconcileBinderRefs — legacy backfill (immunize current good state)', () => {
  it('backfills pinnedKeys from current ids on a binder created before the shadow existed', () => {
    const b = binder({ pinnedCopyIds: ['c1'] }); // no pinnedKeys (legacy)
    const cards = [card('c1', 'sf1', 'foil')];

    const { binders, changed } = reconcileBinderRefs([b], cards, cards);

    expect(changed).toBe(true);
    expect(binders[0].pinnedKeys).toEqual(['sf1:foil']);
    expect(binders[0].pinnedCopyIds).toEqual(['c1']); // id unchanged
  });
});

describe('reconcileBinderRefs — exclusions', () => {
  it('re-resolves excludedCopyIds the same way as pins', () => {
    const b = binder({ excludedCopyIds: ['old'], excludedKeys: ['sf1:nonfoil'] });
    const newCards = [card('new', 'sf1', 'nonfoil')];

    const { binders, changed } = reconcileBinderRefs([b], newCards, []);

    expect(changed).toBe(true);
    expect(binders[0].excludedCopyIds).toEqual(['new']);
    expect(binders[0].excludedKeys).toEqual(['sf1:nonfoil']);
  });
});

describe('keysForIds (mutator-side shadow maintenance)', () => {
  it('maps ids to keys and falls back to prior keys for unresolved (orphan) ids', () => {
    const byId = new Map([['c1', card('c1', 'sf1', 'nonfoil')]]);
    // c2 is an orphan pin (owned card gone) — keep its durable key via fallback.
    const keys = keysForIds(['c1', 'c2'], byId, ['c1', 'c2'], ['sf1:nonfoil', 'sfOrphan:foil']);
    expect(keys).toEqual(['sf1:nonfoil', 'sfOrphan:foil']);
  });

  it('drops ids that resolve to neither the collection nor a prior key', () => {
    const keys = keysForIds(['ghost'], new Map());
    expect(keys).toEqual([]);
  });
});
