import { describe, expect, it } from 'vitest';
import {
  heroBracketReadout,
  formatBracketLabel,
  bracketSourceSentence,
  bracketBadgeWithEstimate,
  bracketTextWithEstimate,
  bracketAriaWithEstimate,
  EXHIBITION_BRACKET_NOTE,
} from './format-bracket-label';

describe('formatBracketLabel', () => {
  it('formats "Bracket N · Label"', () => {
    expect(formatBracketLabel(3)).toBe('Bracket 3 · Upgraded');
  });
});

describe('bracketBadgeWithEstimate', () => {
  it('formats bare tier words, stated first', () => {
    expect(bracketBadgeWithEstimate(2, 4)).toBe('Core · est. Optimized');
  });
});

describe('bracketTextWithEstimate', () => {
  it('formats "Bracket N · est. M"', () => {
    expect(bracketTextWithEstimate(2, 4)).toBe('Bracket 2 · est. 4');
  });
});

describe('bracketAriaWithEstimate', () => {
  it('spells out both facts in plain words', () => {
    expect(bracketAriaWithEstimate(2, 4)).toBe('Bracket 2 stated, estimate 4');
  });
});

describe('bracketSourceSentence', () => {
  it('names the list contents as the source', () => {
    expect(bracketSourceSentence('contents')).toBe("The estimate comes from what's in the list.");
  });

  it('names the power signal as the source', () => {
    expect(bracketSourceSentence('power')).toBe('The power signal raised the estimate.');
  });

  it('names the Core baseline when nothing pushed it higher', () => {
    expect(bracketSourceSentence('baseline')).toBe(
      'Nothing in the list pushes the estimate past Core.'
    );
  });
});

describe('EXHIBITION_BRACKET_NOTE', () => {
  it('explains the Core floor', () => {
    expect(EXHIBITION_BRACKET_NOTE).toMatch(/Core \(2\) or higher/);
  });
});

// The owner's Deck tab states the bracket once, in the hero. The deck stats'
// identity line used to be where "Bracket 2 · est. 4" showed, and it no
// longer repeats the bracket, so the hero carries the Estimate instead.
describe('heroBracketReadout', () => {
  it('shows the Estimate beside a stated bracket it disagrees with', () => {
    expect(heroBracketReadout({ bracket: 2, stated: 2, estimate: 4 })).toEqual({
      text: 'Bracket 2 · est. 4',
      aria: 'Bracket 2 stated, estimate 4',
    });
  });

  it('shows the bracket alone when the two agree', () => {
    expect(heroBracketReadout({ bracket: 3, stated: 3, estimate: 3 })).toEqual({
      text: 'Bracket 3',
    });
  });

  it('marks an estimate made without the combo match as a floor', () => {
    expect(heroBracketReadout({ bracket: 4, estimate: 4, missesCombos: true })).toEqual({
      text: 'Bracket 4+',
    });
  });

  it('never marks a stated bracket as a floor', () => {
    expect(heroBracketReadout({ bracket: 2, stated: 2, missesCombos: true })).toEqual({
      text: 'Bracket 2',
    });
  });
});
