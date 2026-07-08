import { describe, it, expect } from 'vitest';
import { normalizeForSearch, matchesSearch, normalizeScryfallQuery } from './normalize-search';

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

describe('normalizeScryfallQuery', () => {
  it('removes the mobile-keyboard space after an operator colon', () => {
    expect(normalizeScryfallQuery('t: vampire')).toBe('t:vampire');
    expect(normalizeScryfallQuery('type: dragon')).toBe('type:dragon');
    expect(normalizeScryfallQuery('otag: removal')).toBe('otag:removal');
  });

  it('collapses ALL immediate whitespace after the colon, not just one space', () => {
    expect(normalizeScryfallQuery('t:   vampire')).toBe('t:vampire');
    expect(normalizeScryfallQuery('t:\t vampire')).toBe('t:vampire');
  });

  it('leaves an already-tight query untouched', () => {
    expect(normalizeScryfallQuery('t:vampire cmc<4')).toBe('t:vampire cmc<4');
    expect(normalizeScryfallQuery('o:landfall c:g')).toBe('o:landfall c:g');
  });

  it('matches operators case-insensitively, preserving the typed case', () => {
    expect(normalizeScryfallQuery('T: Vampire')).toBe('T:Vampire');
    expect(normalizeScryfallQuery('ID: esper')).toBe('ID:esper');
  });

  it('fixes multiple operators in one query', () => {
    expect(normalizeScryfallQuery('t: elf c: g cmc: 2')).toBe('t:elf c:g cmc:2');
  });

  it('does not alter text inside double quotes', () => {
    expect(normalizeScryfallQuery('o:"draw a card"')).toBe('o:"draw a card"');
    expect(normalizeScryfallQuery('name:"t: weird"')).toBe('name:"t: weird"');
    expect(normalizeScryfallQuery('"t: weird" t: elf')).toBe('"t: weird" t:elf');
  });

  it('collapses the space before a quoted term', () => {
    expect(normalizeScryfallQuery('o: "draw a card"')).toBe('o:"draw a card"');
  });

  it('leaves a bare colon in a card name alone (word not an operator)', () => {
    expect(normalizeScryfallQuery('Circle of Protection: Red')).toBe('Circle of Protection: Red');
    expect(normalizeScryfallQuery('blah: something')).toBe('blah: something');
  });

  it('only fires when the colon directly follows the operator at a word boundary', () => {
    // "xt:" — "t" is mid-word, so this is not an operator.
    expect(normalizeScryfallQuery('xt: y')).toBe('xt: y');
    // Non-ASCII word chars break the word before the colon.
    expect(normalizeScryfallQuery('Ratonhnhaké:ton')).toBe('Ratonhnhaké:ton');
  });

  it('handles negation and parens as boundaries', () => {
    expect(normalizeScryfallQuery('-t: land')).toBe('-t:land');
    expect(normalizeScryfallQuery('(t: elf OR t: goblin)')).toBe('(t:elf OR t:goblin)');
  });

  it('leaves a trailing operator with no term alone', () => {
    expect(normalizeScryfallQuery('t: ')).toBe('t: ');
    expect(normalizeScryfallQuery('t:')).toBe('t:');
  });

  it('passes through empty and plain-name queries unchanged', () => {
    expect(normalizeScryfallQuery('')).toBe('');
    expect(normalizeScryfallQuery('Sol Ring')).toBe('Sol Ring');
    expect(normalizeScryfallQuery('Borborygmos, Enraged')).toBe('Borborygmos, Enraged');
  });

  it('collapses spaces around comparison operators too', () => {
    expect(normalizeScryfallQuery('mv >= 6')).toBe('mv>=6');
    expect(normalizeScryfallQuery('mv >=6')).toBe('mv>=6');
    expect(normalizeScryfallQuery('mv>= 6')).toBe('mv>=6');
    expect(normalizeScryfallQuery('pow <= 2')).toBe('pow<=2');
    expect(normalizeScryfallQuery('cmc < 4')).toBe('cmc<4');
    expect(normalizeScryfallQuery('year = 2020')).toBe('year=2020');
    expect(normalizeScryfallQuery('tou != 3')).toBe('tou!=3');
  });

  it('collapses a keyboard space before the colon as well', () => {
    expect(normalizeScryfallQuery('t : vampire')).toBe('t:vampire');
  });

  it('leaves comparison-like text alone for non-operator words', () => {
    expect(normalizeScryfallQuery('blah >= 6')).toBe('blah >= 6');
  });

  it('is idempotent on comparison forms', () => {
    expect(normalizeScryfallQuery(normalizeScryfallQuery('mv >= 6'))).toBe('mv>=6');
  });
});
