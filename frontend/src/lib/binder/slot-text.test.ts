import { describe, it, expect } from 'vitest';
import { truncateLongWords, MAX_WORD_CHARS } from './slot-text';

describe('truncateLongWords', () => {
  it('leaves short single words untouched', () => {
    expect(truncateLongWords('Island')).toBe('Island');
  });

  it('leaves multi-word names with all-short words untouched', () => {
    expect(truncateLongWords('Aligned Heart')).toBe('Aligned Heart');
    expect(truncateLongWords('Charming Prince')).toBe('Charming Prince');
  });

  it('truncates a single word that exceeds the cap', () => {
    // "Gainsborough" = 12 chars, cap = 11 → keep 10 chars + ellipsis
    expect(truncateLongWords('Gainsborough')).toBe('Gainsborou…');
  });

  it('truncates only the offending word in a multi-word name', () => {
    expect(truncateLongWords('Aerith Gainsborough')).toBe('Aerith Gainsborou…');
  });

  it('preserves whitespace between words', () => {
    // The renderer relies on the spaces to wrap at word boundaries.
    const result = truncateLongWords('Archaeomancer’s Map');
    expect(result.split(' ')).toHaveLength(2);
    expect(result.endsWith(' Map')).toBe(true);
  });

  it('keeps a word exactly at the cap', () => {
    const elevenChars = 'Caretaker’s'; // 11 chars
    expect(elevenChars).toHaveLength(MAX_WORD_CHARS);
    expect(truncateLongWords(elevenChars)).toBe(elevenChars);
  });

  it('respects a custom cap', () => {
    expect(truncateLongWords('Counterspell', 6)).toBe('Count…'); // 5 chars + ellipsis
  });

  it('handles names with multiple long words independently', () => {
    expect(truncateLongWords('Gainsborough Counterspell')).toBe('Gainsborou… Counterspe…');
  });

  it('handles empty input', () => {
    expect(truncateLongWords('')).toBe('');
  });
});
