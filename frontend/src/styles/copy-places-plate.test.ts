/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 2026-10-16: a collection tile's ×qty corner and its deck / binder marks
// shared one wrap-reverse row, so whenever the marks didn't fit beside the
// count they jumped a line and piled up over the rules text, in a different
// shape on every tile. They are one plate now (CopyPlaces' ArtPlate), and it
// must never wrap: it folds its counts, then the set code, then overlaps the
// discs, each step switched by a width CSS compares with the tile.
//
// Read off disk: CSS `?raw` imports come back empty under this setup.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'components/shared/CopyPlaces.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);
const body = (sel: string) => rules.find(([s]) => s === sel)?.[1] ?? '';

describe('the one plate on a collection tile', () => {
  it('nothing in the trigger or plate wraps', () => {
    const wrapping = rules
      .filter(
        ([sel, b]) =>
          /\.copy-places-(trigger--art|plate|marks|mark)\b/.test(sel) && /flex-wrap:\s*wrap/.test(b)
      )
      .map(([sel]) => sel);
    expect(wrapping, 'the plate gives things up instead of wrapping').toEqual([]);
  });

  it('folds the counts below the full width and the set code below the lean width', () => {
    expect(body('.copy-places-count')).toMatch(
      /max-width:\s*clamp\(0px,\s*\(100cqi - var\(--plate-full\)\)/
    );
    expect(body('.copy-places-set')).toMatch(
      /max-width:\s*clamp\(0px,\s*\(100cqi - var\(--plate-lean\)\)/
    );
  });

  // Seen in Chrome at a 390px phone: with overflow hidden the set code's
  // automatic min-width is 0, so flex trimmed "MSC" to "MS" first.
  it('never trims the ×qty or the set code; the discs absorb the squeeze', () => {
    expect(body('.copy-places-set')).toMatch(/flex-shrink:\s*0/);
    expect(body('.copy-places-qty,\n.copy-places-surplus')).toMatch(/flex:\s*none/);
  });

  it('measures against the bottom row, which is the container', () => {
    expect(body('.collection-grid-foot:has(.copy-places-plate)')).toMatch(
      /container-type:\s*inline-size/
    );
  });

  it('lets the discs shrink to overlap, all but the last', () => {
    expect(body('.copy-places-mark')).toMatch(/flex:\s*0 1 auto/);
    expect(body('.copy-places-mark:last-child')).toMatch(/flex-shrink:\s*0/);
  });
});
