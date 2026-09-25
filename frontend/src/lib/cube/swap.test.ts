import { describe, it, expect } from 'vitest';
import { bucketOf, type CubeCard } from './core';
import type { GeneratedCube, Pick } from './generate';
import { swapCandidates } from './swap';

let id = 0;
function card(p: Partial<CubeCard>): CubeCard {
  return {
    name: p.name ?? `Card ${id++}`,
    oracleId: p.oracleId ?? `o${id++}`,
    colors: p.colors ?? ['R'],
    cmc: p.cmc ?? 2,
    typeLine: p.typeLine ?? 'Creature — Goblin',
    role: p.role ?? null,
    rank: p.rank,
    cubePop: p.cubePop,
    cubeElo: p.cubeElo,
  };
}

function cubeOf(picks: CubeCard[]): GeneratedCube {
  const pickList: Pick[] = picks.map((c) => ({ card: c, bucket: bucketOf(c), reason: '' }));
  const byBucket = { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 };
  return {
    size: 360,
    picks: pickList,
    byBucket,
    targetByBucket: byBucket,
    gaps: [],
    shortfall: 0,
    poolSize: picks.length,
  };
}

describe('swapCandidates', () => {
  it('returns [] for an out-of-range pick index', () => {
    const cube = cubeOf([card({})]);
    expect(swapCandidates(cube, 5, [])).toEqual([]);
  });

  it('excludes cards already in the cube and banned cards', () => {
    const inCube = card({ name: 'In cube', cmc: 2, colors: ['R'], rank: 1 });
    const banned = card({ name: 'Banned', cmc: 2, colors: ['R'], rank: 2 });
    const ok = card({ name: 'OK', cmc: 2, colors: ['R'], rank: 3 });
    const cube = cubeOf([inCube]);
    const result = swapCandidates(cube, 0, [inCube, banned, ok], { banned: [banned.oracleId] });
    expect(result.map((r) => r.card.name)).toEqual(['OK']);
  });

  it('only offers same-bucket candidates', () => {
    const target = card({ colors: ['R'], cmc: 2 });
    const red = card({ colors: ['R'], cmc: 2, name: 'Red match' });
    const blue = card({ colors: ['U'], cmc: 2, name: 'Blue mismatch' });
    const cube = cubeOf([target]);
    const result = swapCandidates(cube, 0, [target, red, blue]);
    expect(result.map((r) => r.card.name)).toEqual(['Red match']);
  });

  it('ranks exact curve slot before ±1, and excludes slot distance > 1', () => {
    const target = card({ colors: ['R'], cmc: 3 });
    const exact = card({ colors: ['R'], cmc: 3, name: 'Exact', rank: 500 });
    const near = card({ colors: ['R'], cmc: 4, name: 'Near', rank: 1 }); // better rank, further slot
    const far = card({ colors: ['R'], cmc: 6, name: 'Far', rank: 1 });
    const cube = cubeOf([target]);
    const result = swapCandidates(cube, 0, [target, exact, near, far]);
    expect(result.map((r) => r.card.name)).toEqual(['Exact', 'Near']);
  });

  it('prefers the same role as the pick when it has one', () => {
    const target = card({ colors: ['R'], cmc: 3, role: 'removal' });
    const removal = card({ colors: ['R'], cmc: 3, role: 'removal', name: 'Removal', rank: 500 });
    const other = card({ colors: ['R'], cmc: 3, role: 'ramp', name: 'Ramp', rank: 1 });
    const cube = cubeOf([target]);
    const result = swapCandidates(cube, 0, [target, removal, other]);
    expect(result.map((r) => r.card.name)).toEqual(['Removal', 'Ramp']);
  });

  it('orders same-tier candidates by byQuality', () => {
    const target = card({ colors: ['G'], cmc: 2 });
    const better = card({ colors: ['G'], cmc: 2, name: 'Better', rank: 1 });
    const worse = card({ colors: ['G'], cmc: 2, name: 'Worse', rank: 100 });
    const cube = cubeOf([target]);
    const result = swapCandidates(cube, 0, [target, worse, better]);
    expect(result.map((r) => r.card.name)).toEqual(['Better', 'Worse']);
  });

  it('caps the result at n (default 8)', () => {
    const target = card({ colors: ['B'], cmc: 2 });
    const pool = [
      target,
      ...Array.from({ length: 12 }, (_, i) => card({ colors: ['B'], cmc: 2, rank: i })),
    ];
    const cube = cubeOf([target]);
    expect(swapCandidates(cube, 0, pool)).toHaveLength(8);
    expect(swapCandidates(cube, 0, pool, { n: 3 })).toHaveLength(3);
  });

  it('gives a plain-English reason naming color, mana cost, and kind', () => {
    const target = card({ colors: ['R'], cmc: 1 });
    const sub = card({ colors: ['R'], cmc: 1, name: 'Goblin Bomber' });
    const cube = cubeOf([target]);
    const [result] = swapCandidates(cube, 0, [target, sub]);
    expect(result.reason).toBe('Same slot: red, 1 mana, creature');
  });
});
