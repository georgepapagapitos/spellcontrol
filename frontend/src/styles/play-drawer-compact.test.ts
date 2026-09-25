/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'play-panel-menus.css'), 'utf8');

/**
 * On a SHORT seat the drawer's body becomes one horizontally scrolling row
 * instead of the tall seat's stacked sections (Lotus's model) — a `seat-menu-
 * body` body was measured at 0-68px on every seat of 4p-sides (the default
 * 4-player board), the 2p/3p sideways seats, and every 5-10 player board at
 * 320-390px (`drawer-keypad.mjs`). Same container-query thresholds the life
 * keypad already uses (`play-effects.css`) — a panel under ~300px on its own
 * short axis, told apart by orientation since a sideways panel's height is
 * its cell's WIDTH.
 */
describe('drawer is a compact scrolling row on a short seat', () => {
  const block = (query: string) => {
    const start = css.indexOf(`@container (${query})`);
    expect(start, `@container (${query}) is missing`).toBeGreaterThan(-1);
    const end = css.indexOf('\n}\n', start);
    return css.slice(start, end);
  };

  it('a sideways seat gets the row layout under max-width: 300px, matching the keypad threshold', () => {
    const b = block('max-width: 300px');
    expect(b).toContain('.player-panel[data-sideways] .seat-menu-body {');
    expect(b).toMatch(/flex-direction:\s*row/);
    expect(b).toMatch(/overflow-x:\s*auto/);
  });

  it('an upright short seat gets the row layout under max-height: 300px', () => {
    const b = block('max-height: 300px');
    expect(b).toContain('.player-panel:not([data-sideways]) .seat-menu-body {');
    expect(b).toMatch(/flex-direction:\s*row/);
    expect(b).toMatch(/overflow-x:\s*auto/);
  });

  it('unwraps the actions and counters into the SAME row via display: contents, not a nested sub-row', () => {
    for (const query of ['max-width: 300px', 'max-height: 300px']) {
      const b = block(query);
      expect(b).toMatch(/\.seat-menu-quick,/);
      expect(b).toMatch(/\.pp-counters,/);
      expect(b).toMatch(/\.pp-counters-inner,/);
      expect(b).toMatch(/\.pp-counters-body\s*\{\s*display:\s*contents;/);
    }
  });

  it('a section trigger swaps the row for that ONE editor, full width, via data-active-editor', () => {
    for (const query of ['max-width: 300px', 'max-height: 300px']) {
      const b = block(query);
      expect(b).toMatch(/\.seat-menu-editor\s*\{\s*display:\s*none;/);
      for (const editor of ['name', 'partner', 'color', 'facing', 'counter']) {
        expect(b, `${editor} editor swap-in rule missing under ${query}`).toContain(
          `data-active-editor='${editor}']`
        );
      }
      expect(b).toContain('seat-menu-editor-back');
    }
  });

  it('every compact chip and trigger sits behind a coarse-pointer 44px floor', () => {
    const at = css.indexOf('.seat-menu-row-trigger,\n  .seat-menu-editor-back');
    expect(at, 'no coarse floor for the compact row triggers').toBeGreaterThan(-1);
    expect(css.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
  });

  it('neither layout leaks into the other orientation', () => {
    expect(block('max-width: 300px')).not.toMatch(/:not\(\[data-sideways\]\)/);
    expect(block('max-height: 300px')).not.toMatch(/player-panel\[data-sideways\] \./);
  });
});
