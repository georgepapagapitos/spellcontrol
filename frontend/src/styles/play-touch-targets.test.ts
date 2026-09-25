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
 * Every body declared for a selector, joined.
 *
 * ALL of them, not the first: a selector legitimately appears twice — once
 * in the base sheet and again inside `@media (pointer: coarse)` — and
 * matching only the first made this file assert against the base rule and
 * miss the floor that was right there. The coarse-block placement is
 * asserted separately below. Module-scoped so every describe block below
 * (not only the first) can use it.
 */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodies = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
  return bodies.length > 0 ? bodies.join('\n') : null;
}

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

  it('the clock strip Pause button (icon-only, no label) also gets a min-width floor', () => {
    // F11: Start/Pass carry a text label so their own padding clears 44px
    // wide; Pause swaps its glyph instead of relabeling to "Resume", and
    // measured 31x44 on a phone / 39x44 on a tablet — min-height alone left
    // its narrow axis short.
    const at = enhancements.indexOf('min-width: 2.75rem');
    expect(at, 'no min-width: 2.75rem floor on the strip button').toBeGreaterThan(-1);
    expect(enhancements.lastIndexOf('@media (pointer: coarse)', at)).toBeGreaterThan(-1);
    // The floor must live in the SAME rule as min-height, or it could land in
    // an unrelated selector and pass this assertion without fixing anything.
    const body = ruleBody(enhancements, '.game-clock-strip-btn');
    expect(body).toMatch(/min-width:\s*2\.75rem/);
    expect(body).toMatch(/min-height:\s*2\.75rem/);
  });

  it('the undo seam satellite is a real 44px circle on phones, not 2.6rem (42px)', () => {
    // F11: measured 42x42 on a phone — no ghost on this control, so its own
    // box has to clear the floor.
    const body = ruleBody(enhancements, '.game-board-undo-btn');
    expect(body, '.game-board-undo-btn is missing').toBeTruthy();
    expect(body).toMatch(/width:\s*2\.75rem/);
    expect(body).toMatch(/height:\s*2\.75rem/);
    expect(body).not.toMatch(/width:\s*2\.6rem/);
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

/**
 * F1 (P0): `.game-board`'s touch-action: manipulation still lets the browser
 * treat a drag past the touch slop as a native pan, which cancels the
 * pointer stream (pointercancel) before useTapAndHold's 40px swipe threshold
 * fires — measured 0/4 fast swipes opening anything on a real touch screen.
 * The fix is scoped to the gesture surface itself, never a shared ancestor:
 * touch-action only narrows down the DOM ancestor chain (a descendant can
 * restrict it further, never re-open it), so putting `none` on `.player-panel`
 * or `.game-board` would also silence the seat drawer and game menu sheets
 * nested inside them, which must keep scrolling by touch.
 */
describe('F1: a fast swipe on the panel is not cancelled by the browser', () => {
  it('every tap-zone half stops the browser from taking the gesture as a pan', () => {
    const body = ruleBody(board, '.player-panel-tapzone');
    expect(body, '.player-panel-tapzone is missing').toBeTruthy();
    expect(body).toMatch(/touch-action:\s*none/);
  });

  it('is scoped to the tap zone, not a shared ancestor of the seat drawer', () => {
    // touch-action narrows down the ancestor chain and can never be re-opened
    // by a descendant, so `.player-panel` (the seat drawer's actual parent)
    // must NOT carry `none`, or the drawer body below would stop scrolling.
    const panel = ruleBody(board, '.player-panel') ?? '';
    expect(panel).not.toMatch(/touch-action:\s*none/);
    const gameBoard = ruleBody(board, '.game-board') ?? '';
    expect(gameBoard).not.toMatch(/touch-action:\s*none/);
  });

  it('the seat drawer body and the game menu sheet keep scrolling by touch', () => {
    const drawerBody = ruleBody(panelMenus, '.seat-menu-body');
    expect(drawerBody, '.seat-menu-body is missing').toBeTruthy();
    expect(drawerBody).toMatch(/touch-action:\s*pan-y/);
    const menuBody = ruleBody(panelMenus, '.game-menu-body');
    expect(menuBody, '.game-menu-body is missing').toBeTruthy();
    expect(menuBody).toMatch(/touch-action:\s*pan-y/);
  });
});

/**
 * F2 (P0): the ± buttons sit at the exact centre of each tap-zone half and,
 * as real buttons, intercepted pointerdown ahead of useTapAndHold — a long
 * press on the visible "+" gave +1 (not the zone's +10) and a swipe starting
 * on one did nothing. Lotus's model: on a coarse pointer the ± are hints,
 * not hit targets, so the zone underneath carries every gesture.
 */
describe('F2: the ± glyphs are hints on touch, not their own hit target', () => {
  const sel = '.player-panel-life-wrap > .player-panel-step-btn';

  it('goes pointer-events: none on a coarse pointer, falling through to the tap zone', () => {
    // The selector legitimately appears twice (base rule + coarse override),
    // same convention as the rest of this file — ruleBody joins both bodies.
    const body = ruleBody(board, sel);
    expect(body, `${sel} is missing`).toBeTruthy();
    expect(body).toMatch(/pointer-events:\s*auto/);
    expect(body).toMatch(/pointer-events:\s*none/);
    // The `none` must live specifically inside a coarse-pointer block, not
    // stand alone as a second unconditional rule that would just win by
    // source order and break mouse/trackpad too.
    expect(board).toMatch(
      /@media \(pointer: coarse\) \{\s*\.player-panel-life-wrap > \.player-panel-step-btn \{\s*pointer-events:\s*none;/
    );
  });

  it('stays a real button on a fine pointer — the base rule is unconditional auto', () => {
    // The base (mouse/trackpad) rule keeps pointer-events: auto with no
    // pointer-coarse guard around it — only the override is conditional.
    expect(board).toMatch(
      /\.player-panel-life-wrap > \.player-panel-step-btn \{\s*position: absolute;\s*top: 50%;\s*pointer-events:\s*auto;\s*\}/
    );
  });

  it('the 24x24 life-numeral keypad button is untouched — it stays a real hit target on touch', () => {
    // This one is INTENTIONAL (project_life_counter_board_invariants): a
    // stray tap should fall through to ±1, not open the keypad.
    const body = ruleBody(board, '.player-panel-life-wrap > .player-panel-life-btn');
    expect(body).toMatch(/pointer-events:\s*auto/);
    expect(board).not.toMatch(
      /@media \(pointer: coarse\)\s*\{[^}]*\.player-panel-life-btn[^}]*pointer-events:\s*none/
    );
  });
});
