import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TYPESETS, DEFAULT_TYPESET, isValidTypeSet, typeSetHref } from './typesets';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const indexHtml = () => read('../../index.html');

/** The stylesheet that declares a set's faces: the bundled styles/fonts.css
 *  for the default, public/fonts/typeset-<id>.css for every other set. */
const faceSheet = (id: string) =>
  id === DEFAULT_TYPESET ? read('../styles/fonts.css') : read(`../../public${typeSetHref(id)}`);
/** Families a stylesheet declares an @font-face for. */
const familiesOf = (css: string): string[] => [
  ...new Set([...css.matchAll(/font-family: '([^']+)'/g)].map((m) => m[1])),
];

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

  it('every non-default set has its own self-hosted stylesheet', () => {
    for (const t of TYPESETS) {
      if (t.id === DEFAULT_TYPESET) continue;
      // Self-hosted so every face can carry metric overrides (see
      // styles/font-metrics.test.ts); a third-party sheet can't.
      expect(t.href, t.id).toBe(`/fonts/typeset-${t.id}.css`);
      const css = faceSheet(t.id);
      // swap keeps text visible during a webfont load rather than blanking it;
      // a local()-only sheet (plain) downloads nothing and needs none.
      for (const face of css.match(/@font-face \{[^}]*\}/g) ?? []) {
        if (face.includes('url(')) expect(face, t.id).toContain('font-display: swap');
      }
    }
  });

  it("every face a set's tokens name first is declared by that set's stylesheet", () => {
    const typesets = read('../styles/typesets.css');
    for (const t of TYPESETS) {
      const block = typesets.match(
        new RegExp(String.raw`\[data-typeset='${t.id}'\] \{([^}]*)\}`)
      )?.[1];
      expect(block, `typesets.css has no block for '${t.id}'`).toBeTruthy();
      const declared = familiesOf(faceSheet(t.id));
      const firsts = [...block!.matchAll(/--font-\w+: '([^']+)'/g)].map((m) => m[1]);
      // Non-vacuous: every set names at least its body face in quotes.
      expect(firsts.length, t.id).toBeGreaterThan(0);
      // The first family of each role is the face the set is designed around;
      // an unquoted keyword (system-ui, ui-monospace) is the OS's own.
      for (const first of firsts) {
        expect(
          declared,
          `'${t.id}' names ${first} but its stylesheet has no face for it`
        ).toContain(first);
      }
    }
  });

  it('a font-size-adjust reaches form controls, not just body', () => {
    // The UA stylesheet sets the `font` shorthand on form controls, which
    // resets font-size-adjust to none instead of inheriting it. A rule on body
    // alone left every <button> label ~12% smaller than an <a> with the same
    // classes beside it (Almanac, E433).
    const rules = [...read('../styles/typesets.css').matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(
      ([, , body]) => body.includes('font-size-adjust')
    );
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector] of rules) {
      for (const el of ['button', 'input', 'select', 'textarea']) {
        expect(selector, `font-size-adjust rule misses <${el}>`).toMatch(new RegExp(`\\b${el}\\b`));
      }
    }
  });

  it('DEFAULT_TYPESET is in the registry', () => {
    expect(TYPESETS.some((t) => t.id === DEFAULT_TYPESET)).toBe(true);
  });

  it('typeSetHref returns null for the default set (its faces are bundled)', () => {
    // Guards the double-download regression: the default set's faces are in
    // styles/fonts.css, so injecting them again would refetch the same files.
    expect(typeSetHref(DEFAULT_TYPESET)).toBeNull();
  });

  it('typeSetHref returns the registered href for a non-default set', () => {
    const other = TYPESETS.find((t) => t.id !== DEFAULT_TYPESET && t.href);
    expect(other).toBeDefined();
    expect(typeSetHref(other!.id)).toBe(other!.href);
  });

  it('typeSetHref returns null for unknown ids', () => {
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
 * index.html hard-codes two things the registry also knows: the set id list
 * and the default (in the pre-paint script, which must run before any module
 * loads and so can't import from here). The default set's faces are the third
 * coordination point: they are self-hosted in styles/fonts.css rather than
 * linked from Google, so that file must declare every family the default set
 * names. Drift is silent and ugly — a first paint in faces that were never
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

  it('index.html links no third-party font origin', () => {
    // The whole point of self-hosting: no third-party font origin on first paint.
    expect(indexHtml()).not.toContain('fonts.googleapis.com');
    for (const t of TYPESETS) expect(t.href ?? '', t.id).not.toMatch(/^https?:/);
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
  const defaultFamilies = familiesOf(faceSheet(DEFAULT_TYPESET));

  it('names every family of the default set', () => {
    const block = fontBlock();
    expect(block.length).toBeGreaterThan(0);
    for (const name of defaultFamilies) {
      expect(block, `tokens.css --font-* fallbacks are missing ${name}`).toContain(name);
    }
  });

  it('carries no leftover face that only a non-default set uses', () => {
    const block = fontBlock();
    for (const t of TYPESETS) {
      if (t.id === DEFAULT_TYPESET) continue;
      for (const name of familiesOf(faceSheet(t.id))) {
        // Sets share faces on purpose (Eczar, Archivo Narrow and Plex Mono are
        // in several), so only a face the default does NOT use is a leftover.
        if (defaultFamilies.includes(name)) continue;
        expect(block, `tokens.css still names ${name}, which only '${t.id}' uses`).not.toContain(
          name
        );
      }
    }
  });
});
