import { describe, it, expect } from 'vitest';
import { samplePack } from './sample-pack';
import type { Pick } from './generate';

function pick(i: number): Pick {
  return {
    card: {
      name: `Card ${i}`,
      oracleId: `oracle-${i}`,
      colors: ['U'],
      cmc: 2,
      typeLine: 'Creature',
      role: null,
    },
    bucket: 'U',
    reason: 'goodstuff',
  };
}

const CUBE_PICKS = Array.from({ length: 360 }, (_, i) => pick(i));

describe('samplePack', () => {
  it('draws 15 distinct picks, all from the cube', () => {
    const pack = samplePack(CUBE_PICKS, 1);
    expect(pack).toHaveLength(15);
    const names = pack.map((p) => p.card.name);
    expect(new Set(names).size).toBe(15);
    for (const p of pack) expect(CUBE_PICKS).toContain(p);
  });

  it('is deterministic for a given seed', () => {
    expect(samplePack(CUBE_PICKS, 42)).toEqual(samplePack(CUBE_PICKS, 42));
  });

  it('differs across seeds', () => {
    const a = samplePack(CUBE_PICKS, 1).map((p) => p.card.name);
    const b = samplePack(CUBE_PICKS, 2).map((p) => p.card.name);
    expect(a).not.toEqual(b);
  });

  it('returns every pick when the cube is smaller than the pack size', () => {
    const small = CUBE_PICKS.slice(0, 10);
    const pack = samplePack(small, 1);
    expect(pack).toHaveLength(10);
    expect(new Set(pack.map((p) => p.card.name))).toEqual(new Set(small.map((p) => p.card.name)));
  });

  it('respects a custom size', () => {
    expect(samplePack(CUBE_PICKS, 1, 5)).toHaveLength(5);
  });
});
