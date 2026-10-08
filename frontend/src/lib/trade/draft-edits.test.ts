import { describe, expect, it } from 'vitest';
import {
  addGet,
  addGive,
  counterDraft,
  getCeiling,
  nextGiveCopy,
  removeOneGet,
  removeOneGive,
} from './draft-edits';
import { emptyDraft } from './trade-draft';
import type { OwnedTradeLine } from './trade-picker';
import type { TradeOffer } from './trades-client';
import type { EnrichedCard } from '../../types';

const FRIEND = { id: 'f1', name: 'Morgan' };
const sol = { oracleId: 'o-sol', name: 'Sol Ring' };

const copy = (copyId: string, price: number) =>
  ({ copyId, name: 'Sol Ring', oracleId: 'o-sol', purchasePrice: price }) as EnrichedCard;
const line: OwnedTradeLine = {
  oracleId: 'o-sol',
  name: 'Sol Ring',
  copies: [copy('dear', 9), copy('cheap', 1), copy('mid', 4)],
};

describe('getCeiling', () => {
  it('is what they have, up to 20, and 20 when unreadable', () => {
    expect(getCeiling(3)).toBe(3);
    expect(getCeiling(50)).toBe(20);
    expect(getCeiling(null)).toBe(20);
    expect(getCeiling(0)).toBe(0);
  });
});

describe('addGet / removeOneGet', () => {
  it('starts a draft on the first add and counts up to their real count', () => {
    let r = addGet(null, FRIEND, sol, 2);
    expect(r.blocked).toBeNull();
    expect(r.draft.friendId).toBe('f1');
    expect(r.draft.get['o-sol']).toEqual({ name: 'Sol Ring', oracleId: 'o-sol', quantity: 1 });
    r = addGet(r.draft, FRIEND, sol, 2);
    expect(r.draft.get['o-sol'].quantity).toBe(2);
    r = addGet(r.draft, FRIEND, sol, 2);
    expect(r.blocked).toBe('copies');
    expect(r.draft.get['o-sol'].quantity).toBe(2);
  });

  it('blocks a card they no longer have, and stops at 20 when their count is unknown', () => {
    expect(addGet(null, FRIEND, sol, 0).blocked).toBe('copies');
    let d = emptyDraft('f1', 'Morgan');
    for (let i = 0; i < 20; i++) d = addGet(d, FRIEND, sol, null).draft;
    expect(d.get['o-sol'].quantity).toBe(20);
    expect(addGet(d, FRIEND, sol, null).blocked).toBe('copies');
  });

  it('stops at 40 different cards per side but still bumps one already in', () => {
    let d = emptyDraft('f1', 'Morgan');
    for (let i = 0; i < 40; i++) {
      d = addGet(d, FRIEND, { oracleId: `o-${i}`, name: `Card ${i}` }, 5).draft;
    }
    expect(addGet(d, FRIEND, { oracleId: 'o-new', name: 'New' }, 5).blocked).toBe('lines');
    expect(addGet(d, FRIEND, { oracleId: 'o-3', name: 'Card 3' }, 5).blocked).toBeNull();
  });

  it('takes one back out, and the last one drops the line', () => {
    let d = addGet(addGet(null, FRIEND, sol, 3).draft, FRIEND, sol, 3).draft;
    d = removeOneGet(d, 'o-sol')!;
    expect(d.get['o-sol'].quantity).toBe(1);
    d = removeOneGet(d, 'o-sol')!;
    expect(d.get['o-sol']).toBeUndefined();
    expect(removeOneGet(null, 'o-sol')).toBeNull();
  });
});

describe('addGive / removeOneGive', () => {
  it('adds the cheapest copy not already in, one at a time', () => {
    let r = addGive(null, FRIEND, line);
    expect(r.draft.give['o-sol'].copyIds).toEqual(['cheap']);
    expect(nextGiveCopy(r.draft, line)?.copyId).toBe('mid');
    r = addGive(r.draft, FRIEND, line);
    r = addGive(r.draft, FRIEND, line);
    expect(r.draft.give['o-sol'].copyIds).toEqual(['cheap', 'mid', 'dear']);
    expect(nextGiveCopy(r.draft, line)).toBeUndefined();
    expect(addGive(r.draft, FRIEND, line).blocked).toBe('copies');
  });

  it('takes the most recent copy back out, and the last one drops the line', () => {
    let d = addGive(addGive(null, FRIEND, line).draft, FRIEND, line).draft;
    d = removeOneGive(d, 'o-sol')!;
    expect(d.give['o-sol'].copyIds).toEqual(['cheap']);
    d = removeOneGive(d, 'o-sol')!;
    expect(d.give['o-sol']).toBeUndefined();
  });
});

describe('counterDraft', () => {
  const offer = {
    id: 't1',
    counterpartyUsername: 'morgan',
    counterpartyDisplayName: 'Morgan',
    give: [
      { oracleId: 'o-sol', name: 'Sol Ring', quantity: 2, copies: [] },
      { oracleId: 'o-gone', name: 'Black Lotus', quantity: 1, copies: [] },
    ],
    receive: [{ oracleId: 'o-bolt', name: 'Lightning Bolt', quantity: 3, copies: [] }],
  } as unknown as TradeOffer;

  it('puts what the viewer was asked for on "give" and what was offered on "get"', () => {
    const { draft, skipped } = counterDraft(offer, FRIEND, new Map([['o-sol', line]]));
    expect(draft.give['o-sol'].copyIds).toEqual(['cheap', 'mid']);
    expect(draft.get['o-bolt']).toEqual({
      name: 'Lightning Bolt',
      oracleId: 'o-bolt',
      quantity: 3,
    });
    expect(draft.get['o-sol']).toBeUndefined();
    expect(draft.counterTo).toEqual({ offerId: 't1', name: 'Morgan' });
    // A card the viewer no longer owns is named, not silently dropped.
    expect(skipped).toEqual(['Black Lotus']);
  });

  it('falls back to the handle when there is no display name', () => {
    const { draft } = counterDraft(
      { ...offer, counterpartyDisplayName: null } as unknown as TradeOffer,
      FRIEND,
      new Map()
    );
    expect(draft.counterTo?.name).toBe('@morgan');
  });
});
