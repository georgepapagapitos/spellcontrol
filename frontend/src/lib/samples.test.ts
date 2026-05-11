import { describe, it, expect } from 'vitest';
import { SAMPLE_BINDERS, SAMPLE_CARDS, SAMPLE_IMPORT_LABEL, sampleCardsAsCsv } from './samples';

describe('samples', () => {
  it('exposes at least one sample binder template', () => {
    expect(SAMPLE_BINDERS.length).toBeGreaterThan(0);
    for (const t of SAMPLE_BINDERS) {
      expect(t.templateId.length).toBeGreaterThan(0);
      expect(t.input.isSample).toBe(true);
      expect(t.input.filterGroups.length).toBeGreaterThan(0);
    }
  });

  it('exposes a non-empty starter pack', () => {
    expect(SAMPLE_CARDS.length).toBeGreaterThan(0);
    expect(SAMPLE_IMPORT_LABEL).toMatch(/sample/i);
  });
});

describe('sampleCardsAsCsv', () => {
  it('starts with the name,finish header', () => {
    const csv = sampleCardsAsCsv();
    expect(csv.split('\n')[0]).toBe('name,finish');
  });

  it('emits one row per sample card', () => {
    const csv = sampleCardsAsCsv();
    expect(csv.split('\n').length).toBe(SAMPLE_CARDS.length + 1);
  });

  it('quotes names containing commas and escapes inner quotes', () => {
    const csv = sampleCardsAsCsv();
    expect(csv).toContain('"Atraxa, Praetors\' Voice",foil');
  });

  it('renders the finish value as foil/nonfoil text', () => {
    const csv = sampleCardsAsCsv();
    expect(csv).toContain('"Sol Ring",foil');
    expect(csv).toContain('"Wurmcoil Engine",nonfoil');
  });
});
