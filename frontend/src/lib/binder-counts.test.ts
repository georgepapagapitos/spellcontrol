import { describe, it, expect } from 'vitest';
import { countBinderMatches } from './binder-counts';
import type { EnrichedCard, BinderFilterGroup } from '../types';

function mk(o: Partial<EnrichedCard>): EnrichedCard {
  return {
    copyId: crypto.randomUUID(),
    name: 'C',
    setCode: 'TST',
    setName: 'T',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: crypto.randomUUID(),
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Instant',
    ...o,
  } as EnrichedCard;
}

// One card owned in two printings; only the pricey one clears the price rule.
const pricey = () => mk({ name: 'Atraxa', oracleId: 'atx', purchasePrice: 3 });
const bulk = () => mk({ name: 'Atraxa', oracleId: 'atx', purchasePrice: 0.1 });
const priceRule: BinderFilterGroup[] = [{ filter: { priceMin: 0.5 } }];

describe('countBinderMatches', () => {
  it('flag off: total is deduped rule matches; perGroup is raw', () => {
    const r = countBinderMatches([pricey(), bulk()], priceRule, false);
    expect(r.perGroup).toEqual([1]); // only the $3 printing matches the rule
    expect(r.total).toBe(1);
  });

  it('flag on: total expands to all printings of a matched card; perGroup unchanged', () => {
    const r = countBinderMatches([pricey(), bulk()], priceRule, true);
    expect(r.perGroup).toEqual([1]); // per-group stays rule-only
    expect(r.total).toBe(2); // both printings counted
  });

  it('flag on: counts every owned copy sharing a matched oracleId', () => {
    const cards = [pricey(), bulk(), bulk(), bulk()]; // 1 pricey + 3 bulk, same oracleId
    expect(countBinderMatches(cards, priceRule, true).total).toBe(4);
  });

  it('flag on: a matched card with no oracleId is counted once, not promoted', () => {
    const noOracle = mk({ name: 'X', purchasePrice: 3 }); // matches, no oracleId
    const otherNoOracle = mk({ name: 'Y', purchasePrice: 0.1 }); // no match, no oracleId
    const r = countBinderMatches([noOracle, otherNoOracle], priceRule, true);
    expect(r.perGroup).toEqual([1]);
    expect(r.total).toBe(1); // only the matched no-oracle copy; the other can't be promoted
  });

  it('does not double-count the matched printing itself when expanding', () => {
    // pricey matches AND shares oracleId with itself — must be counted once.
    expect(countBinderMatches([pricey()], priceRule, true).total).toBe(1);
  });

  it('multiple OR groups: perGroup independent, total deduped', () => {
    const groups: BinderFilterGroup[] = [
      { filter: { priceMin: 0.5 } },
      { filter: { nameContains: 'Atraxa' } },
    ];
    const r = countBinderMatches([pricey(), bulk()], groups, false);
    expect(r.perGroup).toEqual([1, 2]); // price group: 1; name group: both
    expect(r.total).toBe(2); // deduped (pricey hits both groups)
  });
});
