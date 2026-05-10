import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME, isValidTheme } from './themes';

describe('themes', () => {
  it('exposes a non-empty theme list with unique ids', () => {
    expect(THEMES.length).toBeGreaterThan(0);
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every theme has a valid swatch shape', () => {
    for (const t of THEMES) {
      expect(t.swatch).toHaveLength(2);
      expect(t.swatch[0]).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(t.swatch[1]).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.guild.length).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_THEME is in the registry', () => {
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
  });

  it('isValidTheme accepts registered ids', () => {
    expect(isValidTheme('azorius')).toBe(true);
    expect(isValidTheme('rakdos')).toBe(true);
  });

  it('isValidTheme rejects unknown ids', () => {
    expect(isValidTheme('not-a-guild')).toBe(false);
    expect(isValidTheme('')).toBe(false);
  });
});
