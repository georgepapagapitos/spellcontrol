import { describe, expect, it } from 'vitest';
import { materializeBinders } from '@spellcontrol/binder-routing';
import {
  volumesFor,
  hasMultipleVolumes,
  pageVolume,
  smallestFittingCapacity,
} from './binder-volumes';
import type { BinderDef, EnrichedCard } from '../types';

function card(name: string, copyId: string): EnrichedCard {
  return {
    name,
    copyId,
    purchasePrice: 0,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: copyId,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  } as EnrichedCard;
}

function makeBinder(overrides: Partial<BinderDef> = {}): BinderDef {
  return {
    id: 'b1',
    name: 'Everything',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('volumesFor', () => {
  it('returns null for a binder with no fixed capacity', () => {
    const cards = [card('Sol Ring', 'c1')];
    const { binders } = materializeBinders(cards, [makeBinder()], {
      search: '',
      globalPocketSize: 9,
    });
    expect(volumesFor(binders[0])).toBeNull();
  });

  it('splits a binder that outgrows its own capacity, using the binder’s own pocket size', () => {
    const cards = Array.from({ length: 20 }, (_, i) => card(`Card ${i}`, `c${i}`));
    const def = makeBinder({ fixedCapacity: 9 });
    const { binders } = materializeBinders(cards, [def], { search: '', globalPocketSize: 9 });
    const volumes = volumesFor(binders[0]);
    expect(hasMultipleVolumes(volumes)).toBe(true);
    // 20 cards / 9 per page = 3 pages; capacity 9 cards = 1 page/volume -> 3 volumes.
    expect(volumes).toHaveLength(3);
    expect(volumes!.reduce((s, v) => s + v.cardCount, 0)).toBe(20);
  });

  it('fits in one volume when the binder is under capacity', () => {
    const cards = [card('Sol Ring', 'c1')];
    const def = makeBinder({ fixedCapacity: 360 });
    const { binders } = materializeBinders(cards, [def], { search: '', globalPocketSize: 9 });
    const volumes = volumesFor(binders[0]);
    expect(hasMultipleVolumes(volumes)).toBe(false);
    expect(volumes).toHaveLength(1);
  });
});

describe('pageVolume', () => {
  it('is undefined for null or single-volume input', () => {
    expect(pageVolume(null, 1)).toBeUndefined();
    expect(
      pageVolume(
        [{ index: 1, pageStart: 1, pageEnd: 5, cardCount: 10, firstLabel: 'A', lastLabel: 'A' }],
        3
      )
    ).toBeUndefined();
  });

  it('finds the volume containing a page', () => {
    const volumes = [
      { index: 1, pageStart: 1, pageEnd: 2, cardCount: 10, firstLabel: 'A', lastLabel: 'A' },
      { index: 2, pageStart: 3, pageEnd: 5, cardCount: 15, firstLabel: 'B', lastLabel: 'C' },
    ];
    expect(pageVolume(volumes, 2)).toBe(1);
    expect(pageVolume(volumes, 3)).toBe(2);
    expect(pageVolume(volumes, 5)).toBe(2);
  });
});

describe('smallestFittingCapacity re-export', () => {
  it('is reachable from the frontend shim (page-based: 30 pages fits the 40-page/360-card tier)', () => {
    expect(smallestFittingCapacity(30, 9)).toBe(360);
  });
});
