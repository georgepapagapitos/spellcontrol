// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { applyCommanderTheme, resetTheme } from './commanderTheme';

const root = () => document.documentElement;

afterEach(() => {
  resetTheme();
  root().removeAttribute('style');
  root().className = '';
});

describe('applyCommanderTheme', () => {
  it('uses the colorless slate for an empty color identity', () => {
    applyCommanderTheme([]);
    expect(root().style.getPropertyValue('--ring')).toBe('220 10% 40%');
    expect(root().style.getPropertyValue('--border')).toBe('220 10% 40%');
  });

  it('uses the single MTG color for a mono-color commander', () => {
    applyCommanderTheme(['U']);
    expect(root().style.getPropertyValue('--ring')).toBe('210 50% 40%');
  });

  it('uses the curated guild border and a gradient for two colors', () => {
    applyCommanderTheme(['R', 'W']);
    // Sorted to WUBRG order (W before R) → Boros guild key.
    expect(root().style.getPropertyValue('--ring')).toBe('25 50% 40%');
    expect(root().style.getPropertyValue('--gradient-start')).toContain('hsl(');
    expect(root().classList.contains('commander-gradient')).toBe(true);
  });

  it('uses gold for three or more colors', () => {
    applyCommanderTheme(['W', 'U', 'B']);
    expect(root().style.getPropertyValue('--ring')).toBe('42 50% 35%');
  });
});

describe('resetTheme', () => {
  it('restores the default ring/border and drops the gradient', () => {
    applyCommanderTheme(['R', 'W']);
    resetTheme();
    expect(root().style.getPropertyValue('--ring')).toBe('262 83% 58%');
    expect(root().style.getPropertyValue('--border')).toBe('220 13% 20%');
    expect(root().style.getPropertyValue('--gradient-start')).toBe('');
    expect(root().classList.contains('commander-gradient')).toBe(false);
  });
});
