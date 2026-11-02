import { describe, expect, it } from 'vitest';
import { gameFormatLabel, FORMAT_OPTIONS } from './game-formats';

describe('gameFormatLabel', () => {
  it('returns null for an unset format', () => {
    expect(gameFormatLabel(null)).toBeNull();
  });

  it('returns the known label for a recognized format id', () => {
    expect(gameFormatLabel('commander')).toBe('Commander');
  });

  it('falls back to the raw value for an unrecognized format id', () => {
    expect(gameFormatLabel('some-legacy-string')).toBe('some-legacy-string');
  });

  it('labels horde even though it has no local-setup option', () => {
    expect(gameFormatLabel('horde')).toBe('Horde');
    expect(FORMAT_OPTIONS.some((f) => f.value === 'horde')).toBe(false);
  });
});

describe('Two-Headed Giant', () => {
  it('is a format with team life and no commander damage', () => {
    const hg = FORMAT_OPTIONS.find((f) => f.value === '2hg');
    expect(hg).toMatchObject({ label: 'Two-Headed Giant', defaultLife: 30, cmdDmg: false });
    expect(gameFormatLabel('2hg')).toBe('Two-Headed Giant');
  });
});
