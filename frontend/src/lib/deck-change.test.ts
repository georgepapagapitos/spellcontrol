import { describe, it, expect } from 'vitest';
import {
  type Change,
  sortOwnedFirst,
  laneSummary,
  fromSynergySuggestion,
  fromGapCard,
  parsePrice,
} from './deck-change';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { GapAnalysisCard } from '@/deck-builder/types';

/** Minimal add Change for the lane helpers. */
function add(over: Partial<Change>): Change {
  return {
    id: over.id ?? `fill-gaps:${over.name ?? 'x'}`,
    type: 'add',
    lane: 'fill-gaps',
    name: 'x',
    reason: 'r',
    ...over,
  };
}

describe('sortOwnedFirst', () => {
  it('owned beats in-other-deck beats unowned/undefined', () => {
    const out = sortOwnedFirst([
      add({ name: 'unowned', ownership: 'unowned' }),
      add({ name: 'free', ownership: 'owned' }),
      add({ name: 'blind', ownership: undefined }),
      add({ name: 'elsewhere', ownership: 'in-other-deck' }),
    ]);
    expect(out.map((c) => c.name)).toEqual(['free', 'elsewhere', 'unowned', 'blind']);
  });

  it('within a rank, higher inclusion comes first', () => {
    const out = sortOwnedFirst([
      add({ name: 'low', ownership: 'owned', inclusion: 20 }),
      add({ name: 'high', ownership: 'owned', inclusion: 90 }),
    ]);
    expect(out.map((c) => c.name)).toEqual(['high', 'low']);
  });

  it('is stable for equal rank + equal/absent inclusion', () => {
    const out = sortOwnedFirst([
      add({ name: 'a', ownership: 'unowned' }),
      add({ name: 'b', ownership: 'unowned' }),
      add({ name: 'c', ownership: 'unowned' }),
    ]);
    expect(out.map((c) => c.name)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [
      add({ name: 'a', ownership: 'unowned' }),
      add({ name: 'b', ownership: 'owned' }),
    ];
    const before = input.map((c) => c.name);
    sortOwnedFirst(input);
    expect(input.map((c) => c.name)).toEqual(before);
  });
});

describe('laneSummary', () => {
  it('counts adds, cuts, and swaps (swap counts on both sides)', () => {
    const s = laneSummary([add({ type: 'add' }), add({ type: 'cut' }), add({ type: 'swap' })]);
    expect(s.addCount).toBe(2); // add + swap
    expect(s.cutCount).toBe(2); // cut + swap
    expect(s.net).toBe(0);
  });

  it('sums defined deltas and keeps unknown deltas null (never coerced to 0)', () => {
    const s = laneSummary([
      add({ deltaScore: 5, deltaPrice: -3 }),
      add({ deltaScore: undefined, deltaPrice: undefined }),
      add({ deltaScore: 2 }),
    ]);
    expect(s.scoreDelta).toBe(7);
    expect(s.priceDelta).toBe(-3);
  });

  it('reports null deltas when nothing is known', () => {
    const s = laneSummary([add({}), add({})]);
    expect(s.scoreDelta).toBeNull();
    expect(s.priceDelta).toBeNull();
  });

  it('handles an empty lane', () => {
    expect(laneSummary([])).toEqual({
      addCount: 0,
      cutCount: 0,
      net: 0,
      scoreDelta: null,
      priceDelta: null,
    });
  });
});

describe('fromSynergySuggestion', () => {
  const base: SynergySuggestion = {
    cardName: 'Cathars’ Crusade',
    axis: 'tokens',
    axisLabel: 'Tokens / go-wide',
    side: 'payoff',
    reason: 'rewards going wide',
    inclusion: 12,
  };

  it('maps an off-meta synergy pick into an upgrade-lane add', () => {
    const c = fromSynergySuggestion(base, 'unowned');
    expect(c.type).toBe('add');
    expect(c.lane).toBe('upgrade');
    expect(c.name).toBe(base.cardName);
    expect(c.id).toBe('upgrade:Cathars’ Crusade');
    expect(c.reason).toBe('rewards going wide');
    expect(c.ownership).toBe('unowned');
    expect(c.inclusion).toBe(12);
    expect(c.isThemeSynergy).toBe(true);
    expect(c.group).toBe('Tokens / go-wide');
    expect(c.axis).toBe('tokens');
    expect(c.side).toBe('payoff');
  });

  it('leaves inclusion undefined for genuinely off-meta picks (renders "Off-meta")', () => {
    const c = fromSynergySuggestion({ ...base, inclusion: undefined });
    expect(c.inclusion).toBeUndefined();
    expect(c.ownership).toBeUndefined();
  });
});

describe('fromGapCard', () => {
  const gap: GapAnalysisCard = {
    name: 'Cultivate',
    price: '$1.50',
    inclusion: 62,
    synergy: 0.3,
    typeLine: 'Sorcery',
    cmc: 3,
    role: 'ramp',
    roleLabel: 'Ramp',
    imageUrl: 'http://img/cultivate',
  };

  it('maps an EDHREC gap card into an add Change with parsed price + role', () => {
    const c = fromGapCard(gap, 'owned');
    expect(c.type).toBe('add');
    expect(c.name).toBe('Cultivate');
    expect(c.reason).toBe('Ramp staple');
    expect(c.ownership).toBe('owned');
    expect(c.deltaPrice).toBe(1.5);
    expect(c.role).toBe('ramp');
    expect(c.inclusion).toBe(62);
    expect(c.imageUrl).toBe('http://img/cultivate');
  });

  it('falls back to a generic reason + undefined price when fields are absent', () => {
    const c = fromGapCard({ ...gap, roleLabel: undefined, price: null });
    expect(c.reason).toBe('EDHREC staple');
    expect(c.deltaPrice).toBeUndefined();
  });
});

describe('parsePrice re-export', () => {
  it('parses a "$X.XX" string', () => {
    expect(parsePrice('$12.34')).toBe(12.34);
  });
  it('returns null for non-finite input', () => {
    expect(parsePrice('—')).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});
