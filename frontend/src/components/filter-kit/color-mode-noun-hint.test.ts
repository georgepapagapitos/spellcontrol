import { describe, expect, it } from 'vitest';
import { colorModeNounHint } from './color-mode-noun-hint';

describe('colorModeNounHint', () => {
  it('says what each mode matches for the given noun', () => {
    expect(colorModeNounHint(['U', 'G'], 'any', 'decks')).toBe(
      'Decks that are blue or green, including multicolor decks.'
    );
    expect(colorModeNounHint(['U', 'G'], 'all', 'combos')).toBe(
      'Only combos whose colors are exactly blue and green.'
    );
    expect(colorModeNounHint(['U', 'G'], 'within', 'decks')).toBe(
      'Decks that fit a blue-green deck. Colorless decks included.'
    );
  });
  it('prompts with no colors', () => {
    expect(colorModeNounHint([], 'within', 'decks')).toBe(
      'No color filter. Pick one or more colors.'
    );
  });
});
