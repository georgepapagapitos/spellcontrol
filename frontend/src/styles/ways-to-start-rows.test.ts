/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Ways to start are a list, not a grid of equal cards (STYLE_GUIDE § Layout
// system, 2026-10-16). Play's four doors and New deck's starts were boxes of one
// size with the icon on top, or framed in a square of its own: the feature-grid
// template the shared directive names (ui-tells.md, "Three (or six) identical
// feature cards, icon on top" and "An icon in a rounded colored square"). They
// are rows split by hairlines now; New deck's Generate alone stays framed, as
// the one primary start.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) =>
  readFileSync(join(srcRoot, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first block whose selector is exactly `sel`. */
function block(css: string, sel: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() === sel) return m[2];
  }
  throw new Error(`no ${sel} block`);
}

describe('ways to start are rows', () => {
  it("Play's doors are one list of hairline rows, not boxed cards", () => {
    const css = read('components/play/PlayHome.css');
    const list = block(css, '.play-home-doors');
    expect(list).toMatch(/flex-direction:\s*column/);
    expect(list).not.toMatch(/display:\s*grid/);
    expect(block(css, '.play-home-doors > li')).toMatch(/border-bottom:\s*0\.5px solid/);
    const door = block(css, '.play-home-door');
    expect(door).not.toMatch(/border-radius/);
    expect(door).toMatch(/border:\s*0/);
    expect(door).toMatch(/background:\s*none/);

    const tsx = read('components/play/PlayHome.tsx');
    expect(tsx).toMatch(/<ul className="play-home-doors" role="list">/);
    // The icon sits beside the title at the inline-with-text size.
    expect(tsx).not.toMatch(/width=\{20\} height=\{20\}/);
  });

  it("New deck's starts are rows under one framed primary, with no framed icon", () => {
    const css = read('pages/DeckNewPage.css');
    expect(css).not.toMatch(/\.deck-new-door-glyph/);
    expect(block(css, '.deck-new-doors')).toMatch(/flex-direction:\s*column/);
    const row = block(css, '.deck-new-door');
    expect(row).not.toMatch(/border-radius/);
    expect(row).toMatch(/border-bottom:\s*0\.5px solid/);
    const icon = block(css, '.deck-new-door-icon');
    expect(icon).not.toMatch(/border/);
    expect(icon).not.toMatch(/background/);
    // Generate is the one framed door.
    expect(block(css, '.deck-new-door.is-feature')).toMatch(/border-radius:\s*var\(--radius-lg\)/);
  });
});
