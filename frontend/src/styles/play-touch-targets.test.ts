/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');
const board = read('play-board.css');
const counters = read('play-counters-panel.css');
const enhancements = read('play-enhancements.css');

/**
 * The play board is the one surface driven entirely by thumbs on a device
 * lying on a table, and its controls are deliberately small so the life
 * numeral dominates. That trade-off is only safe while the *hit* area still
 * meets the coarse-pointer floor via a `::after` ghost (the UX-320 pattern).
 *
 * These assertions were each written against a measured failure from
 * `.claude/tools/board-touch-probe.mjs`, not from reading the CSS — the
 * probe is what caught the icon-only counter chip sitting at 39px on its
 * short axis while the text-bearing chips beside it passed.
 */
describe('play board touch targets', () => {
  /**
   * Every body declared for a selector, joined.
   *
   * ALL of them, not the first: a selector legitimately appears twice — once
   * in the base sheet and again inside `@media (pointer: coarse)` — and
   * matching only the first made this file assert against the base rule and
   * miss the floor that was right there. The coarse-block placement is
   * asserted separately below.
   */
  function ruleBody(css: string, selector: string): string | null {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bodies = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map(
      (m) => m[1]
    );
    return bodies.length > 0 ? bodies.join('\n') : null;
  }

  it('the ± step button carries a 44px ghost hit area', () => {
    const body = ruleBody(board, '.player-panel-step-btn::after');
    expect(body, '.player-panel-step-btn::after is missing').toBeTruthy();
    expect(body).toContain('width: 44px');
    expect(body).toContain('height: 44px');
  });

  it('the seat-name button carries a ghost hit area at least 44px on both axes', () => {
    const body = ruleBody(board, '.player-panel-name::after');
    expect(
      body,
      '.player-panel-name is a text label styled as a button (~23px tall). Without a ghost, a miss falls through to the ±1 tap zone and silently changes life.'
    ).toBeTruthy();
    expect(body).toMatch(/min-width:\s*44px/);
    expect(body).toContain('height: 44px');
  });

  it('a ghost hit area is positioned, or it collapses onto the page', () => {
    for (const sel of ['.player-panel-step-btn::after', '.player-panel-name::after']) {
      const body = ruleBody(board, sel)!;
      expect(body, `${sel} needs position: absolute`).toContain('position: absolute');
      expect(body, `${sel} needs a centring transform`).toContain('translate(-50%, -50%)');
    }
    // The ghost only centres against its own button if that button is a
    // positioning context. `.player-panel-step-btn` already is (it is
    // absolutely positioned); `.player-panel-name` is not, so it must be
    // made one explicitly.
    expect(board).toMatch(/\.player-panel-name\s*\{[^}]*position:\s*relative/);
  });

  it('the icon-only counter chip states the floor on BOTH axes', () => {
    const body = ruleBody(counters, '.pp-counter-chip.is-add');
    expect(
      body,
      'An icon-only chip has no text to widen it, so padding-inline alone left it ~39px across.'
    ).toBeTruthy();
    expect(body).toMatch(/min-width:\s*2\.75rem/);
    // The shared chip rule supplies the height floor for every chip.
    expect(ruleBody(counters, '.pp-counter-chip')).toMatch(/min-height:\s*2\.75rem/);
  });

  it('the counter-chip floors live inside a coarse-pointer block', () => {
    const at = counters.indexOf('.pp-counter-chip.is-add {\n    min-width');
    const idx = at > -1 ? at : counters.lastIndexOf('.pp-counter-chip.is-add');
    const coarseBefore = counters.lastIndexOf('@media (pointer: coarse)', idx);
    expect(
      coarseBefore,
      'the is-add min-width floor must not inflate the desktop board'
    ).toBeGreaterThan(-1);
  });

  it('the turn chip takes the floor the way every other pill does', () => {
    // The active seat's pass-turn control. A pill with text, so min-height +
    // a wider inline pad is the whole floor — the same shape .pp-counter-chip
    // takes, rather than a ghost.
    const body = ruleBody(counters, '.pp-turn-chip');
    expect(body, '.pp-turn-chip is missing').toBeTruthy();
    expect(body).toMatch(/min-height:\s*2\.75rem/);
    const at = counters.indexOf(
      'min-height: 2.75rem',
      counters.indexOf('.pp-turn-chip {\n    min-height')
    );
    const coarseBefore = counters.lastIndexOf('@media (pointer: coarse)', at);
    expect(coarseBefore, 'the turn-chip floor must not inflate the desktop board').toBeGreaterThan(
      -1
    );
  });

  it('the clock cold-start button carries a ghost, being icon-only', () => {
    const body = ruleBody(enhancements, '.game-clock-start::after');
    expect(
      body,
      '.game-clock-start is a 1.5rem icon button inside a pill that must not grow — it needs a ghost, not a bigger box.'
    ).toBeTruthy();
    expect(body).toMatch(/width:\s*2\.75rem/);
    expect(body).toMatch(/height:\s*2\.75rem/);
    expect(body).toContain('position: absolute');
    expect(body).toContain('translate(-50%, -50%)');
    // The ghost centres only against a positioned button, and the floor is
    // coarse-only so a mouse board keeps its compact chip.
    const at = enhancements.indexOf('.game-clock-start::after');
    expect(enhancements.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
    expect(enhancements).toMatch(/\.game-clock-start\s*\{[^}]*position:\s*relative/);
  });

  it('the clock stays pass-through except for the control inside it', () => {
    // The pill sits over the panels; taps must fall through to them. The one
    // button in it opts back in, and nothing else may.
    expect(ruleBody(enhancements, '.game-board-clock')).toContain('pointer-events: none');
    expect(ruleBody(enhancements, '.game-clock-start')).toContain('pointer-events: auto');
  });

  it('every board touch floor lives inside a coarse-pointer block', () => {
    // A floor applied unconditionally would inflate the desktop board, where
    // a mouse needs no 44px. Each of these selectors must appear only after a
    // `@media (pointer: coarse)` opener.
    for (const sel of ['.player-panel-step-btn::after', '.player-panel-name::after']) {
      const at = board.indexOf(sel);
      const coarseBefore = board.lastIndexOf('@media (pointer: coarse)', at);
      expect(coarseBefore, `${sel} is not inside a coarse-pointer block`).toBeGreaterThan(-1);
    }
  });
});

/**
 * The seam is the board's only gutter and it runs along ONE axis. A wide pill
 * fits a row seam's horizontal gutter and spills onto the panels either side
 * of a column seam's vertical one — where it landed on a seat's name label
 * (4p-sides, 2p side-by-side). The clock therefore has to know which it is.
 */
describe('table clock follows the seam orientation', () => {
  it('declares a column-seam variant that stacks and narrows', () => {
    expect(enhancements).toContain('.game-board-clock.is-col-seam');
    const stacked = enhancements.match(
      /\.game-board-clock\.is-col-seam \.game-clock\s*\{([^}]*)\}/
    )?.[1];
    expect(stacked, 'the col-seam clock must stack its two readings').toBeTruthy();
    expect(stacked).toContain('flex-direction: column');
    const pill = enhancements.match(/\.game-board-clock\.is-col-seam\s*\{([^}]*)\}/)?.[1];
    expect(pill, 'the col-seam pill must be capped in width').toBeTruthy();
    expect(pill).toMatch(/max-width:/);
  });

  it('rotates the turn divider with the stack instead of keeping a left border', () => {
    const turn = enhancements.match(
      /\.game-board-clock\.is-col-seam \.game-clock-turn\s*\{([^}]*)\}/
    )?.[1];
    expect(turn).toBeTruthy();
    expect(turn).toContain('border-left: 0');
    expect(turn).toMatch(/border-top:/);
  });
});
