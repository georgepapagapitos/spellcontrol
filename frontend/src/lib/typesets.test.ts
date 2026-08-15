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

/**
 * The fourth coordination point, and the only one that had no test. tokens.css's
 * `--font-*` values are what renders before any [data-typeset] rule matches, so
 * a default flip that leaves them on the old set names faces the page never
 * downloads: the first frame paints in Georgia and then snaps. Nothing errors —
 * the app just flashes — which is exactly why it needs pinning.
 */
describe('typesets ↔ tokens.css fallbacks', () => {
  const fontBlock = (): string => {
    const css = readFileSync(
      fileURLToPath(new URL('../styles/tokens.css', import.meta.url)),
      'utf8'
    );
    // Only the four --font-* declarations, not the whole stylesheet.
    return css.match(/--font-(?:serif|mono|label|display):[^;]*;/g)?.join('\n') ?? '';
  };
  const familiesOf = (href: string): string[] =>
    new URL(href).searchParams.getAll('family').map((f) => f.split(':')[0].replace(/\+/g, ' '));

  const defaultHref = TYPESETS.find((t) => t.id === DEFAULT_TYPESET)?.href;

  it('names every family of the default set', () => {
    const block = fontBlock();
    expect(block.length).toBeGreaterThan(0);
    // `plain` ships no webfont — its fallbacks are the system stack.
    if (!defaultHref) return;
    for (const name of familiesOf(defaultHref)) {
      expect(block, `tokens.css --font-* fallbacks are missing ${name}`).toContain(name);
    }
  });

  it('carries no leftover face that only a non-default set uses', () => {
    const block = fontBlock();
    const defaultFamilies = new Set(defaultHref ? familiesOf(defaultHref) : []);
    for (const t of TYPESETS) {
      if (t.id === DEFAULT_TYPESET || !t.href) continue;
      for (const name of familiesOf(t.href)) {
        // Sets share faces on purpose (Eczar, Archivo Narrow and Plex Mono are
        // in several), so only a face the default does NOT use is a leftover.
        if (defaultFamilies.has(name)) continue;
        expect(block, `tokens.css still names ${name}, which only '${t.id}' uses`).not.toContain(
          name
        );
      }
    }
  });
});
