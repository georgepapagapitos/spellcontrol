import { describe, expect, it } from 'vitest';
import {
  MAX_COPIES_PER_LINE,
  addCheapestCopy,
  askFloorValue,
  bump,
  giveTradeCards,
  giveValue,
  rankGiveLines,
  removeKey,
  resolveChosen,
  setPrintingCount,
  totalQuantity,
  wantTradeCards,
  wantedKeysOf,
} from './trade-basket';
import type { TradeCard } from './trades-client';
import type { OwnedTradeLine } from './trade-picker';
import type { EnrichedCard } from '../../types';

function mk(copyId: string, price: number, scryfallId: string): EnrichedCard {
  return {
    copyId,
    name: 'Sol Ring',
    oracleId: 'o-sol',
    setCode: 'C21',
    setName: 'Commander 2021',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId,
    purchasePrice: price,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
  } as EnrichedCard;
}

const ask = (oracleId: string, name: string, quantity: number): TradeCard =>
  ({ oracleId, name, quantity, copies: [] }) as unknown as TradeCard;

const line: OwnedTradeLine = {
  oracleId: 'o-sol',
  name: 'Sol Ring',
  copies: [mk('a1', 5, 'pA'), mk('a2', 5, 'pA'), mk('b1', 2, 'pB')],
};
const ownedByKey = new Map([['o-sol', line]]);

describe('addCheapestCopy', () => {
  it('adds the cheapest unchosen copy, then the next, then stops', () => {
    let p = addCheapestCopy({}, line);
    expect(p).toEqual({ 'o-sol': ['b1'] });
    p = addCheapestCopy(p, line);
    expect(p['o-sol']).toEqual(['b1', 'a1']);
    p = addCheapestCopy(p, line);
    expect(p['o-sol']).toEqual(['b1', 'a1', 'a2']);
    expect(addCheapestCopy(p, line)).toBe(p);
  });
});

describe('setPrintingCount', () => {
  it('swaps one printing and leaves the others alone', () => {
    let p = setPrintingCount({ 'o-sol': ['b1'] }, line, 'pA|nonfoil|', 2);
    expect(p['o-sol']).toEqual(['b1', 'a1', 'a2']);
    p = setPrintingCount(p, line, 'pA|nonfoil|', 1);
    expect(p['o-sol']).toEqual(['b1', 'a1']);
    p = setPrintingCount(p, line, 'pA|nonfoil|', 99);
    expect(p['o-sol']).toEqual(['b1', 'a1', 'a2']);
  });

  it('removes the line at zero and ignores an unknown printing', () => {
    const start = { 'o-sol': ['a1'] };
    expect(setPrintingCount(start, line, 'pA|nonfoil|', 0)).toEqual({});
    expect(setPrintingCount(start, line, 'nope', 1)).toBe(start);
    expect(setPrintingCount(start, line, 'pA|nonfoil|', -3)).toEqual({});
  });
});

describe('removeKey and bump', () => {
  it('removeKey does not mutate', () => {
    const p = { a: 1, b: 2 };
    expect(removeKey(p, 'a')).toEqual({ b: 2 });
    expect(p).toEqual({ a: 1, b: 2 });
  });

  it('bump clamps to max and removes at zero', () => {
    expect(bump({}, 'k', 1, 20)).toEqual({ k: 1 });
    expect(bump({ k: 19 }, 'k', 5, MAX_COPIES_PER_LINE)).toEqual({ k: 20 });
    expect(bump({ k: 1 }, 'k', -1, 20)).toEqual({});
    expect(bump({ k: 3 }, 'k', -3, 20)).toEqual({});
    expect(MAX_COPIES_PER_LINE).toBe(20);
  });
});

describe('picked state to wire cards', () => {
  it('resolveChosen drops copies and lines that are no longer owned', () => {
    const chosen = resolveChosen(
      { 'o-sol': ['a1', 'gone'], 'o-x': ['z'], 'o-empty': [] },
      ownedByKey
    );
    expect([...chosen.keys()]).toEqual(['o-sol']);
    expect(chosen.get('o-sol')?.map((c) => c.copyId)).toEqual(['a1']);
    expect(resolveChosen({ 'o-sol': ['gone'] }, ownedByKey).size).toBe(0);
  });

  it('giveTradeCards builds wire cards without copyIds and skips empty or unknown lines', () => {
    const chosen = resolveChosen({ 'o-sol': ['a1', 'b1'] }, ownedByKey);
    const cards = giveTradeCards(chosen, ownedByKey);
    expect(cards).toHaveLength(1);
    expect(cards[0].quantity).toBe(2);
    expect(JSON.stringify(cards)).not.toContain('copyId');
    expect(giveTradeCards(new Map([['o-x', [line.copies[0]]]]), ownedByKey)).toEqual([]);
    expect(giveTradeCards(new Map([['o-sol', []]]), ownedByKey)).toEqual([]);
  });

  it('wantTradeCards builds oracle-level asks and skips unresolved keys', () => {
    const cards = wantTradeCards({ 'o-sol': 3, missing: 1, zero: 0 }, (k) =>
      k === 'o-sol' || k === 'zero' ? { oracleId: k, name: 'Sol Ring' } : undefined
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ oracleId: 'o-sol', quantity: 3 });
    expect(cards[0].copies).toEqual([]);
    expect(totalQuantity(cards)).toBe(3);
  });
});

describe('basket value', () => {
  it('giveValue sums exact copy prices', () => {
    expect(giveValue(resolveChosen({ 'o-sol': ['a1', 'b1'] }, ownedByKey))).toBe(7);
  });

  it('askFloorValue counts unpriced cards separately instead of as zero', () => {
    const cards = [ask('o-1', 'Priced', 2), ask('o-2', 'Unknown', 1), ask('o-3', 'Null', 1)];
    const floors = new Map<string, number | null>([
      ['Priced', 1.5],
      ['Null', null],
    ]);
    expect(askFloorValue(cards, floors)).toEqual({ value: 3, unpriced: 2 });
    expect(askFloorValue([], new Map())).toEqual({ value: 0, unpriced: 0 });
  });
});

describe('give-side ranking', () => {
  it('wantedKeysOf matches by oracle id or case-insensitive name', () => {
    const byName: OwnedTradeLine = {
      oracleId: '',
      name: 'Rhystic Study',
      copies: [mk('r', 1, 'r')],
    };
    const other: OwnedTradeLine = { oracleId: 'o-z', name: 'Zzz', copies: [mk('z', 1, 'z')] };
    const keys = wantedKeysOf(
      [
        { oracleId: 'o-sol', name: 'whatever' },
        { oracleId: '', name: 'rhystic study' },
      ],
      [line, byName, other]
    );
    expect([...keys].sort()).toEqual(['name:rhystic study', 'o-sol']);
    expect(wantedKeysOf(null, [line]).size).toBe(0);
    expect(wantedKeysOf([], [line]).size).toBe(0);
  });

  it('rankGiveLines puts wanted first, then spare, then the rest, stable within a rank', () => {
    const l = (name: string): OwnedTradeLine => ({ oracleId: `o-${name}`, name, copies: [] });
    const lines = [l('plain1'), l('spare'), l('wanted'), l('plain2')];
    const ranked = rankGiveLines(lines, new Set(['o-wanted']), new Map([['spare', 1]]));
    expect(ranked.map((x) => x.name)).toEqual(['wanted', 'spare', 'plain1', 'plain2']);
    expect(lines[0].name).toBe('plain1');
  });
});
