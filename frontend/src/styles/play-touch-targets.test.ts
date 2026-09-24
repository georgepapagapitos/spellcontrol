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

  it("the clock's pass-turn segment carries a ghost inside a coarse-pointer block", () => {
    // Passing the turn moved off the seat and into the clock's turn segment,
    // a ~20px line inside a pill that must not grow.
    const at = enhancements.indexOf('button.game-clock-turn::after');
    expect(at, 'button.game-clock-turn::after is missing').toBeGreaterThan(-1);
    expect(enhancements.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
    expect(ruleBody(enhancements, 'button.game-clock-turn::after')).toMatch(/height:\s*2\.75rem/);
    expect(ruleBody(enhancements, 'button.game-clock-turn')).toContain('pointer-events: auto');
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

  it('the edge-anchored clock is capped against the board edge', () => {
    // Anchoring by the near edge pushed the pill 5px off a 320px screen. The
    // cap plus min-width:0 down the flex chain lets the name ellipsis absorb
    // it instead — without the min-width:0 the nowrap children refuse to
    // shrink and the cap does nothing.
    const pill = enhancements.match(/\.game-board-clock\.is-row-seam\s*\{([^}]*)\}/)?.[1];
    expect(pill, 'the row-seam clock needs a width cap').toBeTruthy();
    expect(pill).toMatch(/max-width:\s*calc\(50%/);
    for (const sel of ['.game-clock', '.game-clock-turn', '.game-clock-turn-name']) {
      const body = enhancements.match(
        new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`)
      )?.[1];
      expect(body, `${sel} must allow shrinking`).toMatch(/min-width:\s*0/);
    }
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
