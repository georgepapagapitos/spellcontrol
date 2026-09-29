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

describe('autoSummary — Spare copies field (E495)', () => {
  it('titles a Trade-binder-shaped rule "Spare copies"', () => {
    expect(autoSummary({ spareCopies: true, priceMin: 1 })).toContain('Spare copies');
  });

  it('names the negative case too', () => {
    expect(autoSummary({ spareCopies: false })).toBe('Not spare copies');
  });
});

describe('colorChipLabel', () => {
  it('reads an AND selection as an intersection', () => {
    expect(colorChipLabel(['W', 'U'], 'all')).toBe('White + Blue');
  });
});

describe('autoSummary — Color group field', () => {
  // E497: an unnamed rule's title is now this sentence, so a raw chip code
  // ("U") read as the whole headline instead of a barely-visible placeholder.
  it('names the color, not the raw WUBRG(C) code', () => {
    expect(autoSummary({ colors: chip('U') })).toBe('Blue');
  });

  it('covers Multicolor, which colour IDENTITY has no bucket for', () => {
    expect(autoSummary({ colors: chip('M') })).toBe('Multicolor');
  });

  it('joins and caps at two, like every other chip field', () => {
    expect(
      autoSummary({
        colors: {
          chips: [chip('W').chips[0], chip('U').chips[0], chip('B').chips[0]],
          joiners: [],
        },
      })
    ).toBe('White, Blue +1');
  });
});
