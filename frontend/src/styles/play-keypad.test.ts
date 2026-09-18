/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'play-effects.css'), 'utf8');

/**
 * The life keypad is an in-panel cover with ~160px of fixed chrome above a
 * `1fr` digit grid. On a short panel — every seat of `4p-sides` (the default
 * four-player board on a phone), `2p-side`, and every 5p/6p cell — the grid
 * collapsed to 2px/16px rows and a tap on "5" landed on "Set life" (playtest
 * batch 7, measured on every preset with b7-keypad-layouts.mjs). The fix is
 * one compact layout per short-panel shape, each under a container query on
 * the cell; a sideways panel's height is its cell's WIDTH, so the two shapes
 * are told apart by orientation, not only by the query.
 */
describe('life keypad on short panels', () => {
  const block = (query: string) => {
    const start = css.indexOf(`@container (${query})`);
    expect(start, `@container (${query}) is missing`).toBeGreaterThan(-1);
    // the block ends at the first line that is a lone closing brace
    const end = css.indexOf('\n}\n', start);
    return css.slice(start, end);
  };

  it('a sideways seat (wide and short) gets the row layout with a 6-column grid', () => {
    const b = block('max-width: 300px');
    expect(b).toContain('.player-panel[data-sideways] .life-keypad {');
    expect(b).toContain("'display grid'");
    expect(b).toContain('.player-panel[data-sideways] .life-keypad-grid {');
    expect(b).toContain('grid-template-columns: repeat(6, 1fr)');
    expect(b).toContain('grid-auto-rows: minmax(40px, 1fr)');
    expect(b).toContain('.player-panel[data-sideways] .life-keypad-confirm,');
    // the side column must not eat the grid: measured 39px-wide keys at 2fr/5fr
    expect(b).toContain('grid-template-columns: minmax(5rem, 1fr) 6fr');
  });

  it('an upright short cell (narrow and short) keeps a column but goes 4 across with tighter chrome', () => {
    const b = block('max-height: 300px');
    expect(b).toContain('.player-panel:not([data-sideways]) .life-keypad-grid {');
    expect(b).toContain('grid-template-columns: repeat(4, 1fr)');
    expect(b).toContain('grid-auto-rows: minmax(32px, 1fr)');
    expect(b).toContain('.player-panel:not([data-sideways]) .life-keypad-display {');
    // a 183px-wide cell cannot host the side column — never the row layout here
    expect(b).not.toContain("'display grid'");
  });

  it('neither layout leaks into the other orientation', () => {
    expect(block('max-width: 300px')).not.toContain(':not([data-sideways])');
    expect(block('max-height: 300px')).not.toContain('.player-panel[data-sideways]');
  });
});
