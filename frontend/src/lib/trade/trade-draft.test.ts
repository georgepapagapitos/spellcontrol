import { describe, expect, it } from 'vitest';
import { emptyDraft, isEmptyDraft, reconcileDraft, type TradeDraft } from './trade-draft';
import type { OwnedTradeLine } from './trade-picker';
import type { EnrichedCard } from '../../types';

const card = (copyId: string) => ({ copyId, name: 'Sol Ring', oracleId: 'o-sol' }) as EnrichedCard;
const owned: OwnedTradeLine[] = [
  { oracleId: 'o-sol', name: 'Sol Ring', copies: [card('c1'), card('c2')] },
];

function draft(over: Partial<TradeDraft> = {}): TradeDraft {
  return { ...emptyDraft('f1', 'Ann', 1000), ...over };
}

describe('reconcileDraft', () => {
  it('clamps get quantities to min(20, theirCount) and reports reduced', () => {
    const d = draft({
      get: {
        'o-a': { name: 'A', oracleId: 'o-a', quantity: 9 },
        'o-b': { name: 'B', oracleId: 'o-b', quantity: 30 },
      },
    });
    const { draft: out, issues } = reconcileDraft(
      d,
      new Map([
        ['o-a', 4],
        ['o-b', 100],
      ]),
      owned
    );
    expect(out.get['o-a'].quantity).toBe(4);
    expect(out.get['o-b'].quantity).toBe(20);
    expect(issues).toEqual([
      { kind: 'reduced', key: 'o-a', name: 'A', from: 9, to: 4 },
      { kind: 'reduced', key: 'o-b', name: 'B', from: 30, to: 20 },
    ]);
  });

  it('keeps a get line that fits untouched, with no issue', () => {
    const d = draft({ get: { 'o-a': { name: 'A', oracleId: 'o-a', quantity: 2 } } });
    const { draft: out, issues } = reconcileDraft(d, new Map([['o-a', 5]]), owned);
    expect(out.get).toEqual(d.get);
    expect(issues).toEqual([]);
  });

  it('flags a card no longer in their collection as gone and leaves the line for the owner to remove', () => {
    const d = draft({
      get: {
        'o-a': { name: 'A', oracleId: 'o-a', quantity: 2 },
        'o-z': { name: 'Z', oracleId: 'o-z', quantity: 1 },
      },
    });
    const { draft: out, issues } = reconcileDraft(d, new Map([['o-a', 1]]), owned);
    expect(issues).toContainEqual({ kind: 'gone', key: 'o-z', name: 'Z' });
    expect(out.get['o-z']).toEqual({ name: 'Z', oracleId: 'o-z', quantity: 1 });
    const zero = reconcileDraft(
      d,
      new Map([
        ['o-a', 1],
        ['o-z', 0],
      ]),
      owned
    );
    expect(zero.issues).toContainEqual({ kind: 'gone', key: 'o-z', name: 'Z' });
  });

  it('treats null counts (private collection) as a cap of 20 with nothing gone', () => {
    const d = draft({
      get: {
        'o-a': { name: 'A', oracleId: 'o-a', quantity: 25 },
        'o-b': { name: 'B', oracleId: 'o-b', quantity: 3 },
      },
    });
    const { draft: out, issues } = reconcileDraft(d, null, owned);
    expect(out.get['o-a'].quantity).toBe(20);
    expect(out.get['o-b'].quantity).toBe(3);
    expect(issues).toEqual([{ kind: 'reduced', key: 'o-a', name: 'A', from: 25, to: 20 }]);
  });

  it('filters give copy ids to copies still owned and drops emptied or unowned lines', () => {
    const d = draft({
      give: {
        'o-sol': { name: 'Sol Ring', oracleId: 'o-sol', copyIds: ['c1', 'sold'] },
        'o-x': { name: 'X', oracleId: 'o-x', copyIds: ['q'] },
      },
    });
    const { draft: out, issues } = reconcileDraft(d, null, owned);
    expect(out.give).toEqual({
      'o-sol': { name: 'Sol Ring', oracleId: 'o-sol', copyIds: ['c1'] },
    });
    expect(issues).toEqual([]);
    const none = reconcileDraft(
      draft({ give: { 'o-sol': { name: 'Sol Ring', oracleId: 'o-sol', copyIds: ['sold'] } } }),
      null,
      owned
    );
    expect(none.draft.give).toEqual({});
  });

  it('keeps counterTo, note and identity as-is', () => {
    const d = draft({ note: 'hi', counterTo: { offerId: 'o1', name: 'Ann' } });
    const { draft: out } = reconcileDraft(d, null, owned);
    expect(out).toMatchObject({
      note: 'hi',
      counterTo: { offerId: 'o1', name: 'Ann' },
      friendId: 'f1',
    });
  });
});

describe('isEmptyDraft', () => {
  it('is empty only with no lines, no note and no counter', () => {
    expect(isEmptyDraft(draft())).toBe(true);
    expect(isEmptyDraft(draft({ note: '  ' }))).toBe(true);
    expect(isEmptyDraft(draft({ note: 'x' }))).toBe(false);
    expect(isEmptyDraft(draft({ get: { a: { name: 'A', oracleId: 'a', quantity: 1 } } }))).toBe(
      false
    );
    expect(isEmptyDraft(draft({ counterTo: { offerId: 'o', name: 'n' } }))).toBe(false);
    expect(isEmptyDraft(draft({ give: { a: { name: 'A', oracleId: 'a', copyIds: ['c'] } } }))).toBe(
      false
    );
  });
});

describe('emptyDraft', () => {
  it('defaults updatedAt to now', () => {
    expect(emptyDraft('f', 'F').updatedAt).toBeGreaterThan(0);
  });
});
