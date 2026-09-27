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

  it('pauper/peasant read the mined corpus for colour/curve/type/fixing, but role STAYS on the size band (E464)', () => {
    const sizeBand = targetsForSize(360);
    for (const rarity of ['pauper', 'peasant'] as const) {
      const b = targetsForSize(360, 'limited', rarity);
      expect(b.size).toBe(360);
      // Role is measured to already match the size band — it's not its own band.
      expect(b.role).toEqual(sizeBand.role);
      // The rest is the SCOPED corpus, which genuinely differs from the
      // all-cube size band (see mine-cube-targets.mjs's E464 comment).
      expect(b.color).not.toEqual(sizeBand.color);
      expect(b.type.creature.median).not.toBe(sizeBand.type.creature.median);
    }
    // The two corpora are mined separately and differ from each other too.
    expect(targetsForSize(360, 'limited', 'pauper').color).not.toEqual(
      targetsForSize(360, 'limited', 'peasant').color
    );
  });

  it('pauper/peasant fixing lands rescale with size like every other band', () => {
    const at360 = targetsForSize(360, 'limited', 'pauper');
    const at180 = targetsForSize(180, 'limited', 'pauper');
    expect(at180.size).toBe(180);
    expect(at180.color).toEqual(at360.color);
    expect(at180.fixingLands.median).toBeCloseTo(at360.fixingLands.median / 2, 6);
  });

  it('rarity has no effect on a commander cube — format wins', () => {
    expect(targetsForSize(360, 'commander', 'pauper')).toEqual(targetsForSize(360, 'commander'));
  });

  it('rarity defaults to "any" (today\'s behavior) when omitted', () => {
    expect(targetsForSize(360, 'limited')).toEqual(targetsForSize(360, 'limited', 'any'));
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
