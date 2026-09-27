import { describe, it, expect } from 'vitest';
import { autoSummary, colorChipLabel, ruleGroupLabel } from './filter-summary';

const chip = (value: string) => ({ chips: [{ value, negate: false }], joiners: [] });

describe('ruleGroupLabel', () => {
  it('uses the name the user gave the rule', () => {
    expect(
      ruleGroupLabel({ name: ' Rocks ', filter: { typeTokenChips: chip('artifact') } }, 0)
    ).toBe('Rocks');
  });

  // The Card type, Supertype and Subtype fields were missing from the summary,
  // so a "Card type: land" rule (the Uncategorized sheet makes these) had no
  // title in the editor and read "Rule 1" in the preview.
  it('titles every type field', () => {
    expect(autoSummary({ typeTokenChips: chip('land') })).toBe('land');
    expect(autoSummary({ supertypeChips: chip('legendary') })).toBe('legendary');
    expect(autoSummary({ subtypeChips: chip('elf') })).toBe('elf');
  });

  it('falls back to the rule number for an empty rule', () => {
    expect(ruleGroupLabel({ filter: {} }, 2)).toBe('Rule 3');
  });
});

describe('colorChipLabel', () => {
  it('reads an AND selection as an intersection', () => {
    expect(colorChipLabel(['W', 'U'], 'all')).toBe('White + Blue');
  });
});
