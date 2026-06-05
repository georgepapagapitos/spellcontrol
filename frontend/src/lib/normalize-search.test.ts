import { describe, it, expect } from 'vitest';
import { normalizeForSearch, matchesSearch } from './normalize-search';

describe('normalizeForSearch', () => {
  it('lowercases', () => {
    expect(normalizeForSearch('Sol Ring')).toBe('sol ring');
  });

  it('strips diacritics', () => {
    expect(normalizeForSearch('Jötun Grunt')).toBe('jotun grunt');
    expect(normalizeForSearch('Lim-Dûl the Necromancer')).toBe('lim dul the necromancer');
    // The colon is punctuation, so it folds to a space like any other separator.
    expect(normalizeForSearch('Ratonhnhaké:ton')).toBe('ratonhnhake ton');
  });

  it('drops apostrophes so possessives collapse', () => {
    expect(normalizeForSearch("Urza's Saga")).toBe('urzas saga');
    // curly apostrophe folds the same way
    expect(normalizeForSearch('Urza’s Saga')).toBe('urzas saga');
  });

  it('turns periods, commas, colons and dashes into single spaces', () => {
    expect(normalizeForSearch('Mr. House, President and CEO')).toBe('mr house president and ceo');
    expect(normalizeForSearch('Borborygmos, Enraged')).toBe('borborygmos enraged');
  });

  it('collapses the DFC "//" separator and surrounding spaces', () => {
    expect(normalizeForSearch('Fire // Ice')).toBe('fire ice');
  });

  it('collapses runs of whitespace and trims', () => {
    expect(normalizeForSearch('  Sol   Ring  ')).toBe('sol ring');
  });

  it('returns empty string for punctuation-only / empty input', () => {
    expect(normalizeForSearch('')).toBe('');
    expect(normalizeForSearch('   ')).toBe('');
    expect(normalizeForSearch('...,,')).toBe('');
  });
});

describe('matchesSearch', () => {
  it('matches across missing punctuation', () => {
    expect(matchesSearch('Mr. House, President and CEO', 'mr house')).toBe(true);
    expect(matchesSearch("Urza's Saga", 'urzas')).toBe(true);
    expect(matchesSearch("Urza's Saga", "urza's")).toBe(true);
  });

  it('matches across diacritics in either direction', () => {
    expect(matchesSearch('Jötun Grunt', 'jotun')).toBe(true);
    expect(matchesSearch('Jotun Grunt', 'jötun')).toBe(true);
  });

  it('matches a mid-name substring', () => {
    expect(matchesSearch('Mr. House, President and CEO', 'president')).toBe(true);
  });

  it('matches either face of a double-faced name', () => {
    expect(matchesSearch('Fire // Ice', 'ice')).toBe(true);
    expect(matchesSearch('Fire // Ice', 'fire')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesSearch('Sol Ring', 'mana crypt')).toBe(false);
  });

  it('treats an empty query as matching everything', () => {
    expect(matchesSearch('Sol Ring', '')).toBe(true);
    expect(matchesSearch('Sol Ring', '   ')).toBe(true);
  });
});
