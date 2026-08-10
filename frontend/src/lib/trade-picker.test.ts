import { describe, it, expect } from 'vitest';
import {
  groupOwnedForTrade,
  filterOwnedLines,
  toTradeCard,
  toRequestedCard,
  copiesByValue,
  groupByPrinting,
  toTradeCardFromCopies,
  sumCopyValue,
} from './trade-picker';
import type { EnrichedCard } from '../types';

function owned(over: Partial<EnrichedCard> & { copyId: string; name: string }): EnrichedCard {
  return {
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: 'scry-default',
    purchasePrice: 0,
    sourceCategory: 'manual',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    ...over,
  } as EnrichedCard;
}

describe('groupOwnedForTrade', () => {
  it('stacks printings of the same card into one line', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
      owned({ copyId: 'b', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-lcc' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].copies).toHaveLength(2);
  });

  it('excludes proxies — a proxy is not the card', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'real', name: 'Sol Ring', oracleId: 'o-sol' }),
      owned({ copyId: 'fake', name: 'Mana Crypt', oracleId: 'o-crypt', proxy: true }),
    ]);
    expect(lines.map((l) => l.name)).toEqual(['Sol Ring']);
  });

  it('keeps a legacy copy with no oracleId tradeable, keyed by name', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'legacy', name: 'Sol Ring', oracleId: undefined }),
      owned({ copyId: 'legacy2', name: 'sol ring', oracleId: undefined }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].copies).toHaveLength(2);
  });

  it('sorts by name', () => {
    const lines = groupOwnedForTrade([
      owned({ copyId: 'a', name: 'Zur', oracleId: 'o-zur' }),
      owned({ copyId: 'b', name: 'Arcane Signet', oracleId: 'o-sig' }),
    ]);
    expect(lines.map((l) => l.name)).toEqual(['Arcane Signet', 'Zur']);
  });
});

describe('filterOwnedLines', () => {
  const lines = groupOwnedForTrade([
    owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol' }),
    owned({ copyId: 'b', name: 'Arcane Signet', oracleId: 'o-sig' }),
  ]);

  it('matches a case-insensitive substring', () => {
    expect(filterOwnedLines(lines, 'sig').map((l) => l.name)).toEqual(['Arcane Signet']);
  });

  it('returns everything for a blank query', () => {
    expect(filterOwnedLines(lines, '   ')).toHaveLength(2);
  });
});

describe('toTradeCard', () => {
  const line = groupOwnedForTrade([
    owned({
      copyId: 'a',
      name: 'Sol Ring',
      oracleId: 'o-sol',
      scryfallId: 'scry-c21',
      finish: 'foil',
      condition: 'lp',
      language: 'ja',
    }),
    owned({ copyId: 'b', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-lcc' }),
  ])[0];

  it('names the exact copies going, with their printing detail', () => {
    const card = toTradeCard(line, 1);
    expect(card.quantity).toBe(1);
    expect(card.copies).toEqual([
      { scryfallId: 'scry-c21', finish: 'foil', condition: 'lp', language: 'ja' },
    ]);
  });

  it('omits condition and language when the copy has none', () => {
    const card = toTradeCard(line, 2);
    expect(card.copies[1]).toEqual({ scryfallId: 'scry-lcc', finish: 'nonfoil' });
  });

  it('clamps a quantity beyond what is owned', () => {
    const card = toTradeCard(line, 99);
    expect(card.quantity).toBe(2);
    expect(card.copies).toHaveLength(2);
  });
});

describe('toRequestedCard', () => {
  it('stays oracle-level — the friend resolves printings when they accept', () => {
    const card = toRequestedCard({ oracleId: 'o-rhystic', name: 'Rhystic Study' }, 2);
    expect(card).toEqual({
      oracleId: 'o-rhystic',
      name: 'Rhystic Study',
      quantity: 2,
      copies: [],
    });
  });
});

describe('choosing WHICH copy leaves the binder', () => {
  const beta = owned({
    copyId: 'beta',
    name: 'Sol Ring',
    oracleId: 'o-sol',
    scryfallId: 'scry-lea',
    setCode: 'lea',
    purchasePrice: 3200,
  });
  const reprint = owned({
    copyId: 'reprint',
    name: 'Sol Ring',
    oracleId: 'o-sol',
    scryfallId: 'scry-c21',
    purchasePrice: 2,
  });
  const foil = owned({
    copyId: 'foil',
    name: 'Sol Ring',
    oracleId: 'o-sol',
    scryfallId: 'scry-c21',
    finish: 'foil',
    purchasePrice: 9,
  });

  it('orders copies cheapest-first regardless of collection order', () => {
    // Collection order puts the Beta first — the order the old code sliced.
    const [line] = groupOwnedForTrade([beta, reprint, foil]);
    expect(copiesByValue(line).map((c) => c.copyId)).toEqual(['reprint', 'foil', 'beta']);
  });

  it('an automatic pick takes the CHEAPEST copy, not the first', () => {
    // The regression this guards: offering "Sol Ring ×1" used to hand over
    // copies[0] — here the $3200 Beta — purely because it sorted first.
    const [line] = groupOwnedForTrade([beta, reprint, foil]);
    expect(toTradeCard(line, 1).copies).toEqual([{ scryfallId: 'scry-c21', finish: 'nonfoil' }]);
  });

  it('ties keep collection order so identical printings stay stable', () => {
    const a = owned({ copyId: 'a', name: 'Island', oracleId: 'o-is', purchasePrice: 1 });
    const b = owned({ copyId: 'b', name: 'Island', oracleId: 'o-is', purchasePrice: 1 });
    const [line] = groupOwnedForTrade([a, b]);
    expect(copiesByValue(line).map((c) => c.copyId)).toEqual(['a', 'b']);
  });

  it('sends exactly the copies chosen, in the wire shape, with no copyId', () => {
    const [line] = groupOwnedForTrade([beta, reprint, foil]);
    const card = toTradeCardFromCopies(line, [beta, foil]);
    expect(card.quantity).toBe(2);
    expect(card.copies).toEqual([
      { scryfallId: 'scry-lea', finish: 'nonfoil' },
      { scryfallId: 'scry-c21', finish: 'foil' },
    ]);
    // copyId is device-local; letting it onto the wire would break settlement,
    // which matches by printing.
    expect(JSON.stringify(card)).not.toContain('copyId');
  });

  it('values a chosen set at the sum of THOSE copies, not the card', () => {
    expect(sumCopyValue([reprint, foil])).toBe(11);
    expect(sumCopyValue([beta])).toBe(3200);
    expect(sumCopyValue([])).toBe(0);
  });

  it('collapses identical copies into ONE printing row, cheapest first', () => {
    // Eight indistinguishable copies of one printing is not eight choices —
    // it rendered as eight identical checkboxes and buried the real options.
    const dupes = Array.from({ length: 8 }, (_, i) =>
      owned({
        copyId: `dupe-${i}`,
        name: 'Sol Ring',
        oracleId: 'o-sol',
        scryfallId: 'scry-c21',
        purchasePrice: 2,
      })
    );
    const [line] = groupOwnedForTrade([beta, ...dupes, foil]);
    const groups = groupByPrinting(line);

    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.copies.length)).toEqual([8, 1, 1]);
    expect(groups.map((g) => g.price)).toEqual([2, 9, 3200]);
  });

  it('splits the same printing by finish AND condition — different objects', () => {
    const nm = owned({
      copyId: 'nm',
      name: 'Bolt',
      oracleId: 'o-b',
      scryfallId: 'scry-x',
      condition: 'nm',
      purchasePrice: 5,
    });
    const played = owned({
      copyId: 'mp',
      name: 'Bolt',
      oracleId: 'o-b',
      scryfallId: 'scry-x',
      condition: 'mp',
      purchasePrice: 3,
    });
    const [line] = groupOwnedForTrade([nm, played]);
    expect(groupByPrinting(line).map((g) => g.condition)).toEqual(['mp', 'nm']);
  });
});
