import { describe, it, expect } from 'vitest';
import { planSettlement, describeSettlement } from './trade-settlement';
import type { TradeCard } from './trades-client';
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

function line(over: Partial<TradeCard> & { oracleId: string; name: string }): TradeCard {
  return { quantity: 1, copies: [], ...over };
}

describe('planSettlement', () => {
  it('removes the exact printing when the collection has it', async () => {
    const collection = [
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
      owned({ copyId: 'b', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-lcc' }),
    ];
    const plan = planSettlement(
      [
        line({
          oracleId: 'o-sol',
          name: 'Sol Ring',
          copies: [{ scryfallId: 'scry-lcc', finish: 'nonfoil' }],
        }),
      ],
      [],
      collection
    );
    expect(plan.remove).toEqual([{ copyId: 'b', name: 'Sol Ring' }]);
    expect(plan.short).toHaveLength(0);
  });

  it('prefers the matching finish when the printing is ambiguous', () => {
    const collection = [
      owned({
        copyId: 'plain',
        name: 'Sol Ring',
        oracleId: 'o-sol',
        scryfallId: 'scry-c21',
        finish: 'nonfoil',
      }),
      owned({
        copyId: 'shiny',
        name: 'Sol Ring',
        oracleId: 'o-sol',
        scryfallId: 'scry-c21',
        finish: 'foil',
      }),
    ];
    const plan = planSettlement(
      [
        line({
          oracleId: 'o-sol',
          name: 'Sol Ring',
          copies: [{ scryfallId: 'scry-c21', finish: 'foil' }],
        }),
      ],
      [],
      collection
    );
    expect(plan.remove).toEqual([{ copyId: 'shiny', name: 'Sol Ring' }]);
  });

  it('falls back to another printing of the same card rather than under-removing', () => {
    // They agreed to give a Sol Ring; the exact printing is gone but they still
    // own one. The card leaves the collection — the deal was for the card.
    const collection = [
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-other' }),
    ];
    const plan = planSettlement(
      [
        line({
          oracleId: 'o-sol',
          name: 'Sol Ring',
          copies: [{ scryfallId: 'scry-c21', finish: 'nonfoil' }],
        }),
      ],
      [],
      collection
    );
    expect(plan.remove).toEqual([{ copyId: 'a', name: 'Sol Ring' }]);
    expect(plan.short).toHaveLength(0);
  });

  it('never spends one copy twice across two lines', () => {
    const collection = [
      owned({ copyId: 'only', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
    ];
    const plan = planSettlement(
      [
        line({
          oracleId: 'o-sol',
          name: 'Sol Ring',
          quantity: 2,
          copies: [
            { scryfallId: 'scry-c21', finish: 'nonfoil' },
            { scryfallId: 'scry-c21', finish: 'nonfoil' },
          ],
        }),
      ],
      [],
      collection
    );
    expect(plan.remove).toHaveLength(1);
    expect(plan.short).toEqual([{ name: 'Sol Ring', missing: 1 }]);
  });

  it('reports a shortfall for a card no longer owned, and still settles the rest', () => {
    const collection = [
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
    ];
    const plan = planSettlement(
      [
        line({
          oracleId: 'o-sol',
          name: 'Sol Ring',
          copies: [{ scryfallId: 'scry-c21', finish: 'nonfoil' }],
        }),
        line({
          oracleId: 'o-gone',
          name: 'Mana Crypt',
          copies: [{ scryfallId: 'scry-crypt', finish: 'nonfoil' }],
        }),
      ],
      [],
      collection
    );
    expect(plan.remove).toEqual([{ copyId: 'a', name: 'Sol Ring' }]);
    expect(plan.short).toEqual([{ name: 'Mana Crypt', missing: 1 }]);
  });

  it('adds one entry per received copy, carrying its printing', () => {
    const plan = planSettlement(
      [],
      [
        line({
          oracleId: 'o-rhystic',
          name: 'Rhystic Study',
          quantity: 2,
          copies: [
            { scryfallId: 'scry-jud', finish: 'foil' },
            { scryfallId: 'scry-2xm', finish: 'nonfoil', condition: 'LP' },
          ],
        }),
      ],
      []
    );
    expect(plan.add).toHaveLength(2);
    expect(plan.add[0].copy.scryfallId).toBe('scry-jud');
    expect(plan.add[0].copy.finish).toBe('foil');
    expect(plan.add[1].copy.condition).toBe('LP');
    expect(plan.remove).toHaveLength(0);
  });

  it('re-running against an already-settled collection removes nothing', () => {
    // The idempotency property the settlement flow leans on: apply locally
    // first, report to the server second, and a replay is harmless on the
    // removal side.
    const give = [
      line({
        oracleId: 'o-sol',
        name: 'Sol Ring',
        copies: [{ scryfallId: 'scry-c21', finish: 'nonfoil' }],
      }),
    ];
    const before = [
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
    ];
    const first = planSettlement(give, [], before);
    const after = before.filter((c) => !first.remove.some((r) => r.copyId === c.copyId));

    const replay = planSettlement(give, [], after);
    expect(replay.remove).toHaveLength(0);
  });

  it('matches a legacy copy that has no oracleId, via its scryfallId', () => {
    const collection = [
      owned({ copyId: 'legacy', name: 'Sol Ring', oracleId: undefined, scryfallId: 'scry-c21' }),
    ];
    const plan = planSettlement(
      [
        line({
          oracleId: 'o-sol',
          name: 'Sol Ring',
          copies: [{ scryfallId: 'scry-c21', finish: 'nonfoil' }],
        }),
      ],
      [],
      collection
    );
    expect(plan.remove).toEqual([{ copyId: 'legacy', name: 'Sol Ring' }]);
  });

  it('handles an unresolved give line by spending any copy of the card', () => {
    const collection = [
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
    ];
    const plan = planSettlement(
      [line({ oracleId: 'o-sol', name: 'Sol Ring', copies: [] })],
      [],
      collection
    );
    expect(plan.remove).toEqual([{ copyId: 'a', name: 'Sol Ring' }]);
  });
});

describe('describeSettlement', () => {
  it('counts copies, not card lines', () => {
    const plan = planSettlement(
      [],
      [
        line({
          oracleId: 'o-a',
          name: 'A',
          quantity: 2,
          copies: [
            { scryfallId: 's1', finish: 'nonfoil' },
            { scryfallId: 's2', finish: 'nonfoil' },
          ],
        }),
      ],
      []
    );
    expect(describeSettlement(plan)).toBe('2 cards in');
  });

  it('reads naturally in both directions', () => {
    const collection = [
      owned({ copyId: 'a', name: 'Sol Ring', oracleId: 'o-sol', scryfallId: 'scry-c21' }),
    ];
    const plan = planSettlement(
      [
        line({
          oracleId: 'o-sol',
          name: 'Sol Ring',
          copies: [{ scryfallId: 'scry-c21', finish: 'nonfoil' }],
        }),
      ],
      [line({ oracleId: 'o-r', name: 'R', copies: [{ scryfallId: 's', finish: 'nonfoil' }] })],
      collection
    );
    expect(describeSettlement(plan)).toBe('1 card in, 1 out');
  });

  it('says so plainly when nothing moves', () => {
    expect(describeSettlement({ remove: [], add: [], short: [] })).toBe('No collection changes');
  });
});
