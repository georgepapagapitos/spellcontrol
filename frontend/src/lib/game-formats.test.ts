import { describe, expect, it } from 'vitest';
import { gameFormatLabel } from './game-formats';

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
});
