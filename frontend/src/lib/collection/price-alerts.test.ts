// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { findPriceTargetHits, filterNewPriceTargetHits } from './price-alerts';
import { setPrices, _resetForTests } from './card-prices';
import type { ListDef, ListEntry } from '@/types/index';

let entryCounter = 0;
function entry(overrides: Partial<ListEntry> & { name: string }): ListEntry {
  return {
    id: `e${entryCounter++}`,
    scryfallId: 'sf',
    setCode: 'tst',
    collectorNumber: '1',
    finish: 'nonfoil',
    quantity: 1,
    ...overrides,
  };
}

function list(name: string, entries: ListEntry[], overrides: Partial<ListDef> = {}): ListDef {
  return {
    id: `list-${name}`,
    name,
    entries,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  _resetForTests();
  entryCounter = 0;
});

describe('findPriceTargetHits', () => {
  it('reports an entry whose price is at or under its target', () => {
    const cheap = entry({ name: 'Sol Ring', targetPrice: 5 });
    const stillHigh = entry({ name: 'Rhystic Study', targetPrice: 5 });
    const atTarget = entry({ name: 'Mana Crypt', targetPrice: 5 });
    const lists = [list('wants', [cheap, stillHigh, atTarget])];

    const priceFor = (e: ListEntry) =>
      ({ [cheap.id]: 3, [stillHigh.id]: 40, [atTarget.id]: 5 })[e.id];

    const hits = findPriceTargetHits(lists, priceFor);
    expect(hits.map((h) => h.name).sort()).toEqual(['Mana Crypt', 'Sol Ring']);
  });

  it('skips entries with no target price, and entries with no resolvable price', () => {
    const noTarget = entry({ name: 'No Target' });
    const noPrice = entry({ name: 'No Price', targetPrice: 5 });
    const lists = [list('wants', [noTarget, noPrice])];

    expect(findPriceTargetHits(lists, () => undefined)).toEqual([]);
  });

  it('skips tracking lists and dynamic (rule) lists', () => {
    const cheapTracking = entry({ name: 'Tracked', targetPrice: 5 });
    const cheapDynamic = entry({ name: 'Dynamic', targetPrice: 5 });
    const lists = [
      list('tracking', [cheapTracking], { kind: 'tracking' }),
      list('dynamic', [cheapDynamic], { rule: [{ filter: {} }] }),
    ];
    expect(findPriceTargetHits(lists, () => 1)).toEqual([]);
  });

  it('compares against the entry’s OWN currency, never cross-currency', () => {
    const eurEntry = entry({ name: 'Euro Card', targetPrice: 5, currency: 'EUR' });
    const lists = [list('wants', [eurEntry])];

    setPrices({ [eurEntry.scryfallId]: { usd: 3, eur: 8, pricedAt: 1 } });
    // Live default price resolver: USD is under target but the entry is
    // priced in EUR, where the live price (8) is still over target.
    expect(findPriceTargetHits(lists)).toEqual([]);

    setPrices({ [eurEntry.scryfallId]: { usd: 3, eur: 4, pricedAt: 2 } });
    const hits = findPriceTargetHits(lists);
    expect(hits).toHaveLength(1);
    expect(hits[0].currency).toBe('EUR');
    expect(hits[0].price).toBe(4);
  });
});

describe('filterNewPriceTargetHits (once-only)', () => {
  function hit(entryId: string, price: number) {
    return {
      entryId,
      name: 'X',
      listId: 'l1',
      listName: 'Wants',
      price,
      targetPrice: 5,
      currency: 'USD' as const,
    };
  }

  it('lets a hit through once, then suppresses the identical repeat', () => {
    const first = filterNewPriceTargetHits([hit('e1', 3)]);
    expect(first).toHaveLength(1);

    const repeat = filterNewPriceTargetHits([hit('e1', 3)]);
    expect(repeat).toHaveLength(0);
  });

  it('alerts again when the price drops further', () => {
    filterNewPriceTargetHits([hit('e1', 3)]);
    const droppedFurther = filterNewPriceTargetHits([hit('e1', 2)]);
    expect(droppedFurther).toHaveLength(1);
  });

  it('re-alerts on ANY price change from the last-recorded value, then suppresses that repeat', () => {
    expect(filterNewPriceTargetHits([hit('e1', 3)])).toHaveLength(1);
    expect(filterNewPriceTargetHits([hit('e1', 2)])).toHaveLength(1); // dropped further
    // Back up to 3 — differs from the last-recorded value (2), so it alerts
    // once more; only the map's single most-recent price is remembered, not
    // a full history.
    expect(filterNewPriceTargetHits([hit('e1', 3)])).toHaveLength(1);
    expect(filterNewPriceTargetHits([hit('e1', 3)])).toHaveLength(0); // now a true repeat
  });

  it('tracks each entry independently', () => {
    const first = filterNewPriceTargetHits([hit('e1', 3), hit('e2', 4)]);
    expect(first).toHaveLength(2);
    const second = filterNewPriceTargetHits([hit('e1', 3), hit('e2', 1)]);
    expect(second.map((h) => h.entryId)).toEqual(['e2']);
  });
});
