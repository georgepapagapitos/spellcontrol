import { describe, it, expect } from 'vitest';
import { buildShareText, shareRow } from './share';
import type { ScoredGuess } from './daily-client';

const miss: ScoredGuess = {
  name: 'Path to Exile',
  cells: {
    colors: { value: 'W', mark: 'miss' },
    mv: { value: 1, mark: 'higher' },
    type: { value: 'Instant', mark: 'hit' },
    rarity: { value: 'uncommon', mark: 'near' },
    year: { value: 2009, mark: 'lower' },
  },
};
const win: ScoredGuess = {
  name: 'Pyretic Ritual',
  cells: {
    colors: { value: 'R', mark: 'hit' },
    mv: { value: 2, mark: 'hit' },
    type: { value: 'Instant', mark: 'hit' },
    rarity: { value: 'common', mark: 'hit' },
    year: { value: 2010, mark: 'hit' },
  },
};

describe('shareRow', () => {
  it('maps hit, near and everything else to three squares, in cell order', () => {
    expect(shareRow(miss)).toBe('⬛⬛\u{1F7E9}\u{1F7E8}⬛');
  });
});

describe('buildShareText', () => {
  it('reads guesses used when solved, and never names a card', () => {
    const text = buildShareText({
      number: 37,
      solved: true,
      maxGuesses: 6,
      guesses: [miss, win],
      url: 'https://spellcontrol.com/daily',
    });
    expect(text.split('\n')).toEqual([
      'SpellControl Daily #37 2/6',
      shareRow(miss),
      shareRow(win),
      'https://spellcontrol.com/daily',
    ]);
    expect(text).not.toContain('Pyretic');
  });

  it('reads X/6 when unsolved', () => {
    const text = buildShareText({
      number: 5,
      solved: false,
      maxGuesses: 6,
      guesses: [miss],
      url: 'u',
    });
    expect(text.startsWith('SpellControl Daily #5 X/6\n')).toBe(true);
  });
});
