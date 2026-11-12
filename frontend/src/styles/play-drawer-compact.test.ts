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
      // The Name/Partner/Color/Facing group too, or its chips size against
      // the group rather than the row (they hung 6px past a 58px row).
      expect(b).toMatch(/\.seat-menu-triggers,/);
    }
  });

  it('a section trigger swaps the row for that ONE editor, full width, via data-active-editor', () => {
    for (const query of ['max-width: 300px', 'max-height: 300px']) {
      const b = block(query);
      expect(b).toMatch(/\.seat-menu-editor\s*\{\s*display:\s*none;/);
      for (const editor of ['name', 'partner', 'color', 'facing', 'counter', 'dungeon']) {
        expect(b, `${editor} editor swap-in rule missing under ${query}`).toContain(
          `data-active-editor='${editor}']`
        );
      }
      expect(b).toContain('seat-menu-editor-back');
    }
  });

  it('the row has its own horizontal scroll cue, not a reuse of the vertical one', () => {
    for (const query of ['max-width: 300px', 'max-height: 300px']) {
      const b = block(query);
      expect(b).toMatch(/data-overflow-x='right'\]\s*\{\s*mask-image:/);
      expect(b).toMatch(/data-overflow-x='left'\]\s*\{\s*mask-image:/);
      expect(b).toMatch(/data-overflow-x='both'\]\s*\{\s*mask-image:/);
    }
  });

  it('every compact chip and trigger sits behind a coarse-pointer 44px floor', () => {
    const at = css.indexOf('.seat-menu-row-trigger,\n  .seat-menu-editor-back');
    expect(at, 'no coarse floor for the compact row triggers').toBeGreaterThan(-1);
    expect(css.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
  });

  it("a short seat's drawer drops its header, so the row gets the height", () => {
    // Header (44px) + strip (44px) + padding left a 148px seat's row 33px for
    // 44px chips, and a 95px seat's row 0 (measured, every 4p-sides seat and
    // every 7-10 player wide row on a phone).
    for (const query of ['max-width: 300px', 'max-height: 300px']) {
      const b = block(query);
      expect(b).toMatch(/\.seat-menu-head\s*\{\s*display:\s*none;/);
      expect(b).toMatch(/\.seat-menu-sheet\s*\{\s*padding:\s*var\(--space-1\) var\(--space-2\);/);
    }
  });

  it('a counter is a side-by-side stepper, one 44px row tall, not a stacked column', () => {
    for (const query of ['max-width: 300px', 'max-height: 300px']) {
      expect(block(query)).not.toContain('column-reverse');
    }
  });

  it('editors keep 44px targets on a narrow seat: a scrolling line of swatches and facings', () => {
    for (const query of ['max-width: 300px', 'max-height: 300px']) {
      const b = block(query);
      expect(b).toMatch(/\.seat-menu-swatches\s*\{[^}]*grid-auto-columns:\s*2\.75rem/);
      expect(b).toMatch(/\.seat-menu-facing-btn\s*\{\s*flex:\s*0 0 2\.75rem;/);
      expect(b).toMatch(/\.seat-menu-row\s*\{\s*flex-wrap:\s*wrap;/);
    }
    // A tall seat's grid fills with 44px columns on touch.
    const coarse = css.indexOf('repeat(auto-fill, minmax(2.75rem, 1fr))');
    expect(coarse).toBeGreaterThan(-1);
    expect(css.lastIndexOf('@media (pointer: coarse)', coarse)).toBeGreaterThan(-1);
  });

  it("a counter's stepper drops under its label rather than squeezing the label to nothing", () => {
    const at = css.indexOf('.counter-row {');
    expect(css.slice(at, css.indexOf('}', at))).toMatch(/flex-wrap:\s*wrap/);
  });

  it('the shortest upright seats put the strip at the end of the row instead of under it', () => {
    const b = block('max-height: 7.5rem');
    expect(b).toMatch(/:not\(\[data-sideways\]\) \.seat-menu\s*\{\s*flex-direction:\s*row;/);
    expect(b).toMatch(/\.seat-menu-sheet\s*\{\s*min-width:\s*0;/);
  });

  it('neither layout leaks into the other orientation', () => {
    expect(block('max-width: 300px')).not.toMatch(/:not\(\[data-sideways\]\)/);
    expect(block('max-height: 300px')).not.toMatch(/player-panel\[data-sideways\] \./);
  });
});

/**
 * Between the two: an upright seat that is narrow but not short (the near
 * seats of a four-player pod on a phone, about 195 x 370px). The one-row
 * drawer never applied there, so it got the tall seat's stacked sections:
 * 1236px of content in a 259px window, with the fourth facing button cut off
 * at the drawer's edge. It takes the same chips and swap-in editors, wrapped
 * two to a line (521px, measured with a real-touch probe at 390x844).
 */
describe('drawer wraps its chips on a narrow upright seat that is not short', () => {
  const start = css.indexOf('@container (max-width: 300px) and (min-height: 300.01px)');
  const b = css.slice(start, css.indexOf('\n}\n', start));

  it('exists, and only for upright seats', () => {
    expect(start).toBeGreaterThan(-1);
    expect(b).toContain('.player-panel:not([data-sideways]) .seat-menu-body {');
    expect(b).not.toMatch(/player-panel\[data-sideways\] \./);
  });

  it('wraps the chips two to a line and scrolls on one axis only', () => {
    expect(b).toMatch(/\.seat-menu-body\s*\{\s*flex-flow:\s*row wrap;/);
    expect(b).toMatch(/flex:\s*1 1 calc\(50% - var\(--space-1-5\)\)/);
    expect(b).not.toMatch(/overflow-x:\s*auto/);
    expect(b).toMatch(/\.pp-counters-body\s*\{\s*display:\s*contents;/);
  });

  it('swaps in one editor at a time, like the compact row', () => {
    expect(b).toMatch(/\.seat-menu-editor\s*\{\s*display:\s*none;/);
    for (const editor of ['name', 'partner', 'color', 'facing', 'counter', 'dungeon']) {
      expect(b, `${editor} editor swap-in rule missing`).toContain(
        `.seat-menu-body[data-active-editor='${editor}']`
      );
    }
    expect(b).toMatch(
      /\[data-active-editor\] \.seat-menu-editor-back\s*\{\s*display:\s*inline-flex;/
    );
  });

  it('lays the four facings out two by two instead of running past the edge', () => {
    expect(b).toMatch(
      /\.seat-menu-facing-row\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr 1fr;/
    );
  });

  // A named counter's stepper plus Remove is 176px of 44px targets in a
  // drawer 144-190px wide: Remove ran 35px past the edge. Poison has no
  // Remove, so its label takes the whole first line or the minus button
  // moves up beside it.
  it('a counter row is two lines: label and Remove, then the stepper', () => {
    expect(b).toMatch(/\.counter-row-controls\s*\{\s*display:\s*contents;/);
    expect(b).toMatch(/\.counter-row-label\s*\{\s*flex:\s*1 1 calc\(100% - 3\.25rem\);/);
    expect(b).toMatch(/\.counter-row-remove\s*\{\s*order:\s*1;/);
    expect(b).toMatch(/\.counter-row-btn\s*\{\s*order:\s*2;/);
    expect(b).toMatch(
      /\.counter-row:not\(:has\(\.counter-row-remove\)\)\s+\.counter-row-label\s*\{\s*flex-basis:\s*100%;/
    );
  });
});
