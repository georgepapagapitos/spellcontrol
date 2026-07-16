import { describe, expect, it } from 'vitest';
import type { BinderFilterGroup, EnrichedCard } from '../types';
import { dynamicListRows, dynamicListCount, isRuleEmpty } from './dynamic-list';

function copy(over: Partial<EnrichedCard>): EnrichedCard {
  return {
    copyId: over.copyId ?? crypto.randomUUID(),
    name: 'Sol Ring',
    setCode: 'LEA',
    setName: 'Limited Edition Alpha',
    collectorNumber: '270',
    rarity: 'uncommon',
    scryfallId: 'sf-lea-sol',
    purchasePrice: 10,
    sourceCategory: '',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Artifact',
    ...over,
  };
}

const RULE: BinderFilterGroup[] = [{ filter: { nameContains: 'sol' } }];

describe('isRuleEmpty', () => {
  it('treats undefined, no groups, and only-empty groups as empty', () => {
    expect(isRuleEmpty(undefined)).toBe(true);
    expect(isRuleEmpty([])).toBe(true);
    expect(isRuleEmpty([{ filter: {} }])).toBe(true);
    expect(isRuleEmpty(RULE)).toBe(false);
  });
});

describe('dynamicListRows', () => {
  it('matches with the binder engine and aggregates copies per printing+finish', () => {
    const cards = [
      copy({ copyId: 'a' }),
      copy({ copyId: 'b' }), // same printing+finish → aggregates
      copy({ copyId: 'c', finish: 'foil', foil: true }), // same printing, foil → own row
      copy({ copyId: 'd', name: 'Arcane Signet', scryfallId: 'sf-signet' }), // no match
    ];
    const rows = dynamicListRows(cards, RULE);
    expect(rows).toHaveLength(2);
    const nonfoil = rows.find((r) => r.entry.finish === 'nonfoil')!;
    expect(nonfoil.entry.quantity).toBe(2);
    expect(nonfoil.entry.scryfallId).toBe('sf-lea-sol');
    expect(nonfoil.card.setCode).toBe('LEA'); // the owned copy itself — exact printing
    const foil = rows.find((r) => r.entry.finish === 'foil')!;
    expect(foil.entry.quantity).toBe(1);
    // Stable per-printing ids so preview/row keys don't churn between renders.
    expect(nonfoil.entry.id).toBe(nonfoil.card.copyId);
  });

  it('yields no rows for an empty rule', () => {
    expect(dynamicListRows([copy({})], [{ filter: {} }])).toEqual([]);
  });
});

describe('dynamicListCount', () => {
  it('counts matching copies (not unique printings)', () => {
    const cards = [
      copy({ copyId: 'a' }),
      copy({ copyId: 'b' }),
      copy({ copyId: 'c', name: 'Arcane Signet' }),
    ];
    expect(dynamicListCount(cards, RULE)).toBe(2);
    expect(dynamicListCount(cards, [])).toBe(0);
  });
});
