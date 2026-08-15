import { describe, expect, it } from 'vitest';
import { countMatchingRows, rowMatchesCollectionFilter } from './collection-filter';
import { compileExpression, compileFilter } from './rules';
import type { EnrichedCard } from '../types';

const card = (over: Partial<EnrichedCard> = {}): EnrichedCard =>
  ({
    name: over.name ?? 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    quantity: 1,
    colorIdentity: [],
    ...over,
  }) as EnrichedCard;

const row = (c: Partial<EnrichedCard>, binderName: string | null = null) => ({
  card: card(c),
  binderName,
});

const expr = (...values: string[]) => ({
  chips: values.map((value) => ({ value, negate: false })),
  joiners: values.slice(1).map(() => 'OR' as const),
});

const base = {
  matchFilter: compileFilter({}),
  colors: new Set<string>(),
  colorMode: 'any' as const,
};

describe('rowMatchesCollectionFilter', () => {
  it('passes everything when nothing is set', () => {
    expect(rowMatchesCollectionFilter(row({}), base)).toBe(true);
  });

  it('applies the engine filter', () => {
    const c = { ...base, matchFilter: compileFilter({ nameContains: 'sol' }) };
    expect(rowMatchesCollectionFilter(row({ name: 'Sol Ring' }), c)).toBe(true);
    expect(rowMatchesCollectionFilter(row({ name: 'Arcane Signet' }), c)).toBe(false);
  });

  // The six collection-only post-checks. They can't go through the rule engine
  // — binder membership and deck allocation aren't card properties, and the
  // colour semantics differ — so they're the part most at risk of drifting if
  // the dialog ever grew its own copy of this predicate.
  it('filters on binder membership, with a name for the uncategorized bucket', () => {
    const c = { ...base, binder: compileExpression(expr('Commanders')) };
    expect(rowMatchesCollectionFilter(row({}, 'Commanders'), c)).toBe(true);
    expect(rowMatchesCollectionFilter(row({}, 'Mana rocks'), c)).toBe(false);

    const uncat = { ...base, binder: compileExpression(expr('__uncategorized')) };
    expect(rowMatchesCollectionFilter(row({}, null), uncat)).toBe(true);
  });

  it('filters on colour identity, honouring the OR/AND mode', () => {
    const wu = row({ colorIdentity: ['W', 'U'] });
    const any = { ...base, colors: new Set(['W', 'B']) };
    const all = { ...base, colors: new Set(['W', 'B']), colorMode: 'all' as const };
    expect(rowMatchesCollectionFilter(wu, any)).toBe(true);
    expect(rowMatchesCollectionFilter(wu, all)).toBe(false);
  });

  it('treats a missing language as English', () => {
    const c = { ...base, language: compileExpression(expr('en')) };
    expect(rowMatchesCollectionFilter(row({ language: undefined }), c)).toBe(true);
    expect(rowMatchesCollectionFilter(row({ language: 'ja' }), c)).toBe(false);
  });

  it('filters on condition, surplus and proxy', () => {
    expect(
      rowMatchesCollectionFilter(row({ condition: 'nm' }), {
        ...base,
        condition: compileExpression(expr('nm')),
      })
    ).toBe(true);

    const surplus = { ...base, surplusOnly: true, surplusByName: new Set(['Sol Ring']) };
    expect(rowMatchesCollectionFilter(row({ name: 'Sol Ring' }), surplus)).toBe(true);
    expect(rowMatchesCollectionFilter(row({ name: 'Arcane Signet' }), surplus)).toBe(false);

    const proxies = { ...base, proxyOnly: true };
    expect(rowMatchesCollectionFilter(row({ proxy: true }), proxies)).toBe(true);
    expect(rowMatchesCollectionFilter(row({ proxy: false }), proxies)).toBe(false);
  });
});

describe('countMatchingRows', () => {
  // This is what the Filters dialog shows while you edit, so it has to agree
  // with what the page will render after Apply — same predicate, same inputs.
  it('counts the rows that survive', () => {
    const rows = [
      row({ name: 'Sol Ring', colorIdentity: [] }),
      row({ name: 'Wrath of God', colorIdentity: ['W'] }),
      row({ name: 'Swords to Plowshares', colorIdentity: ['W'] }),
    ];
    expect(countMatchingRows(rows, base)).toBe(3);
    expect(countMatchingRows(rows, { ...base, colors: new Set(['W']) })).toBe(2);
    expect(countMatchingRows(rows, { ...base, colors: new Set(['R']) })).toBe(0);
  });

  it('counts zero for an empty list', () => {
    expect(countMatchingRows([], base)).toBe(0);
  });
});
