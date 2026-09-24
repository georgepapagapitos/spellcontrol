import { describe, it, expect } from 'vitest';
import { resolveHordeSettings } from './settings';

describe('resolveHordeSettings', () => {
  describe('casual', () => {
    it.each([
      [1, 50, 40],
      [2, 80, 52],
      [3, 110, 64],
      [4, 140, 80],
    ])('survivors=%i -> life=%i, librarySize=%i', (survivors, life, librarySize) => {
      const s = resolveHordeSettings('casual', survivors);
      expect(s.life).toBe(life);
      expect(s.librarySize).toBe(librarySize);
      expect(s.setupTurns).toBe(3);
      expect(s.reveal).toEqual({ kind: 'until-nontoken' });
      expect(s.bossTicks).toEqual([]);
      expect(s.safeZone).toBe('full');
      expect(s.survivors).toBe(survivors);
    });
  });

  describe('standard', () => {
    it.each([
      [1, 40, 50],
      [2, 60, 65],
      [3, 80, 80],
      [4, 100, 100],
    ])('survivors=%i -> life=%i, librarySize=%i', (survivors, life, librarySize) => {
      const s = resolveHordeSettings('standard', survivors);
      expect(s.life).toBe(life);
      expect(s.librarySize).toBe(librarySize);
      expect(s.setupTurns).toBe(3);
      expect(s.reveal).toEqual({ kind: 'until-nontoken' });
      expect(s.bossTicks).toEqual([0.5, 1]);
      expect(s.safeZone).toBe('reduced');
    });
  });

  describe('brutal', () => {
    it.each([
      [1, 40, 60],
      [2, 60, 78],
      [3, 80, 96],
      [4, 100, 120],
    ])('survivors=%i -> life=%i, librarySize=%i', (survivors, life, librarySize) => {
      const s = resolveHordeSettings('brutal', survivors);
      expect(s.life).toBe(life);
      expect(s.librarySize).toBe(librarySize);
      expect(s.setupTurns).toBe(2);
      expect(s.reveal).toEqual({ kind: 'waves', perTurn: 2 });
      expect(s.bossTicks).toEqual([0.25, 0.5, 0.75, 1]);
      expect(s.safeZone).toBe('off');
    });
  });

  it('clamps survivors to 1..4, rounding fractional counts', () => {
    expect(resolveHordeSettings('standard', 0).survivors).toBe(1);
    expect(resolveHordeSettings('standard', -5).survivors).toBe(1);
    expect(resolveHordeSettings('standard', 5).survivors).toBe(4);
    expect(resolveHordeSettings('standard', 99).survivors).toBe(4);
    expect(resolveHordeSettings('standard', 2.6).survivors).toBe(3);
  });

  it('lets overrides win field-by-field, over the preset', () => {
    const s = resolveHordeSettings('standard', 2, {
      life: 999,
      safeZone: 'off',
      bossTicks: [0.1],
    });
    expect(s.life).toBe(999);
    expect(s.safeZone).toBe('off');
    expect(s.bossTicks).toEqual([0.1]);
    // Untouched fields keep the preset's values.
    expect(s.librarySize).toBe(65);
    expect(s.setupTurns).toBe(3);
    expect(s.reveal).toEqual({ kind: 'until-nontoken' });
  });

  it('falls back to the standard preset for an unrecognized level', () => {
    // @ts-expect-error deliberately invalid level to exercise the default branch
    const s = resolveHordeSettings('unknown', 3);
    expect(s.safeZone).toBe('reduced');
    expect(s.life).toBe(80);
  });
});
