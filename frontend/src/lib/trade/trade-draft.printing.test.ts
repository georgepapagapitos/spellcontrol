import { describe, expect, it } from 'vitest';
import { pruneDrafts } from '@/store/trade-drafts';
import { emptyDraft, migrateDraft, reconcileDraft, type TradeDraft } from './trade-draft';

const A = 'o-elves|sf-7ed|nonfoil';
const B = 'o-elves|sf-fdn|nonfoil';

function draft(get: TradeDraft['get']): TradeDraft {
  return { ...emptyDraft('f1', 'Morgan'), get };
}

const pinned = (scryfallId: string, quantity: number) => ({
  name: 'Llanowar Elves',
  oracleId: 'o-elves',
  scryfallId,
  finish: 'nonfoil',
  quantity,
});

describe('migrateDraft', () => {
  const v1 = {
    v: 1,
    friendId: 'f1',
    friendName: 'Morgan',
    get: { 'o-elves': { name: 'Llanowar Elves', quantity: 2 } },
    give: {},
    note: 'hello',
    updatedAt: 1000,
  };

  it('reads a v1 ask as an "any printing" entry that sends what it always did', () => {
    const out = migrateDraft(v1)!;
    expect(out.v).toBe(2);
    expect(out.get['o-elves']).toEqual({
      name: 'Llanowar Elves',
      oracleId: 'o-elves',
      quantity: 2,
    });
    expect(out.get['o-elves'].scryfallId).toBeUndefined();
    expect(out.note).toBe('hello');
  });

  it('passes a v2 draft through and refuses anything that is not a draft', () => {
    const v2 = draft({ [A]: pinned('sf-7ed', 1) });
    expect(migrateDraft(v2)).toBe(v2);
    expect(migrateDraft(null)).toBeNull();
    expect(migrateDraft({ v: 3, updatedAt: 1 })).toBeNull();
    expect(migrateDraft({ v: 1 })).toBeNull();
  });

  it('migrates every saved draft when the store hydrates', () => {
    const now = 2000;
    const out = pruneDrafts({ me: { f1: v1 } }, now);
    expect(out.me.f1.v).toBe(2);
    expect(out.me.f1.get['o-elves'].oracleId).toBe('o-elves');
  });
});

describe('reconcileDraft: a pinned ask clamps to THEIR count of that printing', () => {
  const theirOracle = new Map([['o-elves', 5]]);
  const theirPrintings = new Map([
    [A, 1],
    [B, 4],
  ]);

  it('clamps each printing on its own', () => {
    const { draft: out, issues } = reconcileDraft(
      draft({ [A]: pinned('sf-7ed', 3), [B]: pinned('sf-fdn', 3) }),
      theirOracle,
      [],
      theirPrintings
    );
    expect(out.get[A].quantity).toBe(1);
    expect(out.get[B].quantity).toBe(3);
    expect(issues).toEqual([{ kind: 'reduced', key: A, name: 'Llanowar Elves', from: 3, to: 1 }]);
  });

  it('calls a printing they no longer hold gone, though they own the card', () => {
    const { issues } = reconcileDraft(
      draft({ [A]: pinned('sf-7ed', 1) }),
      theirOracle,
      [],
      new Map([[B, 4]])
    );
    expect(issues).toEqual([{ kind: 'gone', key: A, name: 'Llanowar Elves' }]);
  });

  it('clamps an any-printing ask to their count across printings', () => {
    const { draft: out } = reconcileDraft(
      draft({ 'o-elves': { name: 'Llanowar Elves', oracleId: 'o-elves', quantity: 9 } }),
      theirOracle,
      [],
      theirPrintings
    );
    expect(out.get['o-elves'].quantity).toBe(5);
  });
});
