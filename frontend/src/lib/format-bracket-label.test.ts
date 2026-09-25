import { describe, expect, it } from 'vitest';
import {
  formatBracketLabel,
  bracketSourceSentence,
  EXHIBITION_BRACKET_NOTE,
} from './format-bracket-label';

describe('formatBracketLabel', () => {
  it('formats "Bracket N · Label"', () => {
    expect(formatBracketLabel(3)).toBe('Bracket 3 · Upgraded');
  });
});

describe('bracketSourceSentence', () => {
  it('names the list contents as the source', () => {
    expect(bracketSourceSentence('contents')).toBe("Set by what's in the list.");
  });

  it('names the power signal as the source', () => {
    expect(bracketSourceSentence('power')).toBe('Raised by the power signal.');
  });

  it('names the Core baseline when nothing pushed it higher', () => {
    expect(bracketSourceSentence('baseline')).toBe('Nothing in the list pushes it past Core.');
  });
});

describe('EXHIBITION_BRACKET_NOTE', () => {
  it('explains the Core floor', () => {
    expect(EXHIBITION_BRACKET_NOTE).toMatch(/Core \(2\) or higher/);
  });
});
