import { describe, it, expect } from 'vitest';
import { buildShareText, shareRow } from './share';
import type { GuessScore } from './score';

const miss: GuessScore = { colors: 'miss', mv: 'hit', type: 'hit', rarity: 'near', year: 'lower' };
const win: GuessScore = { colors: 'hit', mv: 'hit', type: 'hit', rarity: 'hit', year: 'hit' };

describe('shareRow', () => {
  it('maps hit, near and everything else to three squares, in cell order', () => {
    expect(shareRow(miss)).toBe('⬛\u{1F7E9}\u{1F7E9}\u{1F7E8}⬛');
  });
});

describe('buildShareText', () => {
  it('reads guesses used when solved, and never names a card', () => {
    const text = buildShareText({
      number: 37,
      solved: true,
      scores: [miss, win],
      url: 'https://spellcontrol.com/daily',
    });
    expect(text.split('\n')).toEqual([
      'SpellControl Daily #37 2/6',
      shareRow(miss),
      shareRow(win),
      'https://spellcontrol.com/daily',
    ]);
  });

  it('reads X/6 when unsolved', () => {
    const text = buildShareText({ number: 5, solved: false, scores: [miss], url: 'u' });
    expect(text.startsWith('SpellControl Daily #5 X/6\n')).toBe(true);
  });
});
