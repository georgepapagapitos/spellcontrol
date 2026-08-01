import { describe, it, expect } from 'vitest';
import { TYPESETS, DEFAULT_TYPESET, isValidTypeSet, typeSetHref } from './typesets';

describe('typesets', () => {
  it('exposes a non-empty set list with unique ids', () => {
    expect(TYPESETS.length).toBeGreaterThan(0);
    const ids = TYPESETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every set has a name and a hint', () => {
    for (const t of TYPESETS) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.hint.length).toBeGreaterThan(0);
    }
  });

  it('every webfont href is a Google Fonts css2 URL', () => {
    for (const t of TYPESETS) {
      if (t.href === null) continue;
      expect(t.href).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?/);
      // display=swap keeps text visible during the font load rather than
      // blanking it; a set missing it would flash invisible text.
      expect(t.href).toContain('display=swap');
    }
  });

  it('DEFAULT_TYPESET is in the registry', () => {
    expect(TYPESETS.some((t) => t.id === DEFAULT_TYPESET)).toBe(true);
  });

  it('typeSetHref returns null for the default set (index.html already links it)', () => {
    // Guards the double-download regression: the default set's faces are in a
    // static <link>, so injecting them again would refetch the same families.
    expect(typeSetHref(DEFAULT_TYPESET)).toBeNull();
  });

  it('typeSetHref returns the registered href for a non-default set', () => {
    const other = TYPESETS.find((t) => t.id !== DEFAULT_TYPESET && t.href);
    expect(other).toBeDefined();
    expect(typeSetHref(other!.id)).toBe(other!.href);
  });

  it('typeSetHref returns null for a set with no webfont, and for unknown ids', () => {
    expect(typeSetHref('plain')).toBeNull();
    expect(typeSetHref('not-a-set')).toBeNull();
  });

  it('isValidTypeSet accepts registered ids and rejects everything else', () => {
    expect(isValidTypeSet(DEFAULT_TYPESET)).toBe(true);
    expect(isValidTypeSet('grimoire')).toBe(true);
    expect(isValidTypeSet('not-a-set')).toBe(false);
    expect(isValidTypeSet('')).toBe(false);
  });
});
