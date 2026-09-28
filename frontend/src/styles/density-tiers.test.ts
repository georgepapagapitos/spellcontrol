/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// T135 guard: STYLE_GUIDE § Layout system, "Density tiers: phone ≤599 ·
// tablet 600–1023 · desktop ≥1024 … driven by tier tokens rather than
// per-component media queries". tokens.css sets --control-h and --gutter per
// tier, with a coarse pointer flooring --control-h at 44px last. The shared
// controls, the page gutter and the desktop header read those tokens, so a
// tier is one edit and a control can't fall under the touch floor by the
// order its stylesheet declares its rules in (the tablet banner button that
// read 40px on touch while the floor was a separate rule).
const styles = join(dirname(fileURLToPath(import.meta.url)));
const read = (f: string) => readFileSync(join(styles, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule whose selector list includes `selector`. */
function decls(css: string, selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (m[1].split(',').some((s) => s.trim() === selector)) out.push(m[2]);
  return out.join(';');
}

describe('density tiers (T135)', () => {
  const tokens = read('tokens.css');

  it('sets each tier and floors a touch pointer last', () => {
    const tablet = tokens.indexOf('@media (max-width: 1023px)');
    const phone = tokens.indexOf('@media (max-width: 599px)', tablet);
    const coarse = tokens.lastIndexOf('@media (pointer: coarse)');
    expect(tablet).toBeGreaterThan(0);
    expect(phone).toBeGreaterThan(tablet);
    expect(coarse).toBeGreaterThan(phone);
    expect(tokens.slice(tablet, phone)).toMatch(/--control-h:\s*2\.5rem/);
    expect(tokens.slice(phone, coarse)).toMatch(/--control-h:\s*2\.75rem/);
    expect(tokens.slice(phone, coarse)).toMatch(/--text-base:\s*1rem/);
    expect(tokens.slice(coarse)).toMatch(/--control-h:\s*2\.75rem/);
  });

  it.each([
    ['tabs.css', '.btn', 'min-height'],
    ['tabs.css', '.tab', 'min-height'],
    ['binder-hero.css', '.pill-btn', 'min-height'],
    ['deck-builder-display.css', '.toolbar-pill', 'height'],
    ['search-controls.css', '.search-pill', 'min-height'],
  ])('%s %s stands at the tier height', (file, selector, prop) => {
    expect(decls(read(file), selector)).toMatch(
      new RegExp(`(^|;)\\s*${prop}:\\s*var\\(--control-h\\)`)
    );
  });

  it('the page gutter and the desktop header read the tier gutter', () => {
    const base = read('base-layout.css');
    expect(decls(base, '.app-main')).toMatch(/--page-gutter:\s*var\(--gutter\)/);
    expect(decls(base, '.site-header')).toMatch(/max\(var\(--gutter\)/);
  });
});
