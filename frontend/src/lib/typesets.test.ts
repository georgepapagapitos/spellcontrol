import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TYPESETS, DEFAULT_TYPESET, isValidTypeSet, typeSetHref } from './typesets';

const indexHtml = () =>
  readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

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

/**
 * index.html hard-codes three things the registry also knows: the set id list
 * and the default (in the pre-paint script, which must run before any module
 * loads and so can't import from here) and the default set's font <link>.
 * Drift is silent and ugly — a first paint in faces that were never
 * downloaded — so pin all three.
 */
describe('typesets ↔ index.html', () => {
  it('the pre-paint script knows every registered set id', () => {
    const html = indexHtml();
    for (const t of TYPESETS) {
      expect(html, `index.html pre-paint script is missing '${t.id}'`).toContain(`'${t.id}'`);
    }
  });

  it('the pre-paint script agrees on the default set', () => {
    expect(indexHtml()).toContain(`var DEFAULT_TYPESET = '${DEFAULT_TYPESET}'`);
  });

  it('the static <link> preloads exactly the default set families', () => {
    const html = indexHtml();
    const defaultHref = TYPESETS.find((t) => t.id === DEFAULT_TYPESET)?.href;
    // A default set with no webfont (e.g. `plain`) would need no link at all.
    if (!defaultHref) return;
    for (const family of new URL(defaultHref).searchParams.getAll('family')) {
      // "Vollkorn:wght@400;500" → "Vollkorn"
      const name = family.split(':')[0];
      expect(html, `index.html <link> is missing the default set's ${name}`).toContain(name);
    }
  });
});
