import { describe, expect, it } from 'vitest';
import { formatPagesSummary } from './binder-pages-summary';

describe('formatPagesSummary', () => {
  it('leads with capacity in plain words, and halves pages into sheets when double-sided', () => {
    // 12-pocket, double-sided, capacity 480: 40 pages, 20 sheets (front+back share a sheet).
    expect(
      formatPagesSummary({
        pocketSize: 12,
        doubleSided: true,
        fixedCapacity: 480,
        packSections: false,
        sectionsFromRules: false,
      })
    ).toBe('Holds 480 cards (20 sheets) · 12-pocket · both sides · New page per section');
  });

  it('one sheet per page when single-sided', () => {
    // 9-pocket, single-sided, capacity 360: 40 pages, 40 sheets (one page = one sheet).
    expect(
      formatPagesSummary({
        pocketSize: 9,
        doubleSided: false,
        fixedCapacity: 360,
        packSections: false,
        sectionsFromRules: false,
      })
    ).toBe('Holds 360 cards (40 sheets) · 9-pocket · one side · New page per section');
  });

  it('reads "No size limit" instead of a bare "no limit"', () => {
    const summary = formatPagesSummary({
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      packSections: false,
      sectionsFromRules: false,
    });
    expect(summary).toContain('No size limit');
    expect(summary).not.toMatch(/^no limit/i);
  });

  it('drops the page-fill label when sections come from rules, not the sort chain', () => {
    const summary = formatPagesSummary({
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      packSections: 'continuous',
      sectionsFromRules: true,
    });
    expect(summary).toBe('No size limit · 9-pocket · one side');
  });

  it('names every page-fill mode', () => {
    const base = {
      pocketSize: 9 as const,
      doubleSided: false,
      fixedCapacity: null,
      sectionsFromRules: false,
    };
    expect(formatPagesSummary({ ...base, packSections: false })).toContain('New page per section');
    expect(formatPagesSummary({ ...base, packSections: true })).toContain('Fit whole sections');
    expect(formatPagesSummary({ ...base, packSections: 'continuous' })).toContain('No gaps');
  });

  it('singular "sheet" for a one-sheet capacity', () => {
    const summary = formatPagesSummary({
      pocketSize: 12,
      doubleSided: false,
      fixedCapacity: 12,
      packSections: false,
      sectionsFromRules: false,
    });
    expect(summary).toContain('(1 sheet)');
    expect(summary).not.toContain('1 sheets');
  });
});
