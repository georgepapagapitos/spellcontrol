import { describe, it, expect, vi, afterEach } from 'vitest';
import { PRESET_COLORS, pickRandomPresetColor } from './preset-colors';

describe('PRESET_COLORS', () => {
  it('exposes a non-empty list of presets with hex + name', () => {
    expect(PRESET_COLORS.length).toBeGreaterThan(0);
    for (const c of PRESET_COLORS) {
      expect(c.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe('pickRandomPresetColor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the first preset when Math.random returns 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(pickRandomPresetColor()).toBe(PRESET_COLORS[0].hex);
  });

  it('returns the last preset when Math.random returns ~1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    expect(pickRandomPresetColor()).toBe(PRESET_COLORS[PRESET_COLORS.length - 1].hex);
  });

  it('always returns a value from the preset list', () => {
    const hexes = new Set(PRESET_COLORS.map((c) => c.hex));
    for (let i = 0; i < 50; i++) {
      expect(hexes.has(pickRandomPresetColor())).toBe(true);
    }
  });
});
