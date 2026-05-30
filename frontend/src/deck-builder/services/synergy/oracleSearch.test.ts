import { describe, it, expect } from 'vitest';
import { axisSearchQuery, selectOracleCandidates, type OracleNeedResult } from './oracleSearch';
import { AXES, type AxisKey } from './axes';
import type { CardLike } from './text';
import type { SynergyNeed } from './suggest';

const card = (name: string): CardLike => ({ name });

const need = (axis: AxisKey, side: 'producer' | 'payoff'): SynergyNeed => ({
  axis,
  label: AXES.find((a) => a.key === axis)!.label,
  side,
});

describe('axisSearchQuery', () => {
  it('returns a query for every axis on both sides', () => {
    for (const ax of AXES) {
      for (const side of ['producer', 'payoff'] as const) {
        const q = axisSearchQuery(ax.key, side);
        expect(q, `${ax.key}/${side}`).toBeTruthy();
        expect(typeof q).toBe('string');
      }
    }
  });

  it('returns null for an unknown axis', () => {
    expect(axisSearchQuery('nope' as AxisKey, 'producer')).toBeNull();
  });
});

describe('selectOracleCandidates', () => {
  const base = {
    edhrecInclusion: new Map<string, number>(),
    inDeck: new Set<string>(),
  };

  it('keeps cards EDHREC never aggregated, with inclusion left undefined', () => {
    const results: OracleNeedResult[] = [
      { need: need('tokens', 'payoff'), cards: [card('Cathars Crusade'), card('Impact Tremors')] },
    ];
    const out = selectOracleCandidates(results, base);
    expect(out.map((c) => c.card.name)).toEqual(['Cathars Crusade', 'Impact Tremors']);
    expect(out.every((c) => c.inclusion === undefined)).toBe(true);
  });

  it('drops cards already in the deck (case-insensitive)', () => {
    const results: OracleNeedResult[] = [
      { need: need('tokens', 'payoff'), cards: [card('Impact Tremors'), card('Purphoros')] },
    ];
    const out = selectOracleCandidates(results, {
      ...base,
      inDeck: new Set(['impact tremors']),
    });
    expect(out.map((c) => c.card.name)).toEqual(['Purphoros']);
  });

  it('drops consensus cards (inclusion at/above the off-meta floor)', () => {
    const results: OracleNeedResult[] = [
      { need: need('tokens', 'payoff'), cards: [card('Staple'), card('Fringe')] },
    ];
    const out = selectOracleCandidates(results, {
      ...base,
      edhrecInclusion: new Map([
        ['staple', 40],
        ['fringe', 1], // below floor → genuinely off-meta, kept
      ]),
    });
    expect(out.map((c) => c.card.name)).toEqual(['Fringe']);
  });

  it('uses a configurable off-meta floor', () => {
    const results: OracleNeedResult[] = [
      { need: need('counters', 'payoff'), cards: [card('Niche')] },
    ];
    const inMap = new Map([['niche', 5]]);
    expect(selectOracleCandidates(results, { ...base, edhrecInclusion: inMap }).length).toBe(0);
    expect(
      selectOracleCandidates(results, { ...base, edhrecInclusion: inMap, offMetaFloor: 10 }).length
    ).toBe(1);
  });

  it('dedups a card that satisfies multiple needs', () => {
    const results: OracleNeedResult[] = [
      { need: need('tokens', 'payoff'), cards: [card('Versatile')] },
      { need: need('sacrifice', 'payoff'), cards: [card('Versatile'), card('Other')] },
    ];
    const out = selectOracleCandidates(results, base);
    expect(out.map((c) => c.card.name)).toEqual(['Versatile', 'Other']);
  });

  it('respects perNeed and maxTotal caps', () => {
    const many = Array.from({ length: 10 }, (_, i) => card(`C${i}`));
    const results: OracleNeedResult[] = [
      { need: need('tokens', 'payoff'), cards: many },
      { need: need('counters', 'payoff'), cards: many.map((c) => card(`${c.name}b`)) },
    ];
    const perNeed = selectOracleCandidates(results, { ...base, perNeed: 2, maxTotal: 99 });
    expect(perNeed.length).toBe(4); // 2 per need × 2 needs

    const capped = selectOracleCandidates(results, { ...base, perNeed: 6, maxTotal: 3 });
    expect(capped.length).toBe(3);
  });

  it('returns nothing for no results', () => {
    expect(selectOracleCandidates([], base)).toEqual([]);
  });
});
