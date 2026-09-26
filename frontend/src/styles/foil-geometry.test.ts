/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * A foil canvas must never expose its edge.
 *
 * The foil layers are oversized canvases (::before / ::after) that move by
 * `transform: translate(…)` — the cursor drives them in the preview, keyframes
 * drift them on thumbnails. A canvas N% of the card covers it only while its
 * translate stays inside [−(N − 100)/N, 0] of its own size. #1775 moved the
 * rainbow onto a 3.2× canvas but kept a 2× / 2.5× cursor parallax, so outside
 * the middle of the card the canvas edge crossed the art as a ruler-straight
 * line, and past ~75% the foil left the card entirely.
 *
 * So: every `translate` in holographic.css is evaluated with the cursor at 0%
 * and 100% on both axes, and each must land inside the coverage range the
 * declared canvas size allows. A new var the checker can't resolve fails too —
 * extend CURSOR below rather than letting an expression go unchecked.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'holographic.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The cursor vars the hook writes, in percent. */
const CURSOR = ['--mx', '--my'] as const;

/** Evaluate a CSS length expression (%, calc, var) to a number of percent. */
function evaluate(expr: string, vars: Record<string, number>): number {
  const src = expr
    .replace(/var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g, (whole, name: string) => {
      if (!(name in vars)) throw new Error(`unresolvable ${whole} in "${expr}"`);
      return `(${vars[name]})`;
    })
    .replace(/calc\(/g, '(')
    .replace(/%/g, '');
  let i = 0;
  const peek = () => src[i];
  const skip = () => {
    while (src[i] === ' ') i++;
  };
  const num = (): number => {
    skip();
    if (peek() === '(') {
      i++;
      const v = sum();
      skip();
      if (src[i++] !== ')') throw new Error(`bad parens in "${expr}"`);
      return v;
    }
    if (peek() === '-') {
      i++;
      return -num();
    }
    const m = /^\d*\.?\d+/.exec(src.slice(i));
    if (!m) throw new Error(`cannot parse "${expr}" at "${src.slice(i)}"`);
    i += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = num();
    for (skip(); peek() === '*' || peek() === '/'; skip()) {
      const op = src[i++];
      v = op === '*' ? v * num() : v / num();
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    for (skip(); peek() === '+' || peek() === '-'; skip()) {
      const op = src[i++];
      v = op === '+' ? v + product() : v - product();
    }
    return v;
  };
  const v = sum();
  skip();
  if (i !== src.length) throw new Error(`trailing input in "${expr}"`);
  return v;
}

/** Split `translate(a, b)` args at the top-level comma. */
function translateArgs(body: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') depth--;
    else if (body[i] === ',' && depth === 0) return [body.slice(0, i), body.slice(i + 1)];
  }
  return [body, '0'];
}

/** Every `translate(…)` in the sheet, with balanced parentheses. */
function translates(sheet: string): string[] {
  const out: string[] = [];
  for (let at = sheet.indexOf('translate('); at !== -1; at = sheet.indexOf('translate(', at + 1)) {
    let depth = 0;
    let end = at + 'translate'.length;
    for (; end < sheet.length; end++) {
      if (sheet[end] === '(') depth++;
      else if (sheet[end] === ')' && --depth === 0) break;
    }
    out.push(sheet.slice(at + 'translate('.length, end));
  }
  return out;
}

/** The canvas size (% of the card) every foil ::before / ::after declares. */
function canvasSizes(sheet: string): number[] {
  const rule = /\.card-preview-foil-shine::before,[^{]*\{([^}]*)\}/.exec(sheet);
  if (!rule) throw new Error('foil canvas rule not found');
  const w = /width:\s*(\d+)%/.exec(rule[1]);
  const h = /height:\s*(\d+)%/.exec(rule[1]);
  if (!w || !h) throw new Error('foil canvas rule must size the canvas in %');
  return [Number(w[1]), Number(h[1])];
}

/** Returns every translate that escapes coverage for a canvas `size`% big. */
function escapes(sheet: string, size: number): string[] {
  const floor = (-(size - 100) / size) * 100;
  const bad: string[] = [];
  for (const body of translates(sheet)) {
    for (const arg of translateArgs(body)) {
      for (const x of [0, 100]) {
        const vars = Object.fromEntries(CURSOR.map((v) => [v, x]));
        const v = evaluate(arg.trim(), vars);
        if (v < floor - 1e-9 || v > 1e-9)
          bad.push(`translate(${body}) → ${v.toFixed(2)}% at cursor ${x}%`);
      }
    }
  }
  return bad;
}

describe('foil canvas geometry (#1775 seam)', () => {
  it('declares a square canvas and has translates to check', () => {
    const [w, h] = canvasSizes(css);
    expect(w).toBe(h);
    expect(w).toBeGreaterThan(100);
    expect(translates(css).length).toBeGreaterThanOrEqual(6);
  });

  it('keeps every translate inside the canvas coverage range at every cursor position', () => {
    const [size] = canvasSizes(css);
    expect(escapes(css, size)).toEqual([]);
  });

  it('would have caught the #1775 geometry (3.2× canvas, 2× parallax)', () => {
    const old = `.x { transform: translate(calc(((50% - var(--mx, 50%)) * 2 + 50%) * -0.6875), 0); }`;
    expect(escapes(old, 320).length).toBeGreaterThan(0);
  });
});
