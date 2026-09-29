/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// A keyboard user must always see where focus is (WCAG 2.4.7). A control whose
// :focus-visible ring is the SAME box-shadow as its selected state shows no
// change at all when focus lands on an already-selected one: the WUBRG
// commander pips did exactly this, found by the journey's keyboard walk
// (scripts/journey.mjs --a11y). Fix: draw focus as an outline outside the
// selection ring (`outline: 2px solid var(--accent); outline-offset`), or
// otherwise make the focused state differ from the selected one.

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith('.css') ? [p] : [];
  });
}

/** Innermost `selector { declarations }` blocks, @media bodies included. */
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

const SELECTED = [
  '.active',
  '.is-active',
  '.selected',
  '.is-selected',
  '.is-on',
  "[aria-pressed='true']",
  "[aria-selected='true']",
  "[aria-checked='true']",
  ':checked',
];

function sameRingAsSelected(): string[] {
  const bad: string[] = [];
  for (const file of cssFiles(src)) {
    const all = rules(readFileSync(file, 'utf8'));
    for (const focus of all) {
      if (!focus.selector.endsWith(':focus-visible')) continue;
      const base = focus.selector.slice(0, -':focus-visible'.length);
      if (!base || /[\s>+~]$/.test(base)) continue;
      const outline = focus.decls.get('outline') ?? focus.decls.get('outline-style');
      if (outline && !/^(none|0)$/.test(outline)) continue;
      const ring = focus.decls.get('box-shadow');
      if (!ring) continue;
      for (const sel of all) {
        if (!SELECTED.some((s) => sel.selector === base + s)) continue;
        if (sel.decls.get('box-shadow') === ring) {
          bad.push(
            `${relative(src, file)}: ${focus.selector} draws the same ring as ${sel.selector}`
          );
        }
      }
    }
  }
  return bad;
}

describe('focus ring differs from the selected state', () => {
  it('no :focus-visible ring is identical to its selected-state ring', () => {
    expect(sameRingAsSelected()).toEqual([]);
  });
});
