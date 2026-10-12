/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * E1000: the corrected hit-census (ancestor hits no longer count) found these
 * controls under the floor at phone tier. Each keeps its visible size and gets
 * a coarse-pointer ::after ghost; these pin the ghost so it cannot be dropped.
 */
describe('E1000 residual touch targets', () => {
  it('the deck-analysis suggest-add chip has a 44px coarse ghost', () => {
    const css = read('deck-builder-analysis-panel.css');
    expect(css).toMatch(/\.deck-analysis-suggest-add::after\s*\{[^}]*inset:\s*-7px 0/);
  });

  it('the commander color pip ghost reaches 44px on the inline axis too', () => {
    const css = read('deck-builder-commander.css');
    const m = css.match(/\.commander-color-pip::after\s*\{([^}]*)\}/);
    expect(m, 'pip ghost missing').toBeTruthy();
    expect(m![1]).toMatch(/left:\s*-2px/);
    expect(m![1]).toMatch(/width:\s*calc\(100% \+ 4px\)/);
    expect(m![1]).toMatch(/height:\s*44px/);
  });
});
