import { describe, expect, it } from 'vitest';
import {
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
