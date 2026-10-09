/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// The color pip (<ColorPip>, `.color-pip-mana`) sat off-center: the WUBRG
// glyphs in the commander finder's color filter rode low enough to touch the
// circle's bottom edge. Three things did it, each pinned here.
//
// 1. mana-font centers a glyph with line-height on the glyph's OWN font-size.
//    Shrinking only the `::before`, or flex-centering its box, left the ink
//    1.5–2px high (measured in headless Edge). The glyph has to be the
//    element's font-size, with the circle sized in that em and
//    line-height = height.
// 2. The vendor `.ms-cost { font-size: .95em }` loads after the app CSS
//    (styles/icon-fonts-async.ts), so a one-class `.color-pip-mana` font-size
//    loses to it. The sizing rule needs both classes.
// 3. A bare `ms-cost` circle (no pip) hugs a full-size glyph with ~1px to
//    spare, so a whole-pixel text snap reads as off-center. <ColorPip> has no
//    bare option any more; the type enforces that half.
//
// Fix for a failure here: size a pip with `--pip-size` on an ancestor, never
// by restyling the glyph or its `::before`.

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith('.css') ? [p] : [];
  });
}

function rules(css: string): Array<{ selector: string; decls: Map<string, string> }> {
  const out: Array<{ selector: string; decls: Map<string, string> }> = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0)
        decls.set(
          d.slice(0, i).trim(),
          d
            .slice(i + 1)
            .replace(/\s+/g, ' ')
            .trim()
        );
    }
    for (const selector of m[1].split(',')) out.push({ selector: selector.trim(), decls });
  }
  return out;
}

const all = cssFiles(src).flatMap((file) =>
  rules(readFileSync(file, 'utf8')).map((r) => ({ ...r, file: relative(src, file) }))
);

const GEOMETRY = ['font-size', 'line-height', 'height', 'display', 'padding', 'transform'];

describe('color pip centering', () => {
  it('sizes the pip on both classes, glyph as font-size, line-height = height', () => {
    const pip = all.filter((r) => r.selector === '.color-pip-mana.ms-cost');
    expect(pip).toHaveLength(1);
    const d = pip[0].decls;
    expect(d.get('font-size')).toContain('var(--pip-size');
    expect(d.get('height')).toBeTruthy();
    expect(d.get('line-height')).toBe(d.get('height'));
    expect(d.get('width')).toBe(d.get('height'));
    expect(d.get('text-align')).toBe('center');
  });

  it('no other rule restyles the pip glyph or its box geometry', () => {
    const offenders = all
      .filter(
        (r) => r.selector.includes('color-pip-mana') && r.selector !== '.color-pip-mana.ms-cost'
      )
      .filter((r) => r.selector.includes('::before') || GEOMETRY.some((p) => r.decls.has(p)))
      .map((r) => `${r.file}: ${r.selector}`);
    expect(offenders).toEqual([]);
  });
});
