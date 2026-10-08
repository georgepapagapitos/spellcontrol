import { describe, expect, it } from 'vitest';
import {
  addGet,
  addGive,
  counterDraft,
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

describe('addGet with a printing: asks are per printing', () => {
  const pin = { ...sol, scryfallId: 'sf-a', finish: 'nonfoil' };
  const pinB = { ...sol, scryfallId: 'sf-b', finish: 'foil' };

  it('keys the entry by printing and counts each printing on its own', () => {
    let r = addGet(null, FRIEND, pin, 1);
    expect(Object.keys(r.draft.get)).toEqual(['o-sol|sf-a|nonfoil']);
    expect(r.draft.get['o-sol|sf-a|nonfoil']).toEqual({
      name: 'Sol Ring',
      oracleId: 'o-sol',
      scryfallId: 'sf-a',
      finish: 'nonfoil',
      quantity: 1,
    });
    // Their ceiling is THAT printing's count: a second add is refused...
    expect(addGet(r.draft, FRIEND, pin, 1).blocked).toBe('copies');
    // ...while the other printing is its own entry.
    r = addGet(r.draft, FRIEND, pinB, 2);
    expect(r.blocked).toBeNull();
    expect(Object.keys(r.draft.get).sort()).toEqual(['o-sol|sf-a|nonfoil', 'o-sol|sf-b|foil']);
  });

  it("shares the server's per-card ceiling of 20 across a card's printings", () => {
    let d = emptyDraft('f1', 'Morgan');
    for (let i = 0; i < 19; i++) d = addGet(d, FRIEND, pin, null).draft;
    d = addGet(d, FRIEND, pinB, null).draft;
    expect(addGet(d, FRIEND, pinB, null).blocked).toBe('copies');
    expect(addGet(d, FRIEND, pin, null).blocked).toBe('copies');
  });

  it('takes one back out of just that printing', () => {
    let d = addGet(addGet(null, FRIEND, pin, 3).draft, FRIEND, pinB, 3).draft;
    d = removeOneGet(d, 'o-sol|sf-a|nonfoil')!;
    expect(d.get['o-sol|sf-a|nonfoil']).toBeUndefined();
    expect(d.get['o-sol|sf-b|foil'].quantity).toBe(1);
  });
});

describe('counterDraft keeps the printings an offer names', () => {
  it('asks for the offered printings, and leaves an unpinned line as any printing', () => {
    const offer = {
      id: 't2',
      counterpartyUsername: 'morgan',
      counterpartyDisplayName: 'Morgan',
      give: [],
      receive: [
        {
          oracleId: 'o-bolt',
          name: 'Lightning Bolt',
          quantity: 2,
          copies: [
            { scryfallId: 'sf-1', finish: 'nonfoil' },
            { scryfallId: 'sf-2', finish: 'foil' },
          ],
        },
        { oracleId: 'o-sol', name: 'Sol Ring', quantity: 1, copies: [] },
      ],
    } as unknown as TradeOffer;
    const { draft } = counterDraft(offer, FRIEND, new Map());
    expect(draft.get['o-bolt|sf-1|nonfoil']).toMatchObject({ scryfallId: 'sf-1', quantity: 1 });
    expect(draft.get['o-bolt|sf-2|foil']).toMatchObject({ scryfallId: 'sf-2', finish: 'foil' });
    expect(draft.get['o-sol']).toEqual({ name: 'Sol Ring', oracleId: 'o-sol', quantity: 1 });
  });
});

describe('giving: a copy no deck holds goes before one a deck does', () => {
  // Three Mana Geysers of one printing; the cheapest is the one Goblin Storm uses.
  const geyser = (copyId: string, price: number) =>
    ({
      copyId,
      name: 'Mana Geyser',
      oracleId: 'o-geyser',
      scryfallId: 'sf-geyser',
      finish: 'nonfoil',
      purchasePrice: price,
    }) as EnrichedCard;
  const geysers: OwnedTradeLine = {
    oracleId: 'o-geyser',
    name: 'Mana Geyser',
    copies: [geyser('in-deck', 0.1), geyser('free-dear', 0.4), geyser('free-cheap', 0.2)],
  };
  const claimed = new Set(['in-deck']);
  const printing = { scryfallId: 'sf-geyser', finish: 'nonfoil' };

  it('takes the cheapest FREE copy even though a deck copy is cheaper', () => {
    const r = addGive(null, FRIEND, geysers, { claimed, printing });
    expect(r.draft.give['o-geyser'].copyIds).toEqual(['free-cheap']);
    expect(nextGiveCopy(r.draft, geysers, { claimed, printing })?.copyId).toBe('free-dear');
  });

  it('takes the deck copy only once the free ones are all in', () => {
    let r = addGive(null, FRIEND, geysers, { claimed, printing });
    r = addGive(r.draft, FRIEND, geysers, { claimed, printing });
    expect(r.draft.give['o-geyser'].copyIds).toEqual(['free-cheap', 'free-dear']);
    expect(nextGiveCopy(r.draft, geysers, { claimed, printing })?.copyId).toBe('in-deck');
  });

  it('stays inside the tapped printing even when another printing is free', () => {
    const other = { ...geyser('other-free', 0.05), scryfallId: 'sf-other' };
    const mixed = { ...geysers, copies: [...geysers.copies, other] };
    const all = new Set(['free-cheap', 'free-dear', 'in-deck']);
    expect(nextGiveCopy(null, mixed, { claimed: all, printing })?.copyId).toBe('in-deck');
    expect(nextGiveCopy(null, mixed, { claimed: all })?.copyId).toBe('other-free');
  });

  it('takes the most recent copy of ONE printing back out', () => {
    const other = { ...geyser('other', 0.5), scryfallId: 'sf-other' };
    const mixed = { ...geysers, copies: [...geysers.copies, other] };
    let d = addGive(null, FRIEND, mixed, { claimed, printing }).draft;
    d = addGive(d, FRIEND, mixed, {
      claimed,
      printing: { scryfallId: 'sf-other', finish: 'nonfoil' },
    }).draft;
    d = removeOneGive(d, 'o-geyser', new Set(['free-cheap', 'free-dear', 'in-deck']))!;
    expect(d.give['o-geyser'].copyIds).toEqual(['other']);
  });
});
