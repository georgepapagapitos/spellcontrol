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

describe('samplePack — natural odds over a mixed pool (board #12, PR3)', () => {
  // A Commander cube's page draws from [...cube.picks, ...(cube.legends ?? [])]
  // — samplePack itself stays generic and format-blind; this just proves a
  // combined pool shuffles as one, with no special-cased legend slot.
  interface Legend {
    card: { name: string; oracleId: string };
    identity: string;
  }
  const legend = (i: number): Legend => ({
    card: { name: `Legend ${i}`, oracleId: `legend-oracle-${i}` },
    identity: 'G',
  });

  it('draws from spells and legends together, and both kinds can appear', () => {
    const spells = Array.from({ length: 40 }, (_, i) => pick(i));
    const legends = Array.from({ length: 40 }, (_, i) => legend(i));
    const pool = [...spells, ...legends];
    // Over many seeds, a 15-card pack from a 50/50 pool draws both kinds.
    let sawSpell = false;
    let sawLegend = false;
    for (let seed = 0; seed < 20 && !(sawSpell && sawLegend); seed++) {
      const pack = samplePack(pool, seed);
      expect(pack).toHaveLength(15);
      if (pack.some((p) => 'identity' in p)) sawLegend = true;
      if (pack.some((p) => !('identity' in p))) sawSpell = true;
    }
    expect(sawSpell).toBe(true);
    expect(sawLegend).toBe(true);
  });

  it('degrades to the old spells-only behavior when there are no legends', () => {
    const pack = samplePack(CUBE_PICKS, 1);
    expect(pack.every((p) => !('identity' in p))).toBe(true);
  });
});
