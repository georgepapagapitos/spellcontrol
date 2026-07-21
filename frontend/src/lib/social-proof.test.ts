import { describe, it, expect } from 'vitest';
import { formatSocialCount, MIN_PUBLIC_COUNT } from './social-proof';

describe('formatSocialCount', () => {
  it('returns null below MIN_PUBLIC_COUNT', () => {
    expect(formatSocialCount(0)).toBeNull();
    expect(formatSocialCount(MIN_PUBLIC_COUNT - 1)).toBeNull();
  });

  it('delegates formatting (not reimplementing it) at and above the threshold', () => {
    expect(formatSocialCount(MIN_PUBLIC_COUNT)).toBe(String(MIN_PUBLIC_COUNT));
    expect(formatSocialCount(340)).toBe('340');
    expect(formatSocialCount(999)).toBe('999');
  });

  it('delegates the k-suffix boundary to formatCount', () => {
    expect(formatSocialCount(1000)).toBe('1k');
    expect(formatSocialCount(1234)).toBe('1.2k');
    expect(formatSocialCount(9999)).toBe('10k');
  });
});
