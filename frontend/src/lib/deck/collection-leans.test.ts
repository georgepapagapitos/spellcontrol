import { describe, it, expect } from 'vitest';
import {
  computeCollectionLeans,
  rankByCoverage,
  MAX_LEANS,
  MIN_COLOR_CARDS,
} from './collection-leans';
import type { ReadinessScore } from './commander-readiness';
import type { EnrichedCard } from '@/types/index';

function card(
  name: string,
  colorIdentity: string[],
  oracleText: string,
  typeLine = 'Creature'
): EnrichedCard {
  return {
    copyId: `copy_${name}`,
    name,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `sf_${name}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    colorIdentity,
    oracleText,
    typeLine,
  };
}

const TOKENS = 'When this enters, create a 1/1 white Soldier creature token.';
const SPELLS = 'Whenever you cast an instant or sorcery spell, draw a card.';
const PLAIN = 'Flying';

/** A color's cards: `n` filler cards plus `hits` of the given text. */
function colorSet(prefix: string, color: string, filler: number, hits: number, text: string) {
  return [
    ...Array.from({ length: filler }, (_, i) => card(`${prefix} filler ${i}`, [color], PLAIN)),
    ...Array.from({ length: hits }, (_, i) => card(`${prefix} hit ${i}`, [color], text)),
  ];
}

describe('computeCollectionLeans', () => {
  const fixture = [
    ...colorSet('White', 'W', 20, 12, TOKENS),
    ...colorSet('Blue', 'U', 20, 12, SPELLS),
    ...colorSet('Black', 'B', 32, 0, PLAIN),
  ];

  it('names the playstyle each color skews toward', () => {
    const leans = computeCollectionLeans(fixture);
    expect(leans.map((l) => [l.color, l.playstyleId, l.slug])).toEqual(
      expect.arrayContaining([
        ['W', 'tokens', 'tokens'],
        ['U', 'spellslinger', 'spellslinger'],
      ])
    );
    const white = leans.find((l) => l.color === 'W')!;
    expect(white.matches).toBe(12);
    expect(white.of).toBe(32);
    expect(white.lift).toBeGreaterThan(1.3);
  });

  it('is deterministic and does not depend on card order', () => {
    expect(computeCollectionLeans([...fixture].reverse())).toEqual(computeCollectionLeans(fixture));
  });

  it('gives a color with no skew no lean', () => {
    expect(computeCollectionLeans(fixture).some((l) => l.color === 'B')).toBe(false);
  });

  it('counts one card per name, however many copies are owned', () => {
    const copies = fixture.flatMap((c) => [c, { ...c, copyId: `${c.copyId}-2` }]);
    expect(computeCollectionLeans(copies)).toEqual(computeCollectionLeans(fixture));
  });

  it('reads nothing into a color with too few cards', () => {
    const thin = colorSet('Red', 'R', 0, MIN_COLOR_CARDS - 1, TOKENS);
    expect(computeCollectionLeans([...thin, ...colorSet('Pad', 'B', 60, 0, PLAIN)])).toEqual([]);
  });

  it('ignores lands, multicolor cards and cards with no rules text', () => {
    const noise = [
      ...Array.from({ length: 30 }, (_, i) => card(`Land ${i}`, ['G'], TOKENS, 'Land')),
      ...Array.from({ length: 30 }, (_, i) => card(`Gold ${i}`, ['G', 'W'], TOKENS)),
      ...Array.from({ length: 30 }, (_, i) => ({
        ...card(`Blank ${i}`, ['R'], ''),
        oracleText: undefined,
      })),
    ];
    expect(computeCollectionLeans(noise)).toEqual([]);
  });

  it('does not call a lean on a single card', () => {
    expect(
      computeCollectionLeans([
        ...colorSet('White', 'W', 40, 4, TOKENS),
        ...colorSet('Blue', 'U', 40, 0, PLAIN),
      ])
    ).toEqual([]);
  });

  it('surfaces the strongest leans first and no more than the cap', () => {
    const many = ['W', 'U', 'B', 'R', 'G'].flatMap((c, i) =>
      colorSet(`C${c}`, c, 30, 6 + i * 2, TOKENS)
    );
    const leans = computeCollectionLeans(many);
    expect(leans.length).toBeLessThanOrEqual(MAX_LEANS);
    for (let i = 1; i < leans.length; i += 1)
      expect(leans[i - 1].lift).toBeGreaterThanOrEqual(leans[i].lift);
  });
});

describe('rankByCoverage', () => {
  const score = (percent: number, available = true): ReadinessScore => ({
    available,
    ownedCount: percent,
    totalCount: 100,
    percent,
    explainerLine: '',
    ownedSamples: [],
  });
  const table: Record<string, ReadinessScore | 'loading'> = {
    a: score(40),
    b: score(72),
    c: score(40),
    d: 'loading',
    e: score(0),
    f: score(90, false),
  };
  const entries = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({ name }));

  it('puts the highest coverage first and keeps page order on ties', () => {
    expect(rankByCoverage(entries, (n) => table[n], 10).map((e) => e.name)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('leaves out commanders still loading, unavailable, unscored or at zero', () => {
    const names = rankByCoverage(entries, (n) => table[n], 10).map((e) => e.name);
    for (const gone of ['d', 'e', 'f', 'g']) expect(names).not.toContain(gone);
  });

  it('carries the percent and honors the limit', () => {
    expect(rankByCoverage(entries, (n) => table[n], 1)).toEqual([{ name: 'b', percent: 72 }]);
  });
});
