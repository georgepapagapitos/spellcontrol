import { describe, it, expect } from 'vitest';
import { sectionHeading } from './section-heading';

describe('sectionHeading', () => {
  it('falls back to the section label when the section is not merged', () => {
    expect(sectionHeading(undefined, 'Red')).toBe('Red');
    expect(sectionHeading([], 'Red')).toBe('Red');
  });

  it('names the only group when every card shares one', () => {
    expect(sectionHeading(['Extra Life 2021', 'Extra Life 2021'], 'joined')).toBe(
      'Extra Life 2021'
    );
  });

  it('names the first group and counts the distinct rest', () => {
    const labels = ['A', 'A', 'B', 'C', 'C', 'B'];
    expect(sectionHeading(labels, 'A · B · C')).toBe('A +2 more');
  });
});
