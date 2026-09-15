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

  it('only the seat holding the turn pays for the turn chip', () => {
    // The narrow-panel name cap reserves room for the wide chip, and exactly
    // one panel has one. Applying it to every panel made all four seats
    // truncate at 320px for something only the active seat carries.
    const narrow = counters.match(/@container \(max-width: 11rem\)\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(narrow, 'the narrow-panel container query is missing').toBeTruthy();
    expect(narrow).toMatch(
      /\.player-panel\.is-active-turn[^{]*\.player-panel-corner\.is-tl\s*\{[^}]*max-width/
    );
    // The label drop needs no such scope — it only matters where a chip is.
    expect(narrow).toMatch(/\.pp-turn-chip-label\s*\{\s*display:\s*none/);
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
