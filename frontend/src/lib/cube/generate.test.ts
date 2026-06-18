import { describe, it, expect } from 'vitest';
import { generateCube, bucketOf, curveSlotOf, CubeCard } from './generate';
import { targetsForSize } from './targets';

let id = 0;
function card(p: Partial<CubeCard>): CubeCard {
  return {
    name: p.name ?? `Card ${id++}`,
    oracleId: p.oracleId ?? `o${id++}`,
    colors: p.colors ?? ['W'],
    cmc: p.cmc ?? 2,
    typeLine: p.typeLine ?? 'Creature — Human',
    role: p.role ?? null,
    rank: p.rank,
  };
}

/** A generous, color-balanced pool — enough to fill a 360 cube comfortably. */
function richPool(): CubeCard[] {
  const pool: CubeCard[] = [];
  const colors: CubeCard['colors'][] = [['W'], ['U'], ['B'], ['R'], ['G']];
  for (const c of colors) {
    for (let i = 0; i < 90; i++) {
      pool.push(
        card({
          colors: c,
          cmc: i % 8,
          role: i % 7 === 0 ? 'removal' : i % 11 === 0 ? 'ramp' : i % 13 === 0 ? 'cardDraw' : null,
          rank: i * 10 + c[0].charCodeAt(0),
        })
      );
    }
  }
  for (let i = 0; i < 60; i++) pool.push(card({ colors: ['W', 'U'], cmc: 3, rank: 500 + i }));
  for (let i = 0; i < 60; i++)
    pool.push(card({ colors: [], typeLine: 'Artifact', cmc: 2, rank: 600 + i }));
  for (let i = 0; i < 90; i++)
    pool.push(card({ colors: [], typeLine: 'Land', cmc: 0, rank: 700 + i }));
  return pool;
}

describe('bucketOf', () => {
  it('classifies lands, colorless, mono, and multicolor', () => {
    expect(bucketOf(card({ typeLine: 'Land' }))).toBe('land');
    expect(bucketOf(card({ colors: [], typeLine: 'Artifact' }))).toBe('colorless');
    expect(bucketOf(card({ colors: ['R'] }))).toBe('R');
    expect(bucketOf(card({ colors: ['R', 'G'] }))).toBe('multicolor');
  });
});

describe('curveSlotOf', () => {
  it('buckets cmc, clamping 7+', () => {
    expect(curveSlotOf(0)).toBe('0');
    expect(curveSlotOf(2.0)).toBe('2');
    expect(curveSlotOf(9)).toBe('7');
  });
});

describe('generateCube — rich pool', () => {
  const cube = generateCube(richPool(), 360);

  it('produces exactly the requested size with no shortfall', () => {
    expect(cube.picks.length).toBe(360);
    expect(cube.shortfall).toBe(0);
  });

  it('is singleton (unique oracle ids, no basics)', () => {
    const ids = cube.picks.map((p) => p.card.oracleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cube.picks.some((p) => /basic/i.test(p.card.typeLine))).toBe(false);
  });

  it('hits the empirical color targets within tolerance', () => {
    const t = targetsForSize(360);
    for (const c of ['W', 'U', 'B', 'R', 'G'] as const) {
      const want = Math.round(t.color[c].median * 360);
      expect(Math.abs(cube.byBucket[c] - want)).toBeLessThanOrEqual(3);
    }
  });

  it('shapes roles toward the target rather than ignoring them', () => {
    const removal = cube.picks.filter((p) => p.card.role === 'removal').length;
    // corpus removal is ~25% of nonland; with a role-rich pool we should land well above zero.
    expect(removal).toBeGreaterThan(20);
  });

  it('annotates every pick with a reason', () => {
    expect(cube.picks.every((p) => p.reason.length > 0)).toBe(true);
  });

  it('reports balanced colors as a positive note', () => {
    expect(cube.gaps.some((g) => g.severity === 'note' && /balanced/i.test(g.text))).toBe(true);
  });
});

describe('generateCube — collection light in a color', () => {
  it('flags the under-supported color as a gap', () => {
    const pool = richPool().filter((c) => !(c.colors.length === 1 && c.colors[0] === 'U'));
    // add back just a handful of blue so it's present but far below target
    for (let i = 0; i < 5; i++) pool.push(card({ colors: ['U'], cmc: i, rank: 50 + i }));
    const cube = generateCube(pool, 360);
    expect(cube.gaps.some((g) => g.severity === 'short' && /Blue/i.test(g.text))).toBe(true);
  });
});

describe('generateCube — pool smaller than size', () => {
  it('ships what it can and reports the shortfall', () => {
    const pool = richPool().slice(0, 200);
    const cube = generateCube(pool, 360);
    expect(cube.picks.length).toBeLessThan(360);
    expect(cube.shortfall).toBeGreaterThan(0);
    expect(cube.gaps.some((g) => g.severity === 'short' && /short of a 360/i.test(g.text))).toBe(
      true
    );
  });
});

describe('generateCube — dedupes duplicate printings to one copy', () => {
  it('keeps the best-ranked copy of a repeated oracle id', () => {
    const dupes = [
      card({ name: 'Sol Ring', oracleId: 'sol', colors: [], typeLine: 'Artifact', rank: 999 }),
      card({ name: 'Sol Ring', oracleId: 'sol', colors: [], typeLine: 'Artifact', rank: 1 }),
    ];
    const cube = generateCube([...dupes, ...richPool()], 360);
    const sols = cube.picks.filter((p) => p.card.oracleId === 'sol');
    expect(sols.length).toBe(1);
    expect(sols[0].card.rank).toBe(1);
  });
});
