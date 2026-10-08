import { describe, expect, it } from 'vitest';
import {
  addCheapestCopy,
  askTradeCards,
  getEntryKey,
  resolveGivePrefill,
  setPrintingCount,
} from './trade-basket';
import { pickCopies, printingShortfall, type OwnedTradeLine } from './trade-picker';
import type { TradeCard } from './trades-client';
import type { EnrichedCard } from '../../types';

function copy(copyId: string, price: number, scryfallId = `sf-${copyId}`): EnrichedCard {
  return {
    copyId,
    name: 'Sol Ring',
    oracleId: 'o-sol',
    scryfallId,
    purchasePrice: price,
    finish: 'nonfoil',
    foil: false,
  } as EnrichedCard;
}

const ask = (quantity: number, copies: TradeCard['copies'] = []): TradeCard => ({
  oracleId: 'o-sol',
  name: 'Sol Ring',
  quantity,
  copies,
});

describe('addCheapestCopy: free copies first', () => {
  // The deck's copy is the cheapest.
  const line: OwnedTradeLine = {
    oracleId: 'o-sol',
    name: 'Sol Ring',
    copies: [copy('deck', 1), copy('free-b', 3), copy('free-a', 2)],
  };
  const claimed = new Set(['deck']);

  it('is plain cheapest-first when nothing is claimed', () => {
    expect(addCheapestCopy({}, line)).toEqual({ 'o-sol': ['deck'] });
  });

  it('walks free copies cheapest-first, then the claimed one', () => {
    let picked = addCheapestCopy({}, line, { claimed });
    expect(picked['o-sol']).toEqual(['free-a']);
    picked = addCheapestCopy(picked, line, { claimed });
    expect(picked['o-sol']).toEqual(['free-a', 'free-b']);
    picked = addCheapestCopy(picked, line, { claimed });
    expect(picked['o-sol']).toEqual(['free-a', 'free-b', 'deck']);
    expect(addCheapestCopy(picked, line, { claimed })).toBe(picked);
  });

  it('prefills a counter from free copies first', () => {
    const owned = new Map([['o-sol', line]]);
    const { prefill } = resolveGivePrefill([ask(2)], owned, claimed);
    expect(prefill).toEqual({ 'o-sol': ['free-a', 'free-b'] });
  });

  it('prefills the printings the offer named, free first within them', () => {
    const owned = new Map([['o-sol', line]]);
    const named = ask(1, [{ scryfallId: 'sf-free-b', finish: 'nonfoil' }]);
    expect(resolveGivePrefill([named], owned, claimed).prefill).toEqual({ 'o-sol': ['free-b'] });
  });

  it("setPrintingCount takes a printing's free copies before its claimed ones", () => {
    const twin: OwnedTradeLine = {
      oracleId: 'o-sol',
      name: 'Sol Ring',
      copies: [copy('deck', 1, 'sf-x'), copy('free', 2, 'sf-x')],
    };
    const key = 'sf-x|nonfoil|';
    expect(setPrintingCount({}, twin, key, 1, claimed)).toEqual({ 'o-sol': ['free'] });
    expect(setPrintingCount({}, twin, key, 2, claimed)).toEqual({ 'o-sol': ['free', 'deck'] });
  });
});

describe('askTradeCards: the wire shape of an ask', () => {
  const entry = (scryfallId: string | undefined, quantity: number) => ({
    name: 'Llanowar Elves',
    oracleId: 'o-elves',
    ...(scryfallId ? { scryfallId, finish: 'nonfoil' } : {}),
    quantity,
  });
  const key = (scryfallId?: string) =>
    getEntryKey({ oracleId: 'o-elves', name: 'Llanowar Elves', scryfallId, finish: 'nonfoil' });

  it('sends one pinned line per card, with one copy per unit', () => {
    const cards = askTradeCards({
      [key('sf-7ed')]: entry('sf-7ed', 1),
      [key('sf-fdn')]: entry('sf-fdn', 2),
    });
    expect(cards).toEqual([
      {
        oracleId: 'o-elves',
        name: 'Llanowar Elves',
        quantity: 3,
        copies: [
          { scryfallId: 'sf-7ed', finish: 'nonfoil' },
          { scryfallId: 'sf-fdn', finish: 'nonfoil' },
          { scryfallId: 'sf-fdn', finish: 'nonfoil' },
        ],
      },
    ]);
  });

  it('sends an oracle-level line when any entry takes any printing', () => {
    const cards = askTradeCards({
      [key('sf-7ed')]: entry('sf-7ed', 1),
      'o-elves': entry(undefined, 2),
    });
    expect(cards).toEqual([
      { oracleId: 'o-elves', name: 'Llanowar Elves', quantity: 3, copies: [] },
    ]);
  });

  it('never repeats an oracle id, which the server rejects', () => {
    const cards = askTradeCards({
      [key('a')]: entry('a', 1),
      [key('b')]: entry('b', 1),
      other: { name: 'Sol Ring', oracleId: 'o-sol', quantity: 1 },
    });
    expect(cards.map((c) => c.oracleId)).toEqual(['o-elves', 'o-sol']);
  });
});

describe('pickCopies: the printing an ask named, free copies first', () => {
  const line: OwnedTradeLine = {
    oracleId: 'o-sol',
    name: 'Sol Ring',
    copies: [copy('asked-deck', 5, 'sf-asked'), copy('other-free', 1, 'sf-other')],
  };
  const asked = [{ scryfallId: 'sf-asked', finish: 'nonfoil' }];

  it('takes the asked printing when it is free', () => {
    const ids = pickCopies(line, 1, { prefer: asked }).map((c) => c.copyId);
    expect(ids).toEqual(['asked-deck']);
  });

  it('still prefers a free copy of another printing to the asked one a deck holds', () => {
    const ids = pickCopies(line, 1, { prefer: asked, claimed: new Set(['asked-deck']) });
    expect(ids.map((c) => c.copyId)).toEqual(['other-free']);
  });

  it('reports which asked printings the pick missed', () => {
    const picked = pickCopies(line, 1, { prefer: asked, claimed: new Set(['asked-deck']) });
    const shortfall = printingShortfall(asked, picked);
    expect(shortfall?.missed).toEqual(asked);
    expect(shortfall?.given.map((c) => c.copyId)).toEqual(['other-free']);
    expect(printingShortfall(asked, [line.copies[0]])).toBeNull();
    expect(printingShortfall([], picked)).toBeNull();
  });
});
