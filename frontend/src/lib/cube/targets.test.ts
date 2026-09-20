import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUBE_SIZES, SIZE_INFO, sizeInfo, targetsForSize } from './targets';

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

describe('sizeInfo', () => {
  it('reads the table for a size we offer', () => {
    for (const size of CUBE_SIZES) {
      expect(sizeInfo(size)).toEqual(SIZE_INFO[size]);
    }
  });

  it('falls back on a size we do not offer instead of dereferencing undefined', () => {
    // E353: a saved cube's size is synced, so it can be any number (a cube
    // saved by an older/newer build, or a hand-written sync row). Indexing
    // SIZE_INFO blind on one took the WHOLE cube workshop down through the
    // ErrorBoundary, and cube deletion lives only on the page that crashed.
    expect(sizeInfo(12)).toEqual({ players: 1, note: '12 cards' });
    expect(sizeInfo(400).players).toBe(9);
    expect(sizeInfo(0).players).toBeGreaterThan(0);
  });

  it('is the only reader of SIZE_INFO — nothing indexes the table directly', () => {
    const root = path.resolve(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        if (full.endsWith(path.join('lib', 'cube', 'targets.ts'))) continue;
        if (readFileSync(full, 'utf8').includes('SIZE_INFO[')) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
