import { describe, it, expect } from 'vitest';
import { countBinderMatches, countEffectiveLanding } from './binder-counts';
import type { BinderDef, BinderFilter, EnrichedCard, BinderFilterGroup } from '../types';

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

function makeBinder(name: string, filter: BinderFilter, position: number): BinderDef {
  return {
    id: `binder-${name}`,
    name,
    position,
    filterGroups: [{ filter }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#fff',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('countEffectiveLanding', () => {
  it('matches equals lands when the draft is the only binder', () => {
    const cards = [pricey(), bulk()];
    const r = countEffectiveLanding(cards, [], {
      id: null,
      groups: priceRule,
      keepPrintingsTogether: false,
    });
    expect(r.matches).toBe(1);
    expect(r.lands).toBe(1);
    expect(r.caughtAbove).toBe(0);
    expect(r.pulledIn).toBe(0);
  });

  it('caughtAbove: an earlier binder claims cards the draft would otherwise match', () => {
    // Both binders match on price; the earlier one wins every card, so the
    // draft (appended last) lands nothing despite matching by its own rules.
    const earlier = makeBinder('Earlier', { priceMin: 0.5 }, 0);
    const cards = [pricey(), pricey()];
    const r = countEffectiveLanding(cards, [earlier], {
      id: null,
      groups: priceRule,
      keepPrintingsTogether: false,
    });
    expect(r.matches).toBe(2);
    expect(r.lands).toBe(0);
    expect(r.caughtAbove).toBe(2);
    expect(r.pulledIn).toBe(0);
  });

  it('editing an existing binder keeps its position instead of appending last', () => {
    // Draft ("Mine") sits ahead of "Later" at position 0; edited in place it
    // should keep winning the cards it already claims, not fall behind Later.
    const mine = makeBinder('Mine', { priceMin: 0.5 }, 0);
    const later = makeBinder('Later', {}, 1); // matches everything
    const cards = [pricey(), bulk()];
    const r = countEffectiveLanding(cards, [mine, later], {
      id: 'binder-Mine',
      groups: priceRule,
      keepPrintingsTogether: false,
    });
    expect(r.lands).toBe(1); // still wins the $3 printing ahead of Later
    expect(r.caughtAbove).toBe(0);
  });

  it('pulledIn: keepPrintingsTogether promotes extra printings beyond raw matches', () => {
    const cards = [pricey(), bulk()]; // same oracleId; only pricey matches the rule
    const r = countEffectiveLanding(cards, [], {
      id: null,
      groups: priceRule,
      keepPrintingsTogether: true,
    });
    expect(r.matches).toBe(1); // raw match, not promotion-expanded
    expect(r.lands).toBe(2); // both printings land once promoted
    expect(r.caughtAbove).toBe(0);
    expect(r.pulledIn).toBe(1);
  });

  it('a manual-mode draft lands nothing via rules (pins only, none set here)', () => {
    const cards = [pricey()];
    const r = countEffectiveLanding(cards, [], {
      id: null,
      groups: priceRule,
      keepPrintingsTogether: false,
      mode: 'manual',
    });
    expect(r.matches).toBe(1); // rule count is mode-agnostic
    expect(r.lands).toBe(0); // manual binders don't auto-route by rules
    expect(r.caughtAbove).toBe(1);
  });
});
