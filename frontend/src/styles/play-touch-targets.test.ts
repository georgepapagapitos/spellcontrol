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
const setup = read('play-setup.css');
const panelMenus = read('play-panel-menus.css');

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

  it('the setup form\'s "Add player" button takes the coarse floor its siblings have', () => {
    // Measured 110x39 with a coarse pointer at 390 and 820 (playtest batch 7)
    // while the seat remove/clear buttons beside it sat at 44.
    const body = ruleBody(setup, '.play-setup-roster .play-setup-roster-add');
    expect(body, 'no coarse floor for .play-setup-roster-add').toBeTruthy();
    expect(body).toMatch(/min-height:\s*44px/);
    const at = setup.indexOf('.play-setup-roster .play-setup-roster-add');
    expect(setup.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
  });

  it('a seat carries no buttons: its counters are read-only badges taps pass through', () => {
    // Lotus's model (2026-09-24): the ⋯ button, the counter chips and the turn
    // chip all moved into the seat drawer, so every pixel of a seat is a life
    // tap. A badge that took pointer events would eat the −1/+1 beneath it.
    expect(ruleBody(counters, '.player-panel-counters')).toMatch(/pointer-events:\s*none/);
    for (const gone of ['.pp-counter-chip', '.pp-turn-chip', '.player-panel-menu-btn']) {
      expect(counters + board, `${gone} came back onto the seat`).not.toContain(gone);
    }
  });

  it("the drawer's strip, the way back to the seat, is a full-height 44px target", () => {
    expect(ruleBody(panelMenus, '.seat-menu-strip')).toMatch(/flex:\s*0 0 2\.75rem/);
  });

  it('the clock strip buttons take a real 44px floor on coarse pointers, no ghost needed', () => {
    // Unlike the old floating seam pill, the strip has genuine room below the
    // grid, so Start/Pause/Pass are real 44px boxes rather than a compact
    // chip with an invisible ghost.
    const body = ruleBody(enhancements, '.game-clock-strip-btn');
    expect(body, '.game-clock-strip-btn is missing').toBeTruthy();
    const at = enhancements.indexOf('min-height: 2.75rem');
    expect(at, 'no min-height: 2.75rem floor on the strip button').toBeGreaterThan(-1);
    expect(enhancements.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
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
 * Seam keep-out (E299/E310). The board's seam furniture — hub, undo, clock —
 * sits on a boundary that runs along a panel EDGE, and every panel puts a
 * cluster at its corners, so the two collide unless the panels hold back.
 * `.claude/tools/seam-geometry-scratch.mjs` measured it across all 16 preset
 * layouts: the clock covered 766px² of a name on `4p-sides`, 383px² on
 * `4p-pod` (the default four-player board), the hub nicked two names at 76px²
 * each, and the turn chip lost 447px² on `3p-tr-bb`.
 */
describe('panel corners hold back from the seam', () => {
  it('both corner rails inset by the keep-out, on both axes', () => {
    // Both axes, because at a corner either edge leads away from it — a
    // single-axis inset cleared the hub and left the clock overlapping.
    expect(board).toMatch(/\.player-panel\s*\{[^}]*--seam-keepout:\s*[\d.]+rem/);
    const corner = board.match(/\.player-panel-corner\s*\{([^}]*)\}/)?.[1];
    expect(corner).toMatch(/top:\s*calc\([^;]*--seam-keepout/);
    expect(board).toMatch(
      /\.player-panel-corner\.is-tl\s*\{[^}]*left:\s*calc\([^;]*--seam-keepout/
    );
    const chips = counters.match(/\.pp-designation-chips\s*\{([^}]*)\}/)?.[1];
    expect(chips, 'the chip rail carries the turn chip and sits at a corner too').toBeTruthy();
    expect(chips).toMatch(/top:\s*calc\([^;]*--seam-keepout/);
    expect(chips).toMatch(/right:\s*calc\([^;]*--seam-keepout/);
  });

  it('applies on every layout, not only the grid ones', () => {
    // An earlier attempt gated this on `cols > 1`, which reads as "grid boards
    // only" but silently included 2p-stacked (its seats span both columns) —
    // and 2p-stacked genuinely needs it (98px² clock-on-name). The token is
    // declared unconditionally on the panel; nothing may reset it to 0.
    expect(board).not.toMatch(/--seam-keepout:\s*0(px)?\s*;/);
  });
});

/**
 * The table clock: an edge strip along the board's bottom (2026-09-24
 * ruling), replacing the old seam-satellite pill that used to need a
 * row/column-seam variant. These pin the three properties that ruling
 * depends on: it's a flex sibling that shrinks the grid rather than
 * overlaying it, it sits inside `.game-board`'s existing safe-area padding,
 * and its buttons take a real touch floor (covered above).
 */
describe('table clock is an edge strip, not a seam satellite', () => {
  it('the old seam-satellite classes are gone', () => {
    for (const gone of [
      '.game-board-clock',
      'game-clock-total',
      'game-clock-turn',
      'game-clock-start',
    ]) {
      expect(enhancements, `${gone} should have been removed with the seam pill`).not.toContain(
        gone
      );
    }
  });

  it('the board stacks the grid and the strip in a column, not an overlay', () => {
    const gameBoard = board.match(/\.game-board\s*\{([^}]*)\}/)?.[1];
    expect(gameBoard, '.game-board is missing').toBeTruthy();
    expect(gameBoard).toMatch(/flex-direction:\s*column/);
    // The strip has no position: absolute / fixed anywhere — it takes its
    // place in the flex flow instead of floating over the seat grid.
    const strip = enhancements.match(/\.game-clock-strip\s*\{([^}]*)\}/)?.[1];
    expect(strip, '.game-clock-strip is missing').toBeTruthy();
    expect(strip).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(strip).toMatch(/flex:\s*0 0 auto/);
  });

  it("sits inside .game-board's existing safe-area padding rather than adding its own", () => {
    // .game-board already pads every side for env(safe-area-inset-*); the
    // strip being a normal flex child of that padded box is what keeps it
    // clear of a home indicator, so this only needs to hold that padding
    // still covers the bottom edge — no separate inset on the strip itself.
    const gameBoard = board.match(/\.game-board\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(gameBoard).toMatch(/--safe-bottom/);
    expect(enhancements).not.toMatch(/\.game-clock-strip[^{]*\{[^}]*safe-area-inset/);
  });
});
