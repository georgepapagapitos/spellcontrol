import { describe, expect, it } from 'vitest';
import { CUBE_SIZES, targetsForSize } from './targets';

describe('targetsForSize', () => {
  it('limited reads the size band, with 180/270 scaled off the 360 band', () => {
    expect(targetsForSize(360).size).toBe(360);
    const small = targetsForSize(180);
    expect(small.size).toBe(180);
    expect(small.color).toEqual(targetsForSize(360).color);
    expect(small.fixingLands.median).toBeCloseTo(targetsForSize(360).fixingLands.median / 2, 6);
  });

  it('commander reads the Commander-cube band at every size, rescaling only fixing lands', () => {
    const base = targetsForSize(720, 'commander');
    for (const size of CUBE_SIZES) {
      const b = targetsForSize(size, 'commander');
      expect(b.size).toBe(size);
      expect(b.role).toEqual(base.role);
      expect(b.color).toEqual(base.color);
      expect(b.curve).toEqual(base.curve);
      expect(b.fixingLands.median / size).toBeCloseTo(base.fixingLands.median / 720, 6);
    }
    // The bands genuinely differ — Commander cubes run more ramp and less removal.
    const draft = targetsForSize(360);
    expect(base.role.ramp.median).toBeGreaterThan(draft.role.ramp.median);
    expect(base.role.removal.median).toBeLessThan(draft.role.removal.median);
  });
});
