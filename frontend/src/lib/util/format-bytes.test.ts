import { describe, expect, it } from 'vitest';
import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it('reports bytes below a kilobyte as B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('rounds kilobytes to a whole number', () => {
    expect(formatBytes(1000)).toBe('1 KB');
    expect(formatBytes(15_400)).toBe('15 KB');
    expect(formatBytes(999_499)).toBe('999 KB');
  });

  it('keeps one decimal for megabytes', () => {
    expect(formatBytes(1_000_000)).toBe('1.0 MB');
    expect(formatBytes(48_250_000)).toBe('48.3 MB');
  });
});
