import { describe, it, expect } from 'vitest';
import { buildMotes } from './SealBurst';

describe('buildMotes', () => {
  it('emits a full spark field', () => {
    expect(buildMotes(['G']).length).toBe(18);
  });

  it('cycles every colour in the identity', () => {
    const hexes = new Set(buildMotes(['B', 'G']).map((m) => m.hex));
    expect(hexes).toEqual(new Set(['#a986c9', '#46c274'])); // B lifted to violet, G green
  });

  it('falls back to seal gold for a colourless identity', () => {
    const motes = buildMotes([]);
    expect(motes.every((m) => m.hex === '#e6d2a0')).toBe(true);
  });

  it('spreads sparks around the full circle', () => {
    const angles = buildMotes(['R']).map((m) => m.angle);
    expect(Math.min(...angles)).toBeLessThan(20);
    expect(Math.max(...angles)).toBeGreaterThan(320);
  });
});
